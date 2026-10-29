'use strict';

/**
 * @fileoverview Panel Page for Classic App Switcher preferences.
 *
 * Configures appearance, position, and menu options for the top panel indicator.
 *
 * @module panelPage
 */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import GObject from 'gi://GObject';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

/**
 * Preferences page displaying appearance and positioning of the panel indicator
 *
 * @class
 * @extends Adw.PreferencesPage
 */
export class PanelPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(
            {
                GTypeName: 'ClassicAppSwitcherPanelPage',
            },
            this
        );
    }

    /**
     * @param {Gio.Settings} settings - Extension GSettings instance
     */
    constructor(settings) {
        super({
            title: _('Panel'),
            icon_name: 'focus-top-bar-symbolic',
            name: 'PanelPage',
        });

        /** @private @type {Gio.Settings} */
        this._settings = settings;

        // Check libadwaita version for compatibility
        const adwVersion =
            Adw.get_major_version() * 100 + Adw.get_minor_version();
        /** @private @type {boolean} */
        this._useDimmedClass = adwVersion >= 107; // GNOME 48+

        this._buildIndicatorGroup();
        this._buildMenuGroup();
        this._buildPositionGroup();
        this._buildInfoGroup();
    }

    /**
     * Build indicator presentation group (application label toggle)
     *
     * @private
     * @returns {void}
     */
    _buildIndicatorGroup() {
        const indicatorGroup = new Adw.PreferencesGroup({
            title: _('Indicator'),
            description: _('Customize the panel button appearance'),
        });

        // Show Label Row
        const showLabelRow = new Adw.SwitchRow({
            title: _('Show Application Name'),
            subtitle: _(
                'Display the name of the focused application in the panel'
            ),
        });
        this._settings.bind(
            'show-label',
            showLabelRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        indicatorGroup.add(showLabelRow);

        this.add(indicatorGroup);
    }

    /**
     * Build popup menu options group (boxpointer visibility)
     *
     * @private
     * @returns {void}
     */
    _buildMenuGroup() {
        const menuGroup = new Adw.PreferencesGroup({
            title: _('Switcher'),
            description: _('Customize the menu appearance'),
        });

        // Hide Boxpointer Row
        const hideBoxpointerRow = new Adw.SwitchRow({
            title: _('Hide Boxpointer'),
            subtitle: _('Do not show the menu arrow'),
        });
        this._settings.bind(
            'hide-boxpointer',
            hideBoxpointerRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        menuGroup.add(hideBoxpointerRow);

        // Create info button
        const infoButton = new Gtk.MenuButton({
            icon_name: 'info-outline-symbolic',
            tooltip_text: _('More Information'),
            valign: Gtk.Align.CENTER,
        });
        infoButton.add_css_class('flat');

        // Create popover content
        const popoverBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 6,
            margin_start: 6,
            margin_end: 6,
        });

        const popoverLabel = new Gtk.Label({
            label: _(
                'The switcher menu can be toggled from the desktop by pressing Super+F allowing keyboard interaction.'
            ),
            wrap: true,
            max_width_chars: 40,
            xalign: 0,
        });

        popoverBox.append(popoverLabel);

        const popover = new Gtk.Popover({
            child: popoverBox,
        });
        infoButton.set_popover(popover);

        menuGroup.header_suffix = infoButton;

        this.add(menuGroup);
    }

    /**
     * Build top panel positioning options group (left/center/right box, index offset)
     *
     * @private
     * @returns {void}
     */
    _buildPositionGroup() {
        const positionGroup = new Adw.PreferencesGroup({
            title: _('Position'),
            description: _(
                'Configure where the indicator appears in the panel'
            ),
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
        const panelBoxValue = this._settings.get_string('panel-box');
        const boxIndex = ['left', 'center', 'right'].indexOf(panelBoxValue);
        panelBoxRow.selected = boxIndex >= 0 ? boxIndex : 2;

        // Connect change handler
        panelBoxRow.connect('notify::selected', widget => {
            const selected = ['left', 'center', 'right'][widget.selected];
            this._settings.set_string('panel-box', selected);
        });

        positionGroup.add(panelBoxRow);

        // Position Offset Row
        const positionOffsetRow = new Adw.SpinRow({
            title: _('Position Offset'),
            subtitle: _(
                'Fine-tune position (0 = default, negative = left, positive = right)'
            ),
            adjustment: new Gtk.Adjustment({
                lower: -10,
                upper: 10,
                step_increment: 1,
                page_increment: 1,
                value: this._settings.get_int('position-in-box'),
            }),
        });

        this._settings.bind(
            'position-in-box',
            positionOffsetRow,
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );

        positionGroup.add(positionOffsetRow);
        this.add(positionGroup);
    }

    /**
     * Build informational tip footer regarding panel positioning
     *
     * @private
     * @returns {void}
     */
    _buildInfoGroup() {
        const infoGroup = new Adw.PreferencesGroup();

        const infoBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 12,
            margin_top: 12,
            margin_bottom: 12,
            margin_start: 12,
            margin_end: 12,
        });
        infoBox.add_css_class('caption');

        const infoIcon = new Gtk.Image({
            icon_name: 'dialog-information-symbolic',
            pixel_size: 16,
        });

        const infoLabel = new Gtk.Label({
            label: _(
                'Icon-only mode? ...try pushing the indicator to the end of the panel'
            ),
            tooltip_markup: _(
                'Set the offset to <b>10</b> to place the button at the very end of the top panel'
            ),
            wrap: true,
            xalign: 0,
            hexpand: true,
            use_markup: true,
        });
        infoLabel.add_css_class(this._useDimmedClass ? 'dimmed' : 'dim-label');

        infoGroup.add_css_class('card');

        infoBox.append(infoIcon);
        infoBox.append(infoLabel);
        infoGroup.add(infoBox);
        this.add(infoGroup);
    }
}

