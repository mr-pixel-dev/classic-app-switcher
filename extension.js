'use strict';

import Gio from 'gi://Gio';
import {
    Extension
} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    ClassicAppSwitcher
} from './indicator.js';
import * as WindowManager from './windowManager.js';
import * as KeyboardShortcuts from './keyboardShortcuts.js';

/**
 * Classic App Switcher v3.0
 * Mouse-friendly application switching for GNOME
 * 
 * Main extension entry point - handles enable/disable lifecycle
 */
export default class ClassicAppSwitcherExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._switcher = new ClassicAppSwitcher(this._settings, this);

        // Load resource file
        this._resource = Gio.Resource.load(`${this.path}/data/resources.gresource`);
        Gio.resources_register(this._resource);

        // Add to panel - positioning handled by _applySettings in _init
        Main.panel.addToStatusArea(`${this.uuid}-switcher`, this._switcher);

        // Setup keyboard shortcuts if enabled
        if (this._settings.get_boolean('enable-keyboard-shortcuts')) {
            KeyboardShortcuts.setupKeyboardShortcuts(this._switcher);
        }

        // ALWAYS enable hide handling (animations + optional effects)
        WindowManager.enableHideHandling(this);

        // ALWAYS enable minimized effect handler (checks toggle internally)
        WindowManager.enableMinimizedEffect(this);

    }

    disable() {
        // Unregister resource
        if (this._resource) {
            Gio.resources_unregister(this._resource);
            this._resource = null;
        }
        if (this._switcher) {
            this._switcher.destroy();
            delete this._switcher;
        }
        this._settings = null;
    }
}
