'use strict';

export const SHORTCUT_KEYS = Object.freeze([
    'hide-current-app',
    'hide-others',
    'show-recent-app',
    'show-all-apps',
    'minimize-current-window',
    'unminimize-recent-window',
    'close-current-window',
    'quit-current-app',
]);

const MODIFIER_ALIASES = new Map([
    ['ctrl', 'control'],
    ['ctl', 'control'],
    ['primary', 'control'],
    ['mod1', 'alt'],
    ['mod4', 'super'],
]);

const MODIFIER_ORDER = [
    'control',
    'shift',
    'alt',
    'super',
    'hyper',
    'meta',
];

const MODIFIER_LABELS = new Map([
    ['shift', 'Shift'],
    ['control', 'Ctrl'],
    ['alt', 'Alt'],
    ['super', 'Super'],
    ['hyper', 'Hyper'],
    ['meta', 'Meta'],
]);

// GTK cannot be loaded in the GNOME Shell process, so Shell-side conflict
// detection and menu labels need a small accelerator-string representation.
function parseAccelerator(accelerator) {
    if (!accelerator || accelerator.toLowerCase() === 'disabled') {
        return null;
    }

    const modifiers = [];
    const displayKey = accelerator.replace(/<([^>]+)>/g, (_match, modifier) => {
        const normalized = modifier.toLowerCase();
        modifiers.push(MODIFIER_ALIASES.get(normalized) ?? normalized);
        return '';
    }).trim();
    const key = displayKey.toLowerCase();

    if (!key) {
        return null;
    }

    const uniqueModifiers = [...new Set(modifiers)];
    uniqueModifiers.sort((left, right) => {
        const leftIndex = MODIFIER_ORDER.indexOf(left);
        const rightIndex = MODIFIER_ORDER.indexOf(right);
        return leftIndex - rightIndex;
    });

    return {modifiers: uniqueModifiers, key, displayKey};
}

export function acceleratorIdentity(accelerator) {
    const parsed = parseAccelerator(accelerator);
    if (!parsed) {
        return null;
    }

    return `${parsed.modifiers.join('+')}:${parsed.key}`;
}

export function acceleratorLabel(accelerator) {
    const parsed = parseAccelerator(accelerator);
    if (!parsed) {
        return '';
    }

    const modifiers = parsed.modifiers.map(modifier =>
        MODIFIER_LABELS.get(modifier) ?? modifier);
    const key = parsed.displayKey.length === 1 ?
        parsed.displayKey.toUpperCase() : parsed.displayKey.replaceAll('_', ' ');
    return [...modifiers, key].join('+');
}
