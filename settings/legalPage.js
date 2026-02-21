'use strict';

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import GObject from 'gi://GObject';

import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

/**
 * Legal Page
 * License information
 */
export class LegalPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    constructor(settings, metadata) {
        super({
            title: _('Legal'),
            icon_name: 'license-symbolic',
            name: 'LegalPage',
        });

        this._settings = settings;
        this._metadata = metadata;

        this._buildLicenseGroup();
    }

    _buildLicenseGroup() {
        const licenseGroup = new Adw.PreferencesGroup({
//            title: _('License'),
//            description: _('This extension is licensed under GPLv3'),
        });

        // Just use TextView directly - the PreferencesPage handles scrolling
        const licenseTextView = new Gtk.TextView({
            editable: false,
            cursor_visible: false,
            wrap_mode: Gtk.WrapMode.WORD,
            justification: Gtk.Justification.FILL,
            margin_top: 12,
            margin_bottom: 12,
            margin_start: 12,
            margin_end: 12,
            vexpand: true,
        });
        
            // Apply CSS for TextView
            const cssProvider = new Gtk.CssProvider();
            cssProvider.load_from_data(
                `.view {
                background: inherit;
                padding: 0;
                margin: 0;
            }`,
                -1
            );

            Gtk.StyleContext.add_provider_for_display(
                Gdk.Display.get_default(),
                cssProvider,
                Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
            );

        const buffer = licenseTextView.get_buffer();
        buffer.set_text(
            "GNU GENERAL PUBLIC LICENSE\n" +
            "Version 3, 29 June 2007\n\n" +
            "Copyright © 2007 Free Software Foundation, Inc. <https://fsf.org/>\n" +
            "Everyone is permitted to copy and distribute verbatim copies of this license document, but changing it is not allowed.\n\n" +
            "Preamble\n\n" +
            "The GNU General Public License is a free, copyleft license for software and other kinds of works.\n\n" +
            "The licenses for most software and other practical works are designed to take away your freedom to share and change the works. By contrast, the GNU General Public License is intended to guarantee your freedom to share and change all versions of a program--to make sure it remains free software for all its users.\n\n" +
            "This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.\n\n" +
            "You should have received a copy of the GNU General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.",
            -1
        );

        licenseGroup.add_css_class('card');
        licenseGroup.add(licenseTextView);
        this.add(licenseGroup);
    }
}
