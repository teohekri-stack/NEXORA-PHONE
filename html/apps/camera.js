/* ==========================================================================
   Nexora Phone - Camera
   Opening the app starts the viewfinder (client/camera.lua): the phone
   steps aside and the game camera is driven with the mouse. This page is
   what the player returns to afterwards.
   ========================================================================== */
(() => {
    'use strict';

    const { h, fill, icon, ui, state } = Nexora;

    let body = null;
    let statusTimer = null;

    const statusEl = () => Nexora.$('#vf-status');

    /** Short message inside the viewfinder (the phone itself is hidden there). */
    function viewfinderStatus(text) {
        const node = statusEl();
        if (!node) return;

        node.textContent = text;

        clearTimeout(statusTimer);
        statusTimer = setTimeout(() => { node.textContent = ''; }, 2600);
    }

    async function launch() {
        const result = await Nexora.post('camera:open');
        if (!result.ok) ui.error(result.error);
    }

    function hint(keys, label) {
        return h('div', { class: 'camera-hint' },
            h('span', { class: 'camera-keys' }, keys.map((key) => h('kbd', null, key))),
            h('span', null, label));
    }

    function render() {
        if (!body) return;

        const images = Nexora.gallery.images || [];
        const latest = images[0];
        const available = Nexora.config.camera.available;

        let preview = null;

        if (latest) {
            const img = h('img', { src: latest.url, alt: '', draggable: false });
            img.referrerPolicy = 'no-referrer';

            preview = h('button', {
                class: 'camera-last',
                type: 'button',
                onclick: () => Nexora.openApp('gallery'),
            }, img, h('span', { class: 'camera-last-text' },
                h('b', null, 'Latest photo'),
                h('span', null, 'Open gallery')), icon('chevron-right', 18));
        }

        fill(body,
            h('button', { class: 'camera-launch', type: 'button', onclick: launch },
                h('span', { class: 'camera-lens' }, icon('camera', 38)),
                h('span', { class: 'camera-launch-title' }, 'Open viewfinder'),
                h('span', { class: 'camera-launch-text' }, 'Frame the shot with your mouse')),
            available ? null : h('div', { class: 'notice' },
                icon('info', 18),
                h('span', null, 'Photos can not be saved on this server right now (screenshot-basic is not running).')),
            preview,
            h('div', { class: 'section' },
                h('div', { class: 'section-title' }, 'Controls'),
                h('div', { class: 'card camera-hints' },
                    hint(['Mouse'], 'Look around'),
                    hint(['Scroll'], 'Zoom in and out'),
                    hint(['↑', '↓'], 'Switch between rear and selfie'),
                    hint(['Click', 'Enter'], 'Take a photo'),
                    hint(['Backspace'], 'Back to the phone'))));
    }

    Nexora.registerApp({
        id: 'camera',
        icon: 'camera',
        colors: ['#64748b', '#1e293b'],

        mount(root) {
            body = h('div');
            root.append(ui.view({ title: 'Camera', body }));

            Nexora.gallery.load(false).then(render);
            render();
        },

        // Tapping the icon goes straight into the viewfinder, like a real phone.
        open() {
            render();
            if (!state.camera) launch();
        },
    });

    Nexora.on('camera:result', (result) => {
        if (result.ok && result.image) {
            Nexora.gallery.add(result.image);
            viewfinderStatus('Saved to your gallery');
        } else {
            viewfinderStatus(Nexora.errorText(result.error || 'photo_failed'));
            Nexora.sound.play('error');
        }
    });

    Nexora.on('gallery', render);
    Nexora.on('bootstrap', () => {
        if (body) Nexora.gallery.load(false).then(render);
    });
})();
