'use strict';

import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as SwitcherMenu from './switcherMenu.js';
import * as WindowManager from './windowManager.js';
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

/**
 * Keyboard Shortcuts - Manages optional keyboard shortcuts for app management
 * All functions receive the switcher instance as first parameter
 */

/**
 * Temporarily remove GNOME keybindings that conflict with our shortcuts.
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 */
export function overrideGnomeDefaults(switcher) {
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
            if (settings.get_value(key).get_type_string() !== 'as') {
                return;
            }

            const before = settings.get_strv(key);
            const after = before.filter(accelerator =>
                !configuredAccelerators.has(acceleratorIdentity(accelerator)));
            if (before.length === after.length) {
                return;
            }
            if (!settings.is_writable(key)) {
                log(`Classic App Switcher: Cannot disable read-only shortcut: ${schemaId}/${key}`);
                return;
            }

            if (settings.set_strv(key, after)) {
                switcher._overriddenKeybindings.push({settings, key, before, after});
            } else {
                log(`Classic App Switcher: Failed to disable conflicting shortcut: ${schemaId}/${key}`);
            }
        });
    });
}

/**
 * Register a keyboard shortcut with error handling
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 * @param {string} key - The shortcut key from settings schema
 * @param {Function} handler - The handler function to call when shortcut is triggered
 */
export function registerShortcut(switcher, key, handler) {
    if (!switcher._settings.get_strv(key).some(accelerator =>
        acceleratorIdentity(accelerator))) {
        return;
    }

    const id = Main.wm.addKeybinding(
        key,
        switcher._settings,
        Meta.KeyBindingFlags.NONE,
        Shell.ActionMode.NORMAL,
        handler
    );

    if (id) {
        switcher._keyBindingIds.push(key);
    } else {
        log(`Classic App Switcher: Failed to register shortcut: ${key}`);
    }
}

/**
 * Setup optional keyboard shortcuts for app management
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 */
export function setupKeyboardShortcuts(switcher) {
    if (!switcher._settings.get_boolean('enable-keyboard-shortcuts')) {
        return;
    }

    // Override GNOME defaults that conflict with our shortcuts
    overrideGnomeDefaults(switcher);

    // Register all shortcuts from structured definition
    // Each shortcut maps a settings key to its handler method
    const handlers = {
        'hide-current-app': () => WindowManager.hideCurrentApp(switcher),
        'hide-others': () => WindowManager.hideOthers(switcher),
        'show-recent-app': () => WindowManager.showRecentApp(switcher),
        'show-all-apps': () => WindowManager.showAll(switcher),
        'minimize-current-window': () => WindowManager.minimizeCurrentWindow(switcher),
        'unminimize-recent-window': () => WindowManager.unminimizeRecentWindow(switcher),
        'close-current-window': () => WindowManager.closeCurrentWindow(switcher),
        'quit-current-app': () => WindowManager.quitCurrentApp(switcher),
    };

    // Register each shortcut with error handling
    SHORTCUT_KEYS.forEach(key => registerShortcut(switcher, key, handlers[key]));
}

export function isShortcutSetting(key) {
    return SHORTCUT_KEYS.includes(key);
}

/**
 * Reload keyboard shortcuts when setting changes
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 */
export function reloadShortcuts(switcher) {
    const shortcutsEnabled = switcher._settings.get_boolean('enable-keyboard-shortcuts');

    cleanupKeybindings(switcher);
    if (shortcutsEnabled) {
        setupKeyboardShortcuts(switcher);
    }

    // Rebuild the switcher actions section (where hints appear)
    SwitcherMenu.buildSwitcherActions(switcher);
    switcher._update();
}

/**
 * Clean up keyboard shortcuts and restore GNOME keybindings we changed
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 */
export function cleanupKeybindings(switcher) {
    // Remove our custom keybindings
    switcher._keyBindingIds.forEach(id => {
        Main.wm.removeKeybinding(id);
    });
    switcher._keyBindingIds = [];

    switcher._overriddenKeybindings.forEach(({settings, key, before, after}) => {
        const current = settings.get_strv(key);
        if (current.length === after.length &&
            current.every((accelerator, index) => accelerator === after[index])) {
            if (!settings.set_strv(key, before)) {
                log(`Classic App Switcher: Failed to restore GNOME shortcut: ${key}`);
            }
        }
    });
    switcher._overriddenKeybindings = [];
}
