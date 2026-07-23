'use strict';

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    acceleratorIdentity,
    SHORTCUT_KEYS,
} from './shortcuts.js';

const GNOME_KEYBINDING_SCHEMAS = [
    'org.gnome.desktop.wm.keybindings',
    'org.gnome.mutter.keybindings',
    'org.gnome.mutter.wayland.keybindings',
    'org.gnome.shell.keybindings',
    'org.gnome.settings-daemon.plugins.media-keys',
];

const MEDIA_KEYS_SCHEMA = 'org.gnome.settings-daemon.plugins.media-keys';
const CUSTOM_KEYBINDING_SCHEMA =
    'org.gnome.settings-daemon.plugins.media-keys.custom-keybinding';

export function overrideSetting(overrides, settings, key, after, location, logger) {
    const before = settings.get_value(key);
    if (before.equal(after)) {
        return;
    }
    if (!settings.is_writable(key)) {
        logger(`Classic App Switcher: Cannot disable read-only shortcut: ${location}`);
        return;
    }

    if (settings.set_value(key, after)) {
        overrides.push({settings, key, before, after, location});
    } else {
        logger(`Classic App Switcher: Failed to disable conflicting shortcut: ${location}`);
    }
}

export function restoreSettings(overrides, logger) {
    overrides.forEach(({settings, key, before, after, location}) => {
        if (settings.get_value(key).equal(after) && !settings.set_value(key, before)) {
            logger(`Classic App Switcher: Failed to restore GNOME shortcut: ${location}`);
        }
    });
}

function overrideCustomKeybindings(
    switcher,
    schemaSource,
    configuredAccelerators,
    logger
) {
    const mediaKeysSchema = schemaSource.lookup(MEDIA_KEYS_SCHEMA, true);
    const customKeybindingSchema = schemaSource.lookup(CUSTOM_KEYBINDING_SCHEMA, true);
    if (!mediaKeysSchema || !customKeybindingSchema) {
        return;
    }

    const mediaKeysSettings = new Gio.Settings({settings_schema: mediaKeysSchema});
    mediaKeysSettings.get_strv('custom-keybindings').forEach(path => {
        if (!path.startsWith('/') || !path.endsWith('/') || path.includes('//')) {
            logger(`Classic App Switcher: Ignoring invalid custom shortcut path: ${path}`);
            return;
        }

        const settings = new Gio.Settings({
            settings_schema: customKeybindingSchema,
            path,
        });
        const binding = settings.get_string('binding');
        if (!configuredAccelerators.has(acceleratorIdentity(binding))) {
            return;
        }

        overrideSetting(
            switcher._overriddenKeybindings,
            settings,
            'binding',
            new GLib.Variant('s', ''),
            `${CUSTOM_KEYBINDING_SCHEMA}:${path}binding`,
            logger
        );
    });
}

/**
 * Temporarily remove GNOME keybindings that conflict with our shortcuts.
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 */
export function overrideGnomeDefaults(switcher) {
    const logger = message => console.warn(message);
    const configuredAccelerators = new Set();
    SHORTCUT_KEYS.forEach(key => {
        switcher._settings.get_strv(key).forEach(accelerator => {
            const identity = acceleratorIdentity(accelerator);
            if (identity) {
                configuredAccelerators.add(identity);
            }
        });
    });

    const schemaSource = Gio.SettingsSchemaSource.get_default();
    GNOME_KEYBINDING_SCHEMAS.forEach(schemaId => {
        const schema = schemaSource.lookup(schemaId, true);
        if (!schema) {
            return;
        }

        const settings = new Gio.Settings({settings_schema: schema});
        schema.list_keys().forEach(key => {
            if (schemaId === MEDIA_KEYS_SCHEMA && key === 'custom-keybindings') {
                return;
            }
            if (settings.get_value(key).get_type_string() !== 'as') {
                return;
            }

            const before = settings.get_strv(key);
            const after = before.filter(accelerator =>
                !configuredAccelerators.has(acceleratorIdentity(accelerator)));
            if (before.length === after.length) {
                return;
            }

            overrideSetting(
                switcher._overriddenKeybindings,
                settings,
                key,
                new GLib.Variant('as', after),
                `${schemaId}/${key}`,
                logger
            );
        });
    });

    overrideCustomKeybindings(
        switcher,
        schemaSource,
        configuredAccelerators,
        logger
    );
}

/**
 * Restore GNOME keybindings changed by overrideGnomeDefaults().
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 */
export function restoreGnomeDefaults(switcher) {
    restoreSettings(
        switcher._overriddenKeybindings,
        message => console.warn(message)
    );
    switcher._overriddenKeybindings = [];
}
