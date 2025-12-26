'use strict';

import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import Meta from 'gi://Meta';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {
    Extension,
    gettext as _
} from 'resource:///org/gnome/shell/extensions/extension.js';

/**
 * Classic App Switcher - Mouse friendly application switching for GNOME
 * 
 * Displays the currently focused application in the panel and provides
 * a menu for switching between applications and managing visibility.
 */
const ClassicAppSwitcher = GObject.registerClass(
    class ClassicAppSwitcher extends PanelMenu.Button {
        _init(settings, extension) {
            super._init(0.0, _('Classic App Switcher'));

            this._settings = settings;
            this._extension = extension;
            this._displayId = null;
            this._workspaceId = null;
            this._trackerId = null;
            this._settingsChangedId = null;
            this._appStateId = null;
            this._overviewShowingId = null;
            this._overviewHidingId = null;
            this._lastKnownApp = null;
            this._pendingApp = null;
            this._lastHiddenApp = null;
            this._lastHiddenWindows = []; // Track specific windows hidden via Super+H
            this._lastMinimizedWindow = null; // Track last window minimized via Super+M

            // Track idle state display toggle (Desktop vs Workspace #)
            this._showingWorkspaceNumber = false;

            // Initialize timeout ID for panel button updates only
            this._updateTimeoutId = null;

            // Initialize timeout for idle state auto-revert
            this._idleRevertTimeoutId = null;

            // Keyboard shortcut action IDs
            this._keyBindingIds = [];

            // Signal IDs for proper cleanup
            this._buttonPressId = null;
            this._scrollEventId = null;

            this._buildUI();
            this._buildMenu();
            this._connectSignals();
            this._applySettings();
            this._update();
        }

        /**
         * Helper method to clear a timeout by property name
         * @param {string} propName - The name of the timeout property to clear
         */
        _clearTimeout(propName) {
            if (this[propName] !== null) {
                GLib.Source.remove(this[propName]);
                this[propName] = null;
            }
        }

        /**
         * 1. Build the UI components for the Panel Button
         */
        _buildUI() {
            // Create container box for icon and label
            this._box = new St.BoxLayout({
                style_class: 'classic-switcher-box'
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
                y_align: Clutter.ActorAlign.CENTER
            });

            // Set ellipsization for long app names (middle mode shows start...end)
            this._label.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;

            this._box.add_child(this._icon);
            this._box.add_child(this._label);

            // Add to the button's container
            this.add_child(this._box);

            // Explicitly ensure button is reactive and can receive events
            this.reactive = true;
            this.can_focus = true;
            this.track_hover = true;

            // Handle clicks on the button itself for idle-state toggle
            this._buttonPressId = this.connect('button-press-event', (actor, event) => {
                // Only handle left clicks
                if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;

                // Check if we're in idle state (no focused app)
                const focusWindow = global.display.focus_window;
                const app = focusWindow ?
                    Shell.WindowTracker.get_default().get_window_app(focusWindow) :
                    null;

                if (!app) {
                    // No focused app - but check if there are ANY apps (including hidden/minimized)
                    const workspace = global.workspace_manager.get_active_workspace();
                    const windows = global.display.get_tab_list(Meta.TabList.NORMAL, workspace);
                    const hasAnyApps = windows.some(win => {
                        if (win.get_window_type() !== Meta.WindowType.NORMAL) return false;
                        if (win.is_skip_taskbar()) return false;
                        const winApp = Shell.WindowTracker.get_default().get_window_app(win);
                        return winApp !== null;
                    });

                    if (hasAnyApps) {
                        // There are hidden apps - allow normal menu to open
                        return Clutter.EVENT_PROPAGATE;
                    }

                    // Truly no apps at all - do the idle toggle
                    const inOverview = Main.overview._visible;

                    // Clear any existing revert timeout
                    this._clearTimeout('_idleRevertTimeoutId');

                    if (inOverview) {
                        // In Activities: Toggle between "Workspace #" and "No Applications"
                        this._showingWorkspaceNumber = !this._showingWorkspaceNumber;
                        this._updateIdleDisplay(false); // No animation on click

                        // Set timer to revert back to workspace number
                        this._idleRevertTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
                            this._showingWorkspaceNumber = true; // Revert to workspace display
                            this._updateIdleDisplay(true); // Animate the auto-revert
                            this._idleRevertTimeoutId = null;
                            return GLib.SOURCE_REMOVE;
                        });
                    } else {
                        // On Desktop: Toggle between "Desktop" and "Workspace #"
                        this._showingWorkspaceNumber = !this._showingWorkspaceNumber;
                        this._updateIdleDisplay(false); // No animation on click

                        // If showing workspace number, set timer to revert to Desktop
                        if (this._showingWorkspaceNumber) {
                            this._idleRevertTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
                                this._showingWorkspaceNumber = false; // Revert to Desktop
                                this._updateIdleDisplay(true); // Animate the auto-revert
                                this._idleRevertTimeoutId = null;
                                return GLib.SOURCE_REMOVE;
                            });
                        }
                    }

                    return Clutter.EVENT_STOP; // Prevent menu from opening
                }

                // With focused app, allow normal menu behavior
                return Clutter.EVENT_PROPAGATE;
            });

            // Enable scroll-to-cycle through running apps
            this._scrollEventId = this.connect('scroll-event', (actor, event) => {
                const direction = event.get_scroll_direction();

                // Get running apps on current workspace IN STACKING ORDER
                const workspace = global.workspace_manager.get_active_workspace();
                const windows = global.display.get_tab_list(Meta.TabList.NORMAL, workspace);
                const apps = new Set();

                // Collect apps with VISIBLE windows only (ignore minimized)
                for (const win of windows) {
                    if (win.get_window_type() !== Meta.WindowType.NORMAL) continue;
                    if (win.is_skip_taskbar()) continue;
                    if (win.minimized) continue; // Skip minimized windows

                    const app = Shell.WindowTracker.get_default().get_window_app(win);
                    if (app) apps.add(app);
                }

                const appList = Array.from(apps);

                // Need at least 2 apps to cycle
                if (appList.length <= 1) return Clutter.EVENT_PROPAGATE;

                // Find current app index
                const currentApp = Shell.WindowTracker.get_default().focus_app;
                let index = appList.findIndex(a => a.get_id() === currentApp?.get_id());

                // If current app not in list (shouldn't happen, but safety check)
                if (index === -1) {
                    // Activate the first app in the list
                    this._activateApplication(appList[0], workspace);
                    return Clutter.EVENT_STOP;
                }

                // Cycle based on scroll direction
                if (direction === Clutter.ScrollDirection.UP || direction === Clutter.ScrollDirection.LEFT) {
                    // Scroll up = go backwards through list
                    index = (index - 1 + appList.length) % appList.length;
                } else if (direction === Clutter.ScrollDirection.DOWN || direction === Clutter.ScrollDirection.RIGHT) {
                    // Scroll down = go forwards through list
                    index = (index + 1) % appList.length;
                } else {
                    return Clutter.EVENT_PROPAGATE;
                }

                // Activate the selected app
                this._activateApplication(appList[index], workspace);

                return Clutter.EVENT_STOP;
            });

            // Add style class for CSS targeting
            this.add_style_class_name('classic-app-switcher');

            // Set accessible name for screen readers
            this.accessible_name = _('Application Switcher');
        }

        /**
         * 2. Build the static menu items (Hide, Hide Others, Show All, Quit.)
         */
        _buildMenu() {
            // Add custom style class to the menu for CSS isolation
            this.menu.actor.add_style_class_name('classic-app-switcher-menu');

            // Hide current application menu item (fallback)
            this._hideCurrentItem = new PopupMenu.PopupMenuItem(_('Hide Application'));
            this._hideCurrentItem.connect('activate', () => this._hideCurrentApp());
            this.menu.addMenuItem(this._hideCurrentItem);

            // Add spacer and keyboard shortcut hint to Hide item
            if (this._settings.get_boolean('enable-keyboard-shortcuts') && this._settings.get_boolean('show-menu-hints')) {
                const hideCurrentSpacer = new St.Widget({
                    x_expand: true
                });
                // Hide application
                this._hideCurrentItem.label.get_parent().add_child(hideCurrentSpacer);
                this._hideCurrentShortcut = new St.Label({
                    text: 'Super+H',
                    y_align: Clutter.ActorAlign.CENTER
                });
                this._hideCurrentShortcut.set_opacity(153); // 60% opacity
                this._hideCurrentItem.label.get_parent().add_child(this._hideCurrentShortcut);
            }

            // Hide all other applications
            this._hideOthersItem = new PopupMenu.PopupMenuItem(_('Hide Others'));
            this._hideOthersItem.connect('activate', () => this._hideOthers());
            this.menu.addMenuItem(this._hideOthersItem);

            // Add spacer and keyboard shortcut hint to Hide Others item
            if (this._settings.get_boolean('enable-keyboard-shortcuts') && this._settings.get_boolean('show-menu-hints')) {
                const hideOthersSpacer = new St.Widget({
                    x_expand: true
                });
                this._hideOthersItem.label.get_parent().add_child(hideOthersSpacer);
                this._hideOthersShortcut = new St.Label({
                    text: 'Alt+Super+H',
                    y_align: Clutter.ActorAlign.CENTER
                });
                this._hideOthersShortcut.set_opacity(153); // 60% opacity
                this._hideOthersItem.label.get_parent().add_child(this._hideOthersShortcut);
            }

            // Show all applications
            this._showAllItem = new PopupMenu.PopupMenuItem(_('Show All'));
            this._showAllItem.connect('activate', () => this._showAll());
            this.menu.addMenuItem(this._showAllItem);

            // Separator before Quit option
            this._topSeparator = new PopupMenu.PopupSeparatorMenuItem();
            this.menu.addMenuItem(this._topSeparator);

            // Quit current application menu item (fallback)
            this._quitCurrentItem = new PopupMenu.PopupMenuItem(_('Quit Application'));
            this._quitCurrentItem.connect('activate', () => this._quitCurrentApp());
            this.menu.addMenuItem(this._quitCurrentItem);

            // Add spacer and keyboard shortcut hint to Quit item
            if (this._settings.get_boolean('enable-keyboard-shortcuts') && this._settings.get_boolean('show-menu-hints')) {
                const quitCurrentSpacer = new St.Widget({
                    x_expand: true
                });
                this._quitCurrentItem.label.get_parent().add_child(quitCurrentSpacer);
                this._quitCurrentShortcut = new St.Label({
                    text: 'Super+Q',
                    y_align: Clutter.ActorAlign.CENTER
                });
                this._quitCurrentShortcut.set_opacity(153); // 60% opacity
                this._quitCurrentItem.label.get_parent().add_child(this._quitCurrentShortcut);
            }

            // Separator before application list with label (ALWAYS visible)
            this._appListSeparator = new PopupMenu.PopupSeparatorMenuItem(_('Open Applications'));
            this.menu.addMenuItem(this._appListSeparator);

            // Refresh application list when menu opens to ensure correct stacking order
            this.menu.connect('open-state-changed', (menu, open) => {
                if (open) {
                    this._buildApplicationList();
                    this._pendingApp = null;
                }
            });
        }

        /**
         * 3. Build the dynamic list of running applications in the menu
         */
        _buildApplicationList() {
            // Clean up any previously added workspace indicator
            if (this._workspaceItem) {
                this._workspaceItem.destroy();
                this._workspaceItem = null;
            }

            // Remove existing application menu items (keep first 6: Hide, Hide Others, Show All, Separator, Quit, AppList Separator)
            const items = this.menu._getMenuItems();
            for (let i = items.length - 1; i > 5; i--) {
                items[i].destroy();
            }

            const workspace = global.workspace_manager.get_active_workspace();
            const apps = new Set();

            // Collect all normal windows on the current workspace
            const windows = global.display.get_tab_list(Meta.TabList.NORMAL, workspace);
            for (const win of windows) {
                // Skip non-normal windows (dialogs, tooltips, etc.)
                if (win.get_window_type() !== Meta.WindowType.NORMAL) continue;

                // Skip windows with skip-taskbar hint
                if (win.is_skip_taskbar()) continue;

                // Skip transient windows (dialogs) - they're grouped with their parent
                if (win.get_transient_for() !== null) continue;

                const app = Shell.WindowTracker.get_default().get_window_app(win);
                if (!app) continue;

                apps.add(app);
            }

            // Keep apps in workspace stacking order (no sorting needed)
            // Apps appear in the order their windows are stacked, which typically
            // reflects launch order - first opened apps appear first
            const sorted = Array.from(apps);

            const focusedApp = Shell.WindowTracker.get_default().focus_app;

            // Add menu item for each application
            for (const app of sorted) {
                // Count only top-level windows for this app on this workspace
                const appWindows = app.get_windows().filter(w => {
                    return w.get_workspace() === workspace &&
                        w.get_window_type() === Meta.WindowType.NORMAL &&
                        w.get_transient_for() === null; // Skip transient/dialog windows
                });

                const windowCount = appWindows.length;
                const visibleCount = appWindows.filter(w => !w.minimized).length;

                // Build the display text
                let displayText = app.get_name();

                // Create the menu item
                const item = new PopupMenu.PopupImageMenuItem(displayText, app.get_icon());

                // Set ellipsization for long app names in menu
                item.label.clutter_text.ellipsize = Pango.EllipsizeMode.END;

                // Add window count indicator if there are multiple windows
                if (windowCount > 1) {
                    // Add a spacer to push the count to the right
                    const spacer = new St.Widget({
                        x_expand: true
                    });
                    item.label.get_parent().add_child(spacer);

                    const countLabel = new St.Label({
                        text: `${visibleCount}/${windowCount}`,
                        style_class: 'window-count',
                        y_align: Clutter.ActorAlign.CENTER
                    });
                    item.label.get_parent().add_child(countLabel);
                }

                // Handle application activation
                item.connect('activate', () => {
                    this._activateApplication(app, workspace);
                });

                // Check if all top-level windows are minimized (ignoring transients)
                const allMinimized = appWindows.length > 0 && appWindows.every(w => w.minimized);

                // Style based on application state
                if (app === focusedApp) {
                    // Current app: bold text + checkmark ornament
                    item.label.style = 'font-weight: 600;';
                    item.setOrnament(PopupMenu.Ornament.CHECK);
                } else if (allMinimized) {
                    // Hidden/minimized app: dim and desaturate
                    item.label.set_opacity(128); // 50% opacity

                    if (item._icon) {
                        // Apply visual effects to indicate hidden state
                        const desaturate = new Clutter.DesaturateEffect();
                        desaturate.set_factor(0.50); // 50% desaturated

                        const brightnessContrast = new Clutter.BrightnessContrastEffect();
                        brightnessContrast.set_brightness(-0.10); // Dim by 10%
                        brightnessContrast.set_contrast(-0.10); // Reduce contrast by 10%

                        item._icon.add_effect(desaturate);
                        item._icon.add_effect(brightnessContrast);
                        item._icon.set_opacity(204); // 80% opacity
                    }

                    item.setOrnament(PopupMenu.Ornament.NONE);
                    item.add_style_class_name('all-minimized');
                } else {
                    // Normal app: no special styling
                    item.sensitive = true;
                    item.setOrnament(PopupMenu.Ornament.NONE);
                }

                this.menu.addMenuItem(item);
            }

            // Handle "Hide Others" visibility/sensitivity
            // Only show if there are OTHER APPS (not just other windows) with visible windows
            const otherAppsWithVisibleWindows = windows.some(win => {
                const winApp = Shell.WindowTracker.get_default().get_window_app(win);
                return winApp !== focusedApp && !win.minimized;
            });

            if (!otherAppsWithVisibleWindows) {
                this._hideOthersItem.visible = false;
            } else {
                this._hideOthersItem.visible = true;
                this._hideOthersItem.sensitive = true;
            }

            // Handle "Show All" visibility - check if any windows are minimized on current workspace
            const hasMinimizedWindows = windows.some(win => win.minimized);
            if (!hasMinimizedWindows) {
                this._showAllItem.visible = false;
            } else {
                this._showAllItem.visible = true;
                this._showAllItem.sensitive = true;
            }
        }

        /**
         * 4. Connect all necessary signals for tracking window and workspace changes
         */
        _connectSignals() {
            // Track focus window changes
            this._displayId = global.display.connect(
                'notify::focus-window',
                () => this._update()
            );

            // Track workspace changes
            this._workspaceId = global.workspace_manager.connect(
                'active-workspace-changed',
                () => this._update()
            );

            // Track window creation/destruction
            this._trackerId = Shell.WindowTracker.get_default().connect(
                'tracked-windows-changed',
                () => {
                    // Use idle_add to prevent blocking the main thread
                    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                        this._update();
                        return GLib.SOURCE_REMOVE;
                    });
                }
            );

            // Track settings changes
            this._settingsChangedId = this._settings.connect(
                'changed',
                (settings, key) => {
                    if (key === 'enable-keyboard-shortcuts') {
                        // Reload extension to apply/remove shortcuts
                        this._reloadShortcuts();
                    } else if (key === 'show-menu-hints') {
                        // Rebuild menu to show/hide hints
                        this.menu.removeAll(); // Clear the menu first!
                        this._buildMenu();
                        this._update();
                    } else {
                        this._applySettings();
                    }
                }
            );

            // Track app state changes for launch detection
            this._appStateId = Shell.AppSystem.get_default().connect(
                'app-state-changed',
                (system, app) => {
                    if (app.get_state() === Shell.AppState.STARTING) {
                        this._pendingApp = app;
                        this._update();
                    }
                }
            );

            // Track Activities overview state for context-aware idle display
            this._overviewShowingId = Main.overview.connect(
                'showing',
                () => {
                    // Clear any active idle toggle timeout when entering Activities
                    this._clearTimeout('_idleRevertTimeoutId');
                    this._update();
                }
            );

            this._overviewHidingId = Main.overview.connect(
                'hidden',
                () => {
                    // Clear any active idle toggle timeout when exiting Activities  
                    this._clearTimeout('_idleRevertTimeoutId');
                    this._update();
                }
            );
        }

        /**
         * 5. Update idle state display (Desktop vs Workspace #) based on context
         * @param {boolean} animate - Whether to animate the transition
         */
        _updateIdleDisplay(animate = false) {
            const workspace = global.workspace_manager.get_active_workspace();
            const workspaceNum = workspace.index() + 1;
            const inOverview = Main.overview._visible;

            const updateContent = () => {
                if (inOverview) {
                    // In Activities overview
                    if (this._showingWorkspaceNumber) {
                        // Show workspace number (default in Activities)
                        const iconPath = this._extension.path + '/icons/shell-overview-symbolic.svg';
                        this._icon.gicon = Gio.icon_new_for_string(iconPath);
                        // Translators: %d is the workspace number
                        this._label.text = _('Workspace %d').format(workspaceNum);
                        this.accessible_name = _('Application Switcher - Workspace %d').format(workspaceNum);
                    } else {
                        // Show "No Applications" when toggled
                        const iconPath = this._extension.path + '/icons/system-run-symbolic.svg';
                        this._icon.gicon = Gio.icon_new_for_string(iconPath);
                        this._label.text = _('No Applications');
                        this.accessible_name = _('Application Switcher - No Applications');
                    }
                } else {
                    // On Desktop
                    if (this._showingWorkspaceNumber) {
                        // Show workspace number (peek mode)
                        const iconPath = this._extension.path + '/icons/shell-overview-symbolic.svg';
                        this._icon.gicon = Gio.icon_new_for_string(iconPath);
                        // Translators: %d is the workspace number
                        this._label.text = _('Workspace %d').format(workspaceNum);
                        this.accessible_name = _('Application Switcher - Workspace %d').format(workspaceNum);
                    } else {
                        // Show Desktop (default on Desktop)
                        const iconPath = this._extension.path + '/icons/user-desktop-symbolic.svg';
                        this._icon.gicon = Gio.icon_new_for_string(iconPath);
                        this._label.text = _('Desktop');
                        this.accessible_name = _('Application Switcher - Desktop');
                    }
                }
            };

            if (animate) {
                // Smooth fade transition for manual toggle clicks only
                this._box.ease({
                    opacity: 0,
                    duration: 150,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => {
                        updateContent();

                        // Fade back in
                        this._box.ease({
                            opacity: 255,
                            duration: 150,
                            mode: Clutter.AnimationMode.EASE_IN_QUAD
                        });
                    }
                });
            } else {
                // Instant update for workspace changes and normal updates
                updateContent();
            }
        }

        /**
         * 6. Update the Panel Button to reflect the currently focused application
         */
        _update() {
            // Close menu if it's open when focus changes
            if (this.menu.isOpen) {
                this.menu.close();
            }

            const focusWindow = global.display.focus_window;
            let app = focusWindow ?
                Shell.WindowTracker.get_default().get_window_app(focusWindow) :
                null;

            // Flash fix: hold last known app during launch gap
            if (app) {
                this._lastKnownApp = app;
                // Clear pending only when the NEW app (not the old one) gets focus
                if (this._pendingApp && app.get_id() === this._pendingApp.get_id()) {
                    this._pendingApp = null;
                }
            } else if (this._pendingApp && this._lastKnownApp) {
                app = this._lastKnownApp;
            } else {
                this._lastKnownApp = null;
            }

            if (app) {
                // Update icon and label for focused application
                this._icon.gicon = app.get_icon();
                this._label.text = app.get_name();
                // Translators: %s is the application name
                this._hideCurrentItem.label.text = _('Hide %s').format(app.get_name());
                // Translators: %s is the application name
                this._quitCurrentItem.label.text = _('Quit %s').format(app.get_name());
                // Translators: %s is the application name
                this.accessible_name = _('Application Switcher - %s').format(app.get_name());

                // Show menu items when an app is focused
                this._hideCurrentItem.visible = true;
                this._hideCurrentItem.sensitive = true;
                this._topSeparator.visible = true;
                this._quitCurrentItem.visible = true;
                this._quitCurrentItem.sensitive = true;
                this._hideOthersItem.visible = true;
                this._showAllItem.visible = true;
            } else {
                // No focused application - check if there are hidden apps
                const workspace = global.workspace_manager.get_active_workspace();
                const windows = global.display.get_tab_list(Meta.TabList.NORMAL, workspace);
                const hasAnyApps = windows.some(win => {
                    if (win.get_window_type() !== Meta.WindowType.NORMAL) return false;
                    if (win.is_skip_taskbar()) return false;
                    const winApp = Shell.WindowTracker.get_default().get_window_app(win);
                    return winApp !== null;
                });

                if (hasAnyApps) {
                    // There are hidden apps - ALWAYS show "Desktop" (even in Activities)
                    // This keeps the menu functional and provides visual continuity
                    const iconPath = this._extension.path + '/icons/user-desktop-symbolic.svg';
                    this._icon.gicon = Gio.icon_new_for_string(iconPath);
                    this._label.text = _('Desktop');
                    this.accessible_name = _('Application Switcher - Desktop');
                } else {
                    // Truly no apps - show context-aware idle state
                    const inOverview = Main.overview._visible;

                    // Reset toggle state when transitioning to/from Activities
                    if (inOverview) {
                        // In Activities: default to showing workspace number
                        this._showingWorkspaceNumber = true;
                    } else {
                        // On Desktop: default to showing "Desktop"
                        this._showingWorkspaceNumber = false;
                    }

                    this._updateIdleDisplay();
                }

                // Hide menu items when on desktop (no focused app)
                this._hideCurrentItem.visible = false;
                this._topSeparator.visible = false;
                this._quitCurrentItem.visible = false;
                this._hideOthersItem.visible = false;
                this._showAllItem.visible = false;
            }

            // Rebuild the application list in the menu
            this._buildApplicationList();
        }

        /**
         * 7. Activate an application by bringing its windows to focus
         * @param {Shell.App} app - The application to activate
         * @param {Meta.Workspace} workspace - The current workspace
         */
        _activateApplication(app, workspace) {
            // Get windows in proper stacking order from the display
            const allWindowsInStack = global.display.get_tab_list(Meta.TabList.NORMAL, workspace);

            // Filter to only this app's windows on this workspace
            const windows = allWindowsInStack.filter(w =>
                app.get_windows().includes(w) && w.get_workspace() === workspace
            );

            if (windows.length === 0) return;

            // Sort by user time (most recent first) - but starting from stable stacking order
            windows.sort((a, b) => b.get_user_time() - a.get_user_time());

            // Separate minimized and visible windows
            const minimizedWindows = windows.filter(w => w.minimized);
            const visibleWindows = windows.filter(w => !w.minimized);

            if (minimizedWindows.length > 0) {
                // If there are minimized windows, restore them all
                minimizedWindows.forEach(win => win.unminimize());

                // Activate in reverse order (oldest first) to build proper stack
                for (let i = minimizedWindows.length - 1; i >= 0; i--) {
                    Main.activateWindow(minimizedWindows[i], global.get_current_time());
                }

                // Finally activate the most recent one
                if (minimizedWindows[0]) {
                    Main.activateWindow(minimizedWindows[0], global.get_current_time());
                }
            } else if (visibleWindows.length > 1) {
                // Multiple visible windows - raise them all to front
                // Activate in reverse order (oldest first) to build proper stack
                for (let i = visibleWindows.length - 1; i >= 0; i--) {
                    Main.activateWindow(visibleWindows[i], global.get_current_time());
                }

                // Finally activate the most recent one on top
                if (visibleWindows[0]) {
                    Main.activateWindow(visibleWindows[0], global.get_current_time());
                }
            } else {
                // Single visible window, just activate it
                Main.activateWindow(windows[0], global.get_current_time());
            }

            // Force menu refresh to update list order and checkmark
            this._clearTimeout('_updateTimeoutId');
            this._updateTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                this._update();
                this._updateTimeoutId = null;
                return GLib.SOURCE_REMOVE;
            });
        }

        /**
         * 8-1. Hide all windows of the currently focused application on current workspace (Using 'Hide' in menu or Super+H)
         */
        _hideCurrentApp() {
            const focusedApp = Shell.WindowTracker.get_default().focus_app;
            if (!focusedApp) return;

            const workspace = global.workspace_manager.get_active_workspace();

            // Track which windows we're hiding so we can restore ONLY these
            this._lastHiddenWindows = [];
            this._lastHiddenApp = focusedApp;

            focusedApp.get_windows().forEach(win => {
                if (!win.minimized && win.get_workspace() === workspace) {
                    this._lastHiddenWindows.push(win);
                    win.minimize();
                }
            });
        }

        /**
         * 8-2. Show the most recently hidden application on current workspace (via Super+U)
         */
        _showRecentApp() {
            // Check if we have tracked hidden windows
            if (!this._lastHiddenWindows || this._lastHiddenWindows.length === 0) {
                // No specifically hidden windows to restore
                return;
            }

            const workspace = global.workspace_manager.get_active_workspace();

            // Filter to only windows that are still minimized and on current workspace
            const windowsToRestore = this._lastHiddenWindows.filter(win => {
                return win?.minimized && win?.get_workspace() === workspace;
            });

            if (windowsToRestore.length === 0) {
                // All tracked windows are already visible or destroyed
                this._lastHiddenWindows = [];
                this._lastHiddenApp = null;
                return;
            }

            // Restore the windows we specifically hid
            windowsToRestore.forEach(win => win.unminimize());

            // Sort by user time and activate
            windowsToRestore.sort((a, b) => b.get_user_time() - a.get_user_time());

            // Activate in reverse order (oldest first) to build proper stack
            for (let i = windowsToRestore.length - 1; i >= 0; i--) {
                Main.activateWindow(windowsToRestore[i], global.get_current_time());
            }

            // Finally activate the most recent one on top
            if (windowsToRestore[0]) {
                Main.activateWindow(windowsToRestore[0], global.get_current_time());
            }

            // Clear the tracking since we've restored them
            this._lastHiddenWindows = [];
            this._lastHiddenApp = null;

        }

        /**
         * 8-3. Hide all applications except the currently focused application on the current workspace ('Hide Others' in menu or via Alt+Super+H)
         */
        _hideOthers() {
            const focusedApp = Shell.WindowTracker.get_default().focus_app;
            if (!focusedApp) return;

            const workspace = global.workspace_manager.get_active_workspace();
            const allWindows = global.display.get_tab_list(Meta.TabList.NORMAL, workspace);

            allWindows.forEach(win => {
                const winApp = Shell.WindowTracker.get_default().get_window_app(win);
                if (winApp !== focusedApp && !win.minimized) {
                    win.minimize();
                }
            });
        }

        /**
         * 8-4. Show all (hidden/minimized) applications and windows on the current workspace ('Show All' in menu or via Alt+Super+U)
         */
        _showAll() {
            const workspace = global.workspace_manager.get_active_workspace();
            const allWindows = global.display.get_tab_list(Meta.TabList.NORMAL, workspace);

            // Get all minimized windows
            const minimizedWindows = allWindows.filter(win => win.minimized);

            if (minimizedWindows.length === 0) return;

            // Sort by user time (most recent first)
            minimizedWindows.sort((a, b) => b.get_user_time() - a.get_user_time());

            // Unminimize all windows first
            minimizedWindows.forEach(win => win.unminimize());

            // Now raise them in reverse order (oldest first) by activating each
            // This forces proper stacking - each activation brings that window to front
            for (let i = minimizedWindows.length - 1; i >= 0; i--) {
                Main.activateWindow(minimizedWindows[i], global.get_current_time());
            }

            // Finally, ensure the most recent one ends up on top with focus
            if (minimizedWindows[0]) {
                Main.activateWindow(minimizedWindows[0], global.get_current_time());
            }
        }

        /**
         * 8-5. Minimize the currently focused window on the current workspace (via Super+M)
         */
        _minimizeCurrentWindow() {
            const focusWindow = global.display.focus_window;
            if (!focusWindow) return;

            // Track this window so we can unminimize it (via Alt+Super+M)
            this._lastMinimizedWindow = focusWindow;

            // Minimize just this one window
            focusWindow.minimize();
        }

        /**
         * 8-6. Unminimize the most recently minimized window on the current workspace (via Alt+Super+M)
         */
        _unminimizeRecentWindow() {
            // Check if we have a tracked minimized window
            if (!this._lastMinimizedWindow) {
                // No specifically minimized window to restore
                return;
            }

            const workspace = global.workspace_manager.get_active_workspace();

            // Check if the window is still minimized and on current workspace
            if (this._lastMinimizedWindow?.minimized &&
                this._lastMinimizedWindow?.get_workspace() === workspace) {
                // Unminimize and activate
                this._lastMinimizedWindow.unminimize();
                Main.activateWindow(this._lastMinimizedWindow, global.get_current_time());
            }
            // Clear the tracking since we've restored it
            this._lastMinimizedWindow = null;
        }

        /**
         * 8-7. Close the currently focused window on the current workspace (via Super+W)
         */
        _closeCurrentWindow() {
            const focusWindow = global.display.focus_window;
            if (!focusWindow) return;

            // Close the window gracefully
            focusWindow.delete(global.get_current_time());
        }

        /**
         * 8-8. Quit the currently focused application on the current workspace (via Super+Q)
         */
        _quitCurrentApp() {
            const focusedApp = Shell.WindowTracker.get_default().focus_app;
            if (!focusedApp) return;

            // Request the application to quit gracefully
            focusedApp.request_quit();
        }

        /**
         * 9. Setup optional keyboard shortcuts for app management
         */
        _setupKeyboardShortcuts() {
            if (!this._settings.get_boolean('enable-keyboard-shortcuts')) {
                return;
            }

            const wmSettings = new Gio.Settings({
                schema_id: 'org.gnome.desktop.wm.keybindings'
            });
            const shellSettings = new Gio.Settings({
                schema_id: 'org.gnome.shell.keybindings'
            });

            // Just override GNOME defaults - don't store anything!
            wmSettings.set_strv('minimize', []);
            shellSettings.reset('toggle-message-tray');
            shellSettings.set_strv('toggle-message-tray', ['<Super>v']);

            // Register all our custom shortcuts

            // Super+H: Hide the current application (all windows)
            const hideAppId = Main.wm.addKeybinding(
                'hide-current-app',
                this._settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL,
                () => this._hideCurrentApp()
            );
            if (hideAppId) this._keyBindingIds.push('hide-current-app');

            // Alt+Super+H: Hide all other applications
            const hideOthersId = Main.wm.addKeybinding(
                'hide-others',
                this._settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL,
                () => this._hideOthers()
            );
            if (hideOthersId) this._keyBindingIds.push('hide-others');

            // Super+U: Show most recently hidden application
            const showRecentId = Main.wm.addKeybinding(
                'show-recent-app',
                this._settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL,
                () => this._showRecentApp()
            );
            if (showRecentId) this._keyBindingIds.push('show-recent-app');

            // Alt+Super+U: Show all hidden applications (equivalent to 'Show All' menu item)
            const showAllAppsId = Main.wm.addKeybinding(
                'show-all-apps',
                this._settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL,
                () => this._showAll()
            );
            if (showAllAppsId) this._keyBindingIds.push('show-all-apps');

            // Super+M: Minimize the current window (single window, not entire app)
            const minimizeWindowId = Main.wm.addKeybinding(
                'minimize-current-window',
                this._settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL,
                () => this._minimizeCurrentWindow()
            );
            if (minimizeWindowId) this._keyBindingIds.push('minimize-current-window');

            // Alt+Super+M: Unminimize most recently minimized window
            const unminimizeRecentId = Main.wm.addKeybinding(
                'unminimize-recent-window',
                this._settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL,
                () => this._unminimizeRecentWindow()
            );
            if (unminimizeRecentId) this._keyBindingIds.push('unminimize-recent-window');

            // Super+W: Close the current window
            const closeWindowId = Main.wm.addKeybinding(
                'close-current-window',
                this._settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL,
                () => this._closeCurrentWindow()
            );
            if (closeWindowId) this._keyBindingIds.push('close-current-window');

            // Super+Q: Quit the current application
            const quitAppId = Main.wm.addKeybinding(
                'quit-current-app',
                this._settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL,
                () => this._quitCurrentApp()
            );
            if (quitAppId) this._keyBindingIds.push('quit-current-app');
        }

        /**
         * 10. Apply user preferences from settings
         */
        _applySettings() {
            // Update label visibility
            this._label.visible = this._settings.get_boolean('show-label');

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

            // Reposition if necessary
            if (currentParent !== targetBox) {
                // Moving to a different panel box
                if (currentParent) {
                    currentParent.remove_child(this);
                }
                targetBox.insert_child_at_index(this, desiredPos);
            } else if (currentParent) {
                // Same box, check if position needs adjustment
                const currentPos = currentParent.get_children().indexOf(this);
                if (currentPos !== desiredPos && desiredPos < currentParent.get_children().length) {
                    currentParent.remove_child(this);
                    targetBox.insert_child_at_index(this, desiredPos);
                }
            }
        }

        /**
         * 11. Reload keyboard shortcuts when setting changes
         */
        _reloadShortcuts() {
            const shortcutsEnabled = this._settings.get_boolean('enable-keyboard-shortcuts');

            if (!shortcutsEnabled) {
                // User DISABLED shortcuts - clean up!
                this._cleanupKeybindings();
            } else {
                // User ENABLED shortcuts - set them up!
                this._setupKeyboardShortcuts();
            }

            // IMPORTANT: Rebuild menu with proper clearing
            this.menu.removeAll();
            this._buildMenu();
            this._update();
        }

        /**
         * 12. Clean up keyboard shortcuts and restore GNOME defaults
         */
        _cleanupKeybindings() {
            // Remove our custom keybindings
            this._keyBindingIds.forEach(id => {
                Main.wm.removeKeybinding(id);
            });
            this._keyBindingIds = [];

            // Reset GNOME defaults
            const wmSettings = new Gio.Settings({
                schema_id: 'org.gnome.desktop.wm.keybindings'
            });
            wmSettings.reset('minimize');

            const shellSettings = new Gio.Settings({
                schema_id: 'org.gnome.shell.keybindings'
            });
            shellSettings.reset('toggle-message-tray');
        }

        /**
         * 13. Clean up resources and disconnect signals
         */
        destroy() {
            this._clearTimeout('_updateTimeoutId');
            this._clearTimeout('_idleRevertTimeoutId');

            if (this._buttonPressId) {
                this.disconnect(this._buttonPressId);
                this._buttonPressId = null;
            }
            if (this._scrollEventId) {
                this.disconnect(this._scrollEventId);
                this._scrollEventId = null;
            }

            // Clean up keyboard shortcuts
            this._cleanupKeybindings();

            // Disconnect all signals to prevent memory leaks
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

            // Null them out for completeness
            this._displayId = this._workspaceId = this._trackerId = this._settingsChangedId = this._appStateId = null;
            this._overviewShowingId = this._overviewHidingId = null;
            this._pendingApp = null;
            this._lastKnownApp = null;
            this._lastHiddenApp = null;
            this._lastHiddenWindows = null;
            this._lastMinimizedWindow = null;

            super.destroy();
        }
    });

/**
 * Main Extension class
 */
export default class extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._switcher = new ClassicAppSwitcher(this._settings, this);

        // Add to panel - positioning is handled by _applySettings in _init
        Main.panel.addToStatusArea(`${this.uuid}-switcher`, this._switcher);

        // Setup keyboard shortcuts if enabled (after switcher is created)
        if (this._settings.get_boolean('enable-keyboard-shortcuts')) {
            this._switcher._setupKeyboardShortcuts();
        }
    }

    disable() {
        if (this._switcher) {
            this._switcher._cleanupKeybindings();
            this._switcher.destroy();
            this._switcher = null;
        }
        this._settings = null;
    }
}
