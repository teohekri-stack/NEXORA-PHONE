/* ==========================================================================
   Nexora Phone - Contacts
   The address book is delivered with the bootstrap data and kept in
   Nexora.contacts, so this app only renders it and sends changes to the
   server (which validates and stores them).
   ========================================================================== */
(() => {
    'use strict';

    const { h, fill, icon, ui, format } = Nexora;

    let nav = null;
    let listBody = null;
    let query = '';
    let detail = null; // { id, view } of the contact page on the stack

    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

    function matches(contact) {
        if (!query) return true;

        const text = query.toLowerCase();
        const digits = format.clean(query);

        if (contact.name.toLowerCase().includes(text)) return true;
        return digits !== '' && /^\d+$/.test(digits) && String(contact.number).includes(digits);
    }

    function copy(text) {
        Nexora.post('clipboard', { text: String(text) })
            .then((result) => ui.toast(result.ok ? 'Number copied' : 'Could not copy'));
    }

    /* -- list ---------------------------------------------------------------- */

    function contactRow(contact) {
        return ui.row({
            lead: ui.avatar(contact, 40),
            title: contact.name,
            subtitle: format.number(contact.number),
            trail: contact.favourite ? icon('star', 15) : null,
            onClick: () => openDetail(contact.id),
        });
    }

    function meCard() {
        const me = { name: Nexora.state.name, number: Nexora.state.number };

        return h('div', { class: 'me-card' },
            ui.avatar(me, 50),
            h('div', { class: 'me-main' },
                h('div', { class: 'me-name' }, me.name || 'My card'),
                h('div', { class: 'me-number' }, format.number(me.number))),
            h('button', { class: 'icon-btn', type: 'button', title: 'Copy my number', onclick: () => copy(me.number) },
                icon('copy', 20)));
    }

    function renderList() {
        if (!listBody) return;

        const contacts = [...Nexora.contacts.all()].sort(byName).filter(matches);
        const nodes = [];

        if (!query) nodes.push(meCard());

        if (!contacts.length) {
            nodes.push(query
                ? ui.empty('search', 'No results', `Nothing matches "${query}".`)
                : ui.empty('user', 'No contacts yet', 'Tap + to add your first contact.'));
        } else {
            const favourites = contacts.filter((contact) => contact.favourite);
            if (favourites.length && !query) {
                nodes.push(ui.section('Favourites', favourites.map(contactRow)));
            }

            const groups = new Map();
            for (const contact of contacts) {
                const first = ([...contact.name.trim()][0] || '#').toUpperCase();
                const letter = /^[A-Z]$/.test(first) ? first : '#';
                if (!groups.has(letter)) groups.set(letter, []);
                groups.get(letter).push(contact);
            }

            for (const [letter, items] of groups) {
                nodes.push(ui.section(letter, items.map(contactRow)));
            }
        }

        fill(listBody, nodes);
    }

    /* -- contact page -------------------------------------------------------- */

    function heroAction(iconName, label, onClick, active) {
        return h('button', { class: `hero-action${active ? ' on' : ''}`, type: 'button', onclick: onClick },
            h('span', { class: 'hero-action-icon' }, icon(iconName, 22)),
            h('span', null, label));
    }

    async function toggleFavourite(contact) {
        const result = await Nexora.request('contacts:update', contact.id, {
            name: contact.name,
            number: contact.number,
            avatar: contact.avatar || null,
            favourite: !contact.favourite,
        });

        if (!result.ok) {
            ui.error(result.error);
            return;
        }

        Nexora.contacts.upsert(result.contact);
    }

    async function remove(contact) {
        const confirmed = await ui.confirm({
            title: 'Delete contact?',
            message: `${contact.name} will be removed from your contacts.`,
            confirmText: 'Delete',
            danger: true,
        });

        if (!confirmed) return;

        const result = await Nexora.request('contacts:delete', contact.id);

        if (!result.ok) {
            ui.error(result.error);
            return;
        }

        detail = null;
        nav.popToRoot();
        Nexora.contacts.remove(contact.id);
        ui.toast('Contact deleted');
    }

    function renderDetail() {
        if (!detail) return;

        const contact = Nexora.contacts.all().find((entry) => entry.id === detail.id);
        if (!contact) return;

        fill(detail.view.bodyEl,
            h('div', { class: 'hero' },
                ui.avatar(contact, 96),
                h('div', { class: 'hero-name' }, contact.name),
                h('div', { class: 'hero-sub' }, format.number(contact.number))),
            h('div', { class: 'hero-actions' },
                heroAction('phone', 'Call', () => Nexora.openApp('phone', { call: contact.number })),
                heroAction('chat', 'Message', () => Nexora.openApp('messages', { number: contact.number })),
                heroAction('star', 'Favourite', () => toggleFavourite(contact), contact.favourite)),
            ui.section(null,
                ui.row({ lead: ui.tile('copy'), title: 'Copy number', onClick: () => copy(contact.number) }),
                ui.row({ lead: ui.tile('edit'), title: 'Edit contact', onClick: () => openForm(contact) }),
                ui.row({ lead: ui.tile('trash'), title: 'Delete contact', danger: true, onClick: () => remove(contact) })));
    }

    function openDetail(id) {
        if (!Nexora.contacts.all().some((entry) => entry.id === id)) return;

        const view = ui.view({
            title: 'Contact',
            back: () => nav.pop(),
        });

        view.cleanup = () => {
            if (detail && detail.view === view) detail = null;
        };

        detail = { id, view };
        renderDetail();
        nav.push(view);
    }

    /* -- add / edit form ----------------------------------------------------- */

    function openForm(contact, presetNumber) {
        const editing = !!contact;
        const limits = Nexora.config.contacts;
        let avatar = editing ? contact.avatar || '' : '';

        const name = h('input', {
            class: 'input',
            placeholder: 'Name',
            maxLength: limits.maxName,
            autocomplete: 'off',
            spellcheck: false,
        });
        name.value = editing ? contact.name : '';

        const number = h('input', {
            class: 'input',
            placeholder: 'Phone number',
            maxLength: 20,
            autocomplete: 'off',
        });
        number.inputMode = 'tel';
        number.value = editing ? format.number(contact.number) : presetNumber ? format.number(presetNumber) : '';

        const preview = h('button', { class: 'form-avatar', type: 'button', title: 'Change photo' });

        const drawPreview = () => fill(preview,
            ui.avatar({ name: name.value.trim(), number: format.clean(number.value), avatar }, 92),
            h('span', { class: 'form-avatar-edit' }, icon('camera', 15)));

        preview.addEventListener('click', async () => {
            const choice = await ui.sheet({
                title: 'Contact photo',
                actions: [
                    { label: 'Choose from gallery', icon: 'image', value: 'pick' },
                    avatar ? { label: 'Remove photo', icon: 'trash', value: 'remove', danger: true } : null,
                ],
            });

            if (choice === 'pick') {
                const url = await ui.pickImage('Contact photo');
                if (url) avatar = url;
            } else if (choice === 'remove') {
                avatar = '';
            }

            drawPreview();
        });

        name.addEventListener('input', drawPreview);

        const save = ui.button(editing ? 'Save' : 'Add contact', { block: true });

        const submit = async () => {
            const data = {
                name: name.value.trim(),
                number: format.clean(number.value),
                avatar: avatar || null,
                favourite: editing ? contact.favourite === true : false,
            };

            if (!data.name) {
                ui.error('invalid_name');
                return;
            }

            if (!format.isNumber(data.number)) {
                ui.error('invalid_number');
                return;
            }

            save.disabled = true;

            const result = editing
                ? await Nexora.request('contacts:update', contact.id, data)
                : await Nexora.request('contacts:add', data);

            save.disabled = false;

            if (!result.ok) {
                ui.error(result.error);
                return;
            }

            Nexora.contacts.upsert(result.contact);
            nav.pop();
            ui.toast(editing ? 'Contact updated' : 'Contact added');
        };

        save.addEventListener('click', submit);

        drawPreview();

        nav.push(ui.view({
            title: editing ? 'Edit contact' : 'New contact',
            back: () => nav.pop(),
            body: h('form', { onsubmit: (event) => { event.preventDefault(); submit(); } },
                h('div', { class: 'form-top' }, preview),
                h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Name'), name),
                h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Phone number'), number),
                h('button', { type: 'submit', hidden: true })),
            footer: save,
        }));

        if (!editing) setTimeout(() => name.focus(), 340);
    }

    /* -- app ----------------------------------------------------------------- */

    Nexora.registerApp({
        id: 'contacts',
        icon: 'user',
        colors: ['#8a94ff', '#4f56d8'],

        mount(root) {
            nav = ui.stack(root);
            listBody = h('div');

            const search = ui.search('Search contacts', (value) => {
                query = value;
                renderList();
            });

            nav.reset(ui.view({
                title: 'Contacts',
                actions: [{ icon: 'plus', label: 'Add contact', accent: true, onClick: () => openForm(null) }],
                body: [search, listBody],
            }));

            renderList();
        },

        /** params: { add: number } opens the form, { id } opens a contact. */
        open(params) {
            if (params.add) {
                nav.popToRoot();
                openForm(null, params.add);
            } else if (params.id) {
                nav.popToRoot();
                openDetail(params.id);
            } else {
                renderList();
            }
        },

        back() {
            return nav.pop();
        },
    });

    Nexora.on('contacts', () => {
        renderList();
        renderDetail();
    });

    Nexora.on('bootstrap', () => {
        if (nav) nav.popToRoot();
        detail = null;
        query = '';
        renderList();
    });
})();
