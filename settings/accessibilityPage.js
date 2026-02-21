'use strict';

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import GObject from 'gi://GObject';

import {
    gettext as _
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {
    KeyboardShortcutsDialog
} from './shortcutReferencePage.js';

/**
 * Accessibility Settings Page
 * Keyboard shortcuts and visual aids for improved usability
 */
export class AccessibilityPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    constructor(settings) {
        super({
            title: _('Accessibility'),
            icon_name: 'user-accessibility-symbolic',
            name: 'AccessibilityPage',
        });

        this._settings = settings;

        this._buildKeyboardGroup();
        this._buildShortcutsGroup();
        this._buildVisualAidsGroup();
        this._buildWarningGroup();
    }

    _buildKeyboardGroup() {
        const keyboardGroup = new Adw.PreferencesGroup({
            title: _('Keyboard Shortcuts'),
            description: _('Optional keyboard shortcuts for application and window management'),
        });

        // Enable Keyboard Shortcuts Row
        const enableShortcutsRow = new Adw.ActionRow({
            title: _('Enable Keyboard Shortcuts'),
            subtitle: _('Activate custom shortcuts for enhanced window management'),
        });

        // Create info button
        const infoButton = new Gtk.MenuButton({
            icon_name: 'info-outline-symbolic',
            tooltip_text: _('More Information'),
            valign: Gtk.Align.CENTER,
            has_frame: false,
        });

        // Create popover content
        const popoverBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 6,
            margin_start: 6,
            margin_end: 6,
        });

        const popoverLabel = new Gtk.Label({
            label: _('🪤 Super+H and Super+M will be temporarily remapped while this option is enabled. To access the notification list please use Super+V which is the official shortcut shown in GNOME Settings. 🐁'),
            wrap: true,
            max_width_chars: 40,
            xalign: 0,
        });

        popoverBox.append(popoverLabel);

        const popover = new Gtk.Popover({
            child: popoverBox,
        });
        infoButton.set_popover(popover);

        // Create the switch
        const enableShortcutsSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });

        // Track if this is the initial setup to avoid showing toast on load
        let isInitialSetup = true;

        // Connect to switch changes to show toast
        enableShortcutsSwitch.connect('notify::active', (widget) => {
            if (isInitialSetup) return;

            // The preferences window itself
            const prefsWindow = this.get_root();

            if (prefsWindow && prefsWindow.add_toast) {
                const isEnabled = widget.get_active();
                const toastMessage = isEnabled ?
                    _('Keyboard shortcuts enabled') :
                    _('Keyboard shortcuts disabled');
                const toast = new Adw.Toast({
                    title: toastMessage,
                    timeout: 2,
                });
                prefsWindow.add_toast(toast);
            }
        });

        // Bind the switch to settings
        this._settings.bind(
            'enable-keyboard-shortcuts',
            enableShortcutsSwitch,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        // Mark initial setup as complete after bind finishes
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            isInitialSetup = false;
            return GLib.SOURCE_REMOVE;
        });

        enableShortcutsRow.activatable_widget = enableShortcutsSwitch;
        enableShortcutsRow.add_suffix(infoButton);
        enableShortcutsRow.add_suffix(enableShortcutsSwitch);

        keyboardGroup.add(enableShortcutsRow);

        // Show Menu Hints Row
        const showHintsRow = new Adw.SwitchRow({
            title: _('Show Menu Hints'),
            subtitle: _('Display shortcut key labels next to menu items'),
        });
        this._settings.bind(
            'show-menu-hints',
            showHintsRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        // Bind sensitivity to enable-keyboard-shortcuts
        this._settings.bind(
            'enable-keyboard-shortcuts',
            showHintsRow,
            'sensitive',
            Gio.SettingsBindFlags.GET
        );

        keyboardGroup.add(showHintsRow);
        this.add(keyboardGroup);
    }

    _buildShortcutsGroup() {
        const shortcutsGroup = new Adw.PreferencesGroup();

        const referenceRow = new Adw.ActionRow({
            title: _('Keyboard Access'),
            subtitle: _('View available shortcuts'),
            activatable: true,
        });
        referenceRow.add_suffix(new Gtk.Image({
            icon_name: 'go-next-symbolic',
            valign: Gtk.Align.CENTER,
        }));
        referenceRow.add_prefix(new Gtk.Image({
            icon_name: 'keyboard-shortcuts-symbolic',
            valign: Gtk.Align.CENTER,
        }));
        referenceRow.connect('activated', () => {
            this._showShortcutsDialog();
        });
        shortcutsGroup.add(referenceRow);

        this.add(shortcutsGroup);
    }

    _showShortcutsDialog() {
        // If a window already exists, destroy it first
        if (this._shortcutsWindow) {
            this._shortcutsWindow.close();
            this._shortcutsWindow = null;
        }

        const shortcutsDialog = new KeyboardShortcutsDialog();

        const headerBar = new Adw.HeaderBar({
            show_back_button: false,
        });

        const toolbarView = new Adw.ToolbarView();
        toolbarView.add_top_bar(headerBar);
        toolbarView.set_content(shortcutsDialog);

        // Create modal window
        const window = new Adw.Window({
            modal: true,
            transient_for: this.get_root(),
            default_width: 600,
            default_height: 550,
            title: _('Shortcuts'),
            content: toolbarView,
        });

        // Store reference for cleanup
        this._shortcutsWindow = window;

        // Ensure proper cleanup on close
        window.connect('close-request', () => {
            this._shortcutsWindow = null;
            return false; // Allow normal closure
        });

        window.present();
    }

    _buildVisualAidsGroup() {
        const visualAidsGroup = new Adw.PreferencesGroup({
            title: _('Visual Aids'),
            description: _('Enhance visual clarity and reduce distractions'),
        });

        // Enable Overview Effects
        const effectsRow = new Adw.SwitchRow({
            title: _('Enable Overview Effects'),
            subtitle: _('Apply visual effects to windows in overview for improved distinction'),
        });
        this._settings.bind(
            'enable-overview-effects',
            effectsRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        visualAidsGroup.add(effectsRow);

        // Hide windows from overview
        const hideFromOverviewRow = new Adw.SwitchRow({
            title: _('Hide Applications in Overview'),
            subtitle: _('Hidden apps will not appear in activities overview, reducing visual noise'),
        });
        this._settings.bind(
            'hide-windows-from-overview',
            hideFromOverviewRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        visualAidsGroup.add(hideFromOverviewRow);

        this.add(visualAidsGroup);
    }

    _buildWarningGroup() {
        const warningGroup = new Adw.PreferencesGroup();

        const warningBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 12,
            margin_top: 12,
            margin_bottom: 12,
            margin_start: 12,
            margin_end: 12,
        });

        const warningIcon = new Gtk.Image({
            icon_name: 'dialog-warning-symbolic',
            pixel_size: 16,
        });

        const warningLabel = new Gtk.Label({
            label: _('Activating this option will override GNOME default system shortcuts'),
            tooltip_markup: _('All shortcuts will be restored to their defaults when this option is deactivated and if this extension is disabled or removed'),
            wrap: true,
            xalign: 0,
            hexpand: true,
            use_markup: true,
        });

        // Check libadwaita version for compatibility
        const adwVersion = Adw.get_major_version() * 100 + Adw.get_minor_version();
        const useDimmedClass = adwVersion >= 107; // GNOME 48+

        warningGroup.add_css_class('card');
        warningLabel.add_css_class('caption');
        warningLabel.add_css_class(useDimmedClass ? 'dimmed' : 'dim-label');

        warningBox.append(warningIcon);
        warningBox.append(warningLabel);
        warningGroup.add(warningBox);
        this.add(warningGroup);
    }
}
