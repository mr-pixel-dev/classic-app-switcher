'use strict';

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import GObject from 'gi://GObject';

import {
    gettext as _
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {
    LegalPage
} from './legalPage.js';

/**
 * About Page
 * Extension information, version, and links
 */
export class AboutPage extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    constructor(settings, metadata, path) {
        super({
            title: _('About'),
            icon_name: 'info-outline-symbolic',
            name: 'AboutPage',
        });

        this._settings = settings;
        this._metadata = metadata;

        // Check libadwaita version for compatibility
        const adwVersion = Adw.get_major_version() * 100 + Adw.get_minor_version();
        this._useDimmedClass = adwVersion >= 107; // GNOME 48+

        this._buildHeader();
        this._buildLegalGroup();
        this._buildLinksGroup();
    }

    _buildHeader() {
        const version = this._metadata['version-name'] || this._metadata['version'] || '1.0';

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

        // Extension icon
        const iconWidget = new Gtk.Image({
            icon_name: 'happy-computer-symbolic',
            pixel_size: 96,
            use_fallback: false,
        });
        headerBox.append(iconWidget);

        // Extension name
        const titleLabel = new Gtk.Label({
            label: _('Classic App Switcher'),
            use_markup: true,
            halign: Gtk.Align.CENTER
        });
        titleLabel.add_css_class('title-1');
        headerBox.append(titleLabel);

        // Subtitle
        const subtitleLabel = new Gtk.Label({
            label: _('Mouse friendly application switching for GNOME'),
            use_markup: true,
            halign: Gtk.Align.CENTER
        });
        subtitleLabel.add_css_class(this._useDimmedClass ? 'dimmed' : 'dim-label');
        headerBox.append(subtitleLabel);

        // Separator
        const separator = new Gtk.Separator({
            orientation: Gtk.Orientation.HORIZONTAL,
        });
        separator.add_css_class('spacer');
        headerBox.append(separator);

        // Version badge
        const versionLabel = new Gtk.Label({
            label: version.toString(),
            halign: Gtk.Align.CENTER
        });
        versionLabel.add_css_class('numeric');

        // Apply CSS for version badge
        const cssProvider = new Gtk.CssProvider();
        cssProvider.load_from_data(
            `.version-label {
                padding: 2px 10px;
                font-size: 11px;
                font-weight: 600;
                border-radius: 999px;
                font-feature-settings: "tnum";
                border: 1px solid transparent;
                background: alpha(@accent_color, 0.15);
                color: @accent_color;
            }`,
            -1
        );

        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default(),
            cssProvider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
        );

        versionLabel.add_css_class('version-label');
        headerBox.append(versionLabel);

        headerGroup.add(headerBox);
        this.add(headerGroup);
    }


    _buildLegalGroup() {
        const legalGroup = new Adw.PreferencesGroup({
            // title: _('Legal'),
        });

        // Legal row
        const legalRow = new Adw.ActionRow({
            title: _('Legal'),
            subtitle: _('Licensing information'),
            activatable: true,
        });
        legalRow.add_prefix(new Gtk.Image({
            icon_name: 'license-symbolic',
            valign: Gtk.Align.CENTER,
        }));
        legalRow.add_suffix(new Gtk.Image({
            icon_name: 'go-next-symbolic',
            valign: Gtk.Align.CENTER,
        }));
        legalRow.connect('activated', () => {
            // Create navigation page with header bar for back navigation
            const legalPage = new LegalPage(this._settings, this._metadata);

            const headerBar = new Adw.HeaderBar({
                show_back_button: true,
            });

            const toolbarView = new Adw.ToolbarView();
            toolbarView.add_top_bar(headerBar);
            toolbarView.set_content(legalPage);

            const navigationPage = new Adw.NavigationPage({
                title: _('License'),
                child: toolbarView,
            });

            this.get_root().push_subpage(navigationPage);
        });
        legalGroup.add(legalRow);

        // Copyright row
        const copyrightRow = new Adw.ActionRow({
            title: _('Copyright'),
            subtitle: `${new Date().getFullYear()} Mr Pixel Dev`,
        });
        copyrightRow.add_prefix(new Gtk.Image({
            icon_name: 'license-copyright-symbolic',
            valign: Gtk.Align.CENTER,
        }));

        legalGroup.add(copyrightRow);

        this.add(legalGroup);
    }

    _buildLinksGroup() {
        const linksGroup = new Adw.PreferencesGroup({
            // title: _('Links'),
        });

        // GitHub link
        const githubRow = new Adw.ActionRow({
            title: _('GitHub Repository'),
            subtitle: _('Source code, issues, and contributions'),
            activatable: true,
        });
        githubRow.add_suffix(new Gtk.Image({
            icon_name: 'adw-external-link-symbolic',
            valign: Gtk.Align.CENTER,
        }));
        githubRow.add_prefix(new Gtk.Image({
            icon_name: 'github-logo-symbolic',
            valign: Gtk.Align.CENTER,
        }));
        githubRow.connect('activated', () => {
            Gtk.show_uri(null, 'https://github.com/mr-pixel-dev/classic-app-switcher', Gdk.CURRENT_TIME);
        });
        linksGroup.add(githubRow);

        this.add(linksGroup);
    }
}
