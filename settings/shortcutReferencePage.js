'use strict';

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import GObject from 'gi://GObject';

import { gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {SHORTCUT_KEYS} from '../shortcuts.js';

function getShortcutTitle(key) {
    switch (key) {
        case 'hide-current-app':
            return _('Hide the current application');
        case 'hide-others':
            return _('Hide all other applications');
        case 'show-recent-app':
            return _('Show most recently hidden application');
        case 'show-all-apps':
            return _('Show all hidden applications/windows');
        case 'minimize-current-window':
            return _('Minimize the current window');
        case 'unminimize-recent-window':
            return _('Unminimize most recently minimized window');
        case 'close-current-window':
            return _('Close the current window');
        case 'quit-current-app':
            return _('Quit the current application');
        default:
            throw new Error(`Unknown shortcut setting: ${key}`);
    }
}

function acceleratorsEqual(left, right) {
    const [leftValid, leftKeyval, leftModifiers] = Gtk.accelerator_parse(left);
    const [rightValid, rightKeyval, rightModifiers] = Gtk.accelerator_parse(right);
    return leftValid && rightValid &&
        leftKeyval === rightKeyval && leftModifiers === rightModifiers;
}

const FORBIDDEN_KEYVALS = new Set([
    Gdk.KEY_Home,
    Gdk.KEY_Left,
    Gdk.KEY_Up,
    Gdk.KEY_Right,
    Gdk.KEY_Down,
    Gdk.KEY_Page_Up,
    Gdk.KEY_Page_Down,
    Gdk.KEY_End,
    Gdk.KEY_Tab,
    Gdk.KEY_KP_Enter,
    Gdk.KEY_Return,
    Gdk.KEY_Mode_switch,
]);

function isValidBinding(keyval, modifiers) {
    const shift = Gdk.ModifierType.SHIFT_MASK;
    if (modifiers !== 0 && modifiers !== shift) {
        return true;
    }

    const unicodeValue = Gdk.keyval_to_unicode(keyval);
    const character = unicodeValue === 0 ? '' : String.fromCodePoint(unicodeValue);
    return !/[\p{L}\p{N}]/u.test(character) &&
        keyval !== Gdk.KEY_space && !FORBIDDEN_KEYVALS.has(keyval);
}

class KeyboardShortcutEditor extends Adw.Window {
    static {
        GObject.registerClass(this);
    }

    constructor(settings, shortcut, parent, onSaved) {
        super({
            title: _('Set Shortcut'),
            transient_for: parent,
            modal: true,
            resizable: false,
            default_width: 400,
            default_height: 300,
            destroy_with_parent: true,
        });

        this._settings = settings;
        this._shortcut = shortcut;
        this._onSaved = onSaved;
        this._candidate = null;
        this._collision = null;
        this._systemShortcutsInhibited = false;
        this._grabTimeoutId = null;

        const headerBar = new Adw.HeaderBar({
            show_start_title_buttons: false,
            show_end_title_buttons: false,
        });
        const cancelButton = new Gtk.Button({
            label: _('_Cancel'),
            use_underline: true,
        });
        cancelButton.connect('clicked', () => this.close());
        headerBar.pack_start(cancelButton);

        this._setButton = new Gtk.Button({
            label: _('_Set'),
            use_underline: true,
            sensitive: false,
        });
        this._setButton.add_css_class('suggested-action');
        this._setButton.connect('clicked', () => this._save());
        headerBar.pack_end(this._setButton);

        const contentBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 18,
            margin_top: 12,
            margin_bottom: 12,
            margin_start: 12,
            margin_end: 12,
        });
        contentBox.append(new Gtk.Label({
            label: _('Enter new shortcut to change %s').replace('%s', shortcut.title),
            wrap: true,
        }));

        this._stack = new Gtk.Stack({hexpand: true, vexpand: true});
        const captureBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 18,
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
        });
        captureBox.append(new Gtk.Image({
            icon_name: 'input-keyboard-symbolic',
            pixel_size: 64,
        }));
        const instructions = new Gtk.Label({
            label: _('Press Esc to cancel or Backspace to disable the keyboard shortcut'),
            wrap: true,
            justify: Gtk.Justification.CENTER,
        });
        instructions.add_css_class('dim-label');
        captureBox.append(instructions);

        const candidateBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 18,
            valign: Gtk.Align.CENTER,
        });
        this._shortcutLabel = new Gtk.ShortcutLabel({
            accelerator: '',
            disabled_text: _('Disabled'),
            halign: Gtk.Align.CENTER,
        });
        this._conflictLabel = new Gtk.Label({
            wrap: true,
            justify: Gtk.Justification.CENTER,
        });
        candidateBox.append(this._shortcutLabel);
        candidateBox.append(this._conflictLabel);

        this._stack.add_named(captureBox, 'capture');
        this._stack.add_named(candidateBox, 'candidate');
        this._stack.set_visible_child_name('capture');
        contentBox.append(this._stack);

        const toolbarView = new Adw.ToolbarView();
        toolbarView.add_top_bar(headerBar);
        toolbarView.set_content(contentBox);
        this.set_content(toolbarView);

        const keyController = new Gtk.EventControllerKey({
            propagation_phase: Gtk.PropagationPhase.CAPTURE,
        });
        keyController.connect('key-pressed', (controller, keyval, keycode, state) =>
            this._onKeyPressed(controller, keyval, keycode, state));
        this.add_controller(keyController);

        this.connect('map', () => this._inhibitSystemShortcuts());
        this.connect('unmap', () => this._restoreSystemShortcuts());
    }

    _inhibitSystemShortcuts() {
        this._grabTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            const surface = this.get_surface();
            if (surface && typeof surface.inhibit_system_shortcuts === 'function') {
                surface.inhibit_system_shortcuts(null);
                this._systemShortcutsInhibited = true;
            }
            this._grabTimeoutId = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    _restoreSystemShortcuts() {
        if (this._grabTimeoutId !== null) {
            GLib.Source.remove(this._grabTimeoutId);
            this._grabTimeoutId = null;
        }

        const surface = this.get_surface();
        if (this._systemShortcutsInhibited && surface &&
            typeof surface.restore_system_shortcuts === 'function') {
            surface.restore_system_shortcuts();
        }
        this._systemShortcutsInhibited = false;
    }

    _normalizeKey(controller, keyval, keycode, state) {
        const explicitModifiers = Gtk.accelerator_get_default_mod_mask() |
            Gdk.ModifierType.SHIFT_MASK;
        const modifiers = state & explicitModifiers & ~Gdk.ModifierType.LOCK_MASK;
        const implicitState = state & ~explicitModifiers;
        const display = Gdk.Display.get_default();
        const group = controller.get_group();
        const unmodified = display.translate_key(keycode, implicitState, group);
        const shifted = display.translate_key(
            keycode,
            implicitState | Gdk.ModifierType.SHIFT_MASK,
            group
        );

        let normalizedKeyval = unmodified[0] ? unmodified[1] : Gdk.keyval_to_lower(keyval);
        if (shifted[0] && shifted[1] >= Gdk.KEY_0 && shifted[1] <= Gdk.KEY_9) {
            normalizedKeyval = shifted[1];
        }
        if (normalizedKeyval === Gdk.KEY_ISO_Left_Tab) {
            normalizedKeyval = Gdk.KEY_Tab;
        }
        if (normalizedKeyval === Gdk.KEY_Sys_Req &&
            (modifiers & Gdk.ModifierType.ALT_MASK) !== 0) {
            normalizedKeyval = Gdk.KEY_Print;
        }
        return [normalizedKeyval, modifiers];
    }

    _onKeyPressed(controller, keyval, keycode, state) {
        const [normalizedKeyval, modifiers] = this._normalizeKey(
            controller,
            keyval,
            keycode,
            state
        );

        if (modifiers === 0 && normalizedKeyval === Gdk.KEY_Escape) {
            this.close();
            return Gdk.EVENT_STOP;
        }
        if (modifiers === 0 && normalizedKeyval === Gdk.KEY_BackSpace) {
            this._showCandidate('');
            return Gdk.EVENT_STOP;
        }

        const acceleratorValid = Gtk.accelerator_valid(normalizedKeyval, modifiers) ||
            (normalizedKeyval === Gdk.KEY_Tab && modifiers !== 0);
        if (acceleratorValid && isValidBinding(normalizedKeyval, modifiers)) {
            this._showCandidate(Gtk.accelerator_name(normalizedKeyval, modifiers));
        }
        return Gdk.EVENT_STOP;
    }

    _showCandidate(accelerator) {
        this._candidate = accelerator;
        this._collision = this._findCollision(accelerator);
        this._shortcutLabel.accelerator = accelerator;
        this._setButton.sensitive = true;
        this._stack.set_visible_child_name('candidate');

        if (this._collision) {
            const [, keyval, modifiers] = Gtk.accelerator_parse(accelerator);
            const acceleratorText = Gtk.accelerator_get_label(keyval, modifiers);
            this._conflictLabel.label = _('%s is already being used for %s. If you replace it, %s will be disabled')
                .replace('%s', acceleratorText)
                .replace('%s', this._collision.title)
                .replace('%s', this._collision.title);
            this._setButton.label = _('Re_place');
        } else {
            this._conflictLabel.label = '';
            this._setButton.label = _('_Set');
        }
    }

    _findCollision(accelerator) {
        if (!accelerator) {
            return null;
        }

        for (const key of SHORTCUT_KEYS) {
            if (key !== this._shortcut.key &&
                this._settings.get_strv(key).some(current =>
                    acceleratorsEqual(current, accelerator))) {
                return {key, title: getShortcutTitle(key)};
            }
        }
        return null;
    }

    _save() {
        if (this._candidate === null) {
            throw new Error('Cannot save a shortcut before a candidate is selected');
        }
        if (this._collision) {
            this._settings.set_strv(this._collision.key, []);
        }
        this._settings.set_strv(
            this._shortcut.key,
            this._candidate ? [this._candidate] : []
        );
        this._onSaved();
        this.close();
    }
}

export class KeyboardShortcutsDialog extends Adw.PreferencesPage {
    static {
        GObject.registerClass(this);
    }

    constructor(settings) {
        super({
            title: _('Keyboard Shortcuts'),
            icon_name: 'keyboard-shortcuts-symbolic',
            name: 'KeyboardShortcutsPage',
        });

        this._settings = settings;
        this._rowUpdates = [];
        const shortcutsGroup = new Adw.PreferencesGroup({
            title: _('Classic App Switcher'),
        });
        SHORTCUT_KEYS.forEach(key =>
            shortcutsGroup.add(this._createShortcutRow({key, title: getShortcutTitle(key)})));
        this.add(shortcutsGroup);
    }

    _createShortcutRow(shortcut) {
        const row = new Adw.ActionRow({
            title: shortcut.title,
            activatable: true,
        });
        const shortcutLabel = new Gtk.ShortcutLabel({
            disabled_text: _('Disabled'),
            valign: Gtk.Align.CENTER,
        });
        const resetButton = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            tooltip_text: _('Reset Shortcut'),
            valign: Gtk.Align.CENTER,
        });
        resetButton.add_css_class('flat');
        resetButton.add_css_class('circular');

        const update = () => {
            const accelerators = this._settings.get_strv(shortcut.key);
            shortcutLabel.accelerator = accelerators[0] || '';
            resetButton.visible = !this._settings.get_value(shortcut.key).equal(
                this._settings.get_default_value(shortcut.key)
            );
        };
        resetButton.connect('clicked', () => {
            this._settings.reset(shortcut.key);
            this._refreshRows();
        });
        row.connect('activated', () => {
            const editor = new KeyboardShortcutEditor(
                this._settings,
                shortcut,
                this.get_root(),
                () => this._refreshRows()
            );
            editor.present();
        });

        row.add_suffix(shortcutLabel);
        row.add_suffix(resetButton);
        row.add_suffix(new Gtk.Image({
            icon_name: 'document-edit-symbolic',
            margin_start: 6,
        }));
        this._rowUpdates.push(update);
        update();
        return row;
    }

    _refreshRows() {
        this._rowUpdates.forEach(update => update());
    }
}
