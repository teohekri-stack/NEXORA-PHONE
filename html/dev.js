/* ==========================================================================
   Nexora Phone - browser preview backend
   --------------------------------------------------------------------------
   Loaded ONLY when html/index.html is opened in a normal browser. It is not
   listed in fxmanifest.lua, so it never reaches players. It plays the part
   of client/*.lua and the server with a small in-memory data set, which
   makes it possible to work on the UI without starting FiveM.

   URL options
     ?scene=lock | home | <app id> | thread | contact | call | incall | center
            | banner | closed | appearance | alarms | timer | note | send
            | viewfinder | camerapage
     &theme=dark|light   &accent=<id>   &wallpaper=<id>   &frame=<id>
     &position=right|left|center        &zoom=70..130        &bg=none
   ========================================================================== */
(() => {
    'use strict';

    const N = window.Nexora;
    const params = new URLSearchParams(location.search);
    const scene = params.get('scene') || 'lock';

    const now = () => Math.floor(Date.now() / 1000);
    const ago = (minutes) => now() - minutes * 60;
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const ok = (extra) => Object.assign({ ok: true }, extra || {});
    const fail = (error) => ({ ok: false, error });

    /** Delivers a message exactly like SendNUIMessage does. */
    const send = (action, data) => window.dispatchEvent(new MessageEvent('message', { data: { action, data } }));

    /* ---------------------------------------------------------------------- */
    /* Sample pictures (generated, so the preview needs no image files)        */
    /* ---------------------------------------------------------------------- */

    const SHAPES = {
        skyline: (c) => `<circle cx="292" cy="140" r="44" fill="#fff" opacity=".85"/>
            <path d="M0 400V282h42v-62h50v92h30V192h62v128h30v-82h52v62h40V232h50v98h44v70z" fill="${c}"/>`,
        hills: (c) => `<circle cx="118" cy="128" r="40" fill="#fff" opacity=".9"/>
            <path d="M0 400V300c80-70 140-70 210 0s130 40 190-30v130z" fill="${c}"/>
            <path d="M0 400v-60c90-40 170-20 250 20s110 10 150-10v50z" fill="#000" opacity=".25"/>`,
        road: (c) => `<path d="M0 400V200l400-10v210z" fill="${c}"/>
            <path d="M140 400 188 196h24l48 204z" fill="#000" opacity=".35"/>
            <path d="M200 388v-34M200 330v-28M200 282v-22M200 246v-16" stroke="#fff" stroke-width="5" opacity=".85"/>`,
        coast: (c) => `<circle cx="300" cy="120" r="38" fill="#fff" opacity=".9"/>
            <path d="M0 400V250c60-20 120 20 200 0s140-30 200 0v150z" fill="${c}"/>
            <path d="M0 400V320c70-16 130 14 200 0s140-20 200 0v80z" fill="#fff" opacity=".22"/>`,
    };

    function picture(top, bottom, shape, tint) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
            <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>
            <rect width="400" height="400" fill="url(#g)"/>${SHAPES[shape](tint)}</svg>`;

        return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    }

    const PHOTOS = [
        picture('#2b1b52', '#f0845a', 'skyline', '#1b1030'),
        picture('#8fd3ff', '#e9f6ff', 'hills', '#3b9a6b'),
        picture('#ffb86b', '#ffe3b0', 'road', '#c9a26a'),
        picture('#5aa9f5', '#bfe4ff', 'coast', '#1f6fc2'),
        picture('#101a3c', '#3b4a8c', 'skyline', '#070b1c'),
        picture('#f59fb5', '#ffe0c2', 'hills', '#7a5a8c'),
        picture('#3a4a5c', '#9fb0c2', 'road', '#5c6b78'),
    ];

    /* ---------------------------------------------------------------------- */
    /* Static configuration (mirrors config.lua)                               */
    /* ---------------------------------------------------------------------- */

    const config = {
        resource: 'nexora-phone',
        framework: 'qb',
        debug: true,
        brand: { name: 'Nexora', device: 'Nexora X1', carrier: 'NEXORA' },
        apps: [
            { id: 'phone', label: 'Phone', dock: true },
            { id: 'messages', label: 'Messages', dock: true },
            { id: 'contacts', label: 'Contacts', dock: true },
            { id: 'camera', label: 'Camera', dock: true },
            { id: 'gallery', label: 'Gallery', dock: false },
            { id: 'bank', label: 'Bank', dock: false },
            { id: 'notes', label: 'Notes', dock: false },
            { id: 'clock', label: 'Clock', dock: false },
            { id: 'calculator', label: 'Calculator', dock: false },
            { id: 'settings', label: 'Settings', dock: false },
        ],
        defaults: {
            theme: 'dark', accent: 'azure', wallpaper: 'aurora', frame: 'graphite', ringtone: 'aurora',
            notificationSound: 'drop', volume: 60, scale: 100, use24h: true, notifications: true,
            notificationPreview: true, vibrate: true, doNotDisturb: false, airplane: false,
            hideCallerId: false, lockScreen: true,
        },
        wallpapers: [
            { id: 'aurora', label: 'Aurora', image: 'assets/wallpapers/aurora.svg' },
            { id: 'dunes', label: 'Dunes', image: 'assets/wallpapers/dunes.svg' },
            { id: 'orbit', label: 'Orbit', image: 'assets/wallpapers/orbit.svg' },
            { id: 'tide', label: 'Tide', image: 'assets/wallpapers/tide.svg' },
            { id: 'ember', label: 'Ember', css: 'linear-gradient(160deg,#2b0f1a 0%,#8a2b2b 45%,#f0a04b 100%)' },
            { id: 'midnight', label: 'Midnight', css: 'radial-gradient(120% 90% at 50% 0%,#27306b 0%,#0e1030 55%,#05060f 100%)' },
            { id: 'mint', label: 'Mint', css: 'linear-gradient(170deg,#d7f5e9 0%,#8fd9c4 50%,#3a9d8f 100%)' },
            { id: 'slate', label: 'Slate', css: 'linear-gradient(180deg,#2f3540 0%,#14171d 100%)' },
        ],
        allowCustomWallpaper: true,
        accents: [
            { id: 'azure', label: 'Azure', color: '#3d8bff' },
            { id: 'violet', label: 'Violet', color: '#8b6cff' },
            { id: 'mint', label: 'Mint', color: '#22c79a' },
            { id: 'amber', label: 'Amber', color: '#f5a524' },
            { id: 'coral', label: 'Coral', color: '#ff6b5e' },
            { id: 'rose', label: 'Rose', color: '#f0509b' },
        ],
        frames: [
            { id: 'graphite', label: 'Graphite', color: '#1b1d22', edge: '#3a3d45', notch: 'island', radius: 46 },
            { id: 'silver', label: 'Silver', color: '#d9dce2', edge: '#f4f5f7', notch: 'island', radius: 46 },
            { id: 'ocean', label: 'Ocean', color: '#16324f', edge: '#2f5d8a', notch: 'punch', radius: 42 },
            { id: 'sand', label: 'Sand', color: '#c9b79c', edge: '#e6d9c3', notch: 'notch', radius: 40 },
            { id: 'crimson', label: 'Crimson', color: '#5b1420', edge: '#8f2636', notch: 'punch', radius: 44 },
            { id: 'bare', label: 'Bare', color: '#0c0d10', edge: '#17191e', notch: 'none', radius: 30 },
        ],
        position: params.get('position') || 'right',
        sounds: {
            ringtones: [
                { id: 'aurora', label: 'Aurora' }, { id: 'pulse', label: 'Pulse' }, { id: 'marimba', label: 'Marimba' },
                { id: 'retro', label: 'Retro' }, { id: 'silent', label: 'Silent' },
            ],
            notifications: [
                { id: 'drop', label: 'Drop' }, { id: 'glass', label: 'Glass' }, { id: 'tick', label: 'Tick' },
                { id: 'silent', label: 'Silent' },
            ],
        },
        clockSource: 'real',
        openKey: 'M',
        keepInput: true,
        number: { groups: [3, 3, 4], min: 3, max: 15 },
        messages: { maxLength: 500, allowImages: true, allowLocation: true },
        calls: { allowAnonymous: true },
        bank: { currency: '$', min: 1, max: 1000000, feePercent: 0, reasonMaxLength: 60, allowCharacterId: true },
        gallery: {
            maxImages: 80,
            allowUrlImport: true,
            allowedHosts: ['cdn.discordapp.com', 'media.discordapp.net', 'fivemanage.com', 'i.imgur.com'],
        },
        camera: { available: true },
        notes: { maxNotes: 60, maxTitle: 60, maxBody: 4000 },
        contacts: { maxContacts: 200, maxName: 40 },
        alarms: { maxAlarms: 12 },
        // The banner scenes keep their banner on screen so it can be inspected.
        notifications: { bannerTime: scene === 'banner' || scene === 'closed' ? 600000 : 4500, showWhenClosed: true },
        battery: { enabled: true, lowWarning: 15 },
    };

    /* ---------------------------------------------------------------------- */
    /* In-memory "database"                                                    */
    /* ---------------------------------------------------------------------- */

    const ME = '5550142877';
    const MAYA = '5550198342';
    const DEX = '5550117760';
    const LENA = '5550163029';

    let nextId = 500;
    const id = () => ++nextId;

    const settings = Object.assign({}, config.defaults, { customWallpaper: '' });
    for (const key of ['theme', 'accent', 'wallpaper', 'frame']) {
        if (params.get(key)) settings[key] = params.get(key);
    }

    if (params.get('vibrate') === '0') settings.vibrate = false;

    // &zoom=70..130 sets the phone size (the same value as Settings > Phone size).
    if (params.get('zoom')) settings.scale = Math.max(70, Math.min(130, Number(params.get('zoom')) || 100));

    const db = {
        name: 'Arlo Bennett',
        balance: 48250,
        contacts: [
            { id: 1, name: 'Maya Castillo', number: MAYA, avatar: null, favourite: true },
            { id: 2, name: 'Dex Ramirez', number: DEX, avatar: null, favourite: true },
            { id: 3, name: 'Dr. Lena Hart', number: LENA, avatar: null, favourite: false },
            { id: 4, name: 'Jonah Price', number: '5550125518', avatar: null, favourite: false },
            { id: 5, name: 'LS Customs', number: '5550109911', avatar: null, favourite: false },
            { id: 6, name: 'Priya Nair', number: '5550174403', avatar: null, favourite: false },
            { id: 7, name: 'Sam Okafor', number: '5550150096', avatar: null, favourite: false },
            { id: 8, name: 'Tessa Vaughn', number: '5550133871', avatar: null, favourite: false },
        ],
        messages: [],
        calls: [
            { id: 11, direction: 'in', number: MAYA, anonymous: false, status: 'answered', duration: 312, ts: ago(48) },
            { id: 10, direction: 'out', number: DEX, anonymous: false, status: 'answered', duration: 95, ts: ago(170) },
            { id: 9, direction: 'in', number: LENA, anonymous: false, status: 'missed', duration: 0, ts: ago(380) },
            { id: 8, direction: 'out', number: '5550109911', anonymous: false, status: 'cancelled', duration: 0, ts: ago(1500) },
            { id: 7, direction: 'in', number: null, anonymous: true, status: 'declined', duration: 0, ts: ago(2900) },
            { id: 6, direction: 'in', number: '5550186620', anonymous: false, status: 'answered', duration: 41, ts: ago(4400) },
        ],
        notes: [
            { id: 31, title: 'Garage door code', body: 'Front: 4471\nBack lot: 9902\nAsk Dex for the new fob.', pinned: true, ts: ago(300) },
            { id: 32, title: 'Shopping', body: 'Water\nBandages\nRepair kit x2\nCoffee for the night shift', pinned: false, ts: ago(60) },
            { id: 33, title: '', body: 'Meet Priya at the pier, 8 pm. Bring the paperwork for the boat.', pinned: false, ts: ago(1600) },
            { id: 34, title: 'Car ideas', body: 'Matte grey wrap, bronze wheels, tinted lights. Budget 18k.', pinned: false, ts: ago(5200) },
        ],
        gallery: PHOTOS.map((url, index) => ({ id: 70 - index, url, ts: ago(30 + index * 400) })),
        transactions: [
            { id: 44, direction: 'in', name: 'Dex Ramirez', amount: 1200, fee: 0, reason: 'Parts refund', ts: ago(35) },
            { id: 43, direction: 'out', name: 'LS Customs', amount: 4350, fee: 0, reason: 'Respray + tyres', ts: ago(260) },
            { id: 42, direction: 'out', name: 'Maya Castillo', amount: 250, fee: 0, reason: 'Dinner', ts: ago(1500) },
            { id: 41, direction: 'in', name: 'Priya Nair', amount: 3000, fee: 0, reason: 'Boat share', ts: ago(3100) },
            { id: 40, direction: 'out', name: 'Sam Okafor', amount: 600, fee: 0, reason: '', ts: ago(6000) },
        ],
        alarms: [
            { id: 1, hour: 7, minute: 30, label: 'Shift starts', enabled: true, days: [false, true, true, true, true, true, false] },
            { id: 2, hour: 22, minute: 15, label: 'Call mum', enabled: false, days: [false, false, false, false, false, false, false] },
            { id: 3, hour: 9, minute: 0, label: '', enabled: true, days: [true, false, false, false, false, false, true] },
        ],
        notifications: [
            { id: 91, app: 'bank', title: 'Bank', body: 'You received $1,200 from Dex Ramirez', ts: ago(35) },
            { id: 90, app: 'phone', title: 'Missed call', body: 'You missed a call from Dr. Lena Hart', ts: ago(380) },
        ],
    };

    const message = (from, to, body, minutesAgo, kind, attachment, read) => ({
        id: id(), from, to, body, kind: kind || 'text', attachment: attachment || null,
        ts: ago(minutesAgo), read: read !== false,
    });

    db.messages.push(
        message(LENA, ME, 'Your results are in. Nothing to worry about, come by on Friday.', 2000),
        message(ME, LENA, 'Thank you doctor, see you then.', 1990),
        message('Nexora', ME, 'Welcome to Nexora. Your number is 555-014-2877.', 1700),
        message(MAYA, ME, 'Are you still coming tonight?', 196),
        message(ME, MAYA, 'Yes, leaving the garage in ten minutes.', 192),
        message(MAYA, ME, 'Look at this view from the pier', 190, 'image', PHOTOS[0]),
        message(ME, MAYA, 'Wow. Save me a spot!', 188),
        message(MAYA, ME, '', 60, 'location', '-1850.12,-1231.44'),
        message(MAYA, ME, 'We are right here, by the food trucks.', 59),
        message(ME, MAYA, 'On my way', 57),
        message(DEX, ME, 'Got your parts. Sent the refund over.', 36, 'text', null, false),
        message(DEX, ME, 'Swing by the shop tomorrow?', 34, 'text', null, false),
    );

    const view = (msg) => ({
        id: msg.id, from: msg.from, to: msg.to, body: msg.body, kind: msg.kind,
        attachment: msg.attachment, ts: msg.ts, read: msg.read, mine: msg.from === ME,
    });

    const between = (number) => db.messages.filter((msg) => (msg.from === ME && msg.to === number)
        || (msg.from === number && msg.to === ME));

    const nameOf = (number) => {
        const contact = db.contacts.find((entry) => entry.number === number);
        return contact ? contact.name : number;
    };

    const unreadTotal = () => db.messages.filter((msg) => msg.to === ME && !msg.read).length;

    /* ---------------------------------------------------------------------- */
    /* "Server" callbacks                                                      */
    /* ---------------------------------------------------------------------- */

    const REPLIES = ['Sounds good.', 'On it.', 'Give me five minutes.', 'Ha, classic.', 'Call me when you can.'];

    const server = {
        'messages:conversations'() {
            const map = new Map();

            for (const msg of db.messages) {
                const other = msg.from === ME ? msg.to : msg.from;
                const entry = map.get(other) || { number: other, unread: 0, last: null };

                entry.last = { id: msg.id, body: msg.body, kind: msg.kind, ts: msg.ts, mine: msg.from === ME };
                if (msg.to === ME && !msg.read) entry.unread += 1;
                map.set(other, entry);
            }

            const conversations = [...map.values()].sort((a, b) => b.last.id - a.last.id);
            return ok({ conversations, unread: unreadTotal() });
        },

        'messages:thread'(number, beforeId) {
            const all = between(String(number)).filter((msg) => !beforeId || msg.id < beforeId);
            const page = all.slice(-40);
            const result = page.map(view);

            for (const msg of page) if (msg.to === ME) msg.read = true;

            return ok({ messages: result, hasMore: all.length > page.length });
        },

        'messages:send'(number, body, kind, attachment) {
            number = String(number);

            if (!/^\d+$/.test(number)) return fail('invalid_number');
            if (number === ME) return fail('self');
            if (kind === 'text' && !String(body || '').trim()) return fail('empty');

            const msg = message(ME, number, String(body || ''), 0, kind,
                kind === 'location' ? '215.40,-810.25' : attachment);
            db.messages.push(msg);

            // Somebody answers after a moment, so the thread feels alive.
            setTimeout(() => {
                const reply = message(number, ME, REPLIES[Math.floor(Math.random() * REPLIES.length)], 0, 'text', null, false);
                db.messages.push(reply);
                send('message', view(reply));
            }, 2600);

            return ok({ message: view(msg) });
        },

        'messages:read'(number) {
            for (const msg of between(String(number))) if (msg.to === ME) msg.read = true;
            return ok();
        },

        'messages:deleteThread'(number) {
            const gone = new Set(between(String(number)));
            db.messages = db.messages.filter((msg) => !gone.has(msg));
            return ok({ unread: unreadTotal() });
        },

        'messages:delete'(messageId) {
            const before = db.messages.length;
            db.messages = db.messages.filter((msg) => msg.id !== messageId);
            return { ok: db.messages.length < before };
        },

        'contacts:list': () => ok({ contacts: db.contacts }),

        'contacts:add'(data) {
            if (!data || !data.name) return fail('invalid_name');
            if (db.contacts.some((entry) => entry.number === data.number)) return fail('duplicate');

            const contact = { id: id(), name: data.name, number: data.number, avatar: data.avatar || null, favourite: !!data.favourite };
            db.contacts.push(contact);
            return ok({ contact });
        },

        'contacts:update'(contactId, data) {
            const contact = db.contacts.find((entry) => entry.id === contactId);
            if (!contact) return fail('not_found');

            Object.assign(contact, { name: data.name, number: data.number, avatar: data.avatar || null, favourite: !!data.favourite });
            return ok({ contact: Object.assign({}, contact) });
        },

        'contacts:delete'(contactId) {
            db.contacts = db.contacts.filter((entry) => entry.id !== contactId);
            return ok();
        },

        'notes:list': () => ok({ notes: db.notes.map((note) => Object.assign({}, note)) }),

        'notes:save'(data) {
            let note = data.id ? db.notes.find((entry) => entry.id === data.id) : null;

            if (!note) {
                note = { id: id() };
                db.notes.push(note);
            }

            Object.assign(note, { title: data.title, body: data.body, pinned: !!data.pinned, ts: now() });
            return ok({ note: Object.assign({}, note) });
        },

        'notes:delete'(noteId) {
            db.notes = db.notes.filter((entry) => entry.id !== noteId);
            return ok();
        },

        'gallery:list': () => ok({ images: db.gallery.map((image) => Object.assign({}, image)), max: 80 }),

        'gallery:add'(url) {
            const image = { id: id(), url, ts: now() };
            db.gallery.unshift(image);
            return ok({ image });
        },

        'gallery:saveFromMessage'(messageId) {
            const msg = db.messages.find((entry) => entry.id === messageId);
            if (!msg || msg.kind !== 'image') return fail('not_found');
            return server['gallery:add'](msg.attachment);
        },

        'gallery:delete'(imageId) {
            db.gallery = db.gallery.filter((image) => image.id !== imageId);
            return ok();
        },

        'settings:set'(key, value) {
            settings[key] = value;
            return ok({ key, value });
        },

        'settings:reset'() {
            Object.assign(settings, config.defaults, { customWallpaper: '' });
            return ok({ settings: Object.assign({}, settings) });
        },

        'notifications:dismiss': () => ok(),
        'notifications:clear': () => ok(),

        'clock:saveAlarms'(alarms) {
            db.alarms = alarms;
            return ok({ alarms });
        },

        'bank:overview': () => ok({ balance: db.balance, name: db.name, history: db.transactions.slice() }),

        'bank:lookup'(target) {
            const number = String(target).replace(/[\s\-().+]/g, '');
            const contact = db.contacts.find((entry) => entry.number === number);

            if (number === ME) return fail('self');
            if (!contact && !/^\d{10}$/.test(number)) return fail('unknown_recipient');

            return ok({ name: contact ? contact.name : 'Riley Morgan' });
        },

        'bank:transfer'(target, amount, reason) {
            if (amount > db.balance) return fail('insufficient');

            const lookup = server['bank:lookup'](target);
            if (!lookup.ok) return lookup;

            db.balance -= amount;

            const transaction = { id: id(), direction: 'out', name: lookup.name, amount, fee: 0, reason, ts: now() };
            db.transactions.unshift(transaction);

            return ok({ balance: db.balance, transaction });
        },

        'call:history': () => ok({ calls: db.calls.slice() }),

        'call:delete'(callId) {
            db.calls = db.calls.filter((entry) => entry.id !== callId);
            return ok();
        },

        'call:clear'() {
            db.calls = [];
            return ok();
        },
    };

    /* ---------------------------------------------------------------------- */
    /* "Client Lua" callbacks                                                  */
    /* ---------------------------------------------------------------------- */

    let call = null; // { id, number, direction, answeredAt }

    function endCall(status) {
        if (!call) return;

        const duration = call.answeredAt ? Math.floor((Date.now() - call.answeredAt) / 1000) : 0;

        db.calls.unshift({
            id: id(), direction: call.direction, number: call.number, anonymous: false,
            status, duration, ts: now(),
        });

        send('call:ended', { id: call.id, status, reason: 'hangup', duration });
        call = null;
    }

    const client = {
        ready() {
            boot();
            return ok();
        },

        close() {
            send('close');
            opener.hidden = false;
            return ok();
        },

        inputFocus: () => ok(),
        'alarms:active': () => ok(),

        request(data) {
            const handler = server[data.name];
            if (!handler) return fail('invalid');
            return handler(...(data.args || []).slice(0, data.n));
        },

        'call:start'(data) {
            const number = String(data.number);
            if (!db.contacts.some((entry) => entry.number === number) && !/^\d{10}$/.test(number)) {
                return fail('not_in_service');
            }

            call = { id: id(), number, direction: 'out', answeredAt: 0 };
            const mine = call;

            setTimeout(() => {
                if (call !== mine) return;
                call.answeredAt = Date.now();
                send('call:state', { id: call.id, state: 'active' });
            }, 2600);

            return ok({ call: { id: call.id, number, anonymous: false } });
        },

        'call:answer'() {
            if (!call) return fail('no_call');
            call.answeredAt = Date.now();
            send('call:state', { id: call.id, state: 'active' });
            return ok();
        },

        'call:end'() {
            if (call) endCall(call.answeredAt ? 'answered' : call.direction === 'in' ? 'declined' : 'cancelled');
            return ok();
        },

        'camera:open'() {
            viewfinder.active = true;
            viewfinder.selfie = false;
            viewfinder.zoom = 1;
            sendViewfinder();
            return ok();
        },

        waypoint() {
            N.ui.toast('Location marked on your map');
            return ok();
        },

        clipboard(data) {
            if (navigator.clipboard) navigator.clipboard.writeText(data.text).catch(() => {});
            return ok();
        },

        'dialog:confirm': (data) => ok({ confirmed: window.confirm(`${data.title}\n\n${data.message}`) }),
    };

    N.mock = async (name, data) => {
        await wait(40);

        const handler = client[name];
        if (!handler) return fail('invalid');

        try {
            return handler(data || {}) || ok();
        } catch (err) {
            console.error(`[preview] "${name}" failed`, err);
            return fail('internal');
        }
    };

    /* ---------------------------------------------------------------------- */
    /* Viewfinder (keys are handled by Lua in game)                            */
    /* ---------------------------------------------------------------------- */

    const viewfinder = { active: false, selfie: false, zoom: 1 };

    const sendViewfinder = () => send('camera:state', {
        active: viewfinder.active, selfie: viewfinder.selfie, canSave: true, zoom: viewfinder.zoom,
    });

    async function shoot() {
        send('camera:capture', { hide: true });
        await wait(150);
        send('camera:capture', { hide: false, flash: true });
        await wait(500);

        const image = { id: id(), url: PHOTOS[Math.floor(Math.random() * PHOTOS.length)], ts: now() };
        db.gallery.unshift(image);
        send('camera:result', { ok: true, image });
    }

    document.addEventListener('keydown', (event) => {
        if (!viewfinder.active) return;

        if (event.key === 'Enter') {
            shoot();
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            viewfinder.selfie = !viewfinder.selfie;
            sendViewfinder();
        } else if (event.key === 'Backspace' || event.key === 'Escape') {
            viewfinder.active = false;
            sendViewfinder();
        }
    }, true);

    document.addEventListener('wheel', (event) => {
        if (!viewfinder.active) return;
        viewfinder.zoom = Math.max(0.6, Math.min(3.3, viewfinder.zoom + (event.deltaY < 0 ? 0.1 : -0.1)));
        sendViewfinder();
    });

    /* ---------------------------------------------------------------------- */
    /* Preview chrome                                                          */
    /* ---------------------------------------------------------------------- */

    if (params.get('bg') !== 'none') {
        document.body.style.background =
            'radial-gradient(120% 90% at 20% 10%, #33486b 0%, #1a2233 46%, #0a0d14 100%)';
    }

    const openPhone = (app) => {
        opener.hidden = true;
        send('open', {
            apps: config.apps.map((entry) => entry.id),
            status: { battery: 82, charging: false, signal: 4 },
            app: app || null,
        });
    };

    const opener = document.createElement('button');
    opener.textContent = 'Open phone (M)';
    opener.hidden = true;
    opener.style.cssText = 'position:fixed;left:24px;bottom:24px;padding:12px 18px;border-radius:14px;'
        + 'background:#3d8bff;color:#fff;font:600 14px system-ui;z-index:99';
    opener.addEventListener('click', () => openPhone());
    document.body.append(opener);

    document.addEventListener('keydown', (event) => {
        if (event.key.toLowerCase() !== 'm' || N.state.visible || viewfinder.active) return;
        openPhone();
    });

    /* ---------------------------------------------------------------------- */
    /* Boot + scenes                                                           */
    /* ---------------------------------------------------------------------- */

    const click = (selector) => {
        const node = document.querySelector(selector);
        if (node) node.click();
    };

    const rowWithText = (text) => [...document.querySelectorAll('.app.active .row, .app.active .tab')]
        .find((node) => node.textContent.includes(text));

    const SCENES = {
        lock: () => {},
        home: () => N.unlock(),

        thread: () => N.openApp('messages', { number: MAYA }),
        contact: () => N.openApp('contacts', { id: 1 }),
        send: () => N.openApp('bank', { to: MAYA }),

        async center() {
            N.unlock();
            await wait(250);
            click('#sb-island');
        },

        async banner() {
            N.unlock();
            await wait(400);
            const msg = message(MAYA, ME, 'Running five minutes late, order for me?', 0, 'text', null, false);
            db.messages.push(msg);
            send('message', view(msg));
        },

        async closed() {
            send('close');
            await wait(600);
            const msg = message(MAYA, ME, 'Running five minutes late, order for me?', 0, 'text', null, false);
            db.messages.push(msg);
            send('message', view(msg));
        },

        call() {
            call = { id: id(), number: MAYA, direction: 'in', answeredAt: 0 };
            send('call:incoming', { id: call.id, number: MAYA, anonymous: false });
        },

        async incall() {
            SCENES.call();
            await wait(300);
            client['call:answer']();
        },

        async appearance() {
            N.openApp('settings');
            await wait(450);
            const row = rowWithText('Appearance');
            if (row) row.click();
        },

        async alarms() {
            N.openApp('clock');
            await wait(450);
            const tab = rowWithText('Alarms');
            if (tab) tab.click();
        },

        async timer() {
            N.openApp('clock');
            await wait(450);
            const tab = rowWithText('Timer');
            if (tab) tab.click();
        },

        async note() {
            N.openApp('notes');
            await wait(500);
            click('.app.active .note-item');
        },

        async viewfinder() {
            N.openApp('camera');
        },

        // The camera app's own page (opening the app normally starts the viewfinder).
        async camerapage() {
            N.openApp('camera');
            await wait(400);
            viewfinder.active = false;
            sendViewfinder();
        },
    };

    async function runScene() {
        if (SCENES[scene]) await SCENES[scene]();
        else if (config.apps.some((entry) => entry.id === scene)) N.openApp(scene);
    }

    async function boot() {
        send('init', config);

        send('bootstrap', {
            ok: true,
            framework: 'qb',
            number: ME,
            name: db.name,
            identifier: 'PREVIEW01',
            settings: Object.assign({}, settings),
            battery: 82,
            contacts: db.contacts.map((contact) => Object.assign({}, contact)),
            notifications: db.notifications.slice(),
            unread: unreadTotal(),
            alarms: db.alarms.slice(),
            apps: config.apps.map((entry) => entry.id),
            hasPhone: true,
            serverTime: now(),
        });

        // bootstrap is handled asynchronously (the app scripts load first).
        while (!N.state.ready) await wait(30);

        openPhone();
        await wait(60);
        await runScene();
    }
})();
