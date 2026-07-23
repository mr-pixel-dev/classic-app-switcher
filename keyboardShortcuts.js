'use strict';

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as SwitcherMenu from './switcherMenu.js';
import * as WindowManager from './windowManager.js';
import {
    overrideGnomeDefaults,
    restoreGnomeDefaults,
} from './gnomeKeybindings.js';
import {SHORTCUT_KEYS} from './shortcuts.js';

export {overrideGnomeDefaults} from './gnomeKeybindings.js';

/**
 * Keyboard Shortcuts - Manages optional keyboard shortcuts for app management
 * All functions receive the switcher instance as first parameter
 */

/**
 * Register a keyboard shortcut with error handling
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 * @param {string} key - The shortcut key from settings schema
 * @param {Function} handler - The handler function to call when shortcut is triggered
 */
export function registerShortcut(switcher, key, handler) {
    if (switcher._settings.get_strv(key).length === 0) {
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

    restoreGnomeDefaults(switcher);
}
