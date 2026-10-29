'use strict';

/**
 * @fileoverview Extension preferences entry point for Classic App Switcher GNOME extension.
 *
 * Registers icon resources with GTK's display icon theme, initializes GSettings,
 * and populates the Libadwaita PreferencesWindow with preferences sub-pages.
 *
 * @module prefs
 */

import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {AboutPage} from './settings/aboutPage.js';
import {PanelPage} from './settings/panelPage.js';
import {AccessibilityPage} from './settings/accessibilityPage.js';

/**
 * Preferences entry class for Classic App Switcher GNOME Shell extension
 *
 * @class
 * @extends ExtensionPreferences
 */
export default class ClassicAppSwitcherPrefs extends ExtensionPreferences {
    /**
     * Populate the preferences window with custom preference pages
     *
     * Called by GNOME Shell when opening extension settings.
     * Loads icon gresource bundle, binds gresource path to GTK display theme,
     * initializes GSettings on the window, and appends sub-page widgets.
     *
     * @override
     * @param {Adw.PreferencesWindow} window - Libadwaita preferences window handle
     * @returns {void}
     */

    fillPreferencesWindow(window) {
        // Load and register the resource bundle
        /** @type {Gio.Resource} */
        const resource = Gio.Resource.load(`${this.path}/resources.gresource`);
        Gio.resources_register(resource);

        // Register custom icons so Gtk can find them in prefs context
        /** @type {Gtk.IconTheme} */
        const iconTheme = Gtk.IconTheme.get_for_display(
            Gdk.Display.get_default()
        );
        iconTheme.add_resource_path(
            '/org/gnome/shell/extensions/classic-app-switcher/icons'
        );

        /** @type {Gio.Settings} */
        window._settings = this.getSettings();

        window.add(new AboutPage(window._settings, this.metadata));
        window.add(new PanelPage(window._settings, window));
        window.add(new AccessibilityPage(window._settings));
    }
}

