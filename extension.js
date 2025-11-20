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
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

/**
 * ClassicAppSwitcher - A Mac OS 9-style application switcher for GNOME
 * 
 * Displays the currently focused application in the panel and provides
 * a menu for switching between applications and managing window visibility.
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
<<<<<<< HEAD
        
        // Initialize separate timeout IDs for each function
        this._activateTimeoutId = null;
        this._updateTimeoutId = null;
        this._showAllTimeoutId = null;
        this._hideCurrentAppTimeoutId = null;
        this._hideOthersTimeoutId = null;
=======
        this._timeoutId = null;
>>>>>>> d146d4823664e0a084b9e1104b24b93543b2a2db

        this._buildUI();
        this._buildMenu();
        this._connectSignals();
        this._applySettings();
        this._update();
    }

    /**
     * Build the UI components for the panel button
     */
    _buildUI() {
        // Create container box for icon and label
        this._box = new St.BoxLayout({
            style_class: 'classic-switcher-box',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: false
        });

        // Application icon
        this._icon = new St.Icon({
            style_class: 'classic-switcher-icon',
            icon_size: 16
        });

        // Application label
        this._label = new St.Label({
            style_class: 'classic-switcher-label',
            y_align: Clutter.ActorAlign.CENTER
        });
        
        // Set ellipsization for long app names (middle mode shows start...end)
        this._label.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;
        this._label.style = 'max-width: 200px;';

        this._box.add_child(this._icon);
        this._box.add_child(this._label);
        
        // Add to the button's container
        this.add_child(this._box);
        
        // Add style class for CSS targeting
        this.add_style_class_name('classic-app-switcher');

        // Set accessible name for screen readers
        this.accessible_name = _('Application Switcher');
    }

    /**
     * Build the static menu items (Hide, Show All, etc.)
     */
    _buildMenu() {
        // Add custom style class to the menu for CSS isolation
        this.menu.actor.add_style_class_name('classic-app-switcher-menu');
        
        // Hide current application menu item
        this._hideCurrentItem = new PopupMenu.PopupMenuItem(_('Hide Desktop'));
        this._hideCurrentItem.connect('activate', () => this._hideCurrentApp());
        this.menu.addMenuItem(this._hideCurrentItem);

        // Hide all other applications
        this._hideOthersItem = new PopupMenu.PopupMenuItem(_('Hide Others'));
        this._hideOthersItem.connect('activate', () => this._hideOthers());
        this.menu.addMenuItem(this._hideOthersItem);

        // Show all applications
        this._showAllItem = new PopupMenu.PopupMenuItem(_('Show All'));
        this._showAllItem.connect('activate', () => this._showAll());
        this.menu.addMenuItem(this._showAllItem);

        // Separator before Quit option
        this._topSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._topSeparator);

        // Quit current application menu item
        this._quitCurrentItem = new PopupMenu.PopupMenuItem(_('Quit Desktop'));
        this._quitCurrentItem.connect('activate', () => this._quitCurrentApp());
        this.menu.addMenuItem(this._quitCurrentItem);

        // Separator before application list with label (ALWAYS visible)
        this._appListSeparator = new PopupMenu.PopupSeparatorMenuItem(_('Open Applications'));
        this.menu.addMenuItem(this._appListSeparator);
        
        // Refresh application list when menu opens to ensure correct stacking order
        this.menu.connect('open-state-changed', (menu, open) => {
            if (open) {
                this._buildApplicationList();
            }
        });
    }

    /**
     * Connect all necessary signals for tracking window and workspace changes
     */
    _connectSignals() {
        try {
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
                this._applySettings.bind(this)
            );
        } catch (e) {
            logError(e, 'ClassicAppSwitcher: Failed to connect signals');
        }
    }

    /**
     * Apply user preferences from settings
     */
    _applySettings() {
        try {
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
        } catch (e) {
            logError(e, 'ClassicAppSwitcher: Failed to apply settings');
        }
    }

    /**
     * Update the panel button to reflect the currently focused application
     */
    _update() {
        // Close menu if it's open when focus changes
        if (this.menu.isOpen) {
            this.menu.close();
        }
    
        try {
            const focusWindow = global.display.focus_window;
            const app = focusWindow
                ? Shell.WindowTracker.get_default().get_window_app(focusWindow)
                : null;

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
                // No focused application, show desktop
                this._icon.icon_name = 'user-desktop-symbolic';
                this._label.text = _('Desktop');
                this._hideCurrentItem.label.text = _('Hide Desktop');
                this._quitCurrentItem.label.text = _('Quit Desktop');
                this.accessible_name = _('Application Switcher - Desktop');
                
                // Hide menu items when on desktop (no focused app)
                this._hideCurrentItem.visible = false;
                this._topSeparator.visible = false;
                this._quitCurrentItem.visible = false;
                this._hideOthersItem.visible = false;
                this._showAllItem.visible = false;
            }

            // Rebuild the application list in the menu
            this._buildApplicationList();
        } catch (e) {
            logError(e, 'ClassicAppSwitcher: Failed to update UI');
        }
    }

    /**
     * Build the dynamic list of running applications in the menu
     */
    _buildApplicationList() {
        try {
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
                // Skip non-normal windows
                if (win.get_window_type() !== Meta.WindowType.NORMAL) continue;
                
                // Skip windows with skip-taskbar hint
                if (win.is_skip_taskbar()) continue;
                
                // Filter by window class for utility apps without .desktop files
                // Note: NautilusPreviewer and similar utilities may still appear
                // as this is also the behavior in GNOME's native dash
                const wmClass = win.get_wm_class();
                const utilityWmClasses = [
                    'org.gnome.NautilusPreviewer',
                    'Gnome-screenshot',
                    'Gnome-font-viewer'
                ];
                
                if (utilityWmClasses.some(cls => wmClass && wmClass.includes(cls))) {
                    continue;
                }
                
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
                const windowsOnWorkspace = app.get_windows().filter(
                    w => w.get_workspace() === workspace
                );
                const windowCount = windowsOnWorkspace.length;
                const visibleCount = windowsOnWorkspace.filter(w => !w.minimized).length;

                // Build the display text with styled window count
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

                // Check if all windows are minimized
                const allMinimized = windowsOnWorkspace.every(w => w.minimized);

                // Style based on application state
                if (app === focusedApp) {
                    // Current app: bold text + checkmark ornament
                    item.label.set_opacity(255); // Full opacity
                    const icon = item.child?.get_child_at_index?.(0);
                    if (icon) {
                        icon.set_opacity(255);
                    }
                    item.label.style = 'font-weight: 600;';
                    item.setOrnament(PopupMenu.Ornament.CHECK);
                } else if (allMinimized) {
                    // Hidden/minimized app: dim but keep clickable
                    item.label.set_opacity(128); // 50% opacity
                    const icon = item.child?.get_child_at_index?.(0);
                    if (icon) {
                        icon.set_opacity(128);
                    }
                    item.add_style_class_name('all-minimized');
                    item.setOrnament(PopupMenu.Ornament.NONE);
                } else {
                    // Normal app: full opacity, no special styling
                    item.label.set_opacity(255);
                    const icon = item.child?.get_child_at_index?.(0);
                    if (icon) {
                        icon.set_opacity(255);
                    }
                    item.sensitive = true;
                    item.setOrnament(PopupMenu.Ornament.NONE);
                }

                this.menu.addMenuItem(item);
            }
            
            // Update the separator label based on whether there are apps
            if (this._appListSeparator && this._appListSeparator.label) {
                if (sorted.length === 0) {
                    this._appListSeparator.label.text = _('No Applications');
                    
                    // Add workspace indicator below the separator
                    const workspaceNum = workspace.index() + 1;
                    // Load bundled icon from extension directory
                    const iconPath = this._extension.path + '/icons/shell-overview-symbolic.svg';
                    const gicon = Gio.icon_new_for_string(iconPath);
                    
                    // Translators: %d is the workspace number
                    this._workspaceItem = new PopupMenu.PopupImageMenuItem(
                        _('Workspace %d').format(workspaceNum),
                        gicon
                    );
                    this._workspaceItem.reactive = false;
                    this._workspaceItem.can_focus = false;
                    this._workspaceItem.sensitive = false; // Dims the text and icon
                    this.menu.addMenuItem(this._workspaceItem); // Append to end
                } else {
                    this._appListSeparator.label.text = _('Open Applications');
                }
            }
            
            // Handle "Hide Others" visibility/sensitivity
            // Only show if there are other VISIBLE windows (not minimized) besides current
            const currentWindow = global.display.focus_window;
            const visibleOtherWindows = windows.filter(win => 
                win !== currentWindow && !win.minimized
            );
            
            if (visibleOtherWindows.length === 0) {
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
        } catch (e) {
            logError(e, 'ClassicAppSwitcher: Failed to build application list');
        }
    }

    /**
     * Activate an application by bringing its windows to focus
     * @param {Shell.App} app - The application to activate
     * @param {Meta.Workspace} workspace - The current workspace
     */
    _activateApplication(app, workspace) {
        try {
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
                
                // Finally activate the most recent one with a small delay
                this._activateTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                    if (minimizedWindows[0]) {
                        Main.activateWindow(minimizedWindows[0], global.get_current_time());
                    }
                    this._activateTimeoutId = null;
                    return GLib.SOURCE_REMOVE;
                });
            } else if (visibleWindows.length > 1) {
                // Multiple visible windows - raise them all to front
                // Activate in reverse order (oldest first) to build proper stack
                for (let i = visibleWindows.length - 1; i >= 0; i--) {
                    Main.activateWindow(visibleWindows[i], global.get_current_time());
                }
                
                // Finally activate the most recent one on top
                this._activateTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                    if (visibleWindows[0]) {
                        Main.activateWindow(visibleWindows[0], global.get_current_time());
                    }
                    this._activateTimeoutId = null;
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                // Single visible window, just activate it
                Main.activateWindow(windows[0], global.get_current_time());
            }
            
            // Force menu refresh to update list order and checkmark
            this._updateTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                this._update();
                this._updateTimeoutId = null;
                return GLib.SOURCE_REMOVE;
            });
        } catch (e) {
            logError(e, `ClassicAppSwitcher: Failed to activate application ${app.get_name()}`);
        }
    }

    /**
     * Hide all windows of the currently focused application on current workspace
     */
    _hideCurrentApp() {
        try {
            const focusedApp = Shell.WindowTracker.get_default().focus_app;
            if (!focusedApp) return;

            const workspace = global.workspace_manager.get_active_workspace();
            
            focusedApp.get_windows().forEach(win => {
                // Only hide windows on the current workspace
                if (!win.minimized && win.get_workspace() === workspace) {
                    win.minimize();
                }
            });
            
            // Force menu refresh to update states
            this._hideCurrentAppTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                this._update();
                this._hideCurrentAppTimeoutId = null;
                return GLib.SOURCE_REMOVE;
            });
        } catch (e) {
            logError(e, 'ClassicAppSwitcher: Failed to hide current app');
        }
    }

    /**
     * Quit the currently focused application
     */
    _quitCurrentApp() {
        try {
            const focusedApp = Shell.WindowTracker.get_default().focus_app;
            if (!focusedApp) return;

            // Request the application to quit gracefully
            focusedApp.request_quit();
        } catch (e) {
            logError(e, 'ClassicAppSwitcher: Failed to quit current app');
        }
    }

    /**
     * Hide all windows except those belonging to the currently focused application
     */
    _hideOthers() {
        try {
            const currentWindow = global.display.focus_window;
            const workspace = global.workspace_manager.get_active_workspace();
            const allWindows = global.display.get_tab_list(Meta.TabList.NORMAL, workspace);

            allWindows.forEach(win => {
                if (win !== currentWindow && !win.minimized) {
                    win.minimize();
                }
            });
            
            // Force menu refresh to update states
            this._hideOthersTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                this._update();
                this._hideOthersTimeoutId = null;
                return GLib.SOURCE_REMOVE;
            });
        } catch (e) {
            logError(e, 'ClassicAppSwitcher: Failed to hide other apps');
        }
    }

    /**
     * Show all minimized windows on the current workspace
     */
    _showAll() {
        try {
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
            // Small delay to let the stack settle
            this._showAllTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                if (minimizedWindows[0]) {
                    Main.activateWindow(minimizedWindows[0], global.get_current_time());
                }
                this._showAllTimeoutId = null;
                return GLib.SOURCE_REMOVE;
            });
            
            // Force menu refresh - reuse updateTimeoutId since this is also an update
            this._updateTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                this._update();
                this._updateTimeoutId = null;
                return GLib.SOURCE_REMOVE;
            });
        } catch (e) {
            logError(e, 'ClassicAppSwitcher: Failed to show all windows');
        }
    }

    /**
     * Clean up resources and disconnect signals
     */
    destroy() {
        // Clean up all timeout IDs
        if (this._activateTimeoutId) {
            GLib.Source.remove(this._activateTimeoutId);
            this._activateTimeoutId = null;
        }
        
        if (this._updateTimeoutId) {
            GLib.Source.remove(this._updateTimeoutId);
            this._updateTimeoutId = null;
        }
        
        if (this._showAllTimeoutId) {
            GLib.Source.remove(this._showAllTimeoutId);
            this._showAllTimeoutId = null;
        }
        
        if (this._hideCurrentAppTimeoutId) {
            GLib.Source.remove(this._hideCurrentAppTimeoutId);
            this._hideCurrentAppTimeoutId = null;
        }
        
        if (this._hideOthersTimeoutId) {
            GLib.Source.remove(this._hideOthersTimeoutId);
            this._hideOthersTimeoutId = null;
        }

        // Disconnect all signals to prevent memory leaks
        if (this._displayId) {
            global.display.disconnect(this._displayId);
            this._displayId = null;
        }

        if (this._workspaceId) {
            global.workspace_manager.disconnect(this._workspaceId);
            this._workspaceId = null;
        }

        if (this._trackerId) {
            Shell.WindowTracker.get_default().disconnect(this._trackerId);
            this._trackerId = null;
        }

        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }

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
    }

    disable() {
        if (this._switcher) {
            this._switcher.destroy();
            this._switcher = null;
        }
        this._settings = null;
    }
}
