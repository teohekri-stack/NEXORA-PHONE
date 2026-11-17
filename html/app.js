/* ==========================================================================
   Nexora Phone - UI core
   --------------------------------------------------------------------------
   Everything the apps build on: DOM helpers, the NUI bridge, an event bus,
   sounds, notifications, dialogs and the shell (lock screen, home screen,
   status bar, app switching).

   Apps live in html/apps/<id>.js and register with Nexora.registerApp().
   They are loaded on demand from the app list in config.lua, so adding an
   app never requires touching index.html.

   No user supplied text is ever inserted as HTML: h() only creates text
   nodes, and images are assigned through the `src` property.
   ========================================================================== */
(() => {
    'use strict';

    /* ---------------------------------------------------------------------- */
    /* Environment                                                             */
    /* ---------------------------------------------------------------------- */

    const inGame = typeof window.GetParentResourceName === 'function';
    const RESOURCE = inGame ? window.GetParentResourceName() : 'nexora-phone';
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const EASE = 'cubic-bezier(0.22, 0.9, 0.24, 1)';

    const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
        'August', 'September', 'October', 'November', 'December'];

    const $ = (selector, root = document) => root.querySelector(selector);

    const state = {
        ready: false,           // character data received
        visible: false,         // phone on screen
        locked: true,
        camera: false,          // viewfinder active (phone hidden)
        number: '',
        name: '',
        settings: {},
        contacts: [],
        notifications: [],
        unreadMessages: 0,
        alarms: [],
        allowed: [],            // ids of the apps this character may use
        status: { battery: 100, charging: false, signal: 4 },
        gameTime: null,         // { h, m, dow, d, mo, y } when the game clock is used
        current: null,          // id of the app in the foreground
    };

    const apps = new Map();
    const listeners = new Map();

    const Nexora = { state, config: null, inGame, DAYS, MONTHS, version: '1.0.0' };
    window.Nexora = Nexora;

    const el = {
        wrap: $('#phone-wrap'),
        phone: $('#phone'),
        screen: $('#screen'),
        wallpaper: $('#wallpaper'),
        home: $('#home'),
        grid: $('#home-grid'),
        dock: $('#home-dock'),
        apps: $('#apps'),
        lock: $('#lock'),
        center: $('#center'),
        banner: $('#banner'),
        modal: $('#modal'),
        toast: $('#toast'),
        outside: $('#outside'),
        viewfinder: $('#viewfinder'),
    };

    /* ---------------------------------------------------------------------- */
    /* DOM helpers                                                             */
    /* ---------------------------------------------------------------------- */

    function append(parent, children) {
        for (const child of children) {
            if (child == null || child === false || child === true) continue;
            if (Array.isArray(child)) append(parent, child);
            else parent.append(child.nodeType ? child : document.createTextNode(String(child)));
        }
        return parent;
    }

    /**
     * Creates an element. Strings passed as children become text nodes, so
     * this is safe to use with anything a player typed.
     *   h('button', { class: 'btn', onclick: fn }, 'Label')
     */
    function h(tag, props, ...children) {
        const node = document.createElement(tag);

        if (props) {
            for (const key of Object.keys(props)) {
                const value = props[key];
                if (value == null || value === false) continue;

                if (key === 'class') {
                    node.className = value;
                } else if (key === 'dataset') {
                    Object.assign(node.dataset, value);
                } else if (key === 'style' && typeof value === 'object') {
                    for (const name of Object.keys(value)) {
                        if (name.startsWith('--')) node.style.setProperty(name, value[name]);
                        else node.style[name] = value[name];
                    }
                } else if (key.startsWith('on') && typeof value === 'function') {
                    node.addEventListener(key.slice(2), value);
                } else if (key in node) {
                    try { node[key] = value; } catch (err) { node.setAttribute(key, value); }
                } else {
                    node.setAttribute(key, value === true ? '' : value);
                }
            }
        }

        return append(node, children);
    }

    /** Replaces the content of a node (same child rules as h()). */
    function fill(node, ...children) {
        node.replaceChildren();
        return append(node, children);
    }

    // Original line icons on a 24 x 24 grid. Static markup, never user data.
    const ICONS = {
        dot: '<circle cx="12" cy="12" r="2"/>',
        phone: '<path d="M6.6 3.5h2.3l1.4 4-1.9 1.6a12 12 0 0 0 6.5 6.5l1.6-1.9 4 1.4v2.3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z"/>',
        chat: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.6V16A2.5 2.5 0 0 1 4 13.5z"/>',
        user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.8 19.5a7.2 7.2 0 0 1 14.4 0"/>',
        'user-plus': '<circle cx="10" cy="8" r="3.6"/><path d="M3 19.5a7 7 0 0 1 13.2-3.2M18.5 13.5v6M15.5 16.5h6"/>',
        camera: '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.3l1.2-2h6l1.2 2h1.3A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.4" r="3.4"/>',
        image: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M4.5 17l4.6-4.4 3.3 3 2.7-2.6 4.4 4.2"/>',
        bank: '<path d="M3.5 9.5 12 4l8.5 5.5M5 9.5h14M6.5 12.5v5M10.2 12.5v5M13.8 12.5v5M17.5 12.5v5M4 20h16"/>',
        settings: '<circle cx="12" cy="12" r="2.6"/><circle cx="12" cy="12" r="6.4"/><path d="M12 3v2.6M12 18.4V21M3 12h2.6M18.4 12H21M5.6 5.6l1.9 1.9M16.5 16.5l1.9 1.9M5.6 18.4l1.9-1.9M16.5 7.5l1.9-1.9"/>',
        calculator: '<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M8.5 7.5h7"/><g stroke-width="2.4"><path d="M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01"/></g>',
        note: '<path d="M6.5 3.5h8l4 4v11a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z"/><path d="M14.5 3.5v4h4M8.5 12h7M8.5 15.5h5"/>',
        clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
        alarm: '<circle cx="12" cy="13" r="7"/><path d="M12 9.5V13l2.5 1.5M4.5 5.5l3-2.5M19.5 5.5l-3-2.5"/>',
        stopwatch: '<circle cx="12" cy="13.5" r="7"/><path d="M12 13.5V9.5M10 3.5h4M12 3.5v3"/>',
        timer: '<path d="M7 3.5h10M7 20.5h10M8 3.5c0 4 4 5 4 8.5s-4 4.5-4 8.5M16 3.5c0 4-4 5-4 8.5s4 4.5 4 8.5"/>',
        'chevron-left': '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
        'chevron-right': '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
        'chevron-down': '<path d="M5.5 9.5 12 16l6.5-6.5"/>',
        'chevron-up': '<path d="M5.5 14.5 12 8l6.5 6.5"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        minus: '<path d="M5 12h14"/>',
        close: '<path d="M6 6l12 12M18 6 6 18"/>',
        check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
        search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
        trash: '<path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.8 11.2a2 2 0 0 0 2 1.8h5.4a2 2 0 0 0 2-1.8L17.5 7M10 11v5M14 11v5"/>',
        edit: '<path d="M4.5 19.5l1-4L16 5a2.1 2.1 0 0 1 3 3L8.5 18.5z"/><path d="M14.5 6.5l3 3"/>',
        star: '<path d="M12 4l2.35 4.9 5.35.7-3.9 3.75.95 5.35L12 16.1 7.25 18.7l.95-5.35L4.3 9.6l5.35-.7z"/>',
        send: '<path d="M12 19V5.5M6 11l6-6 6 6"/>',
        backspace: '<path d="M9 5.5h9a2.5 2.5 0 0 1 2.5 2.5v8a2.5 2.5 0 0 1-2.5 2.5H9L3.5 12z"/><path d="M11.5 9.5l5 5M16.5 9.5l-5 5"/>',
        pin: '<path d="M9 4h6l-.8 5.2 3 3V14H6.8v-1.8l3-3z"/><path d="M12 14v6"/>',
        location: '<path d="M12 21s6.5-5.6 6.5-10.5a6.5 6.5 0 0 0-13 0C5.5 15.4 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.4"/>',
        copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
        keypad: '<g stroke-width="2.6"><path d="M6.5 6.5h.01M12 6.5h.01M17.5 6.5h.01M6.5 12h.01M12 12h.01M17.5 12h.01M6.5 17.5h.01M12 17.5h.01M17.5 17.5h.01"/></g>',
        more: '<g stroke-width="2.8"><path d="M5.5 12h.01M12 12h.01M18.5 12h.01"/></g>',
        airplane: '<path d="M12 3.5c.9 0 1.5.9 1.5 2.2v3.6l6.5 3.9v2l-6.5-2v3.6l2 1.5v1.5L12 18.8l-3.5 1v-1.5l2-1.5v-3.6l-6.5 2v-2l6.5-3.9V5.7c0-1.3.6-2.2 1.5-2.2z"/>',
        moon: '<path d="M19.5 14.2A8 8 0 0 1 9.8 4.5a8 8 0 1 0 9.7 9.7z"/>',
        sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
        bell: '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
        lock: '<rect x="5.5" y="10.5" width="13" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
        eye: '<path d="M2.8 12S6.2 5.8 12 5.8 21.2 12 21.2 12 17.8 18.2 12 18.2 2.8 12 2.8 12z"/><circle cx="12" cy="12" r="2.8"/>',
        volume: '<path d="M4.5 9.5h3l4.5-3.8v12.6L7.5 14.5h-3z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.6 7.6 0 0 1 0 11"/>',
        music: '<path d="M9.5 17.5V6l9-2v11.5"/><circle cx="7" cy="17.5" r="2.5"/><circle cx="16" cy="15.5" r="2.5"/>',
        'arrow-up-right': '<path d="M7 17 17 7M9 7h8v8"/>',
        'arrow-down-left': '<path d="M17 7 7 17M15 17H7V9"/>',
        info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8h.01"/>',
        flip: '<path d="M4.5 9a8 8 0 0 1 14-3l1 1.5M19.5 15a8 8 0 0 1-14 3l-1-1.5M19.5 3.5v4h-4M4.5 20.5v-4h4"/>',
        link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/>',
        download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14"/>',
        refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/>',
        home: '<path d="M4.5 11 12 4.5l7.5 6.5v8a1.5 1.5 0 0 1-1.5 1.5h-3.5v-5.5h-5V20.5H6A1.5 1.5 0 0 1 4.5 19z"/>',
        shield: '<path d="M12 3.5l7 2.5v5.5c0 4.3-2.9 7.6-7 9-4.1-1.4-7-4.7-7-9V6z"/>',
        text: '<path d="M4 18 8.5 6.5 13 18M5.6 14h5.8M15 18l2.5-6.5L20 18M15.9 15.8h3.2"/>',
        device: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 18h2"/>',
        palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2-1 1.6-2.1-.5-1.4.3-2.6 1.8-2.6h1.8a3.3 3.3 0 0 0 3.3-3.3c0-5-3.8-9-8.5-9z"/><g stroke-width="2.4"><path d="M8 11h.01M11 7.5h.01M15.5 8.5h.01"/></g>',
    };

    function icon(name, size = 22) {
        const svg = document.createElementNS(SVG_NS, 'svg');

        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', size);
        svg.setAttribute('height', size);
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '1.8');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');
        svg.classList.add('icon');
        svg.innerHTML = ICONS[name] || ICONS.dot;

        return svg;
    }

    Nexora.h = h;
    Nexora.fill = fill;
    Nexora.icon = icon;
    Nexora.$ = $;

    /* ---------------------------------------------------------------------- */
    /* Event bus                                                               */
    /* ---------------------------------------------------------------------- */

    Nexora.on = (event, fn) => {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(fn);
        return () => Nexora.off(event, fn);
    };

    Nexora.off = (event, fn) => {
        const set = listeners.get(event);
        if (set) set.delete(fn);
    };

    Nexora.emit = (event, data) => {
        const set = listeners.get(event);
        if (!set) return;

        for (const fn of [...set]) {
            try {
                fn(data);
            } catch (err) {
                console.error(`[nexora] listener for "${event}" failed`, err);
            }
        }
    };

    /* ---------------------------------------------------------------------- */
    /* NUI bridge                                                              */
    /* ---------------------------------------------------------------------- */

    /** Calls a NUI callback registered in client/nui.lua. Never rejects. */
    Nexora.post = async (name, data) => {
        if (!inGame) {
            return Nexora.mock ? Nexora.mock(name, data || {}) : { ok: false, error: 'internal' };
        }

        try {
            const response = await fetch(`https://${RESOURCE}/${name}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json; charset=UTF-8' },
                body: JSON.stringify(data == null ? {} : data),
            });

            const result = await response.json();
            return result && typeof result === 'object' ? result : { ok: false, error: 'internal' };
        } catch (err) {
            return { ok: false, error: 'internal' };
        }
    };

    /** Calls a server callback through the Lua proxy: request('notes:save', note) */
    Nexora.request = (name, ...args) => Nexora.post('request', { name, args, n: args.length });

    const ERRORS = {
        internal: 'Something went wrong.',
        rate_limited: 'Slow down a little.',
        not_ready: 'Your phone is still starting up.',
        no_phone: "You don't have a phone.",
        no_access: "You can't use this app.",
        invalid: 'That input is not valid.',
        invalid_number: 'That number is not valid.',
        invalid_name: 'Enter a name.',
        invalid_image: 'That picture can not be used.',
        invalid_amount: 'Enter a valid amount.',
        duplicate: 'A contact with this number already exists.',
        limit: 'You reached the limit.',
        not_found: 'That no longer exists.',
        not_allowed: 'This is not available on this server.',
        self: "That's your own number.",
        empty: 'Write something first.',
        airplane: 'Airplane mode is on.',
        battery: 'The battery is empty.',
        no_signal: 'No signal.',
        not_in_service: 'This number is not in service.',
        unavailable: 'The person you called is unavailable.',
        busy: 'The line is busy.',
        busy_self: 'You are already in a call.',
        no_call: 'There is no call to answer.',
        insufficient: 'Not enough money in your account.',
        unknown_recipient: 'Recipient not found.',
        recipient_offline: 'The recipient is not available right now.',
        cooldown: 'Wait a moment before the next transfer.',
        gallery_full: 'Your gallery is full.',
        upload_not_configured: 'Photo hosting is not set up on this server.',
        screenshot_missing: 'The camera is not available on this server.',
        photo_failed: 'The photo could not be saved.',
    };

    Nexora.errorText = (code) => ERRORS[code] || ERRORS.internal;

    /** Lists coming from Lua: anything that is not an array becomes []. */
    Nexora.list = (value) => (Array.isArray(value) ? value : []);

    /* ---------------------------------------------------------------------- */
    /* Formatting                                                              */
    /* ---------------------------------------------------------------------- */

    const cleanNumber = (value) => String(value == null ? '' : value).replace(/[\s\-().+]/g, '');

    function isValidNumber(value) {
        const digits = cleanNumber(value);
        const rules = (Nexora.config && Nexora.config.number) || { min: 3, max: 15 };
        return /^\d+$/.test(digits) && digits.length >= rules.min && digits.length <= rules.max;
    }

    function formatNumber(value) {
        if (value == null || value === '') return 'Unknown';

        const text = String(value);
        if (!/^\d+$/.test(text)) return text; // system sender such as "Dispatch"

        const groups = Nexora.config && Nexora.config.number && Nexora.config.number.groups;
        if (!Array.isArray(groups) || !groups.length) return text;
        if (groups.reduce((sum, size) => sum + size, 0) !== text.length) return text;

        const parts = [];
        let index = 0;
        for (const size of groups) {
            parts.push(text.slice(index, index + size));
            index += size;
        }

        return parts.join('-');
    }

    function formatClock(hours, minutes) {
        const mm = String(minutes).padStart(2, '0');

        if (state.settings.use24h !== false) {
            return `${String(hours).padStart(2, '0')}:${mm}`;
        }

        return `${hours % 12 || 12}:${mm} ${hours >= 12 ? 'PM' : 'AM'}`;
    }

    const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

    const daysAgo = (date) => Math.round((startOfDay(new Date()) - startOfDay(date)) / 86400000);

    /** Clock time of a unix timestamp (real time). */
    function formatTime(ts) {
        const date = new Date(ts * 1000);
        return formatClock(date.getHours(), date.getMinutes());
    }

    /** Compact "when": 14:05, Yesterday, Mon, Mar 3 */
    function formatRelative(ts) {
        if (!ts) return '';

        const date = new Date(ts * 1000);
        const days = daysAgo(date);

        if (days <= 0) return formatTime(ts);
        if (days === 1) return 'Yesterday';
        if (days < 7) return DAYS[date.getDay()].slice(0, 3);

        const year = date.getFullYear() !== new Date().getFullYear() ? `, ${date.getFullYear()}` : '';
        return `${MONTHS[date.getMonth()].slice(0, 3)} ${date.getDate()}${year}`;
    }

    /** Day heading: Today, Yesterday, Monday, March 3 */
    function formatDay(ts) {
        const date = new Date(ts * 1000);
        const days = daysAgo(date);

        if (days <= 0) return 'Today';
        if (days === 1) return 'Yesterday';

        return `${DAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}`;
    }

    /** 75 -> "1:15", 3725 -> "1:02:05" */
    function formatDuration(total) {
        const seconds = Math.max(0, Math.floor(total));
        const hrs = Math.floor(seconds / 3600);
        const min = Math.floor((seconds % 3600) / 60);
        const sec = String(seconds % 60).padStart(2, '0');

        return hrs ? `${hrs}:${String(min).padStart(2, '0')}:${sec}` : `${min}:${sec}`;
    }

    function formatMoney(amount) {
        const value = Math.trunc(Number(amount) || 0);
        const currency = (Nexora.config && Nexora.config.bank && Nexora.config.bank.currency) || '$';

        return `${value < 0 ? '-' : ''}${currency}${Math.abs(value).toLocaleString('en-US')}`;
    }

    Nexora.format = {
        number: formatNumber,
        clean: cleanNumber,
        isNumber: isValidNumber,
        clock: formatClock,
        time: formatTime,
        relative: formatRelative,
        day: formatDay,
        duration: formatDuration,
        money: formatMoney,
    };

    /* ---------------------------------------------------------------------- */
    /* Clock                                                                   */
    /* ---------------------------------------------------------------------- */

    /** The phone's "now": the game clock when configured, the real one otherwise. */
    function now() {
        if (Nexora.config && Nexora.config.clockSource === 'game' && state.gameTime) {
            return state.gameTime;
        }

        const date = new Date();

        return {
            h: date.getHours(),
            m: date.getMinutes(),
            dow: date.getDay(),
            d: date.getDate(),
            mo: date.getMonth(),
            y: date.getFullYear(),
        };
    }

    const dateText = (time) => `${DAYS[time.dow] || ''}, ${MONTHS[time.mo] || ''} ${time.d}`;

    Nexora.clock = { now, dateText };

    /* ---------------------------------------------------------------------- */
    /* Contacts                                                                */
    /* ---------------------------------------------------------------------- */

    const contactIndex = new Map();

    function indexContacts() {
        contactIndex.clear();
        for (const contact of state.contacts) contactIndex.set(String(contact.number), contact);
        Nexora.emit('contacts');
    }

    Nexora.contacts = {
        all: () => state.contacts,
        find: (number) => contactIndex.get(String(number)) || null,
        name(number) {
            if (number == null || number === '') return 'Unknown';
            const contact = contactIndex.get(String(number));
            return contact ? contact.name : formatNumber(number);
        },
        set(list) {
            state.contacts = Array.isArray(list) ? list : [];
            indexContacts();
        },
        upsert(contact) {
            const index = state.contacts.findIndex((entry) => entry.id === contact.id);
            if (index >= 0) state.contacts[index] = contact;
            else state.contacts.push(contact);
            indexContacts();
        },
        remove(id) {
            state.contacts = state.contacts.filter((entry) => entry.id !== id);
            indexContacts();
        },
    };

    /* ---------------------------------------------------------------------- */
    /* Sound (synthesised with the Web Audio API - no audio files shipped)      */
    /* ---------------------------------------------------------------------- */

    const sound = (() => {
        let ctx = null;
        let master = null;
        let loopTimer = null;
        let loopAudio = null;
        let previewing = false; // the current sound was started by preview()
        const active = new Set();

        const volume = () => {
            const value = state.settings.volume;
            return Math.max(0, Math.min(100, value == null ? 60 : value)) / 100;
        };

        function context() {
            if (!ctx) {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (!AudioCtx) return null;

                ctx = new AudioCtx();
                master = ctx.createGain();
                master.connect(ctx.destination);
            }

            if (ctx.state === 'suspended') ctx.resume().catch(() => {});
            master.gain.value = volume() * 0.55;

            return ctx;
        }

        /** One oscillator note with a soft attack and an exponential decay. */
        function note(freq, start, duration, options = {}) {
            const ac = context();
            if (!ac) return;

            const osc = ac.createOscillator();
            const env = ac.createGain();
            const at = ac.currentTime + start;
            const peak = options.gain == null ? 0.5 : options.gain;

            osc.type = options.type || 'sine';
            osc.frequency.setValueAtTime(freq, at);
            if (options.glide) osc.frequency.exponentialRampToValueAtTime(options.glide, at + duration);

            env.gain.setValueAtTime(0.0001, at);
            env.gain.exponentialRampToValueAtTime(peak, at + (options.attack || 0.01));
            env.gain.exponentialRampToValueAtTime(0.0001, at + duration);

            osc.connect(env);
            env.connect(master);
            osc.start(at);
            osc.stop(at + duration + 0.05);

            active.add(osc);
            osc.onended = () => active.delete(osc);
        }

        /** A short burst of filtered noise (camera shutter). */
        function noise(start, duration, gain) {
            const ac = context();
            if (!ac) return;

            const frames = Math.max(1, Math.floor(ac.sampleRate * duration));
            const buffer = ac.createBuffer(1, frames, ac.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);

            const source = ac.createBufferSource();
            const env = ac.createGain();
            source.buffer = buffer;
            env.gain.value = gain;
            source.connect(env);
            env.connect(master);
            source.start(ac.currentTime + start);
        }

        const SHOTS = {
            drop: () => { note(880, 0, 0.16, { glide: 520 }); note(1320, 0.09, 0.24, { gain: 0.28, glide: 780 }); },
            glass: () => { note(1568, 0, 0.5, { gain: 0.34 }); note(2093, 0.12, 0.6, { gain: 0.26 }); },
            tick: () => { note(1200, 0, 0.05, { type: 'square', gain: 0.16 }); },
            sent: () => { note(660, 0, 0.1, { gain: 0.24, glide: 990 }); },
            end: () => { note(480, 0, 0.18, { gain: 0.3 }); note(380, 0.2, 0.26, { gain: 0.3 }); },
            error: () => { note(220, 0, 0.2, { type: 'triangle', gain: 0.36 }); },
            success: () => { note(660, 0, 0.12, { gain: 0.3 }); note(880, 0.1, 0.22, { gain: 0.3 }); },
            shutter: () => { noise(0, 0.07, 0.5); noise(0.09, 0.05, 0.35); },
            silent: () => {},
        };

        const LOOPS = {
            aurora: {
                length: 2.6,
                play: () => [523.25, 659.25, 783.99, 987.77, 783.99, 659.25].forEach((freq, i) => {
                    note(freq, i * 0.16, 0.5, { gain: 0.4 });
                    note(freq * 2, i * 0.16, 0.3, { type: 'triangle', gain: 0.1 });
                }),
            },
            pulse: {
                length: 2.0,
                play: () => {
                    for (let i = 0; i < 4; i++) {
                        note(740, i * 0.2, 0.14, { type: 'triangle', gain: 0.45 });
                        note(1110, i * 0.2 + 0.07, 0.1, { type: 'triangle', gain: 0.3 });
                    }
                },
            },
            marimba: {
                length: 2.4,
                play: () => [659.25, 783.99, 1046.5, 783.99, 880, 1174.66, 1046.5, 783.99].forEach((freq, i) => {
                    note(freq, i * 0.14, 0.32, { gain: 0.5, attack: 0.004 });
                }),
            },
            retro: {
                length: 3.0,
                play: () => {
                    for (let burst = 0; burst < 2; burst++) {
                        for (let i = 0; i < 12; i++) {
                            note(i % 2 ? 480 : 440, burst * 0.9 + i * 0.05, 0.05, { type: 'square', gain: 0.14 });
                        }
                    }
                },
            },
            ringback: {
                length: 6,
                play: () => {
                    note(440, 0, 2, { gain: 0.14, attack: 0.03 });
                    note(480, 0, 2, { gain: 0.14, attack: 0.03 });
                },
            },
            alarm: {
                length: 1.2,
                play: () => { for (let i = 0; i < 4; i++) note(1046.5, i * 0.14, 0.09, { type: 'square', gain: 0.2 }); },
            },
            silent: { length: 60, play: () => {} },
        };

        // Row / column frequencies of the telephone keypad (DTMF).
        const DTMF = {
            1: [697, 1209], 2: [697, 1336], 3: [697, 1477],
            4: [770, 1209], 5: [770, 1336], 6: [770, 1477],
            7: [852, 1209], 8: [852, 1336], 9: [852, 1477],
            '*': [941, 1209], 0: [941, 1336], '#': [941, 1477],
        };

        /** Config entry of a tone ({ id, label, file? }). */
        function entry(kind, id) {
            const list = (Nexora.config && Nexora.config.sounds && Nexora.config.sounds[kind]) || [];
            return list.find((item) => item.id === id) || null;
        }

        function stop() {
            previewing = false;
            clearInterval(loopTimer);
            loopTimer = null;

            if (loopAudio) {
                loopAudio.pause();
                loopAudio = null;
            }

            for (const osc of [...active]) {
                try { osc.stop(); } catch (err) { /* already stopped */ }
            }
            active.clear();
        }

        function playFile(file, loop) {
            const audio = new Audio(file);
            audio.loop = loop;
            audio.volume = volume();
            audio.play().catch(() => {});
            return audio;
        }

        function loop(name, file) {
            stop();

            if (file) {
                loopAudio = playFile(file, true);
                return;
            }

            const pattern = LOOPS[name] || LOOPS.aurora;
            pattern.play();
            loopTimer = setInterval(pattern.play, pattern.length * 1000);
        }

        function play(name) {
            if (volume() <= 0) return;
            (SHOTS[name] || SHOTS.tick)();
        }

        return {
            play,
            loop,
            stop,

            /** Starts the ringtone chosen in Settings. */
            ring() {
                if (state.settings.doNotDisturb || volume() <= 0) return;
                const id = state.settings.ringtone;
                const item = entry('ringtones', id);
                loop(id, item && item.file);
            },

            /** Plays the notification tone chosen in Settings. */
            notification() {
                if (state.settings.doNotDisturb || volume() <= 0) return;
                const id = state.settings.notificationSound;
                const item = entry('notifications', id);
                if (item && item.file) playFile(item.file, false);
                else play(id);
            },

            /** Plays a tone once so it can be auditioned in Settings. */
            preview(kind, id) {
                stop();
                previewing = true;

                const item = entry(kind, id);

                if (item && item.file) {
                    loopAudio = playFile(item.file, false);
                } else if (kind === 'ringtones') {
                    (LOOPS[id] || LOOPS.silent).play();
                } else {
                    play(id);
                }
            },

            /** Stops a preview, but never a real ringtone or alarm. */
            stopPreview() {
                if (previewing) stop();
            },

            /** Keypad tone. */
            key(digit) {
                const pair = DTMF[digit];
                if (!pair || volume() <= 0) return;
                note(pair[0], 0, 0.12, { gain: 0.14 });
                note(pair[1], 0, 0.12, { gain: 0.14 });
            },
        };
    })();

    Nexora.sound = sound;

    /* ---------------------------------------------------------------------- */
    /* UI toolkit                                                              */
    /* ---------------------------------------------------------------------- */

    const ui = {};
    Nexora.ui = ui;

    function hue(text) {
        let hash = 7;
        for (const ch of String(text)) hash = (hash * 31 + ch.codePointAt(0)) % 360;
        return hash;
    }

    function initials(name) {
        const parts = String(name).trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '';

        const first = [...parts[0]][0] || '';
        const last = parts.length > 1 ? [...parts[parts.length - 1]][0] || '' : '';

        return (first + last).toUpperCase();
    }

    /**
     * Round avatar for a contact object or a phone number. Falls back to
     * initials on a colour derived from the name when there is no picture.
     */
    ui.avatar = (subject, size = 44) => {
        const data = subject && typeof subject === 'object'
            ? subject
            : (Nexora.contacts.find(subject) || { number: subject });

        const node = h('span', {
            class: 'avatar',
            style: { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.38)}px` },
        });

        const fallback = () => {
            const base = hue(data.name || data.number || '?');
            node.replaceChildren();
            node.style.background =
                `linear-gradient(145deg, hsl(${base} 60% 60%), hsl(${(base + 36) % 360} 62% 44%))`;

            const text = data.name ? initials(data.name) : '';
            node.append(text || icon('user', Math.round(size * 0.52)));
        };

        if (data.avatar) {
            const img = h('img', { src: data.avatar, alt: '', draggable: false });
            img.referrerPolicy = 'no-referrer';
            img.addEventListener('error', fallback, { once: true });
            node.append(img);
        } else {
            fallback();
        }

        return node;
    };

    ui.spinner = () => h('div', { class: 'spinner' });

    ui.empty = (iconName, title, text) => h('div', { class: 'empty' },
        h('span', { class: 'empty-icon' }, icon(iconName, 30)),
        h('div', { class: 'empty-title' }, title),
        text ? h('div', { class: 'empty-text' }, text) : null);

    /** variant: 'primary' | 'ghost' | 'danger' | 'soft' */
    ui.button = (label, options = {}) => h('button', {
        class: `btn ${options.variant || 'primary'}${options.block ? ' block' : ''}`,
        type: 'button',
        onclick: options.onClick,
        disabled: options.disabled === true,
    }, options.icon ? icon(options.icon, 18) : null, label);

    ui.toggle = (checked, onChange) => {
        const node = h('button', { class: 'switch', type: 'button' });

        node.set = (value) => {
            node.classList.toggle('on', !!value);
            node.setAttribute('aria-checked', String(!!value));
        };

        node.setAttribute('role', 'switch');
        node.set(checked);

        node.addEventListener('click', (event) => {
            event.stopPropagation();
            const next = !node.classList.contains('on');
            node.set(next);
            if (onChange) onChange(next, node);
        });

        return node;
    };

    ui.search = (placeholder, onInput) => {
        const input = h('input', {
            class: 'search-input',
            type: 'search',
            placeholder,
            autocomplete: 'off',
            spellcheck: false,
            maxLength: 60,
        });

        input.addEventListener('input', () => onInput(input.value.trim()));

        const node = h('label', { class: 'search' }, icon('search', 16), input);
        node.input = input;

        return node;
    };

    /** A list row: optional leading element, title / subtitle, trailing element. */
    ui.row = (options) => h(options.onClick ? 'button' : 'div', {
        class: `row${options.onClick ? ' tappable' : ''}${options.danger ? ' danger' : ''}${options.className ? ` ${options.className}` : ''}`,
        type: options.onClick ? 'button' : null,
        onclick: options.onClick,
    },
    options.lead ? h('span', { class: 'row-lead' }, options.lead) : null,
    h('span', { class: 'row-main' },
        h('span', { class: 'row-title' }, options.title),
        options.subtitle != null && options.subtitle !== ''
            ? h('span', { class: 'row-sub' }, options.subtitle)
            : null),
    options.trail != null ? h('span', { class: 'row-trail' }, options.trail) : null,
    options.chevron ? icon('chevron-right', 16) : null);

    ui.section = (title, ...children) => h('div', { class: 'section' },
        title ? h('div', { class: 'section-title' }, title) : null,
        h('div', { class: 'card' }, children));

    /** Small rounded icon tile, used as the leading element of a row. */
    ui.tile = (iconName, accent) => h('span', { class: `tile${accent ? ' accent' : ''}` }, icon(iconName, 18));

    /** Bottom tab bar. Returns the element; `.select(id)` switches tabs. */
    ui.tabs = (items, activeId, onChange) => {
        const bar = h('nav', { class: 'tabbar' });
        const buttons = new Map();

        bar.select = (id, silent) => {
            for (const [key, button] of buttons) button.classList.toggle('active', key === id);
            bar.value = id;
            if (!silent) onChange(id);
        };

        for (const item of items) {
            const button = h('button', { class: 'tab', type: 'button', onclick: () => bar.select(item.id) },
                icon(item.icon, 22), h('span', null, item.label));
            buttons.set(item.id, button);
            bar.append(button);
        }

        bar.select(activeId, true);

        return bar;
    };

    /**
     * A screen inside an app: header (back button, title, actions), a
     * scrolling body and an optional footer.
     */
    ui.view = (options) => {
        const title = h('h1', { class: 'view-title' }, options.title || '');

        const header = h('header', { class: 'view-header' },
            options.back
                ? h('button', { class: 'icon-btn', type: 'button', title: 'Back', onclick: options.back }, icon('chevron-left'))
                : null,
            h('div', { class: 'view-titles' },
                title,
                options.subtitle ? h('div', { class: 'view-subtitle' }, options.subtitle) : null),
            h('div', { class: 'view-actions' }, (options.actions || []).filter(Boolean).map((action) => h('button', {
                class: `icon-btn${action.accent ? ' accent' : ''}${action.text ? ' text' : ''}`,
                type: 'button',
                title: action.label,
                onclick: action.onClick,
            }, action.text || icon(action.icon)))));

        const body = h('div', { class: 'view-body' }, options.body);

        const node = h('section', { class: `view${options.className ? ` ${options.className}` : ''}` },
            header, body,
            options.footer ? h('footer', { class: 'view-footer' }, options.footer) : null);

        node.titleEl = title;
        node.headerEl = header;
        node.bodyEl = body;

        return node;
    };

    /**
     * Navigation stack with slide transitions for the views of one app.
     * A view may carry a `cleanup` function that runs when it is removed.
     */
    ui.stack = (root) => {
        const views = [];
        const top = () => views[views.length - 1];

        root.classList.add('stack');

        const dispose = (view) => {
            if (typeof view.cleanup === 'function') {
                try { view.cleanup(); } catch (err) { console.error(err); }
            }
            view.remove();
        };

        return {
            get depth() { return views.length; },
            top,

            /** Replaces everything with a single root view. */
            reset(view) {
                while (views.length) dispose(views.pop());
                views.push(view);
                root.append(view);
            },

            push(view) {
                const previous = top();

                views.push(view);
                root.append(view);

                if (!previous) return;

                view.animate(
                    [{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }],
                    { duration: 300, easing: EASE });

                const fade = previous.animate(
                    [{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(-22%)', opacity: 0.5 }],
                    { duration: 300, easing: EASE });

                fade.onfinish = () => {
                    if (top() !== previous) previous.classList.add('under');
                };
            },

            /** Returns false when only the root view is left. */
            pop() {
                if (views.length <= 1) return false;

                const view = views.pop();
                const previous = top();

                previous.classList.remove('under');
                previous.animate(
                    [{ transform: 'translateX(-22%)', opacity: 0.5 }, { transform: 'translateX(0)', opacity: 1 }],
                    { duration: 280, easing: EASE });

                const leave = view.animate(
                    [{ transform: 'translateX(0)' }, { transform: 'translateX(100%)' }],
                    { duration: 280, easing: EASE, fill: 'forwards' });

                leave.onfinish = () => dispose(view);

                return true;
            },

            popToRoot() {
                while (views.length > 1) dispose(views.pop());
                if (top()) top().classList.remove('under');
            },
        };
    };

    /** Runs fn on right click or on a ~450 ms press (touch style long press). */
    ui.onHold = (node, fn) => {
        let timer = null;
        let held = false;

        const cancel = () => { clearTimeout(timer); timer = null; };

        node.addEventListener('contextmenu', (event) => { event.preventDefault(); fn(event); });
        node.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            held = false;
            cancel();
            timer = setTimeout(() => { timer = null; held = true; fn(event); }, 450);
        });
        node.addEventListener('pointerup', cancel);
        node.addEventListener('pointerleave', cancel);

        // The click that ends a long press must not also count as a tap.
        node.addEventListener('click', (event) => {
            if (!held) return;
            held = false;
            event.stopImmediatePropagation();
            event.preventDefault();
        }, true);
    };

    /* -- modal layer (dialogs, forms, action sheets) ------------------------- */

    let modals = [];

    function openModal(content, options = {}) {
        const kind = options.kind || 'dialog';
        const box = h('div', { class: `modal-box ${kind}` }, content);
        const backdrop = h('div', { class: `modal-backdrop ${kind}` }, box);

        const entry = {
            closed: false,
            close(result) {
                if (entry.closed) return;
                entry.closed = true;
                modals = modals.filter((item) => item !== entry);

                backdrop.classList.add('leaving');
                setTimeout(() => {
                    backdrop.remove();
                    if (!modals.length) el.modal.hidden = true;
                }, 180);

                if (options.onClose) options.onClose(result);
            },
        };

        backdrop.addEventListener('pointerdown', (event) => {
            if (event.target === backdrop) entry.close(null);
        });

        el.modal.hidden = false;
        el.modal.append(backdrop);
        modals.push(entry);

        return entry;
    }

    ui.modal = openModal;

    /** Resolves true when confirmed. */
    ui.confirm = (options) => new Promise((resolve) => {
        if (inGame && Nexora.config && Nexora.config.oxDialogs) {
            Nexora.post('dialog:confirm', { title: options.title, message: options.message || '' })
                .then((result) => resolve(result.confirmed === true));
            return;
        }

        const entry = openModal([
            h('div', { class: 'dialog-title' }, options.title),
            options.message ? h('div', { class: 'dialog-text' }, options.message) : null,
            h('div', { class: 'dialog-actions' },
                h('button', { class: 'btn ghost', type: 'button', onclick: () => entry.close(false) },
                    options.cancelText || 'Cancel'),
                h('button', {
                    class: `btn ${options.danger ? 'danger' : 'primary'}`,
                    type: 'button',
                    onclick: () => entry.close(true),
                }, options.confirmText || 'Confirm')),
        ], { onClose: (result) => resolve(result === true) });
    });

    /**
     * Small form dialog. fields: [{ name, label, placeholder, value, type,
     * maxLength, inputMode, multiline }]. `validate(values)` may return an
     * error text. Resolves the trimmed values or null when cancelled.
     */
    ui.prompt = (options) => new Promise((resolve) => {
        const inputs = {};
        const error = h('div', { class: 'dialog-error' });

        const fields = options.fields.map((field) => {
            const input = h(field.multiline ? 'textarea' : 'input', {
                class: 'input',
                placeholder: field.placeholder || '',
                maxLength: field.maxLength || 200,
                autocomplete: 'off',
                spellcheck: false,
            });

            if (!field.multiline) input.type = field.type || 'text';
            if (field.inputMode) input.inputMode = field.inputMode;
            input.value = field.value == null ? '' : String(field.value);
            inputs[field.name] = input;

            return h('label', { class: 'field' },
                field.label ? h('span', { class: 'field-label' }, field.label) : null, input);
        });

        const submit = () => {
            const values = {};
            for (const name of Object.keys(inputs)) values[name] = inputs[name].value.trim();

            const problem = options.validate ? options.validate(values) : null;
            if (problem) {
                error.textContent = problem;
                return;
            }

            entry.close(values);
        };

        const form = h('form', { class: 'dialog-form', onsubmit: (event) => { event.preventDefault(); submit(); } },
            fields,
            error,
            h('div', { class: 'dialog-actions' },
                h('button', { class: 'btn ghost', type: 'button', onclick: () => entry.close(null) }, 'Cancel'),
                h('button', { class: 'btn primary', type: 'submit' }, options.confirmText || 'Save')));

        const entry = openModal([
            h('div', { class: 'dialog-title' }, options.title),
            options.message ? h('div', { class: 'dialog-text' }, options.message) : null,
            form,
        ], { onClose: (result) => resolve(result && typeof result === 'object' ? result : null) });

        setTimeout(() => {
            const first = inputs[Object.keys(inputs)[0]];
            if (first && !entry.closed) first.focus();
        }, 80);
    });

    /** Action sheet. actions: [{ label, icon, value, danger }]. Resolves the value or null. */
    ui.sheet = (options) => new Promise((resolve) => {
        const entry = openModal([
            options.title ? h('div', { class: 'sheet-title' }, options.title) : null,
            h('div', { class: 'sheet-actions' }, options.actions.filter(Boolean).map((action) => h('button', {
                class: `sheet-action${action.danger ? ' danger' : ''}`,
                type: 'button',
                onclick: () => entry.close(action.value),
            }, action.icon ? icon(action.icon, 20) : null, h('span', null, action.label)))),
            h('button', { class: 'sheet-cancel', type: 'button', onclick: () => entry.close(null) }, 'Cancel'),
        ], { kind: 'sheet', onClose: (result) => resolve(result == null ? null : result) });
    });

    /**
     * Full screen picture viewer. actions: [{ icon, label, danger, onClick(entry) }]
     * Returns the modal entry (call entry.close() to dismiss it).
     */
    ui.viewImage = (url, options = {}) => {
        const img = h('img', { src: url, alt: '', draggable: false });
        img.referrerPolicy = 'no-referrer';

        const entry = openModal([
            h('div', { class: 'viewer-top' },
                h('button', { class: 'viewer-btn', type: 'button', title: 'Close', onclick: () => entry.close(null) },
                    icon('chevron-left')),
                h('span', { class: 'viewer-caption' }, options.caption || '')),
            h('div', { class: 'viewer-stage' }, img),
            h('div', { class: 'viewer-actions' }, (options.actions || []).filter(Boolean).map((action) => h('button', {
                class: `viewer-action${action.danger ? ' danger' : ''}`,
                type: 'button',
                onclick: () => action.onClick(entry),
            }, icon(action.icon, 22), h('span', null, action.label)))),
        ], { kind: 'viewer' });

        return entry;
    };

    let toastTimer = null;

    ui.toast = (text, kind) => {
        el.toast.textContent = text;
        el.toast.className = `toast show${kind ? ` ${kind}` : ''}`;

        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2400);
    };

    /** Shows the message that belongs to a server error code. */
    ui.error = (code) => ui.toast(Nexora.errorText(code), 'error');

    /* -- gallery cache + picker (used for avatars, attachments, wallpaper) --- */

    const gallery = {
        images: null,
        pending: null,

        async load(force) {
            if (this.images && !force) return this.images;

            if (!this.pending) {
                this.pending = Nexora.request('gallery:list').then((result) => {
                    this.pending = null;
                    if (result.ok) this.images = Nexora.list(result.images);
                    return this.images || [];
                });
            }

            return this.pending;
        },

        add(image) {
            if (this.images) this.images.unshift(image);
            Nexora.emit('gallery');
        },

        remove(id) {
            if (this.images) this.images = this.images.filter((image) => image.id !== id);
            Nexora.emit('gallery');
        },

        reset() {
            this.images = null;
            this.pending = null;
        },
    };

    Nexora.gallery = gallery;

    /** Lets the player pick one of their photos. Resolves the url or null. */
    ui.pickImage = (title) => new Promise((resolve) => {
        const grid = h('div', { class: 'picker-grid' }, ui.spinner());

        const entry = openModal([
            h('div', { class: 'sheet-title' }, title || 'Choose a photo'),
            grid,
            h('button', { class: 'sheet-cancel', type: 'button', onclick: () => entry.close(null) }, 'Cancel'),
        ], { kind: 'sheet', onClose: (result) => resolve(result == null ? null : result) });

        gallery.load().then((images) => {
            if (entry.closed) return;

            if (!images.length) {
                grid.replaceChildren(ui.empty('image', 'No photos yet', 'Take one with the camera first.'));
                return;
            }

            grid.replaceChildren(...images.map((image) => {
                const img = h('img', { src: image.url, alt: '', loading: 'lazy', draggable: false });
                img.referrerPolicy = 'no-referrer';
                return h('button', { class: 'picker-item', type: 'button', onclick: () => entry.close(image.url) }, img);
            }));
        });
    });

    /* ---------------------------------------------------------------------- */
    /* Notifications                                                           */
    /* ---------------------------------------------------------------------- */

    let noteSeq = 0;
    let bannerTimer = null;

    const outside = {
        /** Shows a card on the game screen while the phone is closed. */
        push(card, duration) {
            const wrap = h('div', { class: 'outside-item' }, card);
            el.outside.append(wrap);
            requestAnimationFrame(() => wrap.classList.add('show'));

            const handle = {
                remove() {
                    wrap.classList.remove('show');
                    setTimeout(() => wrap.remove(), 320);
                },
            };

            if (duration) setTimeout(handle.remove, duration);

            return handle;
        },

        clear() {
            el.outside.replaceChildren();
        },
    };

    Nexora.outside = outside;

    function appArt(appId, size = 16) {
        const def = apps.get(appId);
        const colors = def ? def.colors : ['#8e9aaf', '#5c677d'];

        return h('span', {
            class: 'note-icon',
            style: { background: `linear-gradient(145deg, ${colors[0]}, ${colors[1]})` },
        }, icon(def ? def.icon : 'bell', size));
    }

    function previewText(note) {
        if (state.settings.notificationPreview === false) {
            return note.app === 'messages' ? 'New message' : 'New notification';
        }
        return note.body;
    }

    function noteCard(note, options = {}) {
        return h('div', { class: `note-card${options.compact ? ' compact' : ''}`, onclick: options.onClick },
            appArt(note.app),
            h('div', { class: 'note-main' },
                h('div', { class: 'note-head' },
                    h('span', { class: 'note-title' }, note.title),
                    h('span', { class: 'note-time' }, formatRelative(note.ts))),
                h('div', { class: 'note-body' }, previewText(note))),
            options.onDismiss
                ? h('button', {
                    class: 'note-dismiss',
                    type: 'button',
                    title: 'Dismiss',
                    onclick: (event) => { event.stopPropagation(); options.onDismiss(); },
                }, icon('close', 14))
                : null);
    }

    Nexora.noteCard = noteCard;

    function hideBanner() {
        clearTimeout(bannerTimer);
        el.banner.classList.remove('show');
    }

    function showBanner(note) {
        if (state.camera) return;

        if (!state.visible) {
            if (Nexora.config.notifications.showWhenClosed) {
                outside.push(noteCard(note, { compact: true }), Nexora.config.notifications.bannerTime);
            }
            return;
        }

        el.banner.replaceChildren(noteCard(note, {
            onClick: () => { hideBanner(); runNotification(note); },
        }));

        requestAnimationFrame(() => el.banner.classList.add('show'));

        clearTimeout(bannerTimer);
        bannerTimer = setTimeout(hideBanner, Nexora.config.notifications.bannerTime);
    }

    /** Opens whatever a notification points at and removes it from the list. */
    function runNotification(note) {
        dismissNotification(note);

        if (note.action && note.action.app) {
            openApp(note.action.app, note.action.params);
        } else if (apps.has(note.app)) {
            openApp(note.app);
        }
    }

    function dismissNotification(note) {
        const before = state.notifications.length;
        state.notifications = state.notifications.filter((item) => item !== note);

        if (state.notifications.length === before) return;

        if (note.id) Nexora.request('notifications:dismiss', note.id);
        refreshNotifications();
    }

    /** Removes every notification, or only those of one app. */
    function clearNotifications(appId) {
        const stored = state.notifications.some((note) => note.id && (!appId || note.app === appId));

        state.notifications = appId ? state.notifications.filter((note) => note.app !== appId) : [];

        if (stored) Nexora.request('notifications:clear', appId || null);
        refreshNotifications();
    }

    function refreshNotifications() {
        renderHome();
        renderLockNotes();
        if (!el.center.hidden) renderCenter();
    }

    /**
     * Adds a notification.
     *   { app, title, body, id?, ts?, action?: { app, params }, silent?, transient?, banner? }
     * `silent` skips banner + sound, `transient` keeps it out of the list,
     * `banner: false` keeps the list entry and sound but shows no banner.
     */
    Nexora.notify = (input) => {
        const note = {
            key: ++noteSeq,
            id: input.id == null ? null : input.id,
            app: input.app || 'system',
            title: String(input.title || ''),
            body: String(input.body || ''),
            ts: input.ts || Math.floor(Date.now() / 1000),
            action: input.action || null,
        };

        if (!input.transient) {
            state.notifications.unshift(note);
            if (state.notifications.length > 60) state.notifications.length = 60;
            refreshNotifications();
        }

        const quiet = input.silent === true || state.settings.doNotDisturb === true;

        if (!quiet) {
            if (state.settings.notifications !== false && input.banner !== false) showBanner(note);
            sound.notification();
        }

        return note;
    };

    Nexora.dismissNotification = dismissNotification;
    Nexora.clearNotifications = clearNotifications;

    /** Number shown on an app icon. */
    function badgeFor(appId) {
        const def = apps.get(appId);
        if (def && typeof def.badge === 'function') return def.badge();
        return state.notifications.filter((note) => note.app === appId).length;
    }

    /** Updates the unread message counter (owned by the Messages app). */
    Nexora.setUnread = (count) => {
        state.unreadMessages = Math.max(0, Number(count) || 0);
        renderHome();
    };

    /* ---------------------------------------------------------------------- */
    /* Appearance                                                              */
    /* ---------------------------------------------------------------------- */

    const cssUrl = (url) => String(url).replace(/["\\\n\r]/g, '');

    /** CSS background for a picture link. */
    const imageCss = (url) => `url("${cssUrl(url)}") center / cover no-repeat`;

    /** CSS background of a Config.Wallpapers entry. */
    const wallpaperOf = (entry) => (entry.image ? imageCss(entry.image) : entry.css);

    function wallpaperCss() {
        const settings = state.settings;
        const list = Nexora.config.wallpapers || [];

        if (settings.wallpaper === 'custom' && settings.customWallpaper) {
            return imageCss(settings.customWallpaper);
        }

        const entry = list.find((item) => item.id === settings.wallpaper) || list[0];

        return entry ? wallpaperOf(entry) : '#10131a';
    }

    Nexora.imageCss = imageCss;
    Nexora.wallpaperOf = wallpaperOf;

    function applyScale() {
        const user = (state.settings.scale || 100) / 100;
        const fit = (window.innerHeight * 0.94) / el.phone.offsetHeight;
        const base = Math.max(0.5, Math.min(1.7, window.innerHeight / 1080));

        el.wrap.style.setProperty('--scale', Math.min(base * user, fit).toFixed(4));
    }

    function applySettings() {
        const config = Nexora.config;
        if (!config) return;

        const settings = state.settings;
        const accent = (config.accents || []).find((item) => item.id === settings.accent) || (config.accents || [])[0];
        const frame = (config.frames || []).find((item) => item.id === settings.frame) || (config.frames || [])[0];

        const accentColor = accent && /^#[0-9a-f]{6}$/i.test(accent.color) ? accent.color : '#3d8bff';
        const accentValue = parseInt(accentColor.slice(1), 16);

        document.documentElement.dataset.theme = settings.theme === 'light' ? 'light' : 'dark';
        document.documentElement.style.setProperty('--accent', accentColor);
        // "r, g, b" so the stylesheet can build translucent accent colours.
        document.documentElement.style.setProperty('--accent-rgb',
            `${(accentValue >> 16) & 255}, ${(accentValue >> 8) & 255}, ${accentValue & 255}`);

        if (frame) {
            el.phone.style.setProperty('--frame', frame.color);
            el.phone.style.setProperty('--frame-edge', frame.edge);
            el.phone.style.setProperty('--radius', `${frame.radius}px`);
            el.phone.dataset.notch = frame.notch || 'none';
        }

        // Used by both the home screen wallpaper and the lock screen.
        el.screen.style.setProperty('--wallpaper', wallpaperCss());
        el.wrap.dataset.position = config.position || 'right';
        el.outside.dataset.position = config.position || 'right';

        applyScale();
        renderStatus();
        renderClock();
    }

    Nexora.applySettings = applySettings;

    /**
     * Changes a setting: applied immediately, then confirmed by the server
     * (and rolled back when the server refuses it).
     */
    Nexora.setSetting = async (key, value) => {
        const previous = state.settings[key];
        if (previous === value) return true;

        state.settings[key] = value;
        applySettings();
        Nexora.emit('settings', { key, value });

        const result = await Nexora.request('settings:set', key, value);

        if (!result.ok) {
            state.settings[key] = previous;
            applySettings();
            Nexora.emit('settings', { key, value: previous });
            ui.error(result.error);
            return false;
        }

        // Leaving airplane mode: messages may have arrived in the meantime.
        if (typeof result.unread === 'number') {
            Nexora.setUnread(result.unread);
            Nexora.emit('messages:stale');
        }

        return true;
    };

    /* ---------------------------------------------------------------------- */
    /* Status bar, clock, lock screen                                          */
    /* ---------------------------------------------------------------------- */

    let liveCall = null; // { text } while a call is running in the background

    function renderStatus() {
        const { battery, charging, signal } = state.status;
        const settings = state.settings;

        const bars = $('#sb-signal');
        bars.dataset.level = settings.airplane ? 0 : signal;
        bars.hidden = settings.airplane === true;

        fill($('#sb-icons'),
            settings.airplane ? icon('airplane', 14) : null,
            settings.doNotDisturb ? icon('moon', 13) : null);

        const batteryEl = $('#sb-battery');
        const level = Math.max(0, Math.min(100, Math.round(battery)));
        const enabled = !Nexora.config || Nexora.config.battery.enabled;

        batteryEl.hidden = !enabled;
        batteryEl.classList.toggle('low', level <= 15 && !charging);
        batteryEl.classList.toggle('charging', charging === true);
        $('.sb-battery-fill', batteryEl).style.width = `${level}%`;
        $('b', batteryEl).textContent = level;
    }

    function renderClock() {
        const time = now();
        const text = formatClock(time.h, time.m);
        const clockEl = $('#sb-time');

        clockEl.classList.toggle('live', liveCall !== null);
        clockEl.textContent = liveCall ? liveCall.text : text;

        $('#lock-date').textContent = dateText(time);

        const use24 = state.settings.use24h !== false;
        const hours = use24 ? String(time.h).padStart(2, '0') : String(time.h % 12 || 12);

        fill($('#lock-time'),
            h('span', { class: 'lock-hours' }, hours),
            h('span', { class: 'lock-minutes' }, String(time.m).padStart(2, '0')),
            use24 ? null : h('span', { class: 'lock-period' }, time.h >= 12 ? 'PM' : 'AM'));

        const part = time.h < 5 ? 'Good night' : time.h < 12 ? 'Good morning' : time.h < 18 ? 'Good afternoon' : 'Good evening';
        const first = state.name ? state.name.split(' ')[0] : '';

        $('#glance-title').textContent = first ? `${part}, ${first}` : part;
        $('#glance-sub').textContent = dateText(time);
    }

    /** Shows / hides the green "call in progress" pill in the status bar. */
    Nexora.setLiveCall = (text) => {
        liveCall = text == null ? null : { text };
        renderClock();
    };

    let lastMinuteKey = -1;

    function tick() {
        const time = now();
        const key = time.h * 60 + time.m;

        if (key === lastMinuteKey) return;
        lastMinuteKey = key;

        renderClock();
        Nexora.emit('minute', time);
    }

    function renderLockNotes() {
        const list = $('#lock-notes');
        const notes = state.notifications.slice(0, 3);
        const more = state.notifications.length - notes.length;

        fill(list,
            notes.map((note) => noteCard(note, { onClick: () => { unlock(); runNotification(note); } })),
            more > 0 ? h('div', { class: 'lock-more' }, `+${more} more`) : null);
    }

    function lock() {
        state.locked = true;
        el.lock.classList.remove('open');
        updateTone();
    }

    function unlock() {
        if (!state.locked) return;

        state.locked = false;
        el.lock.classList.add('open');
        updateTone();
        Nexora.emit('unlock');
    }

    Nexora.unlock = unlock;

    /* ---------------------------------------------------------------------- */
    /* Notification centre                                                     */
    /* ---------------------------------------------------------------------- */

    function renderCenter() {
        const settings = state.settings;

        const quick = (label, iconName, active, onClick) => h('button', {
            class: `quick${active ? ' on' : ''}`,
            type: 'button',
            onclick: onClick,
        }, icon(iconName, 20), h('span', null, label));

        const flip = (key) => () => Nexora.setSetting(key, !state.settings[key]).then(renderCenter);

        const volume = h('input', {
            class: 'slider',
            type: 'range',
            min: 0,
            max: 100,
            step: 5,
        });
        volume.value = settings.volume == null ? 60 : settings.volume;
        volume.addEventListener('change', () => {
            Nexora.setSetting('volume', Number(volume.value)).then(() => sound.play('tick'));
        });

        const notes = state.notifications;

        el.center.replaceChildren(
            h('div', { class: 'center-panel' },
                h('div', { class: 'quick-row' },
                    quick('Airplane', 'airplane', settings.airplane, flip('airplane')),
                    quick('Silence', 'moon', settings.doNotDisturb, flip('doNotDisturb')),
                    quick('Dark', 'palette', settings.theme !== 'light',
                        () => Nexora.setSetting('theme', state.settings.theme === 'light' ? 'dark' : 'light').then(renderCenter))),
                h('label', { class: 'center-volume' }, icon('volume', 18), volume),
                h('div', { class: 'center-head' },
                    h('span', null, 'Notifications'),
                    notes.length
                        ? h('button', { class: 'link-btn', type: 'button', onclick: () => clearNotifications() }, 'Clear all')
                        : null),
                h('div', { class: 'center-list' },
                    notes.length
                        ? notes.map((note) => noteCard(note, {
                            onClick: () => { closeCenter(); runNotification(note); },
                            onDismiss: () => dismissNotification(note),
                        }))
                        : h('div', { class: 'center-empty' }, 'No new notifications')),
                h('button', { class: 'center-grab', type: 'button', title: 'Close', onclick: closeCenter })),
        );
    }

    function openCenter() {
        if (!state.ready || state.locked) return;

        renderCenter();
        el.center.hidden = false;
        requestAnimationFrame(() => el.center.classList.add('show'));
    }

    function closeCenter() {
        if (el.center.hidden) return false;

        el.center.classList.remove('show');
        setTimeout(() => { el.center.hidden = true; }, 240);

        return true;
    }

    /* ---------------------------------------------------------------------- */
    /* Home screen & apps                                                      */
    /* ---------------------------------------------------------------------- */

    /** Config entries of the apps that are installed AND allowed. */
    function visibleApps() {
        return (Nexora.config.apps || []).filter((app) => apps.has(app.id) && state.allowed.includes(app.id));
    }

    function appButton(app, withLabel) {
        const def = apps.get(app.id);
        const count = badgeFor(app.id);

        return h('button', {
            class: 'app-icon',
            type: 'button',
            dataset: { app: app.id },
            onclick: () => openApp(app.id),
        },
        h('span', {
            class: 'app-icon-art',
            style: { background: `linear-gradient(145deg, ${def.colors[0]}, ${def.colors[1]})` },
        }, icon(def.icon, 30), count > 0 ? h('span', { class: 'badge' }, count > 99 ? '99+' : count) : null),
        withLabel ? h('span', { class: 'app-icon-label' }, app.label) : null);
    }

    function renderHome() {
        if (!Nexora.config || !state.ready) return;

        const list = visibleApps();
        const docked = list.filter((app) => app.dock).slice(0, 4);
        const rest = list.filter((app) => !docked.includes(app));

        el.grid.replaceChildren(...rest.map((app) => appButton(app, true)));
        el.dock.replaceChildren(...docked.map((app) => appButton(app, false)));
        el.dock.hidden = docked.length === 0;
    }

    Nexora.refreshHome = renderHome;

    /** Colour scheme of the status bar: over the wallpaper or inside an app. */
    function updateTone() {
        let tone = 'wall';

        if (!state.locked && state.current) {
            const def = apps.get(state.current);
            tone = (def && def.tone) || 'app';
        }

        // The call screen always sits on a dark backdrop.
        if (Nexora.callScreen && Nexora.callScreen.visible()) tone = 'wall';

        el.screen.dataset.tone = tone;
    }

    Nexora.updateTone = updateTone;

    /** Offset of an app icon from the centre of the screen (for the zoom). */
    function iconOffset(id) {
        const art = document.querySelector(`.app-icon[data-app="${id}"] .app-icon-art`);
        const frame = el.screen.getBoundingClientRect();

        if (!art || !frame.width) return { x: 0, y: 0 };

        const rect = art.getBoundingClientRect();
        const scale = frame.width / el.screen.offsetWidth || 1;

        return {
            x: (rect.left + rect.width / 2 - (frame.left + frame.width / 2)) / scale,
            y: (rect.top + rect.height / 2 - (frame.top + frame.height / 2)) / scale,
        };
    }

    function zoomFrames(id) {
        const offset = iconOffset(id);

        return [
            { transform: `translate(${offset.x}px, ${offset.y}px) scale(0.12)`, opacity: 0, borderRadius: '70px' },
            { transform: 'translate(0, 0) scale(1)', opacity: 1, borderRadius: '0px' },
        ];
    }

    /**
     * Registers an app.
     *   id, icon, colors: [from, to]   icon glyph + gradient of the home icon
     *   tone?: 'app' | 'dark'          status bar style while it is open
     *   mount(root, app)               build the DOM (called once, lazily)
     *   open(params)?                  every time it comes to the foreground
     *   close()?                       when it goes to the background
     *   back()?                        return true when it handled "back"
     *   key(event)?                    return true when it handled a key
     *   badge()?                       number for the icon badge
     */
    Nexora.registerApp = (def) => {
        if (!def || typeof def.id !== 'string' || typeof def.mount !== 'function') {
            console.error('[nexora] invalid app definition', def);
            return;
        }

        apps.set(def.id, Object.assign({
            icon: 'dot',
            colors: ['#8e9aaf', '#5c677d'],
            root: null,
        }, def));
    };

    Nexora.app = (id) => apps.get(id) || null;

    function mountApp(app) {
        if (app.root) return;

        app.root = h('div', { class: 'app', dataset: { app: app.id } });
        el.apps.append(app.root);

        try {
            app.mount(app.root, app);
        } catch (err) {
            console.error(`[nexora] app "${app.id}" failed to mount`, err);
            app.root.replaceChildren(ui.empty('info', 'This app crashed', 'Check the F8 console for details.'));
        }
    }

    function openApp(id, params) {
        const app = apps.get(id);

        if (!app || !state.ready || !state.allowed.includes(id)) return false;

        unlock();
        closeCenter();
        hideBanner();

        const previous = state.current;

        if (previous && previous !== id) {
            const old = apps.get(previous);
            if (old && old.root) old.root.classList.remove('active');
            if (old && old.close) {
                try { old.close(); } catch (err) { console.error(err); }
            }
        }

        mountApp(app);

        state.current = id;
        app.root.classList.add('active');
        el.home.classList.add('behind');
        updateTone();

        if (previous !== id) {
            for (const animation of app.root.getAnimations()) animation.cancel();
            app.root.animate(zoomFrames(id), { duration: 360, easing: EASE });
        }

        if (app.open) {
            try {
                app.open(params || {});
            } catch (err) {
                console.error(`[nexora] app "${id}" failed to open`, err);
            }
        }

        // Opening an app acknowledges its notifications.
        if (state.notifications.some((note) => note.app === id)) clearNotifications(id);

        Nexora.emit('app:open', id);

        return true;
    }

    Nexora.openApp = openApp;

    /** Sends the foreground app to the background and shows the home screen. */
    function goHome() {
        closeCenter();

        const id = state.current;
        if (!id) return;

        const app = apps.get(id);

        state.current = null;
        el.home.classList.remove('behind');
        updateTone();

        if (app.close) {
            try { app.close(); } catch (err) { console.error(err); }
        }

        const frames = zoomFrames(id).reverse();
        const leave = app.root.animate(frames, { duration: 300, easing: EASE, fill: 'forwards' });

        leave.onfinish = () => {
            if (state.current !== id) app.root.classList.remove('active');
            leave.cancel();
        };

        renderHome();
        Nexora.emit('app:close', id);
    }

    Nexora.home = goHome;

    const closePhone = () => Nexora.post('close');

    Nexora.close = closePhone;

    /** The "back" gesture: Escape, Backspace or the app's own back button. */
    function back() {
        if (modals.length) {
            modals[modals.length - 1].close(null);
            return;
        }

        if (closeCenter()) return;

        if (Nexora.callScreen && Nexora.callScreen.back()) return;

        if (state.locked) {
            closePhone();
            return;
        }

        if (state.current) {
            const app = apps.get(state.current);
            let handled = false;

            if (app.back) {
                try { handled = app.back() === true; } catch (err) { console.error(err); }
            }

            if (!handled) goHome();
            return;
        }

        closePhone();
    }

    Nexora.back = back;

    /* ---------------------------------------------------------------------- */
    /* Showing / hiding the phone                                              */
    /* ---------------------------------------------------------------------- */

    function setAllowed(list) {
        state.allowed = Array.isArray(list) ? list : [];

        if (state.current && !state.allowed.includes(state.current)) goHome();
        renderHome();
    }

    function show(data) {
        if (!state.ready) return;

        if (data.apps) setAllowed(data.apps);
        if (data.status) state.status = data.status;
        if (data.time) state.gameTime = data.time;

        state.visible = true;
        outside.clear();

        const inCall = Nexora.callScreen && Nexora.callScreen.active();

        if (state.settings.lockScreen !== false && !data.app && !inCall) lock();
        else unlock();

        renderStatus();
        tick();
        renderClock();
        renderHome();
        renderLockNotes();
        applyScale();

        el.wrap.classList.add('visible');

        if (data.app) openApp(data.app);

        Nexora.emit('visible', true);
    }

    function hide() {
        if (!state.visible) return;

        state.visible = false;
        el.wrap.classList.remove('visible');

        hideBanner();
        closeCenter();
        while (modals.length) modals[modals.length - 1].close(null);

        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();

        Nexora.emit('visible', false);
    }

    /* ---------------------------------------------------------------------- */
    /* Camera viewfinder overlay                                               */
    /* ---------------------------------------------------------------------- */

    function setViewfinder(data) {
        state.camera = data.active === true;

        el.viewfinder.hidden = !state.camera;
        el.wrap.classList.toggle('camera', state.camera);

        if (state.camera) {
            $('#vf-mode').textContent = data.selfie ? 'SELFIE' : 'REAR';
            $('#vf-zoom').textContent = `${Number(data.zoom || 1).toFixed(1)}x`;
            $('#vf-status').textContent = data.canSave === false ? 'Photos can not be saved on this server' : '';
        }

        Nexora.emit('camera:state', data);
    }

    function captureViewfinder(data) {
        el.viewfinder.classList.toggle('capturing', data.hide === true);

        if (data.flash) {
            const flash = $('#vf-flash');
            flash.classList.remove('fire');
            void flash.offsetWidth; // restart the animation
            flash.classList.add('fire');
            sound.play('shutter');
        }
    }

    /* ---------------------------------------------------------------------- */
    /* Loading apps                                                            */
    /* ---------------------------------------------------------------------- */

    function loadScript(src) {
        return new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = () => resolve(true);
            script.onerror = () => {
                console.error(`[nexora] could not load ${src}`);
                resolve(false);
            };
            document.body.append(script);
        });
    }

    let appsLoaded = Promise.resolve();

    function loadApps(list) {
        const ids = list.map((app) => app.id).filter((id) => /^[a-z0-9_-]+$/i.test(id) && !apps.has(id));
        return Promise.all(ids.map((id) => loadScript(`apps/${id}.js`)));
    }

    /* ---------------------------------------------------------------------- */
    /* Messages from Lua                                                       */
    /* ---------------------------------------------------------------------- */

    const handlers = {
        /** Static configuration (config.lua), sent once per page load. */
        init(config) {
            Nexora.config = config;
            appsLoaded = loadApps(config.apps || []);
        },

        /** Data of the character that just loaded. */
        async bootstrap(data) {
            await appsLoaded;

            state.ready = true;
            state.number = data.number || '';
            state.name = data.name || '';
            state.settings = Object.assign({}, Nexora.config.defaults, data.settings || {});
            state.status.battery = data.battery == null ? 100 : data.battery;
            state.unreadMessages = data.unread || 0;
            state.alarms = Array.isArray(data.alarms) ? data.alarms : [];
            state.allowed = Array.isArray(data.apps) ? data.apps : [];
            state.notifications = (data.notifications || []).map((note) => ({
                key: ++noteSeq,
                id: note.id,
                app: note.app || 'system',
                title: String(note.title || ''),
                body: String(note.body || ''),
                ts: note.ts,
                action: null,
            }));

            gallery.reset();
            Nexora.contacts.set(data.contacts);

            applySettings();
            renderHome();
            renderLockNotes();

            Nexora.emit('bootstrap', data);
        },

        /** The character logged out. */
        reset() {
            hide();
            sound.stop();
            outside.clear();

            if (state.current) {
                const app = apps.get(state.current);
                if (app && app.root) app.root.classList.remove('active');
            }

            state.ready = false;
            state.current = null;
            state.locked = true;
            state.number = '';
            state.name = '';
            state.contacts = [];
            state.notifications = [];
            state.unreadMessages = 0;
            state.alarms = [];
            state.allowed = [];

            el.home.classList.remove('behind');
            el.lock.classList.remove('open');
            contactIndex.clear();
            gallery.reset();
            liveCall = null;

            Nexora.emit('reset');
        },

        open: show,
        close: hide,

        time(data) {
            if (!data) return;
            state.gameTime = data;
            tick();
        },

        status(data) {
            if (!data) return;
            state.status = data;
            renderStatus();
        },

        apps: setAllowed,

        notification(data) {
            if (data && state.ready) Nexora.notify(data);
        },

        'camera:state': setViewfinder,
        'camera:capture': captureViewfinder,
    };

    // Everything else is simply forwarded to the apps over the event bus.
    const FORWARDED = ['message', 'messagesRead', 'bankTransaction', 'call:incoming', 'call:state',
        'call:ended', 'camera:result', 'dial'];

    window.addEventListener('message', (event) => {
        const payload = event.data;
        if (!payload || typeof payload.action !== 'string') return;

        const handler = handlers[payload.action];

        if (handler) {
            Promise.resolve(handler(payload.data || {})).catch((err) => {
                console.error(`[nexora] handler "${payload.action}" failed`, err);
            });
        } else if (FORWARDED.includes(payload.action)) {
            if (state.ready) Nexora.emit(payload.action, payload.data || {});
        }
    });

    /* ---------------------------------------------------------------------- */
    /* Input                                                                   */
    /* ---------------------------------------------------------------------- */

    const isEditable = (node) => !!node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable);

    // Tell Lua when a text field has focus so the game stops receiving keys.
    let focusState = false;
    let focusTimer = null;

    function reportFocus() {
        clearTimeout(focusTimer);
        focusTimer = setTimeout(() => {
            const focused = state.visible && isEditable(document.activeElement)
                && document.activeElement.type !== 'range';

            if (focused === focusState) return;
            focusState = focused;
            Nexora.post('inputFocus', { focused });
        }, 40);
    }

    document.addEventListener('focusin', reportFocus);
    document.addEventListener('focusout', reportFocus);
    Nexora.on('visible', reportFocus);

    document.addEventListener('keydown', (event) => {
        if (!state.visible || state.camera) return;

        const typing = isEditable(document.activeElement) && document.activeElement.type !== 'range';

        if (event.key === 'Escape') {
            event.preventDefault();
            if (typing) document.activeElement.blur();
            else back();
            return;
        }

        if (typing) return;

        if (state.locked) {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                unlock();
            }
            return;
        }

        // The foreground app gets the first chance to use the key.
        if (state.current && !modals.length && el.center.hidden) {
            const app = apps.get(state.current);
            if (app && app.key) {
                let used = false;
                try { used = app.key(event) === true; } catch (err) { console.error(err); }
                if (used) {
                    event.preventDefault();
                    return;
                }
            }
        }

        if (event.key === 'Backspace') {
            event.preventDefault();
            back();
            return;
        }

        // With Config.KeepInput = false Lua never sees the open key, so the
        // page has to close the phone itself.
        const config = Nexora.config;
        if (config && !config.keepInput && config.openKey
            && event.key.toUpperCase() === String(config.openKey).toUpperCase()) {
            closePhone();
        }
    });

    $('#lock-open').addEventListener('click', unlock);
    el.lock.addEventListener('click', (event) => {
        if (event.target === el.lock || event.target.closest('.lock-head')) unlock();
    });

    $('#homebar').addEventListener('click', () => {
        if (state.locked) unlock();
        else if (state.current) goHome();
        else closePhone();
    });

    $('#sb-time').addEventListener('click', () => {
        if (liveCall && Nexora.callScreen) Nexora.callScreen.show();
        else if (el.center.hidden) openCenter();
        else closeCenter();
    });

    $('#sb-island').addEventListener('click', () => (el.center.hidden ? openCenter() : closeCenter()));
    $('.sb-right').addEventListener('click', () => (el.center.hidden ? openCenter() : closeCenter()));

    el.center.addEventListener('pointerdown', (event) => {
        if (event.target === el.center) closeCenter();
    });

    window.addEventListener('resize', applyScale);

    // Real clock ticks. With the game clock Lua pushes "time" messages
    // instead, and this only catches the first render.
    setInterval(tick, 1000);

    /* ---------------------------------------------------------------------- */
    /* Boot                                                                    */
    /* ---------------------------------------------------------------------- */

    if (inGame) {
        Nexora.post('ready');
    } else {
        // Opened in a normal browser: load the preview backend (html/dev.js).
        loadScript('dev.js').then((loaded) => {
            if (loaded) Nexora.post('ready');
        });
    }
})();
