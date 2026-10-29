'use strict';

/**
 * @fileoverview Event Handlers - Button clicks, scrolling, and idle state toggles.
 *
 * All functions receive the switcher instance as first parameter.
 *
 * @module eventHandlers
 */

import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as WindowManager from './windowManager.js';
import * as ContextMenu from './contextMenu.js';

/**
 * Handle keyboard presses on the indicator button itself
 * Provides accessibility for opening the context-menu without a mouse
 *
 * @param {import('./indicator.js').ClassicAppSwitcher} switcher - The switcher instance
 * @param {Clutter.Event} event - The key press event
 * @returns {boolean} Clutter.EVENT_STOP to prevent propagation or EVENT_PROPAGATE
 */
export function handleIndicatorKeyPress(switcher, event) {
    const symbol = event.get_key_symbol();
    const state = event.get_state();

    // 1. Check for Shift + F10
    const isShiftF10 =
        symbol === Clutter.KEY_F10 && state & Clutter.ModifierType.SHIFT_MASK;

    // 2. Check for the dedicated Menu key
    const isMenuKey = symbol === Clutter.KEY_Menu;

    // Trigger Right-Click (Secondary) behavior for Context Menu
    if (isShiftF10 || isMenuKey) {
        handleButtonClick(switcher, Clutter.BUTTON_SECONDARY);
        return Clutter.EVENT_STOP;
    }

    // Trigger Left-Click (Primary) behavior for Switcher Menu
    const isEnterOrSpace =
        symbol === Clutter.KEY_Return || symbol === Clutter.KEY_space;

    if (isEnterOrSpace) {
        handleButtonClick(switcher, Clutter.BUTTON_PRIMARY);
        return Clutter.EVENT_STOP;
    }

    // Let other keys (like left/right arrows for panel navigation) pass through
    return Clutter.EVENT_PROPAGATE;
}

/**
 * Handle keyboard navigation in primary switcher and context menus
 * Required for manual menu management (when using dontCreateMenu flag)
 * Based on panelMenu.js setMenu() implementation
 *
 * @param {import('./indicator.js').ClassicAppSwitcher} switcher - The switcher instance
 * @param {Clutter.Actor} actor - The menu actor
 * @param {Clutter.Event} event - The key press event
 * @returns {boolean} Clutter.EVENT_PROPAGATE or Clutter.EVENT_STOP
 */
export function onMenuKeyPress(switcher, actor, event) {
    if (global.focus_manager.navigate_from_event(event))
        return Clutter.EVENT_STOP;

    const symbol = event.get_key_symbol();

    // Handle left/right arrow keys for panel navigation
    if (symbol === Clutter.KEY_Left || symbol === Clutter.KEY_Right) {
        const group = global.focus_manager.get_group(switcher);
        if (group) {
            const direction =
                symbol === Clutter.KEY_Left
                    ? St.DirectionType.TAB_BACKWARD
                    : St.DirectionType.TAB_FORWARD;
            group.navigate_focus(switcher, direction, false);
            return Clutter.EVENT_STOP;
        }
    }

    return Clutter.EVENT_PROPAGATE;
}

/**
 * Handle button press events (left, middle, right click)
 *
 * @param {import('./indicator.js').ClassicAppSwitcher} switcher - The switcher instance
 * @param {Clutter.Event} event - The button press event
 * @returns {boolean} Clutter.EVENT_STOP to prevent propagation
 */
export function handleButtonPress(switcher, event) {
    const button = event.get_button();
    handleButtonClick(switcher, button);
    return Clutter.EVENT_STOP;
}

/**
 * Handle scroll events for cycling through applications
 *
 * @param {import('./indicator.js').ClassicAppSwitcher} switcher - The switcher instance
 * @param {Clutter.Event} event - The scroll event
 * @returns {boolean} Clutter.EVENT_STOP or Clutter.EVENT_PROPAGATE
 */
export function handleScrollEvent(switcher, event) {
    const direction = event.get_scroll_direction();

    /** @type {Meta.Workspace} */
    const workspace = global.workspace_manager.get_active_workspace();
    /** @type {Meta.Window[]} */
    const windows = global.display.get_tab_list(Meta.TabList.NORMAL, workspace);
    /** @type {Set<Shell.App>} */
    const apps = new Set();

    for (const win of windows) {
        if (win.get_window_type() !== Meta.WindowType.NORMAL) continue;
        if (win.is_skip_taskbar()) continue;
        if (win.minimized) continue;

        const app = Shell.WindowTracker.get_default().get_window_app(win);
        if (app) apps.add(app);
    }

    /** @type {Shell.App[]} */
    const appList = Array.from(apps);
    if (appList.length <= 1) return Clutter.EVENT_PROPAGATE;

    /** @type {Shell.App|null} */
    const currentApp = Shell.WindowTracker.get_default().focus_app;
    let index = appList.findIndex(a => a.get_id() === currentApp?.get_id());

    if (index === -1) {
        WindowManager.activateApplication(switcher, appList[0], workspace);
        return Clutter.EVENT_STOP;
    }

    if (
        direction === Clutter.ScrollDirection.UP ||
        direction === Clutter.ScrollDirection.LEFT
    ) {
        index = (index - 1 + appList.length) % appList.length;
    } else if (
        direction === Clutter.ScrollDirection.DOWN ||
        direction === Clutter.ScrollDirection.RIGHT
    ) {
        index = (index + 1) % appList.length;
    } else {
        return Clutter.EVENT_PROPAGATE;
    }

    WindowManager.activateApplication(switcher, appList[index], workspace);
    return Clutter.EVENT_STOP;
}

/**
 * Route button clicks to appropriate handlers based on button type and current state
 *
 * @param {import('./indicator.js').ClassicAppSwitcher} switcher - The switcher instance
 * @param {number} button - Clutter button constant (PRIMARY, MIDDLE, SECONDARY)
 * @returns {void}
 */
export function handleButtonClick(switcher, button) {
    // Get current app (focused or last known)
    /** @type {Shell.App|null} */
    let app = null;
    /** @type {Meta.Window|null} */
    const focusWindow = global.display.focus_window;

    if (focusWindow) {
        app = Shell.WindowTracker.get_default().get_window_app(focusWindow);
    } else if (switcher._lastKnownApp) {
        app = switcher._lastKnownApp;
    }

    // Route to specific handlers based on button and state
    if (button === Clutter.BUTTON_MIDDLE && app) {
        handleMiddleClick(switcher, app);
        return;
    }

    if (button === Clutter.BUTTON_SECONDARY && app) {
        handleRightClick(switcher, app);
        return;
    }

    if (!app) {
        handleIdleClick(switcher, button);
        return;
    }

    if (button === Clutter.BUTTON_PRIMARY) {
        handleLeftClick(switcher);
    }
}

/**
 * Handle middle-click: Open new window for current application
 *
 * @param {import('./indicator.js').ClassicAppSwitcher} switcher - The switcher instance
 * @param {Shell.App} app - The current application
 * @returns {void}
 */
export function handleMiddleClick(switcher, app) {
    if (app.can_open_new_window()) {
        app.open_new_window(-1);
        switcher._closeAllMenus();
    }
}

/**
 * Handle right-click: Open context menu for current application
 *
 * @param {import('./indicator.js').ClassicAppSwitcher} switcher - The switcher instance
 * @param {Shell.App} app - The current application
 * @returns {void}
 */
export function handleRightClick(switcher, app) {
    if (switcher._contextMenu.isOpen) {
        switcher._contextMenu.close();
    } else {
        switcher._closeAllMenus();
        // Build context menu content
        ContextMenu.buildContextMenuContent(switcher, app);
        switcher._contextMenu.open(BoxPointer.PopupAnimation.FULL);
    }
}

/**
 * Handle clicks when in idle state (no focused application)
 * Checks for hidden apps and toggles workspace/desktop display
 *
 * @param {import('./indicator.js').ClassicAppSwitcher} switcher - The switcher instance
 * @param {number} button - The button that was clicked
 * @returns {void}
 */
export function handleIdleClick(switcher, button) {
    /** @type {Meta.Workspace} */
    const workspace = global.workspace_manager.get_active_workspace();
    /** @type {Meta.Window[]} */
    const windows = global.display.get_tab_list(Meta.TabList.NORMAL, workspace);

    // Check if there are any apps (possibly minimized/hidden)
    const hasAnyApps = windows.some(win => {
        if (win.get_window_type() !== Meta.WindowType.NORMAL) return false;
        if (win.is_skip_taskbar()) return false;
        const winApp = Shell.WindowTracker.get_default().get_window_app(win);
        return winApp !== null;
    });

    if (hasAnyApps) {
        // Has hidden apps - explicitly open switcher menu
        toggleSwitcherMenu(switcher);
        return;
    }

    // TRUE IDLE - toggle workspace/desktop display (all buttons)
    switcher._handleIdleToggle();
}

/**
 * Handle left-click: Toggle switcher menu open/closed
 *
 * @param {import('./indicator.js').ClassicAppSwitcher} switcher - The switcher instance
 * @returns {void}
 */
export function handleLeftClick(switcher) {
    toggleSwitcherMenu(switcher);
}

/**
 * Toggle switcher menu open/closed state
 *
 * @param {import('./indicator.js').ClassicAppSwitcher} switcher - The switcher instance
 * @returns {void}
 */
export function toggleSwitcherMenu(switcher) {
    if (switcher._switcherMenu.isOpen) {
        switcher._switcherMenu.close();
    } else {
        switcher._closeAllMenus();
        switcher._switcherMenu.open(BoxPointer.PopupAnimation.FULL);
    }
}

