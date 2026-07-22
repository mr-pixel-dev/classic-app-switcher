'use strict';

import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

if (!GLib.setenv('GSETTINGS_BACKEND', 'memory', true)) {
    throw new Error('Failed to isolate GSettings test backend');
}

import {
    overrideSetting,
    overrideGnomeDefaults,
    restoreGnomeDefaults,
    restoreSettings,
} from '../gnomeKeybindings.js';
import {
    acceleratorIdentity,
    SHORTCUT_KEYS,
} from '../shortcuts.js';
import {isValidBindingPolicy} from '../settings/shortcutBindingPolicy.js';

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

function assertStrv(settings, key, expected, message) {
    assertEqual(
        JSON.stringify(settings.get_strv(key)),
        JSON.stringify(expected),
        message
    );
}

class MemorySettings {
    constructor(key, value) {
        this._key = key;
        this._value = value;
    }

    get_value(key) {
        assertEqual(key, this._key, 'dummy setting key');
        return this._value;
    }

    is_writable(key) {
        assertEqual(key, this._key, 'dummy setting key');
        return true;
    }

    set_value(key, value) {
        assertEqual(key, this._key, 'dummy setting key');
        this._value = value;
        return true;
    }
}

function runOverrideContract(makeSettings) {
    const key = 'binding';
    const before = new GLib.Variant('s', '<Primary>q');
    const after = new GLib.Variant('s', '');
    const settings = makeSettings(key, before);
    const overrides = [];

    overrideSetting(overrides, settings, key, after, 'test binding', () => {});
    assertEqual(settings.get_value(key).get_string()[0], '', 'binding must be overridden');
    assertEqual(overrides.length, 1, 'override must be recorded');

    restoreSettings(overrides, () => {});
    assertEqual(
        settings.get_value(key).get_string()[0],
        '<Primary>q',
        'binding must be restored'
    );

    overrides.length = 0;
    overrideSetting(overrides, settings, key, after, 'test binding', () => {});
    settings.set_value(key, new GLib.Variant('s', '<Super>x'));
    restoreSettings(overrides, () => {});
    assertEqual(
        settings.get_value(key).get_string()[0],
        '<Super>x',
        'a concurrently changed binding must not be overwritten'
    );
}

assertEqual(
    acceleratorIdentity('<Primary>q'),
    acceleratorIdentity('<Control>q'),
    '<Primary> must be equivalent to <Control>'
);
assertEqual(
    Gtk.accelerator_valid(Gdk.KEY_space, Gdk.ModifierType.SHIFT_MASK),
    true,
    'GTK must accept Shift+Space'
);
assertEqual(
    isValidBindingPolicy(Gdk.KEY_space, Gdk.ModifierType.SHIFT_MASK),
    true,
    'binding policy must accept Shift+Space'
);
assertEqual(
    isValidBindingPolicy(Gdk.KEY_space, 0),
    false,
    'binding policy must reject unmodified Space'
);

runOverrideContract((key, before) => new MemorySettings(key, before));

const contractSettings = new Gio.Settings({
    schema_id: 'org.gnome.settings-daemon.plugins.media-keys.custom-keybinding',
    path: '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/contract/',
});
runOverrideContract((key, before) => {
    contractSettings.set_value(key, before);
    return contractSettings;
});

const extensionSettings = new Gio.Settings({
    schema_id: 'org.gnome.shell.extensions.classic-app-switcher',
});
SHORTCUT_KEYS.forEach(key => extensionSettings.set_strv(key, []));
extensionSettings.set_strv('quit-current-app', ['<Control>q']);

const wmSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.wm.keybindings'});
wmSettings.set_strv('close', ['<Primary>q']);

const mediaKeysSettings = new Gio.Settings({
    schema_id: 'org.gnome.settings-daemon.plugins.media-keys',
});
const customPaths = [
    '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/',
    '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom1/',
];
mediaKeysSettings.set_strv('custom-keybindings', customPaths);

const customSettings = customPaths.map(path => new Gio.Settings({
    schema_id: 'org.gnome.settings-daemon.plugins.media-keys.custom-keybinding',
    path,
}));
customSettings.forEach(settings => settings.set_string('binding', '<Primary>q'));

const switcher = {
    _settings: extensionSettings,
    _overriddenKeybindings: [],
};
// Regression: GNOME custom keybindings use relocatable scalar settings.
overrideGnomeDefaults(switcher);

assertStrv(wmSettings, 'close', [], 'ordinary GNOME binding must be disabled');
customSettings.forEach(settings => assertEqual(
    settings.get_string('binding'),
    '',
    'relocatable custom binding must be disabled'
));

customSettings[1].set_string('binding', '<Super>x');
restoreGnomeDefaults(switcher);

assertStrv(wmSettings, 'close', ['<Primary>q'], 'ordinary GNOME binding must be restored');
assertEqual(
    customSettings[0].get_string('binding'),
    '<Primary>q',
    'unchanged relocatable custom binding must be restored'
);
assertEqual(
    customSettings[1].get_string('binding'),
    '<Super>x',
    'a concurrently changed custom binding must not be overwritten'
);
assertEqual(switcher._overriddenKeybindings.length, 0, 'restoration records must be cleared');

print('keyboard shortcut regression tests passed');
