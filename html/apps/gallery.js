/* ==========================================================================
   Nexora Phone - Gallery
   Photos taken with the camera (or imported by link when the server allows
   it). Only the hosted link is stored; the server checks its host.
   ========================================================================== */
(() => {
    'use strict';

    const { h, fill, ui, format, state } = Nexora;

    let nav = null;
    let body = null;
    let view = null;

    function hostAllowed(url) {
        let host;

        try {
            const parsed = new URL(url);
            if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return false;
            host = parsed.hostname.toLowerCase();
        } catch (err) {
            return false;
        }

        return (Nexora.config.gallery.allowedHosts || []).some((allowed) => {
            const name = String(allowed).toLowerCase();
            return host === name || host.endsWith(`.${name}`);
        });
    }

    async function useAsWallpaper(image, entry) {
        // The link has to be stored before the wallpaper can point at it.
        const stored = await Nexora.setSetting('customWallpaper', image.url);
        if (!stored) return;

        if (await Nexora.setSetting('wallpaper', 'custom')) {
            entry.close();
            ui.toast('Wallpaper updated');
        }
    }

    async function remove(image, entry) {
        const confirmed = await ui.confirm({
            title: 'Delete photo?',
            message: 'It will be removed from your gallery.',
            confirmText: 'Delete',
            danger: true,
        });

        if (!confirmed) return;

        const result = await Nexora.request('gallery:delete', image.id);

        if (!result.ok) {
            ui.error(result.error || 'not_found');
            return;
        }

        // A wallpaper that points at a deleted photo falls back to the default.
        if (state.settings.wallpaper === 'custom' && state.settings.customWallpaper === image.url) {
            Nexora.setSetting('wallpaper', Nexora.config.defaults.wallpaper);
        }

        Nexora.gallery.remove(image.id);
        entry.close();
        ui.toast('Photo deleted');
    }

    function openImage(image) {
        ui.viewImage(image.url, {
            caption: `${format.day(image.ts)}, ${format.time(image.ts)}`,
            actions: [
                Nexora.config.allowCustomWallpaper
                    ? { icon: 'device', label: 'Wallpaper', onClick: (entry) => useAsWallpaper(image, entry) }
                    : null,
                Nexora.config.messages.allowImages && state.allowed.includes('messages')
                    ? {
                        icon: 'chat',
                        label: 'Send',
                        onClick: (entry) => {
                            entry.close();
                            Nexora.openApp('messages', { share: image.url });
                        },
                    }
                    : null,
                {
                    icon: 'link',
                    label: 'Copy link',
                    onClick: () => Nexora.post('clipboard', { text: image.url })
                        .then((result) => ui.toast(result.ok ? 'Link copied' : 'Could not copy')),
                },
                { icon: 'trash', label: 'Delete', danger: true, onClick: (entry) => remove(image, entry) },
            ],
        });
    }

    async function importLink() {
        const values = await ui.prompt({
            title: 'Add photo by link',
            message: 'Paste a direct https link to a picture.',
            confirmText: 'Add',
            fields: [{ name: 'url', placeholder: 'https://...', maxLength: 255 }],
            validate: (input) => (hostAllowed(input.url) ? null : 'Links from this website are not allowed.'),
        });

        if (!values) return;

        const result = await Nexora.request('gallery:add', values.url, 'link');

        if (!result.ok) {
            ui.error(result.error);
            return;
        }

        Nexora.gallery.add(result.image);
        ui.toast('Photo added');
    }

    function render(images) {
        if (!body) return;

        if (!images) {
            fill(body, ui.spinner());
            return;
        }

        const max = Nexora.config.gallery.maxImages;

        view.headerEl.querySelector('.view-subtitle').textContent =
            images.length ? `${images.length} of ${max} photos` : '';

        if (!images.length) {
            fill(body, ui.empty('image', 'No photos yet', 'Pictures you take with the camera are kept here.'));
            return;
        }

        fill(body, h('div', { class: 'gallery-grid' }, images.map((image) => {
            const img = h('img', { src: image.url, alt: '', loading: 'lazy', draggable: false });
            img.referrerPolicy = 'no-referrer';

            return h('button', { class: 'gallery-item', type: 'button', onclick: () => openImage(image) }, img);
        })));
    }

    const refresh = (force) => Nexora.gallery.load(force).then(render);

    Nexora.registerApp({
        id: 'gallery',
        icon: 'image',
        colors: ['#f472b6', '#c026d3'],

        mount(root) {
            nav = ui.stack(root);
            body = h('div');

            view = ui.view({
                title: 'Gallery',
                subtitle: ' ',
                actions: [
                    Nexora.config.gallery.allowUrlImport
                        ? { icon: 'link', label: 'Add by link', onClick: importLink }
                        : null,
                    state.allowed.includes('camera')
                        ? { icon: 'camera', label: 'Camera', accent: true, onClick: () => Nexora.openApp('camera') }
                        : null,
                ],
                body,
            });

            nav.reset(view);
            render(Nexora.gallery.images);
        },

        open() {
            refresh(false);
        },

        back() {
            return nav.pop();
        },
    });

    Nexora.on('gallery', () => render(Nexora.gallery.images));
    Nexora.on('bootstrap', () => render(null));
})();
