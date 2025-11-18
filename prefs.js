'use strict';

import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class ClassicAppSwitcherPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        
        // Register custom icon directory with the icon theme
        const iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
        iconTheme.add_search_path(this.path + '/icons');
        
        // Create the main preferences page
        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'dialog-information-symbolic',
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
        
        // Use the registered icon - will be recolored by theme
        const iconWidget = new Gtk.Image({
            icon_name: 'happy-computer-symbolic',
            pixel_size: 96,
            use_fallback: false
        });
        
        headerBox.append(iconWidget);
        
        // Add extension name
        const titleLabel = new Gtk.Label({
            label: '<span size="x-large" weight="bold">' + _('Classic App Switcher') + '</span>',
            use_markup: true,
            halign: Gtk.Align.CENTER
        });
        headerBox.append(titleLabel);
        
        // Add subtitle
        const subtitleLabel = new Gtk.Label({
            label: _('Mac OS 9-style application switching for GNOME'),
            halign: Gtk.Align.CENTER
        });
        subtitleLabel.add_css_class('dim-label');
        headerBox.append(subtitleLabel);
        
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
        
        // Add the page to the window
        window.add(page);
    }
}
