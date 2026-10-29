'use strict';

/**
 * @fileoverview Main extension entry point - handles enable/disable lifecycle.
 *
 * Manages extension lifecycle events (enable/disable), loads gresource icon bundles,
 * initializes GSettings, and adds the status area indicator to the GNOME Shell top panel.
 *
 * @module extension
 */

import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {ClassicAppSwitcher} from './indicator.js';
import * as EventHandlers from './eventHandlers.js';
import * as KeyboardShortcuts from './keyboardShortcuts.js';

/**
 * Main extension entry class handling extension lifecycle events
 *
 * @class
 * @extends Extension
 */
export default class ClassicAppSwitcherExtension extends Extension {
    /**
     * Enable the extension
     *
     * Called by GNOME Shell when the extension is enabled.
     * Loads resource bundle, initializes settings and indicator widget,
     * adds widget to top panel status area, and enables window/keyboard handlers.
     *
     * @override
     * @returns {void}
     */
    enable() {
        /** @type {Gio.Settings} */
        this._settings = this.getSettings();

        /** @type {ClassicAppSwitcher} */
        this._switcher = new ClassicAppSwitcher(this._settings, this);

        // Load resource file
        /** @type {Gio.Resource} */
        this._resource = Gio.Resource.load(`${this.path}/resources.gresource`);
        Gio.resources_register(this._resource);

        // Add to panel (default is 0, panelRight)
        const position = this._settings.get_int('position-in-box');
        const box = this._settings.get_string('panel-box');

        Main.panel.addToStatusArea(this.uuid, this._switcher, position, box);

        // Setup Switcher Hotkey
        Main.wm.addKeybinding(
            'toggle-switcher',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL |
                Shell.ActionMode.OVERVIEW |
                Shell.ActionMode.POPUP,
            () => EventHandlers.toggleSwitcherMenu(this._switcher)
        );

        // Setup keyboard shortcuts if enabled
        if (this._settings.get_boolean('enable-keyboard-shortcuts')) {
            KeyboardShortcuts.setupKeyboardShortcuts(this._switcher);
        }

        // Check for Dash It! compatibility on startup and runtime changes
        this._shellSettings = new Gio.Settings({schema_id: 'org.gnome.shell'});

        const checkDashIt = () => {
            const enabledExtensions =
                this._shellSettings.get_strv('enabled-extensions');
            const dashItUuid = 'dash-it@mr-pixel-dev';

            if (enabledExtensions.includes(dashItUuid)) {
                // Automatically force-disable conflicting features
                if (this._settings.get_boolean('enable-overview-effects')) {
                    this._settings.set_boolean(
                        'enable-overview-effects',
                        false
                    );
                }
                if (this._settings.get_boolean('hide-windows-from-overview')) {
                    this._settings.set_boolean(
                        'hide-windows-from-overview',
                        false
                    );
                }
            }
        };

        // Run immediately on startup to catch already-active Dash It!
        checkDashIt();

        // Listen for runtime changes if Dash It! is toggled later
        this._shellSettingsId = this._shellSettings.connect(
            'changed::enabled-extensions',
            checkDashIt
        );
    }

    /**
     * Disable the extension
     *
     * Called by GNOME Shell when the extension is disabled or during unload.
     * Unregisters resource bundle, destroys indicator widget, and clears settings.
     *
     * @override
     * @returns {void}
     */
    disable() {
        // Unbind hotkey
        Main.wm.removeKeybinding('toggle-switcher');

        // Disconnect shell settings listener
        if (this._shellSettingsId) {
            this._shellSettings.disconnect(this._shellSettingsId);
            this._shellSettingsId = null;
        }
        this._shellSettings = null;

        // Unregister resource
        if (this._resource) {
            Gio.resources_unregister(this._resource);
            this._resource = null;
        }
        if (this._switcher) {
            this._switcher.destroy();
            // delete this._switcher;
            this._switcher = null;
        }
        this._settings = null;
    }
}

