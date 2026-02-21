'use strict';

import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import * as SwitcherMenu from './switcherMenu.js';
import * as WindowManager from './windowManager.js';

/**
 * Keyboard Shortcuts - Manages optional keyboard shortcuts for app management
 * All functions receive the switcher instance as first parameter
 */

/**
 * Override GNOME default keybindings that conflict with our shortcuts
 * - Disables GNOME's 'hide' window (win.minimized) as we use Super+H for hide app and Super+M for minimize window
 * - Unbinds redundant Super+M from Notification list, official default is Super+V
 */
export function overrideGnomeDefaults() {
    const wmSettings = new Gio.Settings({
        schema_id: 'org.gnome.desktop.wm.keybindings'
    });
    const shellSettings = new Gio.Settings({
        schema_id: 'org.gnome.shell.keybindings'
    });

    // Disable GNOME's minimize shortcut (conflicts with our Super+M)
    wmSettings.set_strv('minimize', []);

    // Move GNOME's message tray from Super+M to Super+V
    shellSettings.reset('toggle-message-tray');
    shellSettings.set_strv('toggle-message-tray', ['<Super>v']);
}

/**
 * Register a keyboard shortcut with error handling
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 * @param {string} key - The shortcut key from settings schema
 * @param {Function} handler - The handler function to call when shortcut is triggered
 */
export function registerShortcut(switcher, key, handler) {
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
    overrideGnomeDefaults();

    // Register all shortcuts from structured definition
    // Each shortcut maps a settings key to its handler method
    const shortcuts = [{
            key: 'hide-current-app',
            handler: () => WindowManager.hideCurrentApp(switcher)
        },
        {
            key: 'hide-others',
            handler: () => WindowManager.hideOthers(switcher)
        },
        {
            key: 'show-recent-app',
            handler: () => WindowManager.showRecentApp(switcher)
        },
        {
            key: 'show-all-apps',
            handler: () => WindowManager.showAll(switcher)
        },
        {
            key: 'minimize-current-window',
            handler: () => WindowManager.minimizeCurrentWindow(switcher)
        },
        {
            key: 'unminimize-recent-window',
            handler: () => WindowManager.unminimizeRecentWindow(switcher)
        },
        {
            key: 'close-current-window',
            handler: () => WindowManager.closeCurrentWindow(switcher)
        },
        {
            key: 'quit-current-app',
            handler: () => WindowManager.quitCurrentApp(switcher)
        },
    ];

    // Register each shortcut with error handling
    shortcuts.forEach(shortcut => registerShortcut(switcher, shortcut.key, shortcut.handler));
}

/**
 * Reload keyboard shortcuts when setting changes
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 */
export function reloadShortcuts(switcher) {
    const shortcutsEnabled = switcher._settings.get_boolean('enable-keyboard-shortcuts');

    if (!shortcutsEnabled) {
        // User DISABLED shortcuts - clean up!
        cleanupKeybindings(switcher);
    } else {
        // User ENABLED shortcuts - set them up!
        setupKeyboardShortcuts(switcher);
    }

    // Rebuild the switcher actions section (where hints appear)
    SwitcherMenu.buildSwitcherActions(switcher);
    switcher._update();
}

/**
 * Clean up keyboard shortcuts and restore GNOME defaults
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 */
export function cleanupKeybindings(switcher) {
    // Remove our custom keybindings
    switcher._keyBindingIds.forEach(id => {
        Main.wm.removeKeybinding(id);
    });
    switcher._keyBindingIds = [];

    // Reset GNOME defaults
    const wmSettings = new Gio.Settings({
        schema_id: 'org.gnome.desktop.wm.keybindings'
    });
    wmSettings.reset('minimize');

    const shellSettings = new Gio.Settings({
        schema_id: 'org.gnome.shell.keybindings'
    });
    shellSettings.reset('toggle-message-tray');
}
