/* ==========================================================================
   Nexora Phone - Messages
   Conversation list, threads with text / photo / location messages, unread
   tracking and notifications. The server decides who a message is from; the
   UI only ever sends "to" and "what".
   ========================================================================== */
(() => {
    'use strict';

    const { h, fill, icon, ui, format, state, sound } = Nexora;

    let nav = null;
    let listBody = null;
    let query = '';
    let conversations = null;       // null until loaded: [{ number, unread, last }]
    let loading = false;
    const threads = new Map();      // number -> { messages, hasMore, loaded }
    let active = null;              // { number, view, list, thread } thread on screen

    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

    const findConversation = (number) => (conversations || []).find((item) => String(item.number) === number) || null;

    function getThread(number) {
        if (!threads.has(number)) threads.set(number, { messages: [], hasMore: false, loaded: false });
        return threads.get(number);
    }

    /** One line summary of a message for lists and notifications. */
    function preview(message) {
        if (!message) return '';

        const prefix = message.mine ? 'You: ' : '';

        if (message.kind === 'image') return `${prefix}Photo`;
        if (message.kind === 'location') return `${prefix}Location`;

        return prefix + message.body;
    }

    /** Is the player looking at this conversation right now? */
    const isViewing = (number) => !!active && active.number === number
        && state.visible && !state.locked && state.current === 'messages';

    /* -- unread bookkeeping -------------------------------------------------- */

    function clearUnread(number) {
        if (!conversations) {
            loadConversations(true);
            return;
        }

        const conversation = findConversation(number);
        if (conversation && conversation.unread > 0) {
            Nexora.setUnread(state.unreadMessages - conversation.unread);
            conversation.unread = 0;
            renderList();
        }
    }

    function markRead(number) {
        const conversation = findConversation(number);
        const thread = threads.get(number);

        const unread = conversation
            ? conversation.unread > 0
            : !!thread && thread.messages.some((message) => !message.mine && !message.read);

        if (!unread) return;

        Nexora.request('messages:read', number);

        if (thread) {
            for (const message of thread.messages) {
                if (!message.mine) message.read = true;
            }
        }

        clearUnread(number);
    }

    /* -- conversation list --------------------------------------------------- */

    async function loadConversations(force) {
        if (loading) return;

        if (conversations && !force) {
            renderList();
            return;
        }

        loading = true;
        renderList();

        const result = await Nexora.request('messages:conversations');

        loading = false;

        if (result.ok) {
            conversations = Nexora.list(result.conversations);
            Nexora.setUnread(result.unread || 0);
        } else if (!conversations) {
            conversations = [];
            ui.error(result.error);
        }

        renderList();
    }

    async function deleteConversation(number) {
        const confirmed = await ui.confirm({
            title: 'Delete conversation?',
            message: `All messages with ${Nexora.contacts.name(number)} will be removed from your phone.`,
            confirmText: 'Delete',
            danger: true,
        });

        if (!confirmed) return;

        const result = await Nexora.request('messages:deleteThread', number);

        if (!result.ok) {
            ui.error(result.error);
            return;
        }

        if (conversations) conversations = conversations.filter((item) => String(item.number) !== number);
        threads.delete(number);

        if (typeof result.unread === 'number') Nexora.setUnread(result.unread);
        if (active && active.number === number) nav.popToRoot();

        renderList();
    }

    async function conversationMenu(number) {
        const isNumber = /^\d+$/.test(number);
        const contact = Nexora.contacts.find(number);

        const choice = await ui.sheet({
            title: Nexora.contacts.name(number),
            actions: [
                isNumber ? { label: 'Call', icon: 'phone', value: 'call' } : null,
                isNumber && contact ? { label: 'View contact', icon: 'user', value: 'contact' } : null,
                isNumber && !contact ? { label: 'Add to contacts', icon: 'user-plus', value: 'add' } : null,
                { label: 'Delete conversation', icon: 'trash', value: 'delete', danger: true },
            ],
        });

        if (choice === 'call') Nexora.openApp('phone', { call: number });
        else if (choice === 'contact') Nexora.openApp('contacts', { id: contact.id });
        else if (choice === 'add') Nexora.openApp('contacts', { add: number });
        else if (choice === 'delete') deleteConversation(number);
    }

    function conversationRow(conversation) {
        const number = String(conversation.number);

        const row = ui.row({
            lead: ui.avatar(number, 46),
            title: Nexora.contacts.name(number),
            subtitle: preview(conversation.last),
            trail: h('span', { class: 'convo-meta' },
                h('span', { class: 'convo-time' }, format.relative(conversation.last && conversation.last.ts)),
                conversation.unread > 0
                    ? h('span', { class: 'pill' }, conversation.unread > 99 ? '99+' : conversation.unread)
                    : null),
            className: `convo${conversation.unread > 0 ? ' unread' : ''}`,
            onClick: () => openThread(number),
        });

        ui.onHold(row, () => conversationMenu(number));

        return row;
    }

    function renderList() {
        if (!listBody) return;

        if (!conversations) {
            fill(listBody, ui.spinner());
            return;
        }

        const text = query.toLowerCase();

        const items = conversations.filter((item) => {
            if (!text) return true;
            if (Nexora.contacts.name(item.number).toLowerCase().includes(text)) return true;
            if (String(item.number).includes(text)) return true;
            return !!item.last && item.last.kind === 'text' && item.last.body.toLowerCase().includes(text);
        });

        if (!items.length) {
            fill(listBody, text
                ? ui.empty('search', 'No results', `Nothing matches "${query}".`)
                : ui.empty('chat', 'No messages yet', 'Start a conversation with the pencil button.'));
            return;
        }

        fill(listBody, h('div', { class: 'card' }, items.map(conversationRow)));
    }

    /* -- thread -------------------------------------------------------------- */

    const nearBottom = () => {
        if (!active) return true;
        const body = active.view.bodyEl;
        return body.scrollHeight - body.scrollTop - body.clientHeight < 80;
    };

    const scrollToEnd = () => {
        if (!active) return;
        const body = active.view.bodyEl;
        body.scrollTop = body.scrollHeight;
    };

    async function savePhoto(message) {
        const result = await Nexora.request('gallery:saveFromMessage', message.id);

        if (!result.ok) {
            ui.error(result.error);
            return;
        }

        Nexora.gallery.add(result.image);
        ui.toast('Saved to your gallery');
    }

    async function deleteMessage(message) {
        const result = await Nexora.request('messages:delete', message.id);

        if (!result.ok) {
            ui.error(result.error || 'not_found');
            return;
        }

        const number = String(message.mine ? message.to : message.from);
        const thread = threads.get(number);

        if (thread) {
            thread.messages = thread.messages.filter((item) => item.id !== message.id);

            const conversation = findConversation(number);
            const last = thread.messages[thread.messages.length - 1];

            if (conversation && conversation.last && conversation.last.id === message.id) {
                if (last) {
                    conversation.last = { id: last.id, body: last.body, kind: last.kind, ts: last.ts, mine: last.mine };
                } else if (!thread.hasMore) {
                    conversations = conversations.filter((item) => item !== conversation);
                }
            }
        }

        renderThread();
        renderList();
    }

    async function messageMenu(message) {
        const choice = await ui.sheet({
            actions: [
                message.body ? { label: 'Copy text', icon: 'copy', value: 'copy' } : null,
                message.kind === 'image' ? { label: 'Save to gallery', icon: 'download', value: 'save' } : null,
                { label: 'Delete message', icon: 'trash', value: 'delete', danger: true },
            ],
        });

        if (choice === 'copy') {
            const result = await Nexora.post('clipboard', { text: message.body });
            ui.toast(result.ok ? 'Copied' : 'Could not copy');
        } else if (choice === 'save') {
            savePhoto(message);
        } else if (choice === 'delete') {
            deleteMessage(message);
        }
    }

    function viewPhoto(message) {
        ui.viewImage(message.attachment, {
            caption: `${format.day(message.ts)}, ${format.time(message.ts)}`,
            actions: [{
                icon: 'download',
                label: 'Save',
                onClick: (entry) => {
                    entry.close();
                    savePhoto(message);
                },
            }],
        });
    }

    function bubble(message, endOfGroup) {
        const parts = [];

        if (message.kind === 'image' && message.attachment) {
            const img = h('img', { src: message.attachment, alt: 'Photo', draggable: false });
            img.referrerPolicy = 'no-referrer';
            img.addEventListener('load', () => { if (nearBottom()) scrollToEnd(); }, { once: true });

            parts.push(h('button', { class: 'bubble-image', type: 'button', onclick: () => viewPhoto(message) }, img));
        } else if (message.kind === 'location' && message.attachment) {
            const [x, y] = String(message.attachment).split(',').map(Number);

            parts.push(h('div', { class: 'bubble-location' },
                h('span', { class: 'bubble-location-icon' }, icon('location', 20)),
                h('div', null,
                    h('div', { class: 'bubble-location-title' }, message.mine ? 'Location shared' : 'Shared a location'),
                    h('button', {
                        class: 'bubble-location-link',
                        type: 'button',
                        onclick: (event) => {
                            event.stopPropagation();
                            Nexora.post('waypoint', { x, y }).then((result) => {
                                if (!result.ok) ui.error(result.error);
                            });
                        },
                    }, 'Mark on map'))));
        }

        if (message.body) parts.push(h('div', { class: 'bubble-text' }, message.body));

        const shell = h('div', { class: `bubble${message.kind !== 'text' ? ' media' : ''}` }, parts);
        ui.onHold(shell, () => messageMenu(message));

        return h('div', { class: `msg ${message.mine ? 'out' : 'in'}${endOfGroup ? ' tail' : ''}` },
            shell,
            endOfGroup ? h('div', { class: 'msg-time' }, format.time(message.ts)) : null);
    }

    function renderThread() {
        if (!active) return;

        const { thread, list } = active;

        if (!thread.loaded) {
            fill(list, ui.spinner());
            return;
        }

        const nodes = [];
        let lastDay = null;

        if (thread.hasMore) {
            nodes.push(h('button', { class: 'thread-more', type: 'button', onclick: loadEarlier }, 'Load earlier messages'));
        }

        if (!thread.messages.length) {
            nodes.push(h('div', { class: 'thread-empty' }, 'No messages yet. Say hello.'));
        }

        thread.messages.forEach((message, index) => {
            const day = format.day(message.ts);

            if (day !== lastDay) {
                nodes.push(h('div', { class: 'thread-day' }, day));
                lastDay = day;
            }

            const next = thread.messages[index + 1];
            const endOfGroup = !next || next.mine !== message.mine
                || next.ts - message.ts > 300 || format.day(next.ts) !== day;

            nodes.push(bubble(message, endOfGroup));
        });

        const last = thread.messages[thread.messages.length - 1];
        if (last && last.mine) {
            nodes.push(h('div', { class: 'thread-receipt' }, last.read ? 'Read' : 'Delivered'));
        }

        fill(list, nodes);
    }

    async function loadThread(number) {
        const thread = getThread(number);
        const result = await Nexora.request('messages:thread', number);

        thread.loaded = true;

        if (result.ok) {
            thread.messages = Nexora.list(result.messages);
            thread.hasMore = result.hasMore === true;
            clearUnread(number);
        } else {
            ui.error(result.error);
        }

        if (active && active.number === number) {
            renderThread();
            scrollToEnd();
        }
    }

    async function loadEarlier() {
        if (!active) return;

        const { thread, number, view } = active;
        const first = thread.messages[0];
        if (!first) return;

        const before = view.bodyEl.scrollHeight;
        const result = await Nexora.request('messages:thread', number, first.id);

        if (!result.ok) {
            ui.error(result.error);
            return;
        }

        thread.messages = (Nexora.list(result.messages)).concat(thread.messages);
        thread.hasMore = result.hasMore === true;

        if (active && active.number === number) {
            renderThread();
            view.bodyEl.scrollTop = view.bodyEl.scrollHeight - before;
        }
    }

    /** Puts a message into the caches. Returns the number of the other party. */
    function addMessage(message) {
        const other = String(message.mine ? message.to : message.from);
        const thread = threads.get(other);

        if (thread && thread.loaded && !thread.messages.some((item) => item.id === message.id)) {
            thread.messages.push(message);
        }

        if (conversations) {
            let conversation = findConversation(other);

            if (conversation) conversations.splice(conversations.indexOf(conversation), 1);
            else conversation = { number: other, unread: 0, last: null };

            conversation.last = {
                id: message.id,
                body: message.body,
                kind: message.kind,
                ts: message.ts,
                mine: message.mine === true,
            };

            conversations.unshift(conversation);
        }

        return other;
    }

    async function send(number, text, kind, attachment) {
        const result = await Nexora.request('messages:send', number, text, kind || 'text', attachment || null);

        if (!result.ok) {
            ui.error(result.error);
            sound.play('error');
            return false;
        }

        addMessage(result.message);
        sound.play('sent');

        if (active && active.number === number) {
            renderThread();
            scrollToEnd();
        }

        renderList();

        return true;
    }

    function buildComposer(number) {
        const rules = Nexora.config.messages;
        let pending = null; // photo waiting to be sent with the next message

        const input = h('textarea', {
            class: 'composer-input',
            placeholder: 'Message',
            rows: 1,
            maxLength: rules.maxLength,
            spellcheck: false,
        });

        const attachment = h('div', { class: 'composer-attachment', hidden: true });
        const sendButton = h('button', { class: 'composer-send', type: 'button', title: 'Send' }, icon('send', 18));

        const resize = () => {
            input.style.height = 'auto';
            input.style.height = `${Math.min(input.scrollHeight, 108)}px`;
        };

        const refresh = () => {
            sendButton.disabled = !input.value.trim() && !pending;
        };

        const setPending = (url) => {
            pending = url || null;
            attachment.hidden = !pending;

            if (pending) {
                const img = h('img', { src: pending, alt: '' });
                img.referrerPolicy = 'no-referrer';

                fill(attachment, img, h('button', {
                    class: 'composer-attachment-remove',
                    type: 'button',
                    title: 'Remove photo',
                    onclick: () => setPending(null),
                }, icon('close', 14)));
            }

            refresh();
        };

        const submit = async () => {
            const text = input.value.trim();
            if (!text && !pending) return;

            sendButton.disabled = true;

            const sent = pending
                ? await send(number, text, 'image', pending)
                : await send(number, text, 'text');

            if (sent) {
                input.value = '';
                setPending(null);
                resize();
            }

            refresh();
            input.focus();
        };

        input.addEventListener('input', () => { resize(); refresh(); });
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
            }
        });

        sendButton.addEventListener('click', submit);

        const attach = h('button', {
            class: 'composer-attach',
            type: 'button',
            title: 'Attach',
            onclick: async () => {
                const choice = await ui.sheet({
                    actions: [
                        rules.allowImages ? { label: 'Photo from gallery', icon: 'image', value: 'image' } : null,
                        rules.allowLocation ? { label: 'Share my location', icon: 'location', value: 'location' } : null,
                    ],
                });

                if (choice === 'image') {
                    const url = await ui.pickImage('Send a photo');
                    if (url) setPending(url);
                } else if (choice === 'location') {
                    const confirmed = await ui.confirm({
                        title: 'Share your location?',
                        message: `${Nexora.contacts.name(number)} will see where you are right now.`,
                        confirmText: 'Share',
                    });

                    if (confirmed) send(number, '', 'location');
                }
            },
        }, icon('plus', 20));

        refresh();

        const node = h('div', { class: 'composer' },
            attachment,
            h('div', { class: 'composer-row' },
                rules.allowImages || rules.allowLocation ? attach : null,
                input,
                sendButton));

        node.setPending = setPending;
        node.input = input;

        return node;
    }

    function openThread(number, options = {}) {
        number = String(number);

        const thread = getThread(number);
        const isNumber = /^\d+$/.test(number); // system senders can not be replied to
        const list = h('div', { class: 'thread' });
        const composer = isNumber ? buildComposer(number) : null;

        const view = ui.view({
            title: Nexora.contacts.name(number),
            subtitle: Nexora.contacts.find(number) ? format.number(number) : null,
            className: 'thread-view',
            back: () => nav.pop(),
            actions: [
                isNumber ? { icon: 'phone', label: 'Call', onClick: () => Nexora.openApp('phone', { call: number }) } : null,
                { icon: 'more', label: 'More', onClick: () => conversationMenu(number) },
            ],
            body: list,
            footer: composer || h('div', { class: 'thread-note' }, 'You can not reply to this sender.'),
        });

        view.cleanup = () => {
            if (active && active.view === view) active = null;
        };

        active = { number, view, list, thread };

        nav.push(view);
        renderThread();

        if (composer && options.share) composer.setPending(options.share);

        if (thread.loaded) {
            markRead(number);
            requestAnimationFrame(scrollToEnd);
        } else {
            loadThread(number);
        }
    }

    /* -- new message: pick a recipient --------------------------------------- */

    function openPicker(share) {
        const results = h('div');
        let text = '';

        const choose = (number) => {
            nav.popToRoot();
            openThread(number, { share });
        };

        const render = () => {
            const lower = text.toLowerCase();
            const digits = format.clean(text);
            const nodes = [];

            const contacts = [...Nexora.contacts.all()].sort(byName).filter((contact) => !lower
                || contact.name.toLowerCase().includes(lower)
                || (digits !== '' && /^\d+$/.test(digits) && String(contact.number).includes(digits)));

            if (format.isNumber(digits) && digits !== state.number && !Nexora.contacts.find(digits)) {
                nodes.push(ui.section(null, ui.row({
                    lead: ui.tile('chat', true),
                    title: `Message ${format.number(digits)}`,
                    onClick: () => choose(digits),
                })));
            }

            if (contacts.length) {
                nodes.push(ui.section('Contacts', contacts.map((contact) => ui.row({
                    lead: ui.avatar(contact, 40),
                    title: contact.name,
                    subtitle: format.number(contact.number),
                    onClick: () => choose(contact.number),
                }))));
            } else if (!nodes.length) {
                nodes.push(ui.empty('user', text ? 'No matches' : 'No contacts yet',
                    'Type a phone number to start a conversation.'));
            }

            fill(results, nodes);
        };

        const search = ui.search('Name or number', (value) => {
            text = value;
            render();
        });

        render();

        nav.push(ui.view({
            title: share ? 'Send photo to' : 'New message',
            back: () => nav.pop(),
            body: [search, results],
        }));

        setTimeout(() => search.input.focus(), 340);
    }

    /* -- app ----------------------------------------------------------------- */

    Nexora.registerApp({
        id: 'messages',
        icon: 'chat',
        colors: ['#4ade80', '#16a34a'],

        badge: () => state.unreadMessages,

        mount(root) {
            nav = ui.stack(root);
            listBody = h('div');

            const search = ui.search('Search messages', (value) => {
                query = value;
                renderList();
            });

            nav.reset(ui.view({
                title: 'Messages',
                actions: [{ icon: 'edit', label: 'New message', accent: true, onClick: () => openPicker(null) }],
                body: [search, listBody],
            }));
        },

        /** params: { number } opens a thread, { share: url } sends a photo. */
        open(params) {
            if (params.number) {
                const number = String(params.number);
                if (!active || active.number !== number) {
                    nav.popToRoot();
                    openThread(number);
                } else {
                    markRead(number);
                }
            } else if (params.share) {
                nav.popToRoot();
                openPicker(params.share);
            } else if (active) {
                markRead(active.number);
            }

            loadConversations(false);
        },

        back() {
            return nav.pop();
        },
    });

    /* -- events -------------------------------------------------------------- */

    Nexora.on('message', (message) => {
        const other = addMessage(message);

        if (!message.mine) {
            if (isViewing(other)) {
                message.read = true;
                Nexora.request('messages:read', other);
            } else {
                const conversation = findConversation(other);
                if (conversation) conversation.unread += 1;

                Nexora.setUnread(state.unreadMessages + 1);

                Nexora.notify({
                    app: 'messages',
                    title: Nexora.contacts.name(other),
                    body: preview(Object.assign({}, message, { mine: false })),
                    ts: message.ts,
                    silent: message.silent === true,
                    action: { app: 'messages', params: { number: other } },
                });
            }
        }

        if (active && active.number === other) {
            const stick = nearBottom();
            renderThread();
            if (stick || message.mine) scrollToEnd();
        }

        renderList();
    });

    // The other side opened the conversation: my messages are read now.
    Nexora.on('messagesRead', (data) => {
        const number = String(data.number);
        const thread = threads.get(number);
        if (!thread) return;

        for (const message of thread.messages) {
            if (message.mine) message.read = true;
        }

        if (active && active.number === number) renderThread();
    });

    // Coming back to a thread that received messages while it was not visible.
    const catchUp = () => {
        if (active && isViewing(active.number)) markRead(active.number);
    };

    Nexora.on('visible', (visible) => { if (visible) catchUp(); });
    Nexora.on('unlock', catchUp);

    // Messages may have arrived while the phone was offline (airplane mode).
    Nexora.on('messages:stale', () => {
        conversations = null;
        threads.clear();

        if (nav) nav.popToRoot();
        if (state.current === 'messages') loadConversations(true);
    });

    Nexora.on('contacts', () => {
        renderList();
        if (active) active.view.titleEl.textContent = Nexora.contacts.name(active.number);
    });

    Nexora.on('bootstrap', () => {
        conversations = null;
        threads.clear();
        query = '';
        if (nav) nav.popToRoot();
    });
})();
