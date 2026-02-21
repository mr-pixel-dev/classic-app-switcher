'use strict';

import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {
    gettext as _
} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import * as EventHandlers from './eventHandlers.js';
import * as WindowManager from './windowManager.js';

/**
 * Switcher Menu - Left-click menu for app switching and management
 * All functions receive the switcher instance as first parameter
 */

/**
 * Create the Switcher Menu structure (ONCE on extension enable)
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 */
export function createSwitcherMenu(switcher) {
    // Set as primary menu
    switcher.menu = switcher._switcherMenu;

    // Create source actor for switcher menu
    switcher._switcherSourceActor = switcher;

    // Create independent switcher menu
    switcher._switcherMenu = new PopupMenu.PopupMenu(
        switcher._switcherSourceActor,
        0.5,
        St.Side.TOP,
    );
    switcher._switcherMenu.actor.hide();

    // Add CSS Classes
    switcher._switcherMenu.actor.add_style_class_name('panel-menu classic-app-switcher-menu');

    // Add to UI Group and Menu Manager for proper management
    Main.uiGroup.add_child(switcher._switcherMenu.actor);
    Main.panel.menuManager.addMenu(switcher._switcherMenu);

    // Ensure focus manager tracks keyboard navigation
    switcher._switcherMenu.actor.connect('key-press-event',
        (actor, event) => EventHandlers.onMenuKeyPress(switcher, actor, event));

    // Create switcher actions section
    switcher._switcherActionsSection = new PopupMenu.PopupMenuSection();
    switcher._switcherMenu.addMenuItem(switcher._switcherActionsSection, 0);

    // Populate initial content
    buildSwitcherActions(switcher);

    // Create menu separator
    switcher._bottomSeparator = new PopupMenu.PopupSeparatorMenuItem();
    switcher._switcherMenu.addMenuItem(switcher._bottomSeparator, 2);

    // Create workspace switcher section
    switcher._appWorkspaceSection = new PopupMenu.PopupMenuSection();
    switcher._switcherMenu.addMenuItem(switcher._appWorkspaceSection, 3);

    // Create workspace switcher submenu
    switcher._switcherSubmenu = new PopupMenu.PopupSubMenuMenuItem(_('Move to Workspace'));
    switcher._appWorkspaceSection.addMenuItem(switcher._switcherSubmenu);

    // Manage panel button state and menu height
    switcher._switcherMenu.connectObject(
        'open-state-changed', (menu, open) => {
            if (open) {
                switcher.add_style_pseudo_class('active');

                // Calculate menu max-height dynamically
                const workArea = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
                const scaleFactor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
                const verticalMargins = switcher._switcherMenu.actor.margin_top + switcher._switcherMenu.actor.margin_bottom;
                const maxHeight = Math.round((workArea.height - verticalMargins) / scaleFactor);
                switcher._switcherMenu.actor.set_style(`max-height: ${maxHeight}px;`);
            } else {
                switcher.remove_style_pseudo_class('active');
            }
        }, switcher);

}

/**
 * Build the switcher actions section (Hide, Hide Others, Show All, Quit)
 * Called when keyboard shortcuts or hints toggle changes
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 */
export function buildSwitcherActions(switcher) {
    // Clear existing action items
    switcher._switcherActionsSection.removeAll();

    // Hide Application
    switcher._hideCurrentItem = new PopupMenu.PopupMenuItem(_('Hide Application'));
    switcher._hideCurrentItem.connect('activate', () => {
        WindowManager.hideCurrentApp(switcher);
    });
    switcher._switcherActionsSection.addMenuItem(switcher._hideCurrentItem);
    addKeyboardHint(switcher, switcher._hideCurrentItem, 'Super+H');

    // Hide Others
    switcher._hideOthersItem = new PopupMenu.PopupMenuItem(_('Hide Others'));
    switcher._hideOthersItem.connect('activate', () => {
        WindowManager.hideOthers(switcher);
    });
    switcher._switcherActionsSection.addMenuItem(switcher._hideOthersItem);
    addKeyboardHint(switcher, switcher._hideOthersItem, 'Alt+Super+H');

    // Show All
    switcher._showAllItem = new PopupMenu.PopupMenuItem(_('Show All'));
    switcher._showAllItem.connect('activate', () => {
        WindowManager.showAll(switcher);
    });
    switcher._switcherActionsSection.addMenuItem(switcher._showAllItem);

    // Menu Separator
    switcher._topSeparator = new PopupMenu.PopupSeparatorMenuItem();
    switcher._switcherActionsSection.addMenuItem(switcher._topSeparator);

    // Quit Application
    switcher._quitCurrentItem = new PopupMenu.PopupMenuItem(_('Quit Application'));
    switcher._quitCurrentItem.connect('activate', () => {
        WindowManager.quitCurrentApp(switcher);
    });
    switcher._switcherActionsSection.addMenuItem(switcher._quitCurrentItem);
    addKeyboardHint(switcher, switcher._quitCurrentItem, 'Super+Q');
}

/**
 * Update ALL switcher menu items visibility (Hide, Hide Others, Show All, Quit)
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 */
export function updateConditionalMenuItems(switcher) {
    // Guard: Don't update if menu items are destroyed
    if (!switcher._hideOthersItem || !switcher._showAllItem ||
        !switcher._hideCurrentItem || !switcher._quitCurrentItem) {
        return;
    }

    const workspace = global.workspace_manager.get_active_workspace();
    const windows = global.display.get_tab_list(Meta.TabList.NORMAL, workspace);
    const focusedApp = Shell.WindowTracker.get_default().focus_app;

    // Check if there are OTHER APPS (not current) with visible windows
    const otherAppsWithVisibleWindows = windows.some(win => {
        const winApp = Shell.WindowTracker.get_default().get_window_app(win);
        return winApp && winApp !== focusedApp && !win.minimized;
    });

    // Check if ANY windows are minimized
    const hasMinimizedWindows = windows.some(win => win.minimized);

    // Check if ALL windows are minimized
    const allWindowsMinimized = windows.length > 0 && windows.every(win => win.minimized);

    // Check if NO windows are open at all
    const noWindowsOpen = windows.length === 0;

    // Update visibility based on actual state
    switcher._hideOthersItem.visible = otherAppsWithVisibleWindows;
    switcher._hideOthersItem.sensitive = otherAppsWithVisibleWindows;

    switcher._showAllItem.visible = hasMinimizedWindows;
    switcher._showAllItem.sensitive = hasMinimizedWindows;

    // Hide current app-specific items when ALL windows are minimized OR NO windows are open
    if (allWindowsMinimized || noWindowsOpen) {
        switcher._hideCurrentItem.visible = false;
        switcher._quitCurrentItem.visible = false;
    } else {
        switcher._hideCurrentItem.visible = true;
        switcher._quitCurrentItem.visible = true;
    }

    // Inactivate workspace switcher submenu if all apps are hidden/all windows are minimised
    switcher._switcherSubmenu.sensitive = windows.some(win => !win.minimized);
}

/**
 * Add keyboard shortcut hint to a menu item
 * Only adds hint if keyboard shortcuts are enabled and hints are visible in settings
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 * @param {PopupMenu.PopupMenuItem} item - The menu item to add hint to
 * @param {string} shortcut - The keyboard shortcut text (e.g., 'Super+H')
 */
export function addKeyboardHint(switcher, item, shortcut) {
    // Only add if shortcuts are enabled and hints are visible
    if (!switcher._settings.get_boolean('enable-keyboard-shortcuts') ||
        !switcher._settings.get_boolean('show-menu-hints')) {
        return;
    }

    // Add spacer to push hint to the right
    const spacer = new St.Widget({
        x_expand: true
    });
    item.label.get_parent().add_child(spacer);

    // Create hint label with reduced opacity for subtle appearance
    const hintLabel = new St.Label({
        text: shortcut,
        y_align: Clutter.ActorAlign.CENTER
    });
    hintLabel.set_opacity(153);
    item.label.get_parent().add_child(hintLabel);
}

/**
 * Build the app-list scrollview widget
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 */
export function buildApplicationList(switcher) {
    // Cleanup old section if exists
    if (switcher._appListSection) {
        switcher._appListSection.destroy();
        switcher._appListSection = null;
    }

    const workspace = global.workspace_manager.get_active_workspace();
    const apps = new Set();
    const windows = global.display.get_tab_list(Meta.TabList.NORMAL, workspace);

    // Collect apps
    for (const win of windows) {
        if (win.get_window_type() !== Meta.WindowType.NORMAL) continue;
        if (win.is_skip_taskbar()) continue;
        if (win.get_transient_for() !== null) continue;

        const app = Shell.WindowTracker.get_default().get_window_app(win);
        if (!app) continue;
        apps.add(app);
    }

    const sorted = Array.from(apps);
    const focusedApp = Shell.WindowTracker.get_default().focus_app;

    // Don't build widget if no apps
    if (sorted.length === 0) {
        return;
    }

    // Create a section that will hold the header + scrollable items
    const appListContentSection = new PopupMenu.PopupMenuSection();

    // Add separator header
    const appListHeader = new PopupMenu.PopupSeparatorMenuItem(_('Open Applications'));
    appListContentSection.addMenuItem(appListHeader);

    // Build app items and add to section
    for (const app of sorted) {
        const appWindows = app.get_windows().filter(w => {
            return w.get_workspace() === workspace &&
                w.get_window_type() === Meta.WindowType.NORMAL &&
                w.get_transient_for() === null;
        });

        const windowCount = appWindows.length;
        const visibleCount = appWindows.filter(w => !w.minimized).length;
        const displayText = app.get_name();

        const item = new PopupMenu.PopupImageMenuItem(displayText, app.get_icon());
        item.label.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        // Add window count if multiple windows
        if (windowCount > 1) {
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

        // Handle activation
        item.connect('activate', () => {
            WindowManager.activateApplication(switcher, app, workspace);
        });

        // Style based on state
        const allMinimized = appWindows.length > 0 && appWindows.every(w => w.minimized);

        if (app === focusedApp) {
            item.label.style = 'font-weight: 600;';
            item.setOrnament(PopupMenu.Ornament.CHECK);
        } else if (allMinimized) {
            item.label.set_opacity(128);

            if (item._icon) {
                const desaturate = new Clutter.DesaturateEffect();
                desaturate.set_factor(0.50);

                const brightnessContrast = new Clutter.BrightnessContrastEffect();
                brightnessContrast.set_brightness(-0.10);
                brightnessContrast.set_contrast(-0.10);

                item._icon.add_effect(desaturate);
                item._icon.add_effect(brightnessContrast);
                item._icon.set_opacity(204);
            }

            item.setOrnament(PopupMenu.Ornament.NONE);
            item.add_style_class_name('all-minimized');
        } else {
            item.sensitive = true;
            item.setOrnament(PopupMenu.Ornament.NONE);
        }

        // Add item to section
        appListContentSection.addMenuItem(item);
    }

    // Create ScrollView and wrap the section's actor
    switcher._appListScrollView = new St.ScrollView({
        style_class: 'app-list-scrollview',
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.EXTERNAL,
        x_expand: true,
        y_expand: true
    });

    // Add the section's actor to ScrollView
    switcher._appListScrollView.add_child(appListContentSection.actor);

    // Create outer section to hold the ScrollView
    switcher._appListSection = new PopupMenu.PopupMenuSection();
    switcher._appListSection.box.add_child(switcher._appListScrollView);

    // Add the section to the menu at position 1 (between actions and workspace)
    switcher._switcherMenu.addMenuItem(switcher._appListSection, 1);
}

/**
 * Update workspace submenu in switcher menu (moves ALL app windows)
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 */
export function updateSwitcherSubmenu(switcher) {
    if (!switcher._switcherSubmenu) return;

    const workspaceManager = global.workspace_manager;
    const nWorkspaces = workspaceManager.n_workspaces;
    const currentWorkspace = workspaceManager.get_active_workspace();

    // Hide if only one workspace
    if (nWorkspaces <= 1) {
        switcher._switcherSubmenu.visible = false;
        return;
    }

    switcher._switcherSubmenu.visible = true;
    switcher._switcherSubmenu.menu.removeAll();

    // Store original and alternative submenu labels
    switcher._switcherSubmenu._moveText = _('Move to Workspace');
    switcher._switcherSubmenu._sendText = _('Send to Workspace');

    // Reset to default text
    switcher._switcherSubmenu.label.text = switcher._switcherSubmenu._moveText;

    // Disconnect old handlers if they exist
    if (switcher._switcherSubmenu._keyPressId) {
        switcher._switcherMenu.actor.disconnect(switcher._switcherSubmenu._keyPressId);
    }
    if (switcher._switcherSubmenu._keyReleaseId) {
        switcher._switcherMenu.actor.disconnect(switcher._switcherSubmenu._keyReleaseId);
    }

    // Monitor key press/release events on the menu actor
    switcher._switcherSubmenu._keyPressId = switcher._switcherMenu.actor.connect('key-press-event', (actor, event) => {
        const keyval = event.get_key_symbol();
        if (keyval === Clutter.KEY_Alt_L || keyval === Clutter.KEY_Alt_R) {
            switcher._switcherSubmenu.label.text = switcher._switcherSubmenu._sendText;
        }
        return Clutter.EVENT_PROPAGATE;
    });

    switcher._switcherSubmenu._keyReleaseId = switcher._switcherMenu.actor.connect('key-release-event', (actor, event) => {
        const keyval = event.get_key_symbol();
        if (keyval === Clutter.KEY_Alt_L || keyval === Clutter.KEY_Alt_R) {
            switcher._switcherSubmenu.label.text = switcher._switcherSubmenu._moveText;
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
                moveAppToWorkspace(switcher, i, false);

                // Get app name for notification
                const focusedApp = Shell.WindowTracker.get_default().focus_app;
                const appName = focusedApp ? focusedApp.get_name() : _('Application');

                Main.notify(_('Application Moved'),
                    // Translators: %s is application name, %d is workspace number
                    _('%s Sent to Workspace %d').format(appName, i + 1));
            } else {
                // MOVE mode - move and switch workspace (default)
                moveAppToWorkspace(switcher, i, true);
            }
        });
        // Add menu-items to workspace switcher submenu
        switcher._switcherSubmenu.menu.addMenuItem(item);
    }
}

/**
 * Move all windows of the current app to a workspace
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 * @param {number} workspaceIndex - The workspace index
 * @param {boolean} switchWorkspace - Whether to switch to the target workspace (default: true)
 */
export function moveAppToWorkspace(switcher, workspaceIndex, switchWorkspace = true) {
    const focusedApp = Shell.WindowTracker.get_default().focus_app;
    if (!focusedApp) return;

    const workspaceManager = global.workspace_manager;
    const targetWorkspace = workspaceManager.get_workspace_by_index(workspaceIndex);
    if (!targetWorkspace) return;

    // Move all windows of this app to target workspace
    const windows = focusedApp.get_windows();
    windows.forEach(win => {
        if (win.get_window_type() === Meta.WindowType.NORMAL) {
            win.change_workspace(targetWorkspace);
        }
    });

    // Close menus
    switcher._closeAllMenus();

    // Switch to workspace if requested (default behavior)
    if (switchWorkspace) {
        targetWorkspace.activate(global.get_current_time());
    }
}
