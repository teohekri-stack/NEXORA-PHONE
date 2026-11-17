/* ==========================================================================
   Nexora Phone - Calculator
   A standard immediate-execution calculator. Works with the mouse and with
   the keyboard (digits, + - * /, Enter, Backspace, C).
   ========================================================================== */
(() => {
    'use strict';

    const { h } = Nexora;

    const SYMBOLS = { '+': '+', '-': '−', '*': '×', '/': '÷' };
    const MAX_DIGITS = 12;

    let display = null;
    let trail = null;
    const operatorKeys = new Map();

    let current = '0';      // what is being typed / shown
    let stored = null;      // left operand
    let operator = null;    // pending operator
    let fresh = true;       // the next digit starts a new number
    let note = '';          // small line above the result

    /** Rounds away binary floating point noise (0.1 + 0.2 -> 0.3). */
    const tidy = (value) => String(parseFloat(value.toPrecision(12)));

    function pretty(text) {
        if (text === 'Error' || text.includes('e')) return text;

        const negative = text.startsWith('-');
        const [whole, fraction] = (negative ? text.slice(1) : text).split('.');
        const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

        return (negative ? '-' : '') + grouped + (fraction !== undefined ? `.${fraction}` : '');
    }

    function render() {
        if (!display) return;

        const text = pretty(current);

        display.textContent = text;
        display.dataset.size = text.length > 13 ? 'xs' : text.length > 10 ? 's' : text.length > 7 ? 'm' : 'l';
        trail.textContent = note || (operator && stored !== null ? `${pretty(tidy(stored))} ${SYMBOLS[operator]}` : '');

        for (const [key, button] of operatorKeys) {
            button.classList.toggle('active', operator === key && fresh);
        }
    }

    function clear() {
        current = '0';
        stored = null;
        operator = null;
        fresh = true;
        note = '';
        render();
    }

    function fail() {
        current = 'Error';
        stored = null;
        operator = null;
        fresh = true;
        note = '';
        render();
    }

    function compute(left, right, op) {
        if (op === '+') return left + right;
        if (op === '-') return left - right;
        if (op === '*') return left * right;
        return right === 0 ? NaN : left / right;
    }

    function digit(value) {
        if (current === 'Error') clear();

        note = '';

        if (fresh) {
            current = value;
            fresh = false;
        } else if (current.replace(/[-.]/g, '').length < MAX_DIGITS) {
            current = current === '0' ? value : current + value;
        }

        render();
    }

    function dot() {
        if (current === 'Error') clear();

        note = '';

        if (fresh) {
            current = '0.';
            fresh = false;
        } else if (!current.includes('.')) {
            current += '.';
        }

        render();
    }

    function sign() {
        if (current === 'Error' || parseFloat(current) === 0) return;

        current = current.startsWith('-') ? current.slice(1) : `-${current}`;
        render();
    }

    function percent() {
        if (current === 'Error') return;

        const value = parseFloat(current);

        // "200 + 10 %" means 10 % of 200, a lone "10 %" means 0.1.
        current = tidy(operator && stored !== null ? stored * value / 100 : value / 100);
        fresh = false;
        render();
    }

    function setOperator(op) {
        if (current === 'Error') return;

        const value = parseFloat(current);

        note = '';

        if (operator && stored !== null && !fresh) {
            const result = compute(stored, value, operator);
            if (!Number.isFinite(result)) {
                fail();
                return;
            }

            stored = result;
            current = tidy(result);
        } else {
            stored = value;
        }

        operator = op;
        fresh = true;
        render();
    }

    function equals() {
        if (current === 'Error' || !operator || stored === null) return;

        const value = parseFloat(current);
        const result = compute(stored, value, operator);

        if (!Number.isFinite(result)) {
            fail();
            return;
        }

        note = `${pretty(tidy(stored))} ${SYMBOLS[operator]} ${pretty(tidy(value))} =`;
        current = tidy(result);
        stored = null;
        operator = null;
        fresh = true;
        render();
    }

    /** Removes the last typed digit. Returns false when there is nothing to remove. */
    function backspace() {
        if (fresh || current === 'Error') return false;

        current = current.length > 1 && !(current.length === 2 && current.startsWith('-'))
            ? current.slice(0, -1)
            : '0';

        if (current === '0') fresh = true;
        render();

        return true;
    }

    function key(label, kind, onClick, wide) {
        return h('button', {
            class: `calc-key ${kind}${wide ? ' wide' : ''}`,
            type: 'button',
            onclick: onClick,
        }, label);
    }

    function operatorKey(op) {
        const button = key(SYMBOLS[op], 'op', () => setOperator(op));
        operatorKeys.set(op, button);
        return button;
    }

    Nexora.registerApp({
        id: 'calculator',
        icon: 'calculator',
        colors: ['#fb923c', '#ea580c'],

        mount(root) {
            display = h('div', { class: 'calc-value' });
            trail = h('div', { class: 'calc-trail' });

            const number = (value) => key(value, 'num', () => digit(value));

            root.append(h('section', { class: 'view calc' },
                h('div', { class: 'calc-display' }, trail, display),
                h('div', { class: 'calc-keys' },
                    key('AC', 'fn', clear), key('±', 'fn', sign), key('%', 'fn', percent), operatorKey('/'),
                    number('7'), number('8'), number('9'), operatorKey('*'),
                    number('4'), number('5'), number('6'), operatorKey('-'),
                    number('1'), number('2'), number('3'), operatorKey('+'),
                    key('0', 'num', () => digit('0'), true), key('.', 'num', dot), key('=', 'eq', equals))));

            render();
        },

        key(event) {
            const name = event.key;

            if (/^\d$/.test(name)) digit(name);
            else if (name === '.' || name === ',') dot();
            else if (name === '+' || name === '-' || name === '*' || name === '/') setOperator(name);
            else if (name === 'x' || name === 'X') setOperator('*');
            else if (name === 'Enter' || name === '=') equals();
            else if (name === '%') percent();
            else if (name === 'c' || name === 'C' || name === 'Delete') clear();
            else if (name === 'Backspace') return backspace();
            else return false;

            return true;
        },
    });
})();
