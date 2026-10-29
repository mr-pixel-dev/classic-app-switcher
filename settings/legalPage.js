'use strict';

/**
 * @fileoverview Legal/Licensing page widget for Classic App Switcher GNOME extension preferences.
 *
 * Displays the full GNU General Public License (GPL v3) text in a styled monospace view.
 *
 * @module legalPage
 */

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

/**
 * Preferences page displaying GPL v3 licensing information
 *
 * @class
 * @extends Adw.PreferencesPage
 */
export class LegalPage extends Adw.PreferencesPage {
    /** @static @private @type {boolean} Tracker flag ensuring CSS is registered only once */
    static _cssLoaded = false;

    static {
        GObject.registerClass({GTypeName: 'ClassicAppSwitcherLegalPage'}, this);
    }

    /**
     * Create a new LegalPage instance
     *
     * @param {Gio.Settings} settings - Extension GSettings instance
     */
    constructor(settings) {
        super({
            title: _('Legal'),
            icon_name: 'license-symbolic',
            name: 'LegalPage',
        });

        /** @private @type {Gio.Settings} */
        this._settings = settings;

        if (!LegalPage._cssLoaded) {
            this._initStyles();
            LegalPage._cssLoaded = true;
        }

        this._buildLicenseGroup();
    }

    /**
     * Initialize application CSS provider for TextView background transparency and monospace styling
     *
     * @private
     * @returns {void}
     */
    _initStyles() {
        const css = `
            textview.view,
            textview.view > text {
                background-color: transparent;
            }
            .monospace {
                font-family: monospace;
            }`;

        const provider = new Gtk.CssProvider();
        provider.load_from_data(css, -1);

        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default(),
            provider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
        );
    }

    /**
     * Build preferences group containing the GPL v3 license text view
     *
     * @private
     * @returns {void}
     */
    _buildLicenseGroup() {
        const licenseGroup = new Adw.PreferencesGroup();

        // 1. Create a container explicitly for the card styling
        const cardBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
        });

        cardBox.add_css_class('card');

        const licenseTextView = new Gtk.TextView({
            editable: false,
            cursor_visible: false,
            wrap_mode: Gtk.WrapMode.WORD,
            justification: Gtk.Justification.FILL,
            accepts_tab: false,
            margin_start: 12,
            margin_end: 12,
            margin_top: 12,
            margin_bottom: 12,
        });

        licenseTextView.add_css_class('monospace');

        licenseTextView
            .get_buffer()
            .set_text(
                'GNU GENERAL PUBLIC LICENSE\n' +
                    'Version 3, 29 June 2007\n\n' +
                    'Copyright © 2007 Free Software Foundation, Inc. <https://fsf.org/>\n' +
                    'Everyone is permitted to copy and distribute verbatim copies of this ' +
                    'license document, but changing it is not allowed.\n\n' +
                    'Preamble\n\n' +
                    'The GNU General Public License is a free, copyleft license for ' +
                    'software and other kinds of works.\n\n' +
                    'The licenses for most software and other practical works are designed ' +
                    'to take away your freedom to share and change the works. By contrast, ' +
                    'the GNU General Public License is intended to guarantee your freedom ' +
                    'to share and change all versions of a program--to make sure it remains ' +
                    'free software for all its users.\n\n' +
                    'This program is distributed in the hope that it will be useful, but ' +
                    'WITHOUT ANY WARRANTY; without even the implied warranty of ' +
                    'MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU ' +
                    'General Public License for more details.\n\n' +
                    'You should have received a copy of the GNU General Public License ' +
                    'along with this program. If not, see <https://www.gnu.org/licenses/>.',
                -1
            );

        cardBox.append(licenseTextView);
        licenseGroup.add(cardBox);

        this.add(licenseGroup);
    }
}

