'use strict';

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {
    gettext as _
} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import * as EventHandlers from './eventHandlers.js';
import * as SwitcherMenu from './switcherMenu.js';
import * as ContextMenu from './contextMenu.js';
import * as WindowManager from './windowManager.js';
import * as KeyboardShortcuts from './keyboardShortcuts.js';

// Gresource icon paths
const RESOURCE_BASE = 'resource:///org/gnome/shell/extensions/classic-app-switcher/icons';

/**
 * Classic App Switcher - Main panel button indicator
 * Displays the currently focused application in the panel and provides
 * dual independent menus for switching between applications and managing visibility
 */
export const ClassicAppSwitcher = GObject.registerClass(
    class ClassicAppSwitcher extends PanelMenu.Button {
        _init(settings, extension) {
            // Pass dontCreateMenu to skip the default menu - we manage menus manually
            super._init(0.0, _('Classic App Switcher'), true);

            this._settings = settings;
            this._extension = extension;

            // Signal IDs for proper cleanup
            this._displayId = null;
            this._workspaceId = null;
            this._trackerId = null;
            this._settingsChangedId = null;
            this._appStateId = null;
            this._overviewShowingId = null;
            this._overviewHidingId = null;
            this._buttonPressId = null;
            this._scrollEventId = null;

            // State tracking
            this._lastKnownApp = null;
            this._pendingApp = null;
            this._lastHiddenApp = null;
            this._lastHiddenWindows = [];
            this._lastMinimizedWindow = null;
            this._showingWorkspaceNumber = false;

            // Timeout IDs
            this._updateTimeoutId = null;
            this._idleRevertTimeoutId = null;

            // Keyboard shortcut action IDs
            this._keyBindingIds = [];

            // Build the UI and menus
            this._buildUI();
            SwitcherMenu.createSwitcherMenu(this);
            ContextMenu.createContextMenu(this);
            this._connectSignals();
            this._applySettings();
            this._update();
        }

        /**
         * Helper: Clear a timeout by property name
         */
        _clearTimeout(propName) {
            if (this[propName] !== null) {
                GLib.Source.remove(this[propName]);
                this[propName] = null;
            }
        }

        /**
         * Helper: Schedule an update with debouncing
         */
        _scheduleUpdate() {
            this._clearTimeout('_updateTimeoutId');
            this._updateTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                this._update();
                this._updateTimeoutId = null;
                return GLib.SOURCE_REMOVE;
            });
        }

        /**
         * Helper: Close all menus
         */
        _closeAllMenus() {
            if (this._switcherMenu.isOpen) {
                this._switcherMenu.close();
            }
            if (this._contextMenu.isOpen) {
                this._contextMenu.close();
            }
        }

        /**
         * Build the App Switcher Indicator Panel-Button UI
         */
        _buildUI() {
            // Create container box for icon and label
            this._box = new St.BoxLayout({
                style_class: 'classic-switcher-box',
                x_expand: true,
                y_expand: true
            });

            // Application icon
            this._icon = new St.Icon({
                style_class: 'classic-switcher-icon',
                y_expand: true,
                y_align: Clutter.ActorAlign.CENTER
            });

            // Application label
            this._label = new St.Label({
                style_class: 'classic-switcher-label',
                y_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._label.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;

            this._box.add_child(this._icon);
            this._box.add_child(this._label);

            // Replace the button's St.Bin container with our box
            this.add_child(this._box);

            // Add CSS Classes
            this.add_style_class_name('classic-app-switcher');

            // Accessibility
            this.accessible_name = _('Application Switcher');

            // Set the accessible relationship to the label widget
            this.label_actor = this._label;

            // Connect event handlers
            this._buttonPressId = this.connect('button-press-event',
                (actor, event) => EventHandlers.handleButtonPress(this, event));
            this._scrollEventId = this.connect('scroll-event',
                (actor, event) => EventHandlers.handleScrollEvent(this, event));
        }

        /**
         * Handle settings changes based on which key changed
         * @param {string} key - The settings key that changed
         */
        _handleSettingChange(key) {
            switch (key) {
                case 'enable-keyboard-shortcuts':
                    KeyboardShortcuts.reloadShortcuts(this);
                    break;
                case 'show-menu-hints':
                    // Rebuild menu to show/hide hints
                    SwitcherMenu.buildSwitcherActions(this);
                    this._update();
                    break;
                case 'enable-overview-effects':
                    // Toggle overview effects on/off
                    if (this._settings.get_boolean('enable-overview-effects')) {
                        WindowManager.enableMinimizedEffect(this);
                        WindowManager.enableHideHandling(this);
                    } else {
                        WindowManager.disableMinimizedEffect(this);
                        WindowManager.disableHideHandling(this);
                    }
                    break;
                case 'hide-windows-from-overview':
                    // Toggle hidden window filtering on/off
                    if (this._settings.get_boolean('hide-windows-from-overview')) {
                        WindowManager.enableHiddenWindowFiltering(this);
                    } else {
                        WindowManager.disableHiddenWindowFiltering(this);
                    }
                    break;
                default:
                    // All other settings (label visibility, panel position, etc.)
                    this._applySettings();
            }
        }

        /**
         * Connect all necessary signals for tracking window and workspace changes
         */
        _connectSignals() {
            // Track focus window changes
            this._displayId = global.display.connect(
                'notify::focus-window',
                () => this._scheduleUpdate() // Ensure menu is up to date!
            );

            // Track workspace changes
            this._workspaceId = global.workspace_manager.connect(
                'active-workspace-changed',
                () => this._scheduleUpdate() // Ensure menu is up to date!
            );

            // Track window creation/destruction
            this._trackerId = Shell.WindowTracker.get_default().connect(
                'tracked-windows-changed',
                () => {
                    // Use idle_add to prevent blocking the main thread
                    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                        this._scheduleUpdate() // Ensure menu is up to date!
                        return GLib.SOURCE_REMOVE;
                    });
                }
            );

            // Track settings changes
            this._settingsChangedId = this._settings.connect(
                'changed',
                (settings, key) => this._handleSettingChange(key)
            );

            // Enable visual effects based on preferences

            // Enable overview effects (minimized effect + hide handling)
            if (this._settings.get_boolean('enable-overview-effects')) {
                WindowManager.enableMinimizedEffect(this);
                WindowManager.enableHideHandling(this);
            }

            // Enable hidden window filtering in Activities Overview
            if (this._settings.get_boolean('hide-windows-from-overview')) {
                WindowManager.enableHiddenWindowFiltering(this);
            }

            // Track app state changes for launch detection
            this._appStateId = Shell.AppSystem.get_default().connect(
                'app-state-changed',
                (system, app) => {
                    if (app.get_state() === Shell.AppState.STARTING) {
                        this._pendingApp = app;

                        // SAFETY: Clear pending status if no window appears within 2 seconds
                        // Prevents sticking to old app if launch fails or is "hidden"
                        this._clearTimeout('_pendingAppTimeoutId');
                        this._pendingAppTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
                            this._pendingApp = null;
                            this._scheduleUpdate();
                            this._pendingAppTimeoutId = null;
                            return GLib.SOURCE_REMOVE;
                        });

                        this._scheduleUpdate();
                    }
                }
            );

            // Shared handler for Activities overview state changes
            // Clear idle toggle timeout and update display when entering/exiting Activities
            const overviewHandler = () => {
                this._clearTimeout('_idleRevertTimeoutId');
                this._scheduleUpdate() // Ensure menu is up to date!
            };

            // Track Activities overview state for context-aware idle display
            this._overviewShowingId = Main.overview.connect('showing', overviewHandler);
            this._overviewHidingId = Main.overview.connect('hidden', overviewHandler);

            // Align window menu terminology with our extension behavior
            WindowManager.fixWindowMenuLabels(this);
        }

        /**
         * Set display to show workspace number
         * Used in both Activities overview and desktop toggle modes
         * @param {number} workspaceNum - The workspace number (1-indexed)
         */
        _setWorkspaceNumberDisplay(workspaceNum) {
            this._icon.gicon = Gio.icon_new_for_string(`${RESOURCE_BASE}/scalable/actions/shell-overview-symbolic.svg`);
            // Translators: %d is the workspace number
            this._label.text = _('Workspace %d').format(workspaceNum);
            this.accessible_name = _('Application Switcher - Workspace %d').format(workspaceNum);
            this.accessible_role = Atk.Role.TOGGLE_BUTTON;
        }

        /**
         * Set display to show "No Applications" state
         * Shown in Activities overview when toggled and no apps are running
         */
        _setNoApplicationsDisplay() {
            this._icon.gicon = Gio.icon_new_for_string(`${RESOURCE_BASE}/scalable/actions/system-run-symbolic.svg`);
            this._label.text = _('No Applications');
            this.accessible_name = _('Application Switcher - No Applications');
            this.accessible_role = Atk.Role.TOGGLE_BUTTON;
        }

        /**
         * Set display to show "Desktop" state
         * Default display when on desktop with no focused apps
         */
        _setDesktopDisplay() {
            this._icon.gicon = Gio.icon_new_for_string(`${RESOURCE_BASE}/scalable/actions/user-desktop-symbolic.svg`);
            this._label.text = _('Desktop');
            this.accessible_name = _('Application Switcher - Desktop');
            this.accessible_role = Atk.Role.TOGGLE_BUTTON;
        }

        /**
         * Animate transition between idle display states
         * Fades out, updates content, then fades back in
         * @param {Function} updateCallback - Function to call at transition midpoint
         */
        _animateIdleTransition(updateCallback) {
            this._box.ease({
                opacity: 0,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    updateCallback();

                    // Fade back in
                    this._box.ease({
                        opacity: 255,
                        duration: 150,
                        mode: Clutter.AnimationMode.EASE_IN_QUAD
                    });
                }
            });
        }

        /**
         * Update panel indicator - idle state display (Desktop vs Workspace #) based on context
         * @param {boolean} animate - Whether to animate the transition
         */
        _updateIdleDisplay(animate = false) {
            const workspace = global.workspace_manager.get_active_workspace();
            const workspaceNum = workspace.index() + 1;
            const inOverview = Main.overview._visible;

            const updateContent = () => {
                // Use early returns for clearer logic flow
                if (this._showingWorkspaceNumber) {
                    this._setWorkspaceNumberDisplay(workspaceNum);
                    return;
                }

                if (inOverview) {
                    this._setNoApplicationsDisplay();
                    return;
                }

                this._setDesktopDisplay();
            };

            if (animate) {
                // Smooth fade transition for manual toggle clicks
                this._animateIdleTransition(updateContent);
            } else {
                // Instant update for workspace changes and normal updates
                updateContent();
            }
        }

        /**
         * Handle idle state toggle between Desktop/Workspace display
         * Behavior differs based on Activities Overview state:
         * - In Overview: Toggles between "Workspace #" and "No Applications"
         * - On Desktop: Toggles between "Desktop" and "Workspace #"
         * Auto-reverts after 3 seconds with animation
         */
        _handleIdleToggle() {
            const inOverview = Main.overview._visible;
            this._clearTimeout('_idleRevertTimeoutId');

            if (inOverview) {
                // In Activities overview
                this._showingWorkspaceNumber = !this._showingWorkspaceNumber;
                this._updateIdleDisplay(false);

                // Auto-revert to showing workspace number after 3 seconds
                this._idleRevertTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
                    this._showingWorkspaceNumber = true;
                    this._updateIdleDisplay(true);
                    this._idleRevertTimeoutId = null;
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                // On Desktop
                this._showingWorkspaceNumber = !this._showingWorkspaceNumber;
                this._updateIdleDisplay(false);

                // Auto-revert to showing desktop after 3 seconds (if showing workspace number)
                if (this._showingWorkspaceNumber) {
                    this._clearTimeout('_idleRevertTimeoutId');
                    this._idleRevertTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
                        this._showingWorkspaceNumber = false;
                        this._updateIdleDisplay(true);
                        this._idleRevertTimeoutId = null;
                        return GLib.SOURCE_REMOVE;
                    });
                }
            }
        }

        /**
         * Update Logic - Handles panel indicator state and conditional menu item visibility
         */
        _update() {
            const focusWindow = global.display.focus_window;
            let app = focusWindow ?
                Shell.WindowTracker.get_default().get_window_app(focusWindow) :
                null;

            /**
             * FLASH FIX REFINED:
             * We hold the last known app only if we are ACTIVELY waiting for a new one.
             * If focus is lost and no launch is pending, or if there is literally no focus window,
             * we must drop the hold to avoid getting stuck on "Settings" or previous apps.
             */
            if (app) {
                this._lastKnownApp = app;
                // If the app we were waiting for has arrived, clear the pending state
                if (this._pendingApp && app.get_id() === this._pendingApp.get_id()) {
                    this._pendingApp = null;
                    this._clearTimeout('_pendingAppTimeoutId');
                }
            } else if (this._pendingApp && this._lastKnownApp) {
                // Gap detected: use the last app while waiting for the new one
                app = this._lastKnownApp;
            } else {
                // No focused app and no pending launch
                this._lastKnownApp = null;
                this._pendingApp = null;
                this._clearTimeout('_pendingAppTimeoutId');
            }

            if (app) {
                // Update icon and label for focused application
                this._icon.gicon = app.get_icon();
                this._label.text = app.get_name();

                // Update menu item labels
                this._hideCurrentItem.label.text = _('Hide %s').format(app.get_name());
                this._quitCurrentItem.label.text = _('Quit %s').format(app.get_name());

                this.accessible_name = _('Application Switcher - %s').format(app.get_name());
                this.accessible_role = Atk.Role.MENU;

                SwitcherMenu.updateConditionalMenuItems(this);
            } else {
                // No focused application - handle Desktop / Workspace display
                const workspace = global.workspace_manager.get_active_workspace();
                const windows = global.display.get_tab_list(Meta.TabList.NORMAL, workspace);

                // Check if any windows exist that we should care about
                const hasAnyApps = windows.some(win => {
                    if (win.get_window_type() !== Meta.WindowType.NORMAL) return false;
                    if (win.is_skip_taskbar()) return false;
                    const winApp = Shell.WindowTracker.get_default().get_window_app(win);
                    return winApp !== null;
                });

                if (hasAnyApps) {
                    this._setDesktopDisplay();
                    this.accessible_role = Atk.Role.MENU;
                } else {
                    // Truly no apps - show context-aware idle state (Workspace # in Overview)
                    this._showingWorkspaceNumber = Main.overview._visible;
                    this._updateIdleDisplay();
                }

                SwitcherMenu.updateConditionalMenuItems(this);
            }

            // Always rebuild app-list during general updates
            SwitcherMenu.buildApplicationList(this);
            SwitcherMenu.updateSwitcherSubmenu(this);
        }

        /**
         * Apply user preferences from settings
         */
        _applySettings() {
            // Update label visibility
            this._label.visible = this._settings.get_boolean('show-label');

            // Update boxpointer visibility for both menus
            if (this._settings.get_boolean('hide-boxpointer')) {
                this._switcherMenu.actor.add_style_class_name('hide-boxpointer');
                this._contextMenu.actor.add_style_class_name('hide-boxpointer');
            } else {
                this._switcherMenu.actor.remove_style_class_name('hide-boxpointer');
                this._contextMenu.actor.remove_style_class_name('hide-boxpointer');
            }

            // Get desired panel position
            const desiredBox = this._settings.get_string('panel-box') || 'right';
            const desiredPos = Math.max(0, this._settings.get_int('position-in-box') || 0);

            // Map setting names to actual panel boxes
            const boxMap = {
                'left': Main.panel._leftBox,
                'center': Main.panel._centerBox,
                'right': Main.panel._rightBox
            };

            const targetBox = boxMap[desiredBox] || boxMap['right'];
            const currentParent = this.get_parent();

            // Check if repositioning is needed
            const boxChanged = currentParent !== targetBox;
            const currentPos = currentParent ? currentParent.get_children().indexOf(this) : -1;
            const posChanged = currentParent &&
                currentPos !== desiredPos &&
                desiredPos < currentParent.get_children().length;

            // Reposition if necessary
            if (boxChanged || posChanged) {
                if (currentParent) {
                    currentParent.remove_child(this);
                }
                targetBox.insert_child_at_index(this, desiredPos);
            }
        }

        /**
         * Clean up resources and disconnect signals
         */
        destroy() {
            // Disconnect all signals
            if (this._displayId) {
                global.display.disconnect(this._displayId);
            }
            if (this._workspaceId) {
                global.workspace_manager.disconnect(this._workspaceId);
            }
            if (this._trackerId) {
                Shell.WindowTracker.get_default().disconnect(this._trackerId);
            }
            if (this._settingsChangedId) {
                this._settings.disconnect(this._settingsChangedId);
            }
            if (this._appStateId) {
                Shell.AppSystem.get_default().disconnect(this._appStateId);
            }
            if (this._overviewShowingId) {
                Main.overview.disconnect(this._overviewShowingId);
            }
            if (this._overviewHidingId) {
                Main.overview.disconnect(this._overviewHidingId);
            }

            // Disconnect settings handler
            if (this._effectsSettingId) {
                this._settings.disconnect(this._effectsSettingId);
                this._effectsSettingId = null;
            }

            // Null them out
            this._displayId = this._workspaceId = this._trackerId = this._settingsChangedId = this._appStateId = null;
            this._overviewShowingId = this._overviewHidingId = null;

            // Clear state tracking variables
            this._pendingApp = null;
            this._lastKnownApp = null;
            this._lastHiddenApp = null;
            this._lastHiddenWindows = null;
            this._lastMinimizedWindow = null;

            // Clear timeouts
            this._clearTimeout('_updateTimeoutId');
            this._clearTimeout('_idleRevertTimeoutId');
            this._clearTimeout('_pendingAppTimeoutId');

            // Disable hide and minimise handling
            WindowManager.disableHideHandling(this);
            WindowManager.disableMinimizedEffect(this);

            // Restore window menu labels
            WindowManager.restoreWindowMenuLabels(this);

            // Clean up hidden window focus signal
            if (this._hiddenWindowFocusId) {
                global.display.disconnect(this._hiddenWindowFocusId);
                this._hiddenWindowFocusId = null;
            }

            // Clean up submenu key handler signals
            if (this._switcherSubmenu?._keyPressId) {
                this._switcherMenu.actor.disconnect(this._switcherSubmenu._keyPressId);
                this._switcherSubmenu._keyPressId = null;
            }
            if (this._switcherSubmenu?._keyReleaseId) {
                this._switcherMenu.actor.disconnect(this._switcherSubmenu._keyReleaseId);
                this._switcherSubmenu._keyReleaseId = null;
            }
            if (this._contextSubmenu?._keyPressId) {
                this._contextMenu.actor.disconnect(this._contextSubmenu._keyPressId);
                this._contextSubmenu._keyPressId = null;
            }
            if (this._contextSubmenu?._keyReleaseId) {
                this._contextMenu.actor.disconnect(this._contextSubmenu._keyReleaseId);
                this._contextSubmenu._keyReleaseId = null;
            }

            if (this._buttonPressId) {
                this.disconnect(this._buttonPressId);
                this._buttonPressId = null;
            }
            if (this._scrollEventId) {
                this.disconnect(this._scrollEventId);
                this._scrollEventId = null;
            }

            // Clean up keyboard shortcuts
            KeyboardShortcuts.cleanupKeybindings(this);

            // Remove menus from menu manager BEFORE destroying
            if (this._switcherMenu) {
                Main.panel.menuManager.removeMenu(this._switcherMenu);
                this._switcherMenu.destroy();
            }
            if (this._contextMenu) {
                Main.panel.menuManager.removeMenu(this._contextMenu);
                this._contextMenu.destroy();
            }

            this._switcherMenu = null;
            this._contextMenu = null;
            this._switcher = null;

            super.destroy();
        }
    });
