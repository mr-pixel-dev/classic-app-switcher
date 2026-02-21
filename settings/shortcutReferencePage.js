'use strict';

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import GObject from 'gi://GObject';

import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

/**
 * Keyboard Shortcuts Reference Dialog
 * Displays available keyboard shortcuts in a window
 */
export class KeyboardShortcutsDialog extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    constructor() {
        super({
            title: _('Keyboard Shortcuts'),
            icon_name: 'keyboard-shortcuts-symbolic',
            name: 'KeyboardShortcutsPage',
        });

        // Check libadwaita version for compatibility
        const adwVersion = Adw.get_major_version() * 100 + Adw.get_minor_version();
        this._isModernVersion = adwVersion >= 108; // GNOME 49+

        this._buildShortcutsGroup();
    }

    _buildShortcutsGroup() {
        const shortcutsGroup = new Adw.PreferencesGroup();

        const shortcuts = [{
                keys: ['Super', 'H'],
                accelerator: '<Super>H',
                desc: _('Hide the current application<sup>*</sup>'),
                tooltipText: _('Assigned to <b>Hide window</b> by default')
            },
            {
                keys: ['Alt', 'Super', 'H'],
                accelerator: '<Alt>&<Super>H',
                desc: _('Hide all other applications')
            },
            {
                keys: ['Super', 'U'],
                accelerator: '<Super>U',
                desc: _('Show most recently hidden application')
            },
            {
                keys: ['Alt', 'Super', 'U'],
                accelerator: '<Alt>&<Super>U',
                desc: _('Show all hidden applications/windows')
            },
            {
                keys: ['Super', 'M'],
                accelerator: '<Super>M',
                desc: _('Minimize the current window<sup>*</sup>'),
                tooltipText: _('Assigned to <b>Show the notification list</b> by default')
            },
            {
                keys: ['Alt', 'Super', 'M'],
                accelerator: '<Alt>&<Super>M',
                desc: _('Unminimize most recently minimized window')
            },
            {
                keys: ['Super', 'W'],
                accelerator: '<Super>W',
                desc: _('Close the current window')
            },
            {
                keys: ['Super', 'Q'],
                accelerator: '<Super>Q',
                desc: _('Quit the current application')
            },
        ];

        if (this._isModernVersion) {
            // Modern implementation - Uses native Adw.ShortcutLabel (GNOME 49+)
            shortcuts.forEach(shortcut => {
                const shortcutRow = new Adw.ActionRow({
                    title: shortcut.desc,
                    use_markup: true,
                    activatable: false,
                });

                const shortcutLabel = new Adw.ShortcutLabel({
                    accelerator: shortcut.accelerator,
                    valign: Gtk.Align.CENTER,
                });

                if (shortcut.tooltipText) {
                    shortcutRow.set_tooltip_markup(shortcut.tooltipText);
                }

                shortcutRow.add_suffix(shortcutLabel);
                shortcutsGroup.add(shortcutRow);
            });
        } else {
            // Legacy implementation - Custom buttons for GNOME 47/48
            this._applyLegacyKeybindingStyles();

            shortcuts.forEach(shortcut => {
                const shortcutRow = new Adw.ActionRow({
                    title: shortcut.desc,
                    use_markup: true,
                    activatable: false,
                });

                const keyBox = new Gtk.Box({
                    orientation: Gtk.Orientation.HORIZONTAL,
                    spacing: 4,
                    valign: Gtk.Align.CENTER,
                });
                keyBox.add_css_class('key-box');

                shortcut.keys.forEach(key => {
                    const keyLabel = new Gtk.Label({
                        label: key,
                        halign: Gtk.Align.CENTER,
                        valign: Gtk.Align.CENTER,
                    });

                    const keyButton = new Gtk.Button({
                        child: keyLabel,
                        can_focus: false,
                        valign: Gtk.Align.CENTER,
                    });

                    if (key.length > 1) {
                        keyLabel.set_margin_start(2);
                        keyLabel.set_margin_end(2);
                    }

                    keyButton.add_css_class('key-button');
                    keyBox.append(keyButton);
                });

                if (shortcut.tooltipText) {
                    shortcutRow.set_tooltip_markup(shortcut.tooltipText);
                }

                shortcutRow.add_suffix(keyBox);
                shortcutsGroup.add(shortcutRow);
            });
        }

        this.add(shortcutsGroup);
    }

    _applyLegacyKeybindingStyles() {
        const provider = new Gtk.CssProvider();
        provider.load_from_data(
            `.key-button {
                font-weight: 400;
                padding: 3px 4px;
                margin: 0 1px;
                min-width: 24px;
                border-radius: 6px;
                background-color: alpha(@window_fg_color, 0.1);
                color: @window_fg_color;
                box-shadow: inset 0 -2px alpha(@window_fg_color, 0.08);
            }
            .key-box {
                margin: -1px;
            }`,
            -1
        );

        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default(),
            provider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
        );
    }
}
