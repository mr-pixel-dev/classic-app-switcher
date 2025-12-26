'use strict';

import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import {
    ExtensionPreferences,
    gettext as _
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class ClassicAppSwitcherPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // Get extension version from metadata.json
        const metadata = this.metadata;
        const version = metadata['version-name'] || metadata['version'] || '1.0';

        // Register custom icon directory with the icon theme
        const iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
        iconTheme.add_search_path(this.path + '/icons');

        // Check libadwaita version for Adw support & icon fallback
        const adwVersion = Adw.get_major_version() * 100 + Adw.get_minor_version();
        const isModernVersion = adwVersion >= 108; // GNOME 49+
        const useDimmedClass = adwVersion >= 107; // GNOME 48+

        function getIconName(iconName) {
            // Mapping of problematic icons to alternatives
            const iconFallbacks = {
                'keyboard-shortcuts-symbolic': isModernVersion ?
                    'keyboard-shortcuts-symbolic' : 'preferences-desktop-keyboard-shortcuts-symbolic',
                'info-outline-symbolic': isModernVersion ?
                    'info-outline-symbolic' : 'help-about-symbolic',
            };

            return iconFallbacks[iconName] || iconName;
        }

        // ============================================================
        // 1. PANEL INDICATOR PAGE
        // ============================================================
        const page = new Adw.PreferencesPage({
            title: _('Panel Indicator'),
            icon_name: 'focus-top-bar-symbolic',
        });

        // Create branded header group
        const headerGroup = new Adw.PreferencesGroup();

        // Create header box with icon and title
        const headerBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            margin_top: 24,
            margin_bottom: 24,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER
        });

        // Use the registered icon - symbolic icons will be recolored by theme
        const iconWidget = new Gtk.Image({
            icon_name: 'happy-computer-symbolic',
            pixel_size: 96,
            use_fallback: false,
        });
        headerBox.append(iconWidget);

        // Add extension name
        const titleLabel = new Gtk.Label({
            label: _('Classic App Switcher'),
            use_markup: true,
            halign: Gtk.Align.CENTER
        });
        headerBox.append(titleLabel);
        titleLabel.add_css_class('title-1');

        // Add subtitle
        const subtitleLabel = new Gtk.Label({
            label: _('Mouse friendly application switching for GNOME'),
            use_markup: true,
            halign: Gtk.Align.CENTER
        });
        subtitleLabel.add_css_class(useDimmedClass ? 'dimmed' : 'dim-label');
        headerBox.append(subtitleLabel);

        // Horizontal separator (invisible)
        const separator = new Gtk.Separator({
            orientation: Gtk.Orientation.HORIZONTAL,
        });
        headerBox.append(separator);
        separator.add_css_class('spacer');

        // Add version badge
        const versionLabel = new Gtk.Label({
            label: version.toString(),
            halign: Gtk.Align.CENTER
        });
        versionLabel.add_css_class('numeric');

        // Apply CSS
        const cssProvider = new Gtk.CssProvider();
        cssProvider.load_from_data(
            `.version-label {
        padding: 2px 10px;
        font-size: 11px;
        font-weight: 600;
        border-radius: 9999px;
        background: alpha(@accent_color, 0.15);
        color: @accent_color;
    }`,
            -1
        );

        // Add provider to display
        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default(),
            cssProvider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
        );

        // Add the class and append
        versionLabel.add_css_class('version-label');
        headerBox.append(versionLabel);

        headerGroup.add(headerBox);
        page.add(headerGroup);

        // Appearance Group
        const appearanceGroup = new Adw.PreferencesGroup({
            title: _('Appearance'),
            description: _('Customize how the switcher looks'),
        });

        // Show Label Row
        const showLabelRow = new Adw.SwitchRow({
            title: _('Show Application Name'),
            subtitle: _('Display the name of the focused application in the panel'),
        });
        settings.bind(
            'show-label',
            showLabelRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        appearanceGroup.add(showLabelRow);
        page.add(appearanceGroup);

        // Position Group
        const positionGroup = new Adw.PreferencesGroup({
            title: _('Panel Position'),
            description: _('Configure where the switcher appears in the panel'),
        });

        // Panel Box Row
        const panelBoxRow = new Adw.ComboRow({
            title: _('Panel Area'),
            subtitle: _('Choose which section of the panel to use'),
        });

        const panelBoxModel = new Gtk.StringList();
        panelBoxModel.append(_('Left'));
        panelBoxModel.append(_('Center'));
        panelBoxModel.append(_('Right'));
        panelBoxRow.model = panelBoxModel;

        // Set initial value
        const panelBoxValue = settings.get_string('panel-box');
        const boxIndex = ['left', 'center', 'right'].indexOf(panelBoxValue);
        panelBoxRow.selected = boxIndex >= 0 ? boxIndex : 2;

        // Connect change handler
        panelBoxRow.connect('notify::selected', (widget) => {
            const selected = ['left', 'center', 'right'][widget.selected];
            settings.set_string('panel-box', selected);
        });

        positionGroup.add(panelBoxRow);

        // Position Offset Row
        const positionOffsetRow = new Adw.SpinRow({
            title: _('Position Offset'),
            subtitle: _('Fine-tune position (0 = default, negative = left, positive = right)'),
            adjustment: new Gtk.Adjustment({
                lower: -10,
                upper: 10,
                step_increment: 1,
                page_increment: 1,
                value: settings.get_int('position-in-box'),
            }),
        });

        settings.bind(
            'position-in-box',
            positionOffsetRow,
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );

        positionGroup.add(positionOffsetRow);
        page.add(positionGroup);

        // Info Group
        const infoGroup = new Adw.PreferencesGroup();

        const infoBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 12,
            margin_top: 12,
            margin_bottom: 12,
            margin_start: 12,
            margin_end: 12,
        });

        const infoIcon = new Gtk.Image({
            icon_name: 'dialog-information-symbolic',
            pixel_size: 16,
        });

        const infoLabel = new Gtk.Label({
            label: _('Icon-only mode? ...try pushing the indicator to the end of the panel!'),
            tooltip_markup: _('Set the offset to <b>10</b> to place the button at the very end of the top panel'),
            wrap: true,
            xalign: 0,
            hexpand: true,
            use_markup: true,
        });
        infoLabel.add_css_class(useDimmedClass ? 'dimmed' : 'dim-label');
        infoBox.add_css_class('caption');
        infoGroup.add_css_class('card');

        infoBox.append(infoIcon);
        infoBox.append(infoLabel);
        infoGroup.add(infoBox);
        page.add(infoGroup);

        // Add the General page to the window
        window.add(page);

        // ============================================================
        // 2. KEYBOARD ACCESS PAGE
        // ============================================================
        const keyboardPage = new Adw.PreferencesPage({
            title: _('Keyboard Access'),
            icon_name: getIconName('keyboard-shortcuts-symbolic'),
        });

        // Keyboard Shortcuts Group
        const keyboardGroup = new Adw.PreferencesGroup({
            title: _('Keyboard Shortcuts'),
            description: _('Optional keyboard shortcuts for application and window management'),
        });

        // Enable Keyboard Shortcuts Row - using ActionRow to add button before switch
        const enableShortcutsRow = new Adw.ActionRow({
            title: _('Enable Keyboard Shortcuts'),
            subtitle: _('Activate custom shortcuts for enhanced window management'),
        });

        // Create info button using MenuButton (proper GTK pattern)
        const infoButton = new Gtk.MenuButton({
            icon_name: getIconName('info-outline-symbolic'),
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

        // Create popover and set it on the MenuButton
        const popover = new Gtk.Popover({
            child: popoverBox,
        });
        infoButton.set_popover(popover);

        // Create the switch manually
        const enableShortcutsSwitch = new Gtk.Switch({
            valign: Gtk.Align.CENTER,
        });

        // Track if this is the initial setup to avoid showing toast on load
        let isInitialSetup = true;

        // Connect to switch changes to show toast (skip on initial load)
        enableShortcutsSwitch.connect('notify::active', (widget) => {
            // Skip toast on initial load
            if (isInitialSetup) {
                return;
            }

            // Add Toast
            const toastOverlay = window.get_content();
            if (toastOverlay instanceof Adw.ToastOverlay) {
                const isEnabled = widget.get_active();
                const toastMessage = isEnabled ?
                    _('Keyboard shortcuts enabled') :
                    _('Keyboard shortcuts disabled');
                const toast = new Adw.Toast({
                    title: toastMessage,
                    timeout: 2,
                });
                toastOverlay.add_toast(toast);
            }
        });

        // Bind the switch to settings
        settings.bind(
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

        // Set the switch as activatable widget
        enableShortcutsRow.activatable_widget = enableShortcutsSwitch;

        // Add info button FIRST, then the switch - order matters!
        enableShortcutsRow.add_suffix(infoButton);
        enableShortcutsRow.add_suffix(enableShortcutsSwitch);

        keyboardGroup.add(enableShortcutsRow);

        // Show Menu Hints Row
        const showHintsRow = new Adw.SwitchRow({
            title: _('Show Menu Hints'),
            subtitle: _('Display shortcut key labels next to menu items'),
        });
        settings.bind(
            'show-menu-hints',
            showHintsRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        // Bind sensitivity to enable-keyboard-shortcuts
        settings.bind(
            'enable-keyboard-shortcuts',
            showHintsRow,
            'sensitive',
            Gio.SettingsBindFlags.GET
        );

        keyboardGroup.add(showHintsRow);
        keyboardPage.add(keyboardGroup);

        const shortcutsGroup = new Adw.PreferencesGroup({
            title: _('Configuration'),
            description: _('The following shortcuts are available when enabled above')
        });

        // Shortcut Reference Group - Version-aware implementation
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

        // Check if we can use native AdwShortcutLabel (GNOME 49+)
        const hasShortcutLabel = adwVersion >= 108;

        if (hasShortcutLabel) {
            // Modern implementation - Uses native Adw.ShortcutLabel
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

        keyboardPage.add(shortcutsGroup);

        // Warning Group
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
            label: _('Activating this option will override GNOME <sup>*</sup>default system shortcuts'),
            tooltip_markup: _('All shortcuts will be restored to their defaults when this option is deactivated and if this extension is disabled or removed'),
            wrap: true,
            xalign: 0,
            hexpand: true,
            use_markup: true,
        });
        warningGroup.add_css_class('card');
        warningBox.add_css_class('caption');
        warningLabel.add_css_class(useDimmedClass ? 'dimmed' : 'dim-label');

        warningBox.append(warningIcon);
        warningBox.append(warningLabel);
        warningGroup.add(warningBox);
        keyboardPage.add(warningGroup);

        // Add the Keyboard Shortcuts page to the window
        window.add(keyboardPage);
    }
}
