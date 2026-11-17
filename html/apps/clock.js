/* ==========================================================================
   Nexora Phone - Clock
   Clock face, alarms (stored per character), stopwatch and timer.

   Alarms follow the phone's clock (the in-game clock or the real one, see
   Config.ClockSource) and also ring while the phone is in the pocket.
   Stopwatch and timer always run on real time.
   ========================================================================== */
(() => {
    'use strict';

    const { h, fill, icon, ui, format, state, sound, DAYS } = Nexora;

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const TITLES = { clock: 'Clock', alarms: 'Alarms', stopwatch: 'Stopwatch', timer: 'Timer' };
    const RING_TIME = 45000; // an unattended alarm stops by itself

    let nav = null;
    let pane = null;
    let title = null;
    let actions = null;
    let current = 'clock';
    let stopPane = null; // tears down the timers of the visible pane

    const pad = (value) => String(value).padStart(2, '0');

    function svg(tag, attributes, ...children) {
        const node = document.createElementNS(SVG_NS, tag);

        for (const key of Object.keys(attributes || {})) node.setAttribute(key, attributes[key]);
        for (const child of children) if (child) node.append(child);

        return node;
    }

    /* ====================================================================== */
    /* Ringing (shared by alarms and the timer)                                */
    /* ====================================================================== */

    let ringing = null; // { title, body, modal, outside, timeout }

    function stopRing() {
        if (!ringing) return;

        const active = ringing;
        ringing = null;

        sound.stop();
        clearTimeout(active.timeout);

        if (active.modal && !active.modal.closed) active.modal.close(null);
        if (active.outside) active.outside.remove();
    }

    function showRingDialog() {
        if (!ringing || (ringing.modal && !ringing.modal.closed)) return;

        ringing.modal = ui.modal([
            h('span', { class: 'ring-icon' }, icon('alarm', 34)),
            h('div', { class: 'dialog-title' }, ringing.title),
            h('div', { class: 'dialog-text' }, ringing.body),
            h('div', { class: 'dialog-actions' }, ui.button('Stop', { onClick: stopRing })),
        ], { onClose: stopRing });
    }

    function ring(heading, body) {
        stopRing();

        ringing = { title: heading, body, modal: null, outside: null, timeout: setTimeout(stopRing, RING_TIME) };

        sound.loop('alarm');

        // Keeps a trace in the notification centre; the ringing is the alert.
        Nexora.notify({ app: 'clock', title: heading, body, silent: true });

        if (state.visible) {
            showRingDialog();
        } else if (Nexora.config.notifications.showWhenClosed) {
            ringing.outside = Nexora.outside.push(Nexora.noteCard({
                app: 'clock',
                title: heading,
                body: `${body} - open your phone to stop`,
                ts: Math.floor(Date.now() / 1000),
            }, { compact: true }));
        }
    }

    Nexora.on('visible', (visible) => {
        if (!visible || !ringing) return;

        if (ringing.outside) {
            ringing.outside.remove();
            ringing.outside = null;
        }

        showRingDialog();
    });

    /* ====================================================================== */
    /* Clock face                                                              */
    /* ====================================================================== */

    function clockPane() {
        const gameClock = Nexora.config.clockSource === 'game';

        const hourHand = svg('line', { x1: 100, y1: 100, x2: 100, y2: 54, class: 'hand hour' });
        const minuteHand = svg('line', { x1: 100, y1: 100, x2: 100, y2: 30, class: 'hand minute' });
        const secondHand = svg('line', { x1: 100, y1: 114, x2: 100, y2: 24, class: 'hand second' });

        const marks = [];
        for (let i = 0; i < 60; i++) {
            const major = i % 5 === 0;
            marks.push(svg('line', {
                x1: 100,
                y1: major ? 9 : 12,
                x2: 100,
                y2: major ? 20 : 15,
                class: major ? 'mark major' : 'mark',
                transform: `rotate(${i * 6} 100 100)`,
            }));
        }

        if (gameClock) secondHand.style.display = 'none';

        const face = svg('svg', { viewBox: '0 0 200 200', class: 'clock-face' },
            svg('circle', { cx: 100, cy: 100, r: 97, class: 'clock-rim' }),
            ...marks, hourHand, minuteHand, secondHand,
            svg('circle', { cx: 100, cy: 100, r: 4.5, class: 'clock-pin' }));

        const digital = h('div', { class: 'clock-digital' });
        const date = h('div', { class: 'clock-date' });

        const draw = () => {
            const time = Nexora.clock.now();
            const seconds = gameClock ? 0 : new Date().getSeconds();

            hourHand.setAttribute('transform', `rotate(${(time.h % 12) * 30 + time.m * 0.5} 100 100)`);
            minuteHand.setAttribute('transform', `rotate(${time.m * 6 + seconds * 0.1} 100 100)`);
            secondHand.setAttribute('transform', `rotate(${seconds * 6} 100 100)`);

            digital.textContent = format.clock(time.h, time.m);
            date.textContent = Nexora.clock.dateText(time);
        };

        draw();

        const timer = setInterval(draw, 1000);
        stopPane = () => clearInterval(timer);

        return h('div', { class: 'clock-pane' },
            face, digital, date,
            h('div', { class: 'clock-source' }, gameClock ? 'City time' : 'Local time'));
    }

    /* ====================================================================== */
    /* Alarms                                                                  */
    /* ====================================================================== */

    const reportAlarms = () => Nexora.post('alarms:active', {
        active: state.alarms.some((alarm) => alarm.enabled),
    });

    async function saveAlarms() {
        const result = await Nexora.request('clock:saveAlarms', state.alarms);

        if (!result.ok) {
            ui.error(result.error);
            return false;
        }

        state.alarms = Nexora.list(result.alarms);
        reportAlarms();

        return true;
    }

    function repeatText(alarm) {
        const days = alarm.days || [];
        const count = days.filter(Boolean).length;

        if (count === 0) return 'Once';
        if (count === 7) return 'Every day';
        if (count === 5 && !days[0] && !days[6]) return 'Weekdays';
        if (count === 2 && days[0] && days[6]) return 'Weekends';

        return DAYS.filter((_, index) => days[index]).map((day) => day.slice(0, 3)).join(' ');
    }

    function openAlarm(alarm) {
        const editing = !!alarm;

        if (!editing && state.alarms.length >= Nexora.config.alarms.maxAlarms) {
            ui.error('limit');
            return;
        }

        const use24 = state.settings.use24h !== false;
        const time = Nexora.clock.now();

        let hour = editing ? alarm.hour : time.h;
        let minute = editing ? alarm.minute : time.m;
        const days = Array.from({ length: 7 }, (_, index) => editing && alarm.days && alarm.days[index] === true);

        const hourText = h('span', { class: 'stepper-value' });
        const minuteText = h('span', { class: 'stepper-value' });
        const period = use24 ? null : h('button', { class: 'chip on period', type: 'button' });

        const draw = () => {
            hourText.textContent = use24 ? pad(hour) : String(hour % 12 || 12);
            minuteText.textContent = pad(minute);
            if (period) period.textContent = hour >= 12 ? 'PM' : 'AM';
        };

        const stepper = (text, change) => {
            const step = (amount) => { change(amount); draw(); };

            return h('div', {
                class: 'stepper',
                onwheel: (event) => { event.preventDefault(); step(event.deltaY < 0 ? 1 : -1); },
            },
            h('button', { class: 'stepper-btn', type: 'button', onclick: () => step(1) }, icon('chevron-up', 20)),
            text,
            h('button', { class: 'stepper-btn', type: 'button', onclick: () => step(-1) }, icon('chevron-down', 20)));
        };

        if (period) {
            period.addEventListener('click', () => {
                hour = (hour + 12) % 24;
                draw();
            });
        }

        const label = h('input', {
            class: 'input',
            placeholder: 'Label (optional)',
            maxLength: 30,
            autocomplete: 'off',
            spellcheck: false,
        });
        label.value = editing ? alarm.label || '' : '';

        const dayChips = DAYS.map((day, index) => {
            const chip = h('button', { class: `chip day${days[index] ? ' on' : ''}`, type: 'button', title: day },
                day.slice(0, 1));

            chip.addEventListener('click', () => {
                days[index] = !days[index];
                chip.classList.toggle('on', days[index]);
            });

            return chip;
        });

        const finish = async (list) => {
            const before = state.alarms;
            state.alarms = list;

            if (await saveAlarms()) {
                nav.pop();
                showPane('alarms');
            } else {
                state.alarms = before;
            }
        };

        const save = () => {
            const next = {
                id: editing ? alarm.id : Math.floor(Math.random() * 2000000000) + 1,
                hour,
                minute,
                label: label.value.trim(),
                enabled: true,
                days,
            };

            finish(editing
                ? state.alarms.map((item) => (item.id === alarm.id ? next : item))
                : state.alarms.concat(next));
        };

        draw();

        nav.push(ui.view({
            title: editing ? 'Edit alarm' : 'New alarm',
            back: () => nav.pop(),
            actions: [editing
                ? {
                    icon: 'trash',
                    label: 'Delete alarm',
                    onClick: () => finish(state.alarms.filter((item) => item.id !== alarm.id)),
                }
                : null],
            body: [
                h('div', { class: 'time-picker' },
                    stepper(hourText, (amount) => { hour = (hour + amount + 24) % 24; }),
                    h('span', { class: 'time-colon' }, ':'),
                    stepper(minuteText, (amount) => { minute = (minute + amount + 60) % 60; }),
                    period),
                h('div', { class: 'section' },
                    h('div', { class: 'section-title' }, 'Repeat'),
                    h('div', { class: 'day-row' }, dayChips)),
                h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Label'), label),
            ],
            footer: ui.button('Save alarm', { block: true, onClick: save }),
        }));
    }

    function alarmsPane() {
        fill(actions, h('button', {
            class: 'icon-btn accent',
            type: 'button',
            title: 'Add alarm',
            onclick: () => openAlarm(null),
        }, icon('plus')));

        const alarms = [...state.alarms].sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));

        if (!alarms.length) {
            return h('div', { class: 'pane-scroll' }, ui.empty('alarm', 'No alarms', 'Tap + to set one.'));
        }

        return h('div', { class: 'pane-scroll' }, h('div', { class: 'card' }, alarms.map((alarm) => {
            const row = h('div', { class: `row alarm-row${alarm.enabled ? '' : ' off'}` },
                h('button', { class: 'alarm-main', type: 'button', onclick: () => openAlarm(alarm) },
                    h('span', { class: 'alarm-time' }, format.clock(alarm.hour, alarm.minute)),
                    h('span', { class: 'alarm-info' },
                        [alarm.label, repeatText(alarm)].filter(Boolean).join(' - '))),
                ui.toggle(alarm.enabled, async (value, node) => {
                    alarm.enabled = value;
                    row.classList.toggle('off', !value);

                    if (await saveAlarms()) {
                        if (current === 'alarms') showPane('alarms');
                    } else {
                        alarm.enabled = !value;
                        row.classList.toggle('off', value);
                        node.set(!value);
                    }
                }));

            return row;
        })));
    }

    // Fire alarms whose time was reached since the previous clock tick. The
    // in-game clock can skip minutes, so this checks the range that passed.
    let lastTick = null;

    Nexora.on('minute', (time) => {
        const minuteOfDay = time.h * 60 + time.m;
        const previous = lastTick;

        lastTick = minuteOfDay;

        if (previous === null || !state.ready) return;

        const gap = (minuteOfDay - previous + 1440) % 1440;
        if (gap === 0 || gap > 30) return; // unchanged, or the clock was set by hand

        let changed = false;

        for (const alarm of state.alarms) {
            if (!alarm.enabled) continue;

            const at = alarm.hour * 60 + alarm.minute;
            const since = (at - previous + 1440) % 1440;
            if (since === 0 || since > gap) continue;

            const days = alarm.days || [];
            const repeats = days.some(Boolean);

            // An alarm time "after" now was reached before midnight: yesterday.
            const day = at <= minuteOfDay ? time.dow : (time.dow + 6) % 7;
            if (repeats && !days[day]) continue;

            if (!repeats) {
                alarm.enabled = false;
                changed = true;
            }

            ring('Alarm', alarm.label || format.clock(alarm.hour, alarm.minute));
        }

        if (changed) {
            saveAlarms().then(() => {
                if (pane && current === 'alarms' && nav.depth === 1) showPane('alarms');
            });
        }
    });

    /* ====================================================================== */
    /* Stopwatch                                                               */
    /* ====================================================================== */

    const stopwatch = { running: false, startedAt: 0, elapsed: 0, laps: [] };

    const stopwatchTime = () => stopwatch.elapsed
        + (stopwatch.running ? performance.now() - stopwatch.startedAt : 0);

    function formatStopwatch(ms) {
        const hundredths = Math.floor(ms / 10);
        const hours = Math.floor(hundredths / 360000);

        return `${hours ? `${hours}:` : ''}${pad(Math.floor(hundredths / 6000) % 60)}:`
            + `${pad(Math.floor(hundredths / 100) % 60)}.${pad(hundredths % 100)}`;
    }

    function stopwatchPane() {
        const display = h('div', { class: 'big-time' });
        const laps = h('div', { class: 'lap-list' });
        const left = ui.button('', { variant: 'ghost' });
        const right = ui.button('');
        let frame = 0;

        const drawLaps = () => fill(laps, stopwatch.laps.length
            ? h('div', { class: 'card' }, stopwatch.laps.map((lap, index) => ui.row({
                title: `Lap ${stopwatch.laps.length - index}`,
                subtitle: formatStopwatch(lap.total),
                trail: formatStopwatch(lap.split),
            })))
            : null);

        const drawButtons = () => {
            left.textContent = stopwatch.running ? 'Lap' : 'Reset';
            left.disabled = !stopwatch.running && stopwatch.elapsed === 0;
            right.textContent = stopwatch.running ? 'Stop' : 'Start';
            right.className = `btn ${stopwatch.running ? 'danger' : 'primary'}`;
        };

        const loop = () => {
            display.textContent = formatStopwatch(stopwatchTime());
            frame = stopwatch.running ? requestAnimationFrame(loop) : 0;
        };

        left.addEventListener('click', () => {
            if (stopwatch.running) {
                const total = stopwatchTime();
                const previous = stopwatch.laps[0] ? stopwatch.laps[0].total : 0;
                stopwatch.laps.unshift({ total, split: total - previous });
            } else {
                stopwatch.elapsed = 0;
                stopwatch.laps = [];
            }

            drawLaps();
            drawButtons();
            cancelAnimationFrame(frame);
            loop();
        });

        right.addEventListener('click', () => {
            if (stopwatch.running) {
                stopwatch.elapsed = stopwatchTime();
                stopwatch.running = false;
            } else {
                stopwatch.startedAt = performance.now();
                stopwatch.running = true;
            }

            drawButtons();
            cancelAnimationFrame(frame);
            loop();
        });

        drawButtons();
        drawLaps();
        loop();

        stopPane = () => cancelAnimationFrame(frame);

        return h('div', { class: 'pane-scroll timer-pane' },
            display,
            h('div', { class: 'pair' }, left, right),
            laps);
    }

    /* ====================================================================== */
    /* Timer                                                                   */
    /* ====================================================================== */

    const PRESETS = [1, 3, 5, 10, 15, 30];
    const RING_LENGTH = 2 * Math.PI * 88;

    const timer = { total: 0, remaining: 0, endsAt: 0, running: false, handle: null };
    let setMinutes = 5;
    let setSeconds = 0;

    const timerLeft = () => (timer.running ? Math.max(0, timer.endsAt - Date.now()) : timer.remaining);

    function cancelTimer() {
        clearTimeout(timer.handle);
        timer.total = 0;
        timer.remaining = 0;
        timer.running = false;
        timer.handle = null;
    }

    function timerDone() {
        cancelTimer();
        ring('Timer', 'Time is up');

        if (pane && current === 'timer') showPane('timer');
    }

    function resumeTimer() {
        timer.endsAt = Date.now() + timer.remaining;
        timer.running = true;

        clearTimeout(timer.handle);
        timer.handle = setTimeout(timerDone, timer.remaining);
    }

    function pauseTimer() {
        timer.remaining = timerLeft();
        timer.running = false;
        clearTimeout(timer.handle);
    }

    function timerSetup() {
        const minuteText = h('span', { class: 'stepper-value' });
        const secondText = h('span', { class: 'stepper-value' });
        const start = ui.button('Start', { block: true });

        const draw = () => {
            minuteText.textContent = pad(setMinutes);
            secondText.textContent = pad(setSeconds);
            start.disabled = setMinutes === 0 && setSeconds === 0;
        };

        const stepper = (text, change) => {
            const step = (amount) => { change(amount); draw(); };

            return h('div', {
                class: 'stepper',
                onwheel: (event) => { event.preventDefault(); step(event.deltaY < 0 ? 1 : -1); },
            },
            h('button', { class: 'stepper-btn', type: 'button', onclick: () => step(1) }, icon('chevron-up', 20)),
            text,
            h('button', { class: 'stepper-btn', type: 'button', onclick: () => step(-1) }, icon('chevron-down', 20)));
        };

        start.addEventListener('click', () => {
            timer.total = (setMinutes * 60 + setSeconds) * 1000;
            timer.remaining = timer.total;
            resumeTimer();
            showPane('timer');
        });

        draw();

        return h('div', { class: 'pane-scroll timer-pane' },
            h('div', { class: 'time-picker' },
                stepper(minuteText, (amount) => { setMinutes = (setMinutes + amount + 100) % 100; }),
                h('span', { class: 'time-colon' }, ':'),
                stepper(secondText, (amount) => { setSeconds = (setSeconds + amount * 5 + 60) % 60; })),
            h('div', { class: 'time-units' }, h('span', null, 'min'), h('span', null, 'sec')),
            h('div', { class: 'preset-row' }, PRESETS.map((minutes) => h('button', {
                class: 'chip',
                type: 'button',
                onclick: () => { setMinutes = minutes; setSeconds = 0; draw(); },
            }, `${minutes} min`))),
            start);
    }

    function timerRunning() {
        const progress = svg('circle', {
            cx: 100, cy: 100, r: 88, class: 'timer-progress', transform: 'rotate(-90 100 100)',
        });
        progress.style.strokeDasharray = String(RING_LENGTH);

        const display = h('div', { class: 'timer-left' });
        const toggle = ui.button('', { variant: 'soft' });
        let frame = 0;

        const draw = () => {
            const left = timerLeft();

            display.textContent = format.duration(Math.ceil(left / 1000));
            progress.style.strokeDashoffset = String(RING_LENGTH * (1 - (timer.total ? left / timer.total : 0)));
            toggle.textContent = timer.running ? 'Pause' : 'Resume';

            frame = timer.running ? requestAnimationFrame(draw) : 0;
        };

        toggle.addEventListener('click', () => {
            if (timer.running) pauseTimer();
            else resumeTimer();

            cancelAnimationFrame(frame);
            draw();
        });

        draw();
        stopPane = () => cancelAnimationFrame(frame);

        return h('div', { class: 'pane-scroll timer-pane' },
            h('div', { class: 'timer-ring' },
                svg('svg', { viewBox: '0 0 200 200' },
                    svg('circle', { cx: 100, cy: 100, r: 88, class: 'timer-track' }),
                    progress),
                display),
            h('div', { class: 'pair' },
                ui.button('Cancel', {
                    variant: 'ghost',
                    onClick: () => { cancelTimer(); showPane('timer'); },
                }),
                toggle));
    }

    /* ====================================================================== */
    /* App                                                                     */
    /* ====================================================================== */

    const PANES = {
        clock: clockPane,
        alarms: alarmsPane,
        stopwatch: stopwatchPane,
        timer: () => (timer.total > 0 ? timerRunning() : timerSetup()),
    };

    function showPane(id) {
        if (stopPane) stopPane();
        stopPane = null;

        current = id;
        title.textContent = TITLES[id];

        fill(actions);
        fill(pane, PANES[id]());
    }

    Nexora.registerApp({
        id: 'clock',
        icon: 'clock',
        colors: ['#a78bfa', '#6d28d9'],

        mount(root) {
            nav = ui.stack(root);
            title = h('h1', { class: 'view-title' });
            actions = h('div', { class: 'view-actions' });
            pane = h('div', { class: 'phone-pane' });

            const tabs = ui.tabs([
                { id: 'clock', label: 'Clock', icon: 'clock' },
                { id: 'alarms', label: 'Alarms', icon: 'alarm' },
                { id: 'stopwatch', label: 'Stopwatch', icon: 'stopwatch' },
                { id: 'timer', label: 'Timer', icon: 'timer' },
            ], current, showPane);

            nav.reset(h('section', { class: 'view' },
                h('header', { class: 'view-header' }, h('div', { class: 'view-titles' }, title), actions),
                pane,
                tabs));
        },

        open() {
            showPane(current);
        },

        // Nothing has to tick while the app is in the background.
        close() {
            if (stopPane) stopPane();
            stopPane = null;
        },

        back() {
            return nav.pop();
        },
    });

    Nexora.on('bootstrap', () => {
        lastTick = null;
        stopRing();
        cancelTimer();

        stopwatch.running = false;
        stopwatch.elapsed = 0;
        stopwatch.laps = [];

        reportAlarms();

        if (nav) nav.popToRoot();
        if (pane && Nexora.state.current === 'clock') showPane(current);
    });

    Nexora.on('reset', () => {
        stopRing();
        cancelTimer();
    });
})();
