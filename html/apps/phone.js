/* ==========================================================================
   Nexora Phone - Phone
   Dial pad, call history, quick contact list and the call screen (incoming,
   outgoing, connected). The call screen is a global overlay so a call can be
   answered from the lock screen and survives switching apps.
   ========================================================================== */
(() => {
    'use strict';

    const { h, fill, icon, ui, format, state, sound } = Nexora;

    const KEYS = [
        ['1', ''], ['2', 'ABC'], ['3', 'DEF'],
        ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
        ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'],
        ['*', ''], ['0', '+'], ['#', ''],
    ];

    const TITLES = { keypad: 'Keypad', recents: 'Recents', contacts: 'Contacts' };
    const MAX_DIGITS = 15;

    let pane = null;
    let title = null;
    let actions = null;
    let tabs = null;
    let current = 'keypad';
    let keypad = null;          // { update, press, erase } of the visible dial pad
    let dialed = '';
    let hideId = false;
    let history = null;         // cached call log
    let contactQuery = '';

    /* ====================================================================== */
    /* Call screen                                                             */
    /* ====================================================================== */

    const screenEl = Nexora.$('#call');
    const phoneEl = Nexora.$('#phone');

    /** @type {{ id: ?number, number: ?string, anonymous: boolean, direction: 'in'|'out',
     *           state: 'ringing'|'active'|'ended', startedAt?: number, endText?: string,
     *           pending?: boolean, cancelled?: boolean }|null} */
    let call = null;
    let shown = false;          // call screen visible (false = running in the background)
    let statusEl = null;
    let ticker = null;
    let outsideCard = null;

    const END_TEXT = {
        answered: 'Call ended',
        declined: 'Call declined',
        cancelled: 'Call cancelled',
        missed: 'No answer',
    };

    function callerName() {
        if (!call || !call.number) return 'Unknown caller';
        return Nexora.contacts.name(call.number);
    }

    const elapsed = () => format.duration((Date.now() - (call.startedAt || Date.now())) / 1000);

    function statusText() {
        if (!call) return '';
        if (call.state === 'ended') return call.endText || 'Call ended';
        if (call.state === 'active') return elapsed();
        return call.direction === 'in' ? 'Incoming call' : 'Calling...';
    }

    /** Text of the green pill in the status bar while the call is hidden. */
    function updateLive() {
        if (!call || shown || call.state === 'ended') {
            Nexora.setLiveCall(null);
            return;
        }

        Nexora.setLiveCall(call.state === 'active' ? elapsed() : call.direction === 'in' ? 'Ringing' : 'Calling');
    }

    function removeOutside() {
        if (outsideCard) outsideCard.remove();
        outsideCard = null;
    }

    function stopRinging() {
        sound.stop();
        phoneEl.classList.remove('ringing');
        removeOutside();
    }

    function roundButton(kind, iconName, label, onClick) {
        return h('button', { class: `call-btn ${kind}`, type: 'button', onclick: onClick },
            h('span', { class: 'call-btn-icon' }, icon(iconName, 28)),
            h('span', { class: 'call-btn-label' }, label));
    }

    function renderCall() {
        if (!call) return;

        const incoming = call.state === 'ringing' && call.direction === 'in';
        const contact = call.number ? Nexora.contacts.find(call.number) : null;

        statusEl = h('div', { class: 'call-status' }, statusText());

        let buttons = null;
        if (call.state !== 'ended') {
            buttons = incoming
                ? [roundButton('decline', 'phone', 'Decline', hangUp), roundButton('answer', 'phone', 'Answer', answer)]
                : [roundButton('neutral', 'chevron-down', 'Hide', minimise), roundButton('decline', 'phone', 'End', hangUp)];
        }

        fill(screenEl,
            h('div', { class: 'call-backdrop' }),
            h('div', { class: 'call-top' }, statusEl),
            h('div', { class: 'call-who' },
                h('div', { class: `call-avatar${call.state === 'ringing' ? ' ringing' : ''}` },
                    ui.avatar(contact || { number: call.number }, 118)),
                h('div', { class: 'call-name' }, callerName()),
                contact ? h('div', { class: 'call-number' }, format.number(call.number)) : null),
            h('div', { class: 'call-actions' }, buttons));
    }

    function showScreen() {
        if (!call) return;

        shown = true;
        Nexora.setLiveCall(null);
        renderCall();

        screenEl.hidden = false;
        requestAnimationFrame(() => screenEl.classList.add('show'));
        Nexora.updateTone();
    }

    function hideScreen() {
        shown = false;
        screenEl.classList.remove('show');
        Nexora.updateTone();

        setTimeout(() => {
            if (!shown) screenEl.hidden = true;
        }, 280);
    }

    /** Keeps the call running but gives the screen back to the player. */
    function minimise() {
        if (!call || call.state === 'ended') return;

        hideScreen();
        updateLive();
    }

    function startTicker() {
        clearInterval(ticker);
        ticker = setInterval(() => {
            if (!call) {
                clearInterval(ticker);
                return;
            }

            if (shown && statusEl) statusEl.textContent = statusText();
            else updateLive();
        }, 500);
    }

    /** Shows the final state for a moment, then removes the call. */
    function finish(text, delay) {
        stopRinging();
        Nexora.setLiveCall(null);

        if (!call) return;

        const ended = call;
        ended.state = 'ended';
        ended.endText = text;

        if (shown) renderCall();

        setTimeout(() => {
            if (call !== ended) return;
            call = null;
            clearInterval(ticker);
            hideScreen();
        }, shown ? (delay || 1300) : 0);
    }

    async function startCall(target) {
        const number = format.clean(target);

        if (call) {
            showScreen();
            return;
        }

        if (!format.isNumber(number)) {
            ui.error('invalid_number');
            return;
        }

        if (number === state.number) {
            ui.error('self');
            return;
        }

        // Show the call screen right away; the server answers in a moment.
        const mine = { id: null, number, anonymous: false, direction: 'out', state: 'ringing', pending: true };
        call = mine;

        startTicker();
        showScreen();

        const result = await Nexora.post('call:start', { number, anonymous: hideId });

        mine.pending = false;
        history = null;

        if (mine.cancelled) {
            // Hung up before the server answered: make sure nothing keeps ringing.
            if (result.ok) Nexora.post('call:end');
            return;
        }

        if (call !== mine) return;

        if (!result.ok) {
            sound.play('error');
            finish(Nexora.errorText(result.error), 1900);
            return;
        }

        mine.id = result.call.id;
        sound.loop('ringback');
    }

    function answer() {
        if (!call || call.direction !== 'in' || call.state !== 'ringing') return;

        stopRinging();

        Nexora.post('call:answer').then((result) => {
            if (!result.ok) ui.error(result.error);
        });
    }

    function hangUp() {
        if (!call || call.state === 'ended') return;

        if (call.pending) {
            call.cancelled = true;
            finish('Call cancelled', 700);
            return;
        }

        stopRinging();
        Nexora.post('call:end');
    }

    Nexora.callScreen = {
        /** A call exists (ringing or connected). */
        active: () => !!call && call.state !== 'ended',
        visible: () => shown,
        show: showScreen,

        /** "Back" while the call screen is up hides it (except while it rings). */
        back() {
            if (!shown || !call) return false;
            if (call.state === 'ringing' && call.direction === 'in') return true;
            if (call.state !== 'ended') minimise();
            return true;
        },
    };

    Nexora.on('call:incoming', (data) => {
        if (call) return;

        call = {
            id: data.id,
            number: data.number ? String(data.number) : null,
            anonymous: data.anonymous === true,
            direction: 'in',
            state: 'ringing',
        };

        startTicker();
        sound.ring();

        if (state.settings.vibrate !== false) phoneEl.classList.add('ringing');

        if (state.visible) {
            showScreen();
        } else if (Nexora.config.notifications.showWhenClosed) {
            outsideCard = Nexora.outside.push(h('div', { class: 'note-card calling' },
                h('span', { class: 'note-icon' }, icon('phone', 16)),
                h('div', { class: 'note-main' },
                    h('div', { class: 'note-head' }, h('span', { class: 'note-title' }, 'Incoming call')),
                    h('div', { class: 'note-body' }, `${callerName()} - open your phone to answer`))));
        }
    });

    Nexora.on('call:state', (data) => {
        if (!call || data.state !== 'active') return;

        call.id = data.id;
        call.state = 'active';
        call.startedAt = Date.now();

        stopRinging();

        if (shown) renderCall();
        else updateLive();
    });

    Nexora.on('call:ended', (data) => {
        history = null;
        if (pane && current === 'recents') showPane('recents');

        if (!call || call.state === 'ended') return;

        let text = END_TEXT[data.status] || 'Call ended';
        if (call.direction === 'in' && (data.status === 'cancelled' || data.status === 'missed')) text = 'Missed call';

        finish(text);
        sound.play('end');
    });

    // Opening the phone during a call brings the call screen up.
    Nexora.on('visible', (visible) => {
        if (visible && call && call.state !== 'ended') {
            removeOutside();
            showScreen();
        }
    });

    Nexora.on('reset', () => {
        stopRinging();
        clearInterval(ticker);

        call = null;
        history = null;
        dialed = '';

        hideScreen();
        Nexora.setLiveCall(null);
    });

    // exports['nexora-phone']:StartCall(number)
    Nexora.on('dial', (data) => {
        if (data && data.number) startCall(data.number);
    });

    /* ====================================================================== */
    /* Keypad                                                                  */
    /* ====================================================================== */

    function keypadPane() {
        const display = h('div', { class: 'dial-number' });
        const match = h('div', { class: 'dial-match' });

        const erase = h('button', { class: 'dial-side', type: 'button', title: 'Delete' }, icon('backspace', 24));

        const update = () => {
            const contact = dialed ? Nexora.contacts.find(dialed) : null;

            display.textContent = dialed ? format.number(dialed) : '';
            display.classList.toggle('long', dialed.length > 11);
            erase.style.visibility = dialed ? 'visible' : 'hidden';

            fill(match, contact
                ? contact.name
                : format.isNumber(dialed) && dialed !== state.number
                    ? h('button', {
                        class: 'link-btn',
                        type: 'button',
                        onclick: () => Nexora.openApp('contacts', { add: dialed }),
                    }, 'Add to contacts')
                    : null);
        };

        const press = (key) => {
            if (dialed.length >= MAX_DIGITS) return;
            dialed += key;
            sound.key(key);
            update();
        };

        const remove = () => {
            dialed = dialed.slice(0, -1);
            update();
        };

        erase.addEventListener('click', remove);
        ui.onHold(erase, () => {
            dialed = '';
            update();
        });

        const anonymous = Nexora.config.calls.allowAnonymous
            ? h('button', {
                class: `dial-side${hideId ? ' on' : ''}`,
                type: 'button',
                title: 'Hide my number',
                onclick: (event) => {
                    hideId = !hideId;
                    event.currentTarget.classList.toggle('on', hideId);
                    ui.toast(hideId ? 'Your number will be hidden' : 'Your number will be shown');
                },
            }, icon('eye', 22))
            : h('span', { class: 'dial-side' });

        const node = h('div', { class: 'dialer' },
            h('div', { class: 'dial-display' }, display, match),
            h('div', { class: 'dial-keys' }, KEYS.map(([digit, letters]) => h('button', {
                class: 'dial-key',
                type: 'button',
                onclick: () => press(digit),
            }, h('span', { class: 'dial-digit' }, digit), h('span', { class: 'dial-letters' }, letters)))),
            h('div', { class: 'dial-actions' },
                anonymous,
                h('button', {
                    class: 'dial-call',
                    type: 'button',
                    title: 'Call',
                    onclick: () => { if (dialed) startCall(dialed); },
                }, icon('phone', 28)),
                erase));

        keypad = { update, press, remove };
        update();

        return node;
    }

    /* ====================================================================== */
    /* Recents                                                                 */
    /* ====================================================================== */

    const isMissed = (entry) => entry.direction === 'in' && entry.status !== 'answered' && entry.status !== 'declined';

    function describe(entry) {
        const outgoing = entry.direction === 'out';

        if (entry.status === 'answered') {
            return `${outgoing ? 'Outgoing' : 'Incoming'} - ${format.duration(entry.duration)}`;
        }

        if (entry.status === 'declined') return 'Declined';
        if (outgoing) return entry.status === 'cancelled' ? 'Cancelled' : 'No answer';

        return 'Missed';
    }

    async function recentMenu(entry) {
        const contact = entry.number ? Nexora.contacts.find(entry.number) : null;

        const choice = await ui.sheet({
            title: entry.number ? Nexora.contacts.name(entry.number) : 'Unknown caller',
            actions: [
                entry.number ? { label: 'Call', icon: 'phone', value: 'call' } : null,
                entry.number ? { label: 'Send message', icon: 'chat', value: 'message' } : null,
                entry.number && !contact ? { label: 'Add to contacts', icon: 'user-plus', value: 'add' } : null,
                { label: 'Remove from recents', icon: 'trash', value: 'delete', danger: true },
            ],
        });

        if (choice === 'call') {
            startCall(entry.number);
        } else if (choice === 'message') {
            Nexora.openApp('messages', { number: entry.number });
        } else if (choice === 'add') {
            Nexora.openApp('contacts', { add: entry.number });
        } else if (choice === 'delete') {
            const result = await Nexora.request('call:delete', entry.id);

            if (!result.ok) {
                ui.error(result.error || 'not_found');
                return;
            }

            history = (history || []).filter((item) => item.id !== entry.id);
            renderRecents();
        }
    }

    function recentRow(entry) {
        const missed = isMissed(entry);

        const row = ui.row({
            lead: h('span', { class: `tile call-tile${missed ? ' missed' : ''}` },
                icon(entry.direction === 'out' ? 'arrow-up-right' : 'arrow-down-left', 18)),
            title: entry.number ? Nexora.contacts.name(entry.number) : 'Unknown caller',
            subtitle: describe(entry),
            trail: format.relative(entry.ts),
            className: missed ? 'missed' : '',
            onClick: () => { if (entry.number) startCall(entry.number); },
        });

        ui.onHold(row, () => recentMenu(entry));

        return row;
    }

    function renderRecents() {
        if (current !== 'recents') return;

        const list = history || [];

        fill(actions, list.length
            ? h('button', {
                class: 'icon-btn text',
                type: 'button',
                onclick: async () => {
                    const confirmed = await ui.confirm({
                        title: 'Clear recents?',
                        message: 'Your whole call history will be removed.',
                        confirmText: 'Clear',
                        danger: true,
                    });

                    if (!confirmed) return;

                    const result = await Nexora.request('call:clear');
                    if (!result.ok) {
                        ui.error(result.error);
                        return;
                    }

                    history = [];
                    renderRecents();
                },
            }, 'Clear')
            : null);

        fill(pane, h('div', { class: 'pane-scroll' }, list.length
            ? h('div', { class: 'card' }, list.map(recentRow))
            : ui.empty('clock', 'No recent calls', 'Calls you make and receive show up here.')));
    }

    async function loadHistory() {
        const result = await Nexora.request('call:history');

        if (result.ok) history = Nexora.list(result.calls);
        else if (!history) history = [];

        renderRecents();
    }

    /* ====================================================================== */
    /* Contacts tab                                                            */
    /* ====================================================================== */

    function renderContacts() {
        if (current !== 'contacts') return;

        const list = h('div');

        const draw = () => {
            const text = contactQuery.toLowerCase();
            const digits = format.clean(contactQuery);

            const contacts = [...Nexora.contacts.all()]
                .sort((a, b) => (b.favourite === true) - (a.favourite === true)
                    || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
                .filter((contact) => !text || contact.name.toLowerCase().includes(text)
                    || (digits !== '' && /^\d+$/.test(digits) && String(contact.number).includes(digits)));

            fill(list, contacts.length
                ? h('div', { class: 'card' }, contacts.map((contact) => ui.row({
                    lead: ui.avatar(contact, 40),
                    title: contact.name,
                    subtitle: format.number(contact.number),
                    trail: [contact.favourite ? icon('star', 15) : null, icon('phone', 18)],
                    onClick: () => startCall(contact.number),
                })))
                : ui.empty('user', text ? 'No matches' : 'No contacts yet', 'Add people in the Contacts app.'));
        };

        const search = ui.search('Search contacts', (value) => {
            contactQuery = value;
            draw();
        });
        search.input.value = contactQuery;

        fill(actions);
        fill(pane, h('div', { class: 'pane-scroll' }, search, list));
        draw();
    }

    /* ====================================================================== */
    /* App                                                                     */
    /* ====================================================================== */

    function showPane(id) {
        current = id;
        keypad = null;
        title.textContent = TITLES[id];

        if (id === 'keypad') {
            fill(actions);
            fill(pane, keypadPane());
        } else if (id === 'recents') {
            if (history) renderRecents();
            else fill(pane, h('div', { class: 'pane-scroll' }, ui.spinner()));
            loadHistory();
        } else {
            renderContacts();
        }
    }

    Nexora.registerApp({
        id: 'phone',
        icon: 'phone',
        colors: ['#34d399', '#059669'],

        mount(root) {
            title = h('h1', { class: 'view-title' });
            actions = h('div', { class: 'view-actions' });
            pane = h('div', { class: 'phone-pane' });

            tabs = ui.tabs([
                { id: 'keypad', label: 'Keypad', icon: 'keypad' },
                { id: 'recents', label: 'Recents', icon: 'clock' },
                { id: 'contacts', label: 'Contacts', icon: 'user' },
            ], 'keypad', showPane);

            root.append(h('section', { class: 'view' },
                h('header', { class: 'view-header' }, h('div', { class: 'view-titles' }, title), actions),
                pane,
                tabs));

            showPane('keypad');
        },

        /** params: { call: number } dials straight away, { number } fills the keypad. */
        open(params) {
            if (params.call) {
                startCall(params.call);
            } else if (params.number) {
                dialed = format.clean(params.number).slice(0, MAX_DIGITS);
                tabs.select('keypad');
            } else if (current === 'recents') {
                loadHistory();
            }
        },

        key(event) {
            if (current !== 'keypad' || !keypad) return false;

            if (/^[0-9*#]$/.test(event.key)) {
                keypad.press(event.key);
                return true;
            }

            if (event.key === 'Backspace' && dialed) {
                keypad.remove();
                return true;
            }

            if (event.key === 'Enter' && dialed) {
                startCall(dialed);
                return true;
            }

            return false;
        },
    });

    Nexora.on('contacts', () => {
        if (!pane) return;
        if (current === 'keypad' && keypad) keypad.update();
        else if (current === 'recents') renderRecents();
        else if (current === 'contacts') renderContacts();
    });
})();
