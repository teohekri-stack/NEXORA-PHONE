/* ==========================================================================
   Nexora Phone - Bank
   Shows the balance the server reports and lets the player send money.
   Nothing here is trusted by the server: the amount is validated and the
   balance is checked there, this UI only asks.
   ========================================================================== */
(() => {
    'use strict';

    const { h, fill, icon, ui, format, state } = Nexora;

    let nav = null;
    let body = null;
    let data = null;        // { balance, name, history }
    let loading = false;
    let refreshSend = null; // updates the open transfer form when the balance arrives

    const feeFor = (amount) => Math.floor(amount * (Nexora.config.bank.feePercent || 0) / 100 + 0.5);

    /* -- overview ------------------------------------------------------------ */

    function transactionRow(entry) {
        const incoming = entry.direction === 'in';

        return ui.row({
            lead: h('span', { class: `tile bank-tile ${incoming ? 'in' : 'out'}` },
                icon(incoming ? 'arrow-down-left' : 'arrow-up-right', 18)),
            title: entry.name || 'Unknown',
            subtitle: entry.reason || (incoming ? 'Received' : 'Sent'),
            trail: h('span', { class: 'bank-amount-cell' },
                h('span', { class: `bank-amount ${incoming ? 'in' : 'out'}` },
                    `${incoming ? '+' : '-'}${format.money(entry.amount + (incoming ? 0 : entry.fee || 0))}`),
                h('span', { class: 'bank-when' }, format.relative(entry.ts))),
        });
    }

    function render() {
        if (!body) return;

        if (!data) {
            fill(body, ui.spinner());
            return;
        }

        const tail = String(state.number || '').slice(-4).padStart(4, '0');

        fill(body,
            h('div', { class: 'bank-card' },
                h('div', { class: 'bank-card-top' },
                    h('span', { class: 'bank-card-brand' }, `${Nexora.config.brand.name} Bank`),
                    icon('bank', 22)),
                h('div', { class: 'bank-card-label' }, 'Available balance'),
                h('div', { class: 'bank-card-balance' }, format.money(data.balance)),
                h('div', { class: 'bank-card-bottom' },
                    h('span', null, data.name || state.name),
                    h('span', { class: 'bank-card-digits' }, `•••• ${tail}`))),
            h('div', { class: 'bank-actions' },
                ui.button('Send money', { icon: 'arrow-up-right', block: true, onClick: () => openSend() })),
            h('div', { class: 'section' },
                h('div', { class: 'section-title' }, 'Recent activity'),
                data.history.length
                    ? h('div', { class: 'card' }, data.history.map(transactionRow))
                    : ui.empty('bank', 'No transfers yet', 'Money you send or receive with your phone shows up here.')));
    }

    async function load() {
        if (loading) return;
        loading = true;

        const result = await Nexora.request('bank:overview');

        loading = false;

        if (result.ok) {
            data = { balance: result.balance || 0, name: result.name || '', history: Nexora.list(result.history) };
        } else {
            if (!data) data = { balance: 0, name: '', history: [] };
            ui.error(result.error);
        }

        render();
        if (refreshSend) refreshSend();
    }

    /* -- send money ---------------------------------------------------------- */

    function openSuccess(transaction) {
        nav.popToRoot();

        nav.push(ui.view({
            title: '',
            body: h('div', { class: 'bank-done' },
                h('span', { class: 'bank-done-icon' }, icon('check', 44)),
                h('div', { class: 'bank-done-amount' }, format.money(transaction.amount)),
                h('div', { class: 'bank-done-text' }, `sent to ${transaction.name}`),
                transaction.fee
                    ? h('div', { class: 'bank-done-fee' }, `Fee ${format.money(transaction.fee)}`)
                    : null),
            footer: ui.button('Done', { block: true, onClick: () => nav.pop() }),
        }));

        Nexora.sound.play('success');
    }

    async function pickContact(input) {
        const contacts = [...Nexora.contacts.all()]
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

        if (!contacts.length) {
            ui.toast('You have no contacts yet');
            return;
        }

        const number = await ui.sheet({
            title: 'Send to a contact',
            actions: contacts.slice(0, 40).map((contact) => ({
                label: `${contact.name}  ·  ${format.number(contact.number)}`,
                value: contact.number,
            })),
        });

        if (number) input.value = format.number(number);
    }

    function openSend(preset) {
        const rules = Nexora.config.bank;

        const to = h('input', {
            class: 'input',
            placeholder: rules.allowCharacterId ? 'Phone number or citizen ID' : 'Phone number',
            maxLength: 50,
            autocomplete: 'off',
            spellcheck: false,
        });
        to.value = preset ? format.number(preset) : '';

        const amount = h('input', {
            class: 'input bank-amount-input',
            placeholder: '0',
            maxLength: 10,
            autocomplete: 'off',
        });
        amount.inputMode = 'numeric';

        const note = h('input', {
            class: 'input',
            placeholder: 'What is it for? (optional)',
            maxLength: rules.reasonMaxLength,
            autocomplete: 'off',
        });

        const summary = h('div', { class: 'bank-summary' });
        const submit = ui.button('Review transfer', { block: true });

        const value = () => {
            const digits = amount.value.replace(/[^\d]/g, '');
            return digits ? parseInt(digits, 10) : 0;
        };

        const refresh = () => {
            const total = value();
            const fee = feeFor(total);

            // Whole amounts only: strip everything that is not a digit.
            if (amount.value !== (total ? String(total) : '')) amount.value = total ? String(total) : '';

            fill(summary,
                h('span', null, `Balance ${format.money(data ? data.balance : 0)}`),
                fee ? h('span', null, `Fee ${format.money(fee)}`) : null);

            submit.disabled = total <= 0 || !to.value.trim();
        };

        amount.addEventListener('input', refresh);
        to.addEventListener('input', refresh);

        const review = async () => {
            const total = value();
            const target = to.value.trim();
            const fee = feeFor(total);

            if (total < rules.min || total > rules.max) {
                ui.toast(`Enter an amount between ${format.money(rules.min)} and ${format.money(rules.max)}.`, 'error');
                return;
            }

            if (data && total + fee > data.balance) {
                ui.error('insufficient');
                return;
            }

            submit.disabled = true;

            // Ask the server who this goes to, so the player confirms a name.
            const lookup = await Nexora.request('bank:lookup', target);

            if (!lookup.ok) {
                submit.disabled = false;
                ui.error(lookup.error);
                return;
            }

            const confirmed = await ui.confirm({
                title: `Send ${format.money(total)}?`,
                message: `To ${lookup.name}${fee ? `\nFee ${format.money(fee)} - total ${format.money(total + fee)}` : ''}`,
                confirmText: 'Send',
            });

            if (!confirmed) {
                submit.disabled = false;
                return;
            }

            const result = await Nexora.request('bank:transfer', target, total, note.value.trim());

            submit.disabled = false;

            if (!result.ok) {
                ui.error(result.error);
                Nexora.sound.play('error');
                return;
            }

            if (data) {
                data.balance = result.balance;
                data.history.unshift(result.transaction);
            }

            render();
            openSuccess(result.transaction);
        };

        submit.addEventListener('click', review);
        refresh();
        refreshSend = refresh;

        const view = ui.view({
            title: 'Send money',
            back: () => nav.pop(),
            body: h('form', { onsubmit: (event) => { event.preventDefault(); if (!submit.disabled) review(); } },
                h('div', { class: 'field' },
                    h('span', { class: 'field-label' }, 'To'),
                    h('div', { class: 'input-group' },
                        to,
                        h('button', {
                            class: 'icon-btn',
                            type: 'button',
                            title: 'Choose a contact',
                            onclick: () => pickContact(to).then(refresh),
                        }, icon('user', 20)))),
                h('label', { class: 'field' },
                    h('span', { class: 'field-label' }, `Amount (${rules.currency})`), amount),
                h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Note'), note),
                summary,
                h('button', { type: 'submit', hidden: true })),
            footer: submit,
        });

        view.cleanup = () => {
            if (refreshSend === refresh) refreshSend = null;
        };

        nav.push(view);

        setTimeout(() => (preset ? amount : to).focus(), 340);
    }

    /* -- app ----------------------------------------------------------------- */

    Nexora.registerApp({
        id: 'bank',
        icon: 'bank',
        colors: ['#38bdf8', '#2563eb'],

        mount(root) {
            nav = ui.stack(root);
            body = h('div');

            nav.reset(ui.view({
                title: 'Bank',
                actions: [{ icon: 'refresh', label: 'Refresh', onClick: load }],
                body,
            }));

            render();
        },

        /** params: { to: number } opens the transfer form for that number. */
        open(params) {
            load();

            if (params.to) {
                nav.popToRoot();
                openSend(params.to);
            }
        },

        back() {
            return nav.pop();
        },
    });

    // Money arrived while the app is loaded.
    Nexora.on('bankTransaction', (transaction) => {
        if (!data) return;

        if (typeof transaction.balance === 'number') data.balance = transaction.balance;
        data.history.unshift(transaction);
        render();
    });

    Nexora.on('bootstrap', () => {
        data = null;
        if (nav) nav.popToRoot();
        render();
    });
})();
