'use strict';

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {
    gettext as _
} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

/**
 * Context Menu - Right-click menu for app actions and window management
 * All functions receive the switcher instance as first parameter
 */

// Gresource icon paths
const RESOURCE_BASE = 'resource:///org/gnome/shell/extensions/classic-app-switcher/icons';

/**
 * Create the Context Menu structure (ONCE on extension enable)
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 */
export function createContextMenu(switcher) {
    // Create source actor for context menu
    switcher._contextSourceActor = switcher;

    // Create independent context menu
    switcher._contextMenu = new PopupMenu.PopupMenu(
        switcher._contextSourceActor,
        0.5,
        St.Side.TOP,
    );
    switcher._contextMenu.actor.hide();

    // Add CSS Classes
    switcher._contextMenu.actor.add_style_class_name('panel-menu classic-app-switcher-context-menu');

    // Add to UI Group and Menu Manager for proper management
    Main.uiGroup.add_child(switcher._contextMenu.actor);
    Main.panel.menuManager.addMenu(switcher._contextMenu);

    // Create app actions section
    switcher._appActionListSection = new PopupMenu.PopupMenuSection();
    switcher._contextMenu.addMenuItem(switcher._appActionListSection, 0);

    // Create menu separator
    switcher._contextBottomSeparator = new PopupMenu.PopupSeparatorMenuItem();
    switcher._contextMenu.addMenuItem(switcher._contextBottomSeparator, 2);

    // Create workspace switcher section
    switcher._windowWorkspaceSection = new PopupMenu.PopupMenuSection();
    switcher._contextMenu.addMenuItem(switcher._windowWorkspaceSection, 3);

    // Manage panel button state and menu height
    switcher._contextMenu.connectObject(
        'open-state-changed', (menu, open) => {
            if (open) {
                switcher.add_style_pseudo_class('active');

                // Calculate menu max-height dynamically
                const workArea = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
                const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
                const verticalMargins = switcher._contextMenu.actor.margin_top + switcher._contextMenu.actor.margin_bottom;
                const maxHeight = Math.round((workArea.height - verticalMargins) / scaleFactor);
                switcher._contextMenu.actor.set_style(`max-height: ${maxHeight}px;`);
            } else {
                switcher.remove_style_pseudo_class('active');
            }
        }, switcher);
}

/**
 * Populate context menu content dynamically
 * Called when right-clicking to show context menu for current app
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 * @param {Shell.App} app - The application
 */
export function buildContextMenuContent(switcher, app) {
    switcher._currentApp = app;

    // Clear existing content
    switcher._appActionListSection.removeAll();
    switcher._windowWorkspaceSection.removeAll();

    // === APP ACTIONS ===
    const appInfo = app.get_app_info();
    const actions = appInfo ? appInfo.list_actions() : [];

    for (const action of actions) {
        const actionName = appInfo.get_action_name(action);
        const actionItem = new PopupMenu.PopupMenuItem(actionName);
        actionItem.connect('activate', () => {
            app.launch_action(action, global.get_current_time(), -1);
        });
        switcher._appActionListSection.addMenuItem(actionItem);
    }

    if (actions.length > 0) {
        switcher._appActionListSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    }

    // Add App Settings
    const appSettingsItem = new PopupMenu.PopupMenuItem(_('App Settings'));
    appSettingsItem.connect('activate', () => {
        const appId = app.get_id();
        if (appId) {
            GLib.spawn_command_line_async(`gnome-control-center applications ${appId}`);
        }
    });
    switcher._appActionListSection.addMenuItem(appSettingsItem);

    // === WINDOW LIST ===
    buildWindowList(switcher, app);

    // Create workspace switcher submenu
    switcher._contextSubmenu = new PopupMenu.PopupSubMenuMenuItem(_('Move to Workspace'));
    switcher._windowWorkspaceSection.addMenuItem(switcher._contextSubmenu);

    // Update workspace switcher submenu
    updateContextSubmenu(switcher);
}

/**
 * Build the window-list scrollview widget
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 * @param {Shell.App} app - The application to show windows for
 */
export function buildWindowList(switcher, app) {
    // Cleanup old section if exists
    if (switcher._windowListSection) {
        switcher._windowListSection.destroy();
        switcher._windowListSection = null;
    }

    const workspace = global.workspace_manager.get_active_workspace();

    // Get windows for this app
    const appWindows = app.get_windows().filter(w => {
        return w.get_workspace() === workspace &&
            w.get_window_type() === Meta.WindowType.NORMAL &&
            w.get_transient_for() === null;
    });

    appWindows.sort((a, b) => b.get_user_time() - a.get_user_time());

    // Create section that will hold header + items
    const windowListContentSection = new PopupMenu.PopupMenuSection();
    const windowListHeader = new PopupMenu.PopupSeparatorMenuItem(_('Open Windows'));

    windowListContentSection.addMenuItem(windowListHeader);

    // Build window items
    for (const win of appWindows) {
        const title = win.get_title() || _('Untitled');

        // Construct icon using gresource paths
        const iconPath = win.minimized ?
            `${RESOURCE_BASE}/scalable/actions/diamond-outline-thick-symbolic.svg` :
            `${RESOURCE_BASE}/scalable/actions/diamond-filled-symbolic.svg`;

        const icon = Gio.icon_new_for_string(iconPath);
        const item = new PopupMenu.PopupImageMenuItem(title, icon);

        item.label.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;

        // Style based on state
        const focusWindow = global.display.focus_window;
        if (win === focusWindow) {
            item.label.style = 'font-weight: 600;';
        } else if (win.minimized) {
            item.label.set_opacity(128);
        }

        // Handle activation
        item.connect('activate', () => {
            if (win.minimized) {
                win.unminimize();
            }
            Main.activateWindow(win, global.get_current_time());
            switcher._switcherMenu.close();
            switcher._contextMenu.close();
        });

        windowListContentSection.addMenuItem(item);
    }

    // Create ScrollView and wrap the section's actor
    switcher._windowListScrollView = new St.ScrollView({
        style_class: 'window-list-scrollview',
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.EXTERNAL,
        x_expand: true,
        y_expand: true
    });

    // Add the section's actor to ScrollView
    switcher._windowListScrollView.add_child(windowListContentSection.actor);

    // Create outer section to hold the ScrollView
    switcher._windowListSection = new PopupMenu.PopupMenuSection();
    switcher._windowListSection.box.add_child(switcher._windowListScrollView);

    // Add the section to menu at position 1
    switcher._contextMenu.addMenuItem(switcher._windowListSection, 1);
}

/**
 * Update workspace submenu in context menu (moves SINGLE window)
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 */
export function updateContextSubmenu(switcher) {
    if (!switcher._contextSubmenu) return;

    const workspaceManager = global.workspace_manager;
    const nWorkspaces = workspaceManager.n_workspaces;
    const currentWorkspace = workspaceManager.get_active_workspace();

    // Hide if only one workspace
    if (nWorkspaces <= 1) {
        switcher._contextSubmenu.visible = false;
        return;
    }

    switcher._contextSubmenu.visible = true;
    switcher._contextSubmenu.menu.removeAll();

    // Store original submenu label
    const originalSubmenuLabel = _('Move to Workspace');
    const altSubmenuLabel = _('Send to Workspace');

    // Reset to default text
    switcher._contextSubmenu.label.text = originalSubmenuLabel;

    // Disconnect old handlers if they exist
    if (switcher._contextSubmenu._keyPressId) {
        switcher._contextMenu.actor.disconnect(switcher._contextSubmenu._keyPressId);
    }
    if (switcher._contextSubmenu._keyReleaseId) {
        switcher._contextMenu.actor.disconnect(switcher._contextSubmenu._keyReleaseId);
    }

    // Monitor key press/release events on the menu actor
    switcher._contextSubmenu._keyPressId = switcher._contextMenu.actor.connect('key-press-event', (actor, event) => {
        const keyval = event.get_key_symbol();
        if (keyval === Clutter.KEY_Alt_L || keyval === Clutter.KEY_Alt_R) {
            switcher._contextSubmenu.label.text = altSubmenuLabel;
        }
        return Clutter.EVENT_PROPAGATE;
    });

    switcher._contextSubmenu._keyReleaseId = switcher._contextMenu.actor.connect('key-release-event', (actor, event) => {
        const keyval = event.get_key_symbol();
        if (keyval === Clutter.KEY_Alt_L || keyval === Clutter.KEY_Alt_R) {
            switcher._contextSubmenu.label.text = originalSubmenuLabel;
        }
        return Clutter.EVENT_PROPAGATE;
    });

    // Add workspace items
    for (let i = 0; i < nWorkspaces; i++) {
        const workspace = workspaceManager.get_workspace_by_index(i);
        const item = new PopupMenu.PopupMenuItem(
            _('Workspace %d').format(i + 1),
        );

        // Set ornament
        if (workspace !== currentWorkspace) {
            item.setOrnament(PopupMenu.Ornament.NO_DOT);
        } else {
            item.setOrnament(PopupMenu.Ornament.DOT);
        }

        // Handle activation
        item.connect('activate', () => {
            const [, , modifiers] = global.get_pointer();
            const altPressed = (modifiers & Clutter.ModifierType.MOD1_MASK) !== 0;

            if (altPressed) {
                // SEND mode - move with notification but don't switch workspace
                moveWindowToWorkspace(switcher, i, false);

                // Get window title for notification
                const focusWindow = global.display.focus_window;
                const windowTitle = focusWindow ? focusWindow.get_title() : _('Window');

                Main.notify(_('Window Moved'),
                    // Translators: %s is window title, %d is workspace number
                    _('%s Sent to Workspace %d').format(windowTitle, i + 1));
            } else {
                // MOVE mode - move and switch workspace (default)
                moveWindowToWorkspace(switcher, i, true);
            }
        });
        // Add menu-items to workspace switcher submenu
        switcher._contextSubmenu.menu.addMenuItem(item);
    }
}

/**
 * Move the focused window to a workspace
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 * @param {number} workspaceIndex - The workspace index
 * @param {boolean} switchWorkspace - Whether to switch to the target workspace (default: true)
 */
export function moveWindowToWorkspace(switcher, workspaceIndex, switchWorkspace = true) {
    const focusWindow = global.display.focus_window;
    if (!focusWindow) return;

    const workspaceManager = global.workspace_manager;
    const targetWorkspace = workspaceManager.get_workspace_by_index(workspaceIndex);
    if (!targetWorkspace) return;

    // Move just this window
    focusWindow.change_workspace(targetWorkspace);

    // Close menus
    switcher._closeAllMenus();

    // Switch to workspace if requested (default behavior)
    if (switchWorkspace) {
        targetWorkspace.activate(global.get_current_time());
    }
}
