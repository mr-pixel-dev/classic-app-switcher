'use strict';

import Gdk from 'gi://Gdk';

const FORBIDDEN_KEYVALS = new Set([
    Gdk.KEY_Home,
    Gdk.KEY_Left,
    Gdk.KEY_Up,
    Gdk.KEY_Right,
    Gdk.KEY_Down,
    Gdk.KEY_Page_Up,
    Gdk.KEY_Page_Down,
    Gdk.KEY_End,
    Gdk.KEY_Tab,
    Gdk.KEY_KP_Enter,
    Gdk.KEY_Return,
    Gdk.KEY_Mode_switch,
]);

// GNOME Control Center applies this policy in addition to Gtk.accelerator_valid().
// It is not exposed by GTK or libadwaita.
export function isValidBindingPolicy(keyval, modifiers) {
    const shift = Gdk.ModifierType.SHIFT_MASK;
    if (modifiers !== 0 && modifiers !== shift) {
        return true;
    }

    const unicodeValue = Gdk.keyval_to_unicode(keyval);
    const character = unicodeValue === 0 ? '' : String.fromCodePoint(unicodeValue);
    return !/[\p{L}\p{N}]/u.test(character) &&
        (modifiers !== 0 || keyval !== Gdk.KEY_space) &&
        !FORBIDDEN_KEYVALS.has(keyval);
}
