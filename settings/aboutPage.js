'use strict';

/**
 * @fileoverview About page widget for Classic App Switcher GNOME extension preferences.
 *
 * Renders application branding, version badge, copyright information,
 * navigation to legal/licensing pages, and external repository links.
 *
 * @module aboutPage
 */

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {LegalPage} from './legalPage.js';

/**
 * Preferences page displaying extension information, copyright, and external links
 *
 * @class
 * @extends Adw.PreferencesPage
 */
export class AboutPage extends Adw.PreferencesPage {
    /** @static @private @type {boolean} Tracker flag ensuring CSS is registered only once */
    static _cssLoaded = false;

    static {
        GObject.registerClass(
            {
                GTypeName: 'ClassicAppSwitcherAboutPage',
            },
            this
        );
    }

    /**
     * @param {Gio.Settings} settings  - Extension GSettings instance
     * @param {object}       metadata  - Extension metadata object
     */
    constructor(settings, metadata) {
        super({
            title: _('About'),
            icon_name: 'help-about-symbolic',
            name: 'AboutPage',
        });

        this._settings = settings;
        this._metadata = metadata;

        if (!AboutPage._cssLoaded) {
            this._initStyles();
            AboutPage._cssLoaded = true;
        }

        // Detect libadwaita version — 'dimmed' class available from GNOME 48+
        const adwVersion =
            Adw.get_major_version() * 100 + Adw.get_minor_version();
        this._useDimmedClass = adwVersion >= 107;

        this._buildHeader();
        this._buildLegalGroup();
        this._buildLinksGroup();
    }

    /**
     * Initialize application CSS provider for versionBadge Adw.Bin
     *
     * @private
     * @returns {void}
     */
    _initStyles() {
        const css = `
              .version-badge {
                padding: 2px 10px;
                border-radius: 999px;
                border: 1px solid transparent;
                background: alpha(@accent_color, 0.15);
            }
              .version-label {
                font-size: 11px;
                font-weight: 600;
                font-feature-settings: "tnum";
                color: @accent_color;
            }
        `;

        const provider = new Gtk.CssProvider();
        provider.load_from_data(css, -1);

        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default(),
            provider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
        );
    }

    /**
     * Builds the header group containing the extension icon, title,
     * subtitle and version badge.
     *
     * @private
     * @returns {void}
     */
    _buildHeader() {
        const versionName = this._metadata['version-name'] || '1.0';
        const egoVersion =
            this._metadata['version'] === 0
                ? 'Development Build'
                : `EGO Version: ${this._metadata['version']}`;

        const headerGroup = new Adw.PreferencesGroup();

        const headerBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            margin_top: 24,
            margin_bottom: 24,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
        });

        // Extension icon from gresource
        headerBox.append(
            new Gtk.Image({
                icon_name: 'happy-computer-symbolic',
                pixel_size: 96,
                use_fallback: true,
            })
        );

        // Extension name
        const titleLabel = new Gtk.Label({
            label: this._metadata.name,
            use_markup: true,
            halign: Gtk.Align.CENTER,
        });
        titleLabel.add_css_class('title-1');
        headerBox.append(titleLabel);

        // Subtitle
        const subtitleLabel = new Gtk.Label({
            label: this._metadata.description,
            use_markup: true,
            halign: Gtk.Align.CENTER,
        });
        subtitleLabel.add_css_class(
            this._useDimmedClass ? 'dimmed' : 'dim-label'
        );
        headerBox.append(subtitleLabel);

        // Visual separator
        const separator = new Gtk.Separator({
            orientation: Gtk.Orientation.HORIZONTAL,
        });
        separator.add_css_class('spacer');
        headerBox.append(separator);

        // Version badge — accent-coloured pill using custom CSS
        const versionLabel = new Gtk.Label({
            label: versionName,
            halign: Gtk.Align.CENTER,
        });
        versionLabel.set_css_classes(['version-label', 'numeric']);

        const versionBadge = new Adw.Bin({
            child: versionLabel,
            halign: Gtk.Align.CENTER,
            tooltip_text: egoVersion,
        });
        versionBadge.add_css_class('version-badge');

        headerBox.append(versionBadge);
        headerGroup.add(headerBox);
        this.add(headerGroup);
    }

    /**
     * Builds the legal group containing a navigable Legal sub-page
     * and a static copyright row.
     *
     * @private
     * @returns {void}
     */
    _buildLegalGroup() {
        const legalGroup = new Adw.PreferencesGroup();

        // Legal sub-page row — pushes LegalPage onto the navigation stack
        const legalRow = new Adw.ActionRow({
            title: _('Legal'),
            subtitle: _('Licensing information'),
            activatable: true,
        });
        legalRow.add_prefix(
            new Gtk.Image({
                icon_name: 'license-symbolic',
                valign: Gtk.Align.CENTER,
            })
        );
        legalRow.add_suffix(
            new Gtk.Image({
                icon_name: 'go-next-symbolic',
                valign: Gtk.Align.CENTER,
            })
        );
        legalRow.connect('activated', () => {
            const legalPage = new LegalPage(this._settings, this._metadata);

            const toolbarView = new Adw.ToolbarView();
            toolbarView.add_top_bar(
                new Adw.HeaderBar({
                    show_back_button: true,
                })
            );
            toolbarView.set_content(legalPage);

            this.get_root().push_subpage(
                new Adw.NavigationPage({
                    title: _('License'),
                    child: toolbarView,
                })
            );
        });
        legalGroup.add(legalRow);

        // Copyright row
        const copyrightRow = new Adw.ActionRow({
            title: _('Copyright'),
            subtitle: `${new Date().getFullYear()} ${this._metadata.author}`,
        });
        copyrightRow.add_prefix(
            new Gtk.Image({
                icon_name: 'license-copyright-symbolic',
                valign: Gtk.Align.CENTER,
            })
        );
        legalGroup.add(copyrightRow);

        this.add(legalGroup);
    }

    /**
     * Build external project links preferences group
     *
     * @private
     * @returns {void}
     */
    _buildLinksGroup() {
        const linksGroup = new Adw.PreferencesGroup();

        const githubRow = new Adw.ActionRow({
            title: _('GitHub Repository'),
            subtitle: _('Source code, issues and contributions'),
            activatable: true,
        });
        githubRow.add_prefix(
            new Gtk.Image({
                icon_name: 'github-logo-symbolic',
                valign: Gtk.Align.CENTER,
            })
        );
        githubRow.add_suffix(
            new Gtk.Image({
                icon_name: 'adw-external-link-symbolic',
                valign: Gtk.Align.CENTER,
            })
        );
        githubRow.connect('activated', () => {
            Gtk.show_uri(null, this._metadata.url, Gdk.CURRENT_TIME);
        });
        linksGroup.add(githubRow);

        this.add(linksGroup);
    }
}

