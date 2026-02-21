'use strict';

import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {
    ExtensionPreferences
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {
    AboutPage
} from './settings/aboutPage.js';
import {
    PanelPage
} from './settings/panelPage.js';
import {
    AccessibilityPage
} from './settings/accessibilityPage.js';

/**
 * Classic App Switcher Preferences
 * Main entry point for the preferences window
 */
export default class ClassicAppSwitcherPrefs extends ExtensionPreferences {

    fillPreferencesWindow(window) {
        // 1. Load and Register the actual data bundle
        const resource = Gio.Resource.load(`${this.path}/data/resources.gresource`);
        Gio.resources_register(resource);

        // 2. Tell the Icon Theme specifically to look inside the resource for icons
        const iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
        iconTheme.add_resource_path('/org/gnome/shell/extensions/classic-app-switcher/icons');

        window._settings = this.getSettings();

        const aboutPage = new AboutPage(window._settings, this.metadata, this.path);
        const panelPage = new PanelPage(window._settings);
        const accessibilityPage = new AccessibilityPage(window._settings);

        window.add(aboutPage);
        window.add(panelPage);
        window.add(accessibilityPage);
    }
}
