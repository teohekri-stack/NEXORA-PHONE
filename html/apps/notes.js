/* ==========================================================================
   Nexora Phone - Notes
   Notes are stored in the database per character. The editor saves by
   itself a moment after typing stops and again when it is left.
   ========================================================================== */
(() => {
    'use strict';

    const { h, fill, icon, ui, format } = Nexora;

    let nav = null;
    let listBody = null;
    let notes = null;   // null until loaded
    let query = '';
    let editor = null;  // { flush } of the open editor
    let epoch = 0;      // bumps when the character changes: old editors must not save any more

    const sortNotes = () => notes.sort((a, b) => (b.pinned === true) - (a.pinned === true) || b.ts - a.ts);

    function upsert(note) {
        if (!notes) notes = [];

        const index = notes.findIndex((item) => item.id === note.id);
        if (index >= 0) notes[index] = note;
        else notes.push(note);

        sortNotes();
        renderList();
    }

    /** Title and preview line of a note (falls back to its first line). */
    function summary(note) {
        const lines = note.body.split('\n').map((line) => line.trim()).filter(Boolean);
        const title = note.title || lines[0] || 'Untitled';
        const rest = note.title ? lines : lines.slice(1);

        return { title, text: rest.join(' ') };
    }

    function noteItem(note) {
        const { title, text } = summary(note);

        return h('button', { class: 'note-item', type: 'button', onclick: () => openEditor(note) },
            h('div', { class: 'note-item-head' },
                h('span', { class: 'note-item-title' }, title),
                note.pinned ? icon('pin', 15) : null),
            text ? h('div', { class: 'note-item-text' }, text) : null,
            h('div', { class: 'note-item-date' }, format.relative(note.ts)));
    }

    function renderList() {
        if (!listBody) return;

        if (!notes) {
            fill(listBody, ui.spinner());
            return;
        }

        const text = query.toLowerCase();
        const items = notes.filter((note) => !text
            || note.title.toLowerCase().includes(text)
            || note.body.toLowerCase().includes(text));

        if (!items.length) {
            fill(listBody, text
                ? ui.empty('search', 'No results', `Nothing matches "${query}".`)
                : ui.empty('note', 'No notes yet', 'Tap + to write your first note.'));
            return;
        }

        fill(listBody, h('div', { class: 'note-list' }, items.map(noteItem)));
    }

    async function load() {
        const result = await Nexora.request('notes:list');

        if (result.ok) {
            notes = Nexora.list(result.notes);
            sortNotes();
        } else {
            if (!notes) notes = [];
            ui.error(result.error);
        }

        renderList();
    }

    /* -- editor -------------------------------------------------------------- */

    function openEditor(note) {
        const limits = Nexora.config.notes;

        if (!note && notes && notes.length >= limits.maxNotes) {
            ui.error('limit');
            return;
        }

        const draft = note
            ? { id: note.id, title: note.title, body: note.body, pinned: note.pinned === true }
            : { id: null, title: '', body: '', pinned: false };

        const snapshot = () => JSON.stringify([draft.title, draft.body.trim(), draft.pinned]);

        let saved = snapshot();
        let saving = null;
        let timer = null;
        let deleted = false;
        const born = epoch;

        const title = h('input', {
            class: 'note-title-input',
            placeholder: 'Title',
            maxLength: limits.maxTitle,
            autocomplete: 'off',
            spellcheck: false,
        });
        title.value = draft.title;

        const body = h('textarea', {
            class: 'note-body-input',
            placeholder: 'Start writing...',
            maxLength: limits.maxBody,
            spellcheck: false,
        });
        body.value = draft.body;

        const status = h('span', { class: 'note-status' });

        async function save() {
            clearTimeout(timer);
            if (deleted || born !== epoch) return;

            draft.title = title.value.trim();
            draft.body = body.value;

            if (snapshot() === saved) return;
            if (!draft.title && !draft.body.trim()) return; // nothing worth storing yet

            if (saving) {
                await saving;
                await save();
                return;
            }

            const pending = snapshot();
            status.textContent = 'Saving...';

            saving = Nexora.request('notes:save', {
                id: draft.id,
                title: draft.title,
                body: draft.body,
                pinned: draft.pinned,
            });

            const result = await saving;
            saving = null;

            if (!result.ok) {
                status.textContent = '';
                ui.error(result.error);
                return;
            }

            saved = pending;
            draft.id = result.note.id;
            status.textContent = 'Saved';
            upsert(result.note);
        }

        const schedule = () => {
            status.textContent = '';
            clearTimeout(timer);
            timer = setTimeout(save, 900);
        };

        title.addEventListener('input', schedule);
        body.addEventListener('input', schedule);

        const pinButton = h('button', { class: 'icon-btn', type: 'button', title: 'Pin' }, icon('pin'));
        const showPin = () => pinButton.classList.toggle('accent', draft.pinned);

        pinButton.addEventListener('click', () => {
            draft.pinned = !draft.pinned;
            showPin();
            ui.toast(draft.pinned ? 'Pinned to the top' : 'Unpinned');
            save();
        });

        const remove = async () => {
            const confirmed = await ui.confirm({
                title: 'Delete note?',
                message: 'This note will be gone for good.',
                confirmText: 'Delete',
                danger: true,
            });

            if (!confirmed) return;

            deleted = true;
            clearTimeout(timer);

            if (saving) await saving;

            if (draft.id) {
                const result = await Nexora.request('notes:delete', draft.id);

                if (!result.ok) {
                    deleted = false;
                    ui.error(result.error || 'not_found');
                    return;
                }

                notes = (notes || []).filter((item) => item.id !== draft.id);
                renderList();
            }

            nav.pop();
            ui.toast('Note deleted');
        };

        const view = ui.view({
            title: '',
            className: 'note-editor',
            back: () => nav.pop(),
            body: [title, body],
        });

        // Custom header actions: status text, pin, delete.
        fill(view.headerEl.querySelector('.view-actions'),
            status,
            pinButton,
            h('button', { class: 'icon-btn', type: 'button', title: 'Delete', onclick: remove }, icon('trash')));

        const handle = { flush: save };

        view.cleanup = () => {
            if (editor === handle) editor = null;
            save();
        };

        editor = handle;
        showPin();
        nav.push(view);

        if (!note) setTimeout(() => body.focus(), 340);
    }

    /* -- app ----------------------------------------------------------------- */

    Nexora.registerApp({
        id: 'notes',
        icon: 'note',
        colors: ['#fcd34d', '#f59e0b'],

        mount(root) {
            nav = ui.stack(root);
            listBody = h('div');

            const search = ui.search('Search notes', (value) => {
                query = value;
                renderList();
            });

            nav.reset(ui.view({
                title: 'Notes',
                actions: [{ icon: 'plus', label: 'New note', accent: true, onClick: () => openEditor(null) }],
                body: [search, listBody],
            }));

            renderList();
        },

        open() {
            if (!notes) load();
            else renderList();
        },

        // Leaving the app (or closing the phone) must never lose what was typed.
        close() {
            if (editor) editor.flush();
        },

        back() {
            return nav.pop();
        },
    });

    Nexora.on('visible', (visible) => {
        if (!visible && editor) editor.flush();
    });

    // A note typed by one character must never be saved for the next one.
    Nexora.on('reset', () => {
        epoch += 1;
        editor = null;
    });

    Nexora.on('bootstrap', () => {
        epoch += 1;
        notes = null;
        query = '';
        editor = null;
        if (nav) nav.popToRoot();
        renderList();
    });
})();
