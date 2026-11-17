/* ==========================================================================
   Nexora Phone - Settings
   Every change goes through Nexora.setSetting(), which applies it at once
   and lets the server validate + store it (and rolls back on refusal).
   ========================================================================== */
(() => {
    'use strict';

    const { h, fill, icon, ui, format, state, sound } = Nexora;

    const FRAMEWORKS = { qb: 'QBCore', qbx: 'Qbox', esx: 'ESX', ox: 'ox_core' };

    let nav = null;
    let redraw = null; // render function of the page on screen

    /* -- building blocks ----------------------------------------------------- */

    function toggleRow(key, title, iconName, subtitle) {
        const on = state.settings[key] === true;

        return ui.row({
            lead: ui.tile(iconName, on),
            title,
            subtitle,
            trail: ui.toggle(on, (value, node) => {
                Nexora.setSetting(key, value).then((saved) => {
                    if (!saved) node.set(!value);
                });
            }),
        });
    }

    function navRow(title, iconName, detail, onClick) {
        return ui.row({ lead: ui.tile(iconName), title, trail: detail, chevron: true, onClick });
    }

    /** Range input that saves when the handle is released. */
    function sliderRow(key, min, max, step, label) {
        const value = h('span', { class: 'slider-value' });

        const input = h('input', { class: 'slider', type: 'range', min, max, step });
        input.value = state.settings[key] == null ? min : state.settings[key];

        const show = () => { value.textContent = label(Number(input.value)); };

        input.addEventListener('input', show);
        input.addEventListener('change', () => Nexora.setSetting(key, Number(input.value)));

        show();

        return h('div', { class: 'slider-row' }, input, value);
    }

    /** A page of settings. `draw` returns the content and reruns on changes. */
    function openPage(title, draw) {
        const body = h('div');
        const render = () => fill(body, draw());

        const view = ui.view({ title, back: () => nav.pop(), body });
        const previous = redraw;

        view.cleanup = () => {
            sound.stopPreview();
            redraw = previous;
        };

        redraw = render;
        render();
        nav.push(view);
    }

    const labelOf = (list, id) => {
        const entry = (list || []).find((item) => item.id === id);
        return entry ? entry.label : '';
    };

    /* -- pages --------------------------------------------------------------- */

    function appearancePage() {
        const config = Nexora.config;
        const settings = state.settings;

        const theme = (id, label) => h('button', {
            class: `theme-card ${id}${settings.theme === id ? ' selected' : ''}`,
            type: 'button',
            onclick: () => Nexora.setSetting('theme', id),
        }, h('span', { class: 'theme-preview' }, h('i'), h('i'), h('i')), h('span', null, label));

        const wallpapers = config.wallpapers.map((entry) => h('button', {
            class: `wall-item${settings.wallpaper === entry.id ? ' selected' : ''}`,
            type: 'button',
            title: entry.label,
            style: { background: Nexora.wallpaperOf(entry) },
            onclick: () => Nexora.setSetting('wallpaper', entry.id),
        }));

        if (config.allowCustomWallpaper) {
            const custom = settings.customWallpaper;

            wallpapers.push(h('button', {
                class: `wall-item custom${settings.wallpaper === 'custom' ? ' selected' : ''}`,
                type: 'button',
                title: 'From your gallery',
                style: custom ? { background: Nexora.imageCss(custom) } : null,
                onclick: async () => {
                    const url = await ui.pickImage('Wallpaper');
                    if (!url) return;

                    // Store the link first; the wallpaper can only point at a stored one.
                    if (await Nexora.setSetting('customWallpaper', url)) {
                        Nexora.setSetting('wallpaper', 'custom');
                    }
                },
            }, h('span', { class: 'wall-custom' }, icon('image', 20), h('span', null, 'Gallery'))));
        }

        return [
            h('div', { class: 'section' },
                h('div', { class: 'section-title' }, 'Theme'),
                h('div', { class: 'theme-row' }, theme('dark', 'Dark'), theme('light', 'Light'))),

            h('div', { class: 'section' },
                h('div', { class: 'section-title' }, 'Accent colour'),
                h('div', { class: 'card accent-row' }, config.accents.map((entry) => h('button', {
                    class: `accent-dot${settings.accent === entry.id ? ' selected' : ''}`,
                    type: 'button',
                    title: entry.label,
                    style: { '--dot': entry.color },
                    onclick: () => Nexora.setSetting('accent', entry.id),
                })))),

            h('div', { class: 'section' },
                h('div', { class: 'section-title' }, 'Wallpaper'),
                h('div', { class: 'wall-grid' }, wallpapers)),

            h('div', { class: 'section' },
                h('div', { class: 'section-title' }, 'Phone body'),
                h('div', { class: 'frame-grid' }, config.frames.map((entry) => h('button', {
                    class: `frame-item${settings.frame === entry.id ? ' selected' : ''}`,
                    type: 'button',
                    onclick: () => Nexora.setSetting('frame', entry.id),
                }, h('span', {
                    class: 'frame-swatch',
                    style: { background: entry.color, borderColor: entry.edge },
                }), h('span', null, entry.label))))),

            ui.section('Display',
                h('div', { class: 'row' },
                    h('span', { class: 'row-lead' }, ui.tile('text')),
                    h('span', { class: 'row-main' },
                        h('span', { class: 'row-title' }, 'Phone size'),
                        sliderRow('scale', 70, 130, 5, (value) => `${value}%`))),
                toggleRow('use24h', '24-hour time', 'clock')),
        ];
    }

    function soundsPage() {
        const config = Nexora.config;
        const settings = state.settings;

        const toneRow = (kind, key, entry) => ui.row({
            lead: ui.tile(kind === 'ringtones' ? 'music' : 'bell', settings[key] === entry.id),
            title: entry.label,
            trail: settings[key] === entry.id ? icon('check', 18) : null,
            onClick: () => {
                Nexora.setSetting(key, entry.id);
                sound.preview(kind, entry.id);
            },
        });

        return [
            ui.section('Volume',
                h('div', { class: 'row' },
                    h('span', { class: 'row-lead' }, ui.tile('volume')),
                    h('span', { class: 'row-main' },
                        sliderRow('volume', 0, 100, 5, (value) => (value === 0 ? 'Muted' : `${value}%`)))),
                toggleRow('vibrate', 'Shake on incoming call', 'device')),
            ui.section('Ringtone', config.sounds.ringtones.map((entry) => toneRow('ringtones', 'ringtone', entry))),
            ui.section('Notification sound',
                config.sounds.notifications.map((entry) => toneRow('notifications', 'notificationSound', entry))),
        ];
    }

    function notificationsPage() {
        return [
            ui.section(null,
                toggleRow('notifications', 'Show banners', 'bell', 'Pop up when something arrives'),
                toggleRow('notificationPreview', 'Show previews', 'eye', 'Message text in banners and on the lock screen')),
            ui.section(null,
                toggleRow('doNotDisturb', 'Do not disturb', 'moon', 'No sounds, banners or incoming calls')),
        ];
    }

    function privacyPage() {
        return [
            ui.section(null,
                Nexora.config.calls.allowAnonymous
                    ? toggleRow('hideCallerId', 'Hide my number', 'eye', 'People you call see "Unknown caller"')
                    : null,
                toggleRow('lockScreen', 'Lock screen', 'lock', 'Show the lock screen when the phone opens')),
            ui.section(null,
                toggleRow('airplane', 'Airplane mode', 'airplane', 'No calls or messages in or out')),
        ];
    }

    function aboutPage() {
        const config = Nexora.config;
        const info = (title, value) => ui.row({ title, trail: value });

        return [
            h('div', { class: 'about-hero' },
                h('span', { class: 'about-logo' }, icon('device', 34)),
                h('div', { class: 'about-name' }, config.brand.device),
                h('div', { class: 'about-version' }, `${config.brand.name} OS ${Nexora.version}`)),
            ui.section(null,
                info('Owner', state.name || '-'),
                info('Phone number', format.number(state.number)),
                info('Carrier', config.brand.carrier),
                info('Framework', FRAMEWORKS[config.framework] || '-')),
        ];
    }

    /* -- root ---------------------------------------------------------------- */

    async function reset() {
        const confirmed = await ui.confirm({
            title: 'Reset settings?',
            message: 'Wallpaper, sounds and all other preferences go back to their defaults. Your data is kept.',
            confirmText: 'Reset',
            danger: true,
        });

        if (!confirmed) return;

        const result = await Nexora.request('settings:reset');

        if (!result.ok) {
            ui.error(result.error);
            return;
        }

        state.settings = Object.assign({}, Nexora.config.defaults, result.settings || {});
        Nexora.applySettings();
        Nexora.emit('settings', {});
        ui.toast('Settings reset');
    }

    function rootContent() {
        const config = Nexora.config;
        const settings = state.settings;
        const me = { name: state.name, number: state.number };

        const wallpaper = settings.wallpaper === 'custom' ? 'Gallery' : labelOf(config.wallpapers, settings.wallpaper);

        return [
            h('div', { class: 'me-card' },
                ui.avatar(me, 54),
                h('div', { class: 'me-main' },
                    h('div', { class: 'me-name' }, state.name || 'My phone'),
                    h('div', { class: 'me-number' }, format.number(state.number))),
                h('button', {
                    class: 'icon-btn',
                    type: 'button',
                    title: 'Copy my number',
                    onclick: () => Nexora.post('clipboard', { text: state.number })
                        .then((result) => ui.toast(result.ok ? 'Number copied' : 'Could not copy')),
                }, icon('copy', 20))),

            ui.section(null,
                toggleRow('airplane', 'Airplane mode', 'airplane'),
                toggleRow('doNotDisturb', 'Do not disturb', 'moon')),

            ui.section(null,
                navRow('Appearance', 'palette', wallpaper, () => openPage('Appearance', appearancePage)),
                navRow('Sounds', 'volume', labelOf(config.sounds.ringtones, settings.ringtone),
                    () => openPage('Sounds', soundsPage)),
                navRow('Notifications', 'bell', settings.notifications === false ? 'Off' : 'On',
                    () => openPage('Notifications', notificationsPage)),
                navRow('Privacy', 'shield', null, () => openPage('Privacy', privacyPage))),

            ui.section(null,
                navRow('About this phone', 'info', config.brand.device, () => openPage('About', aboutPage)),
                ui.row({ lead: ui.tile('refresh'), title: 'Reset settings', danger: true, onClick: reset })),
        ];
    }

    let rootBody = null;
    const renderRoot = () => { if (rootBody) fill(rootBody, rootContent()); };

    Nexora.registerApp({
        id: 'settings',
        icon: 'settings',
        colors: ['#94a3b8', '#475569'],

        mount(root) {
            nav = ui.stack(root);
            rootBody = h('div');
            nav.reset(ui.view({ title: 'Settings', body: rootBody }));
            renderRoot();
        },

        open() {
            renderRoot();
            if (redraw) redraw();
        },

        close() {
            sound.stopPreview();
        },

        back() {
            return nav.pop();
        },
    });

    // Keep the pages in sync with changes made here or in the notification centre.
    Nexora.on('settings', () => {
        renderRoot();
        if (redraw) redraw();
    });

    Nexora.on('bootstrap', () => {
        if (nav) nav.popToRoot();
        redraw = null;
        renderRoot();
    });
})();
