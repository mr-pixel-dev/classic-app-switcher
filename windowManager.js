'use strict';

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as WindowMenu from 'resource:///org/gnome/shell/ui/windowMenu.js';
import {
    Workspace
} from 'resource:///org/gnome/shell/ui/workspace.js'

/**
 * Window Manager - Handles all window and application management operations
 * All functions receive the switcher instance as first parameter
 */

/**
 * Raise multiple windows to front in proper stacking order
 * Most recent window ends up on top with focus
 * @param {Array<Meta.Window>} windows - Windows sorted by user time (most recent first)
 */
export function raiseWindowsToFront(windows) {
    if (windows.length === 0) return;

    const timestamp = global.get_current_time();

    // Activate in reverse order (oldest first) to build proper stack
    // Each activation brings that window to front
    // Most recent window (index 0) is activated last, so it ends up on top
    for (let i = windows.length - 1; i >= 0; i--) {
        Main.activateWindow(windows[i], timestamp);
    }
}

/**
 * Activate an application by bringing its windows to focus
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 * @param {Shell.App} app - The application to activate
 * @param {Meta.Workspace} workspace - The current workspace
 */
export function activateApplication(switcher, app, workspace) {
    // Close menus when activating an app
    switcher._closeAllMenus();

    // Get windows in proper stacking order from the display
    const allWindowsInStack = global.display.get_tab_list(Meta.TabList.NORMAL, workspace);

    // Filter to only this app's windows on this workspace
    const windows = allWindowsInStack.filter(w =>
        app.get_windows().includes(w) && w.get_workspace() === workspace
    );

    if (windows.length === 0) return;

    // Sort by user time (most recent first)
    windows.sort((a, b) => b.get_user_time() - a.get_user_time());

    // Separate minimized and visible windows
    const minimizedWindows = windows.filter(w => w.minimized);
    const visibleWindows = windows.filter(w => !w.minimized);

    if (minimizedWindows.length > 0) {
        // If there are minimized windows, restore them all
        minimizedWindows.forEach(win => win.unminimize());

        // Raise all minimized windows to front in proper stacking order
        raiseWindowsToFront(minimizedWindows);
    } else if (visibleWindows.length > 1) {
        // Multiple visible windows - raise them all to front
        raiseWindowsToFront(visibleWindows);
    } else {
        // Single visible window, just activate it
        Main.activateWindow(windows[0], global.get_current_time());
    }

    // CRITICAL: Clear hidden window tracking for this app
    // This ensures windows show in Overview after being activated
    if (switcher._lastHiddenWindows && switcher._lastHiddenWindows.length > 0) {
        // Remove all windows of this app from hidden tracking
        const appWindows = app.get_windows();
        switcher._lastHiddenWindows = switcher._lastHiddenWindows.filter(hiddenWin => {
            return !appWindows.some(appWin => appWin.get_id() === hiddenWin.get_id());
        });

        // If we've cleared all hidden windows, clear the app tracking too
        if (switcher._lastHiddenWindows.length === 0) {
            switcher._lastHiddenApp = null;
        }
    }

    // Force menu refresh to update list order and checkmark
    switcher._clearTimeout('_updateTimeoutId');
    switcher._updateTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
        // Defensive: Check switcher still exists and has the method
        if (switcher && switcher._update) {
            switcher._update();
        }
        switcher._updateTimeoutId = null;
        return GLib.SOURCE_REMOVE;
    });
}

/**
 * Hide all windows of the currently focused application on current workspace
 * (Using 'Hide' in menu or Super+H)
 * Windows fade out instead of flying to corner for visual distinction
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 */
export function hideCurrentApp(switcher) {
    const focusedApp = Shell.WindowTracker.get_default().focus_app;
    if (!focusedApp) return;

    const workspace = global.workspace_manager.get_active_workspace();

    if (!switcher._lastHiddenWindows) {
        switcher._lastHiddenWindows = [];
    }

    focusedApp.get_windows().forEach(win => {
        if (win.get_workspace() === workspace) {
            // Track ALL windows of this app (even already minimized ones)
            const alreadyTracked = switcher._lastHiddenWindows.some(
                hiddenWin => hiddenWin.get_id() === win.get_id()
            );

            if (!alreadyTracked) {
                switcher._lastHiddenWindows.push(win);
            }

            // Check if window is already minimized
            if (win.minimized) {
                // Already minimized - upgrade effect to hidden (if effects enabled)
                if (switcher._settings.get_boolean('enable-overview-effects')) {
                    const actor = win.get_compositor_private();
                    if (actor) {
                        // Safety: Only swap effects if actor is valid and realized
                        if (!actor.is_destroyed() && actor.get_stage()) {
                            // Remove minimized effects
                            actor.remove_effect_by_name('minimized-desaturation');
                            actor.remove_effect_by_name('minimized-brightness');

                            // Apply hidden effects LIVE
                            applyHiddenEffect(win);
                        }
                    }
                }
            } else {
                // Not minimized - animate and minimize
                const actor = win.get_compositor_private();
                if (actor && !actor.is_destroyed()) {
                    // Fade out animation
                    actor.ease({
                        opacity: 0,
                        duration: 200,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        onComplete: () => {
                            // DECOUPLING FIX: Move minimize to next idle cycle to avoid g_closure_unref
                            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                                if (win && !win.is_destroyed?.()) {
                                    // Mark as hide operation (signal handler will apply hidden effect)
                                    win._isHideOperation = true;
                                    win.minimize();
                                }
                                // Reset opacity for when window is shown again
                                if (actor && !actor.is_destroyed()) {
                                    actor.opacity = 255;
                                }
                                return GLib.SOURCE_REMOVE;
                            });
                        }
                    });
                } else {
                    // Fallback if no actor or actor destroyed
                    win._isHideOperation = true;
                    win.minimize();
                }
            }
        }
    });

    switcher._lastHiddenApp = focusedApp;
    switcher._scheduleUpdate();
}

/**
 * Show the most recently hidden application on current workspace (via Super+U)
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 */
export function showRecentApp(switcher) {
    // Check if we have tracked hidden windows
    if (!switcher._lastHiddenWindows || switcher._lastHiddenWindows.length === 0) {
        return;
    }

    const workspace = global.workspace_manager.get_active_workspace();

    // Filter to only windows that are still minimized and on current workspace
    const windowsToRestore = switcher._lastHiddenWindows.filter(win => {
        return win?.minimized && win?.get_workspace() === workspace;
    });

    if (windowsToRestore.length === 0) {
        // All tracked windows are already visible or destroyed
        switcher._lastHiddenWindows = [];
        switcher._lastHiddenApp = null;
        return;
    }

    // Get windows in proper stacking order from the display FIRST
    const allWindowsInStack = global.display.get_tab_list(Meta.TabList.NORMAL, workspace);

    // Create a Set for fast lookup
    const windowsToRestoreSet = new Set(windowsToRestore.map(w => w.get_id()));

    // Filter the stacked list to only our windows, preserving stack order
    const orderedWindows = allWindowsInStack.filter(w =>
        windowsToRestoreSet.has(w.get_id())
    );

    // Restore the windows we specifically hid
    orderedWindows.forEach(win => win.unminimize());

    // Sort by user time (most recent first)
    orderedWindows.sort((a, b) => b.get_user_time() - a.get_user_time());

    // Raise all windows to front in proper stacking order
    raiseWindowsToFront(orderedWindows);

    // Clear the tracking since we've restored them
    switcher._lastHiddenWindows = [];
    switcher._lastHiddenApp = null;

    switcher._scheduleUpdate();
}

/**
 * Hide all applications except the currently focused application on the current workspace
 * ('Hide Others' in menu or via Alt+Super+H)
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 */
export function hideOthers(switcher) {
    const focusedApp = Shell.WindowTracker.get_default().focus_app;
    if (!focusedApp) return;

    const workspace = global.workspace_manager.get_active_workspace();
    const allWindows = global.display.get_tab_list(Meta.TabList.NORMAL, workspace);

    // Initialize tracking array if it doesn't exist
    if (!switcher._lastHiddenWindows) {
        switcher._lastHiddenWindows = [];
    }

    // Collect windows to hide
    const windowsToHide = [];
    allWindows.forEach(win => {
        const winApp = Shell.WindowTracker.get_default().get_window_app(win);

        // Process windows that belong to OTHER apps
        if (winApp !== focusedApp) {
            // Track the window
            const alreadyTracked = switcher._lastHiddenWindows.some(
                hiddenWin => hiddenWin.get_id() === win.get_id()
            );

            if (!alreadyTracked) {
                switcher._lastHiddenWindows.push(win);
            }

            // Check if already minimized
            if (win.minimized) {
                // Already minimized - upgrade effect to hidden LIVE (if effects enabled)
                if (switcher._settings.get_boolean('enable-overview-effects')) {
                    const actor = win.get_compositor_private();
                    if (actor && !actor.is_destroyed() && actor.get_stage()) {
                        actor.remove_effect_by_name('minimized-desaturation');
                        actor.remove_effect_by_name('minimized-brightness');
                        applyHiddenEffect(win);
                    }
                }
            } else {
                // Not minimized - add to animation queue
                windowsToHide.push(win);
            }
        }
    });

    // Staggered fade animation for visual polish
    // Clear any previous stagger timeouts before starting a new batch
    if (switcher._staggerTimeoutIds) {
        switcher._staggerTimeoutIds.forEach(id => GLib.Source.remove(id));
    }
    switcher._staggerTimeoutIds = [];

    windowsToHide.forEach((win, index) => {
        const actor = win.get_compositor_private();

        // Defensive: Check actor validity before creating timeout
        if (!actor || actor.is_destroyed()) {
            win._isHideOperation = true;
            win.minimize();

            // Update if this is the last window
            if (index === windowsToHide.length - 1) {
                switcher._scheduleUpdate();
            }
            return;
        }

        // Stagger each window by 30ms for cascading effect
        const staggerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, index * 30, () => {
            switcher._staggerTimeoutIds = switcher._staggerTimeoutIds?.filter(id => id !== staggerId) ?? [];
            // Defensive: Check again inside timeout (actor might be destroyed by now)
            if (!actor.is_destroyed()) {
                actor.ease({
                    opacity: 0,
                    duration: 150,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => {
                        // DECOUPLING FIX: Move minimize to next idle cycle
                        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                            if (win && !win.is_destroyed?.()) {
                                win._isHideOperation = true;
                                win.minimize();
                            }
                            if (actor && !actor.is_destroyed()) {
                                actor.opacity = 255;
                            }

                            // Update menu after LAST window finishes animating
                            if (index === windowsToHide.length - 1) {
                                switcher._scheduleUpdate();
                            }
                            return GLib.SOURCE_REMOVE;
                        });
                    }
                });
            } else {
                // Actor destroyed during timeout delay
                win._isHideOperation = true;
                win.minimize();

                if (index === windowsToHide.length - 1) {
                    switcher._scheduleUpdate();
                }
            }
            return GLib.SOURCE_REMOVE;
        });
        switcher._staggerTimeoutIds.push(staggerId);
    });

    // If no windows to animate (all were already minimized), update now
    if (windowsToHide.length === 0) {
        switcher._scheduleUpdate();
    }
}

/**
 * Show all (hidden/minimized) applications and windows on the current workspace
 * ('Show All' in menu or via Alt+Super+U)
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 */
export function showAll(switcher) {
    const workspace = global.workspace_manager.get_active_workspace();
    const allWindows = global.display.get_tab_list(Meta.TabList.NORMAL, workspace);

    // Get all minimized windows
    const minimizedWindows = allWindows.filter(win => win.minimized);

    if (minimizedWindows.length === 0) return;

    // Sort by user time (most recent first)
    minimizedWindows.sort((a, b) => b.get_user_time() - a.get_user_time());

    // Unminimize all windows first
    minimizedWindows.forEach(win => win.unminimize());

    // Raise all windows to front in proper stacking order
    raiseWindowsToFront(minimizedWindows);

    // Clear ALL hidden window tracking since we're showing everything
    switcher._lastHiddenWindows = [];
    switcher._lastHiddenApp = null;

    switcher._scheduleUpdate();
}

/**
 * Minimize the currently focused window on the current workspace (via Super+M)
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 */
export function minimizeCurrentWindow(switcher) {
    const focusWindow = global.display.focus_window;
    if (!focusWindow) return;

    // Track this window so we can unminimize it (via Alt+Super+M)
    switcher._lastMinimizedWindow = focusWindow;

    // Minimize just this one window
    focusWindow.minimize();

    switcher._scheduleUpdate();
}

/**
 * Unminimize the most recently minimized window on the current workspace (via Alt+Super+M)
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 */
export function unminimizeRecentWindow(switcher) {
    // Check if we have a tracked minimized window
    if (!switcher._lastMinimizedWindow) {
        return;
    }

    const workspace = global.workspace_manager.get_active_workspace();

    // Check if the window is still minimized and on current workspace
    if (switcher._lastMinimizedWindow?.minimized &&
        switcher._lastMinimizedWindow?.get_workspace() === workspace) {
        // Unminimize and activate
        switcher._lastMinimizedWindow.unminimize();
        Main.activateWindow(switcher._lastMinimizedWindow, global.get_current_time());
    }

    // Clear the tracking since we've restored it
    switcher._lastMinimizedWindow = null;

    switcher._scheduleUpdate();
}

/**
 * Close the currently focused window on the current workspace (via Super+W)
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 */
export function closeCurrentWindow(switcher) {
    const focusWindow = global.display.focus_window;
    if (!focusWindow) return;

    // Close the window gracefully
    focusWindow.delete(global.get_current_time());
}

/**
 * Quit the currently focused application on the current workspace (via Super+Q)
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 */
export function quitCurrentApp(switcher) {
    const focusedApp = Shell.WindowTracker.get_default().focus_app;
    if (!focusedApp) return;

    // Request the application to quit gracefully
    focusedApp.request_quit();
}

/**
 * Apply hidden effect to a window (stronger visual distinction)
 * Used when windows are hidden via Hide/Hide Others commands
 * Full desaturation with darker appearance for maximum distinction
 * @param {Meta.Window} win - The window to apply hidden effect to
 */
function applyHiddenEffect(win) {
    if (win.window_type !== Meta.WindowType.NORMAL) return;

    const actor = win.get_compositor_private();
    if (!actor || actor.is_destroyed()) return;

    const effectName = 'hidden-desaturation';
    const brightnessEffectName = 'hidden-brightness';

    // Only add if not already present
    if (!actor.get_effect(effectName)) {
        // Full desaturation (complete monochrome)
        const desaturate = new Clutter.DesaturateEffect();
        desaturate.set_factor(1.00);
        actor.add_effect_with_name(effectName, desaturate);

        // Brightness/Contrast reduction for darker appearance
        const brightnessContrast = new Clutter.BrightnessContrastEffect();
        brightnessContrast.set_brightness(-0.05); // Darker
        brightnessContrast.set_contrast(-0.05); // Softer
        actor.add_effect_with_name(brightnessEffectName, brightnessContrast);
    }
}

/**
 * Apply minimized effect to a window (subtle distinction)
 * Used when windows are manually minimized
 * Slight desaturation with lighter appearance
 * @param {Meta.Window} win - The window to apply minimized effect to
 */
function applyMinimizedEffect(win) {
    if (win.window_type !== Meta.WindowType.NORMAL) return;

    const actor = win.get_compositor_private();
    if (!actor || actor.is_destroyed()) return;

    const effectName = 'minimized-desaturation';
    const brightnessEffectName = 'minimized-brightness';

    // Only add if not already present
    if (!actor.get_effect(effectName)) {
        // Subtle desaturation (25% desaturated)
        const desaturate = new Clutter.DesaturateEffect();
        desaturate.set_factor(0.25);
        actor.add_effect_with_name(effectName, desaturate);

        // Brightness/Contrast adjustment for lighter greyed-out look
        const brightnessContrast = new Clutter.BrightnessContrastEffect();
        brightnessContrast.set_brightness(0.05); // Lighter
        brightnessContrast.set_contrast(-0.05); // Softer
        actor.add_effect_with_name(brightnessEffectName, brightnessContrast);
    }
}

/**
 * Remove all effects from a window (both hidden and minimized)
 * @param {Meta.Window} win - The window to restore
 */
function removeAllEffects(win) {
    const actor = win.get_compositor_private();
    if (!actor || actor.is_destroyed()) return;

    // Remove hidden effects
    actor.remove_effect_by_name('hidden-desaturation');
    actor.remove_effect_by_name('hidden-brightness');

    // Remove minimized effects  
    actor.remove_effect_by_name('minimized-desaturation');
    actor.remove_effect_by_name('minimized-brightness');
}

/**
 * Initialize CORE hide functionality (always active, not toggleable)
 * Handles opacity trick for animation blocking and hidden effect application
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 */
export function enableHideHandling(switcher) {
    // Store signal IDs for cleanup
    if (!switcher._hideHandlingSignals) {
        switcher._hideHandlingSignals = [];
    }

    // Handle hide operations - ALWAYS active
    const hideMinimizeId = global.window_manager.connect('minimize', (wm, actor) => {
        // SAFETY: Ensure actor still exists when signal fires
        if (!actor || actor.is_destroyed()) return;

        const win = actor.get_meta_window();
        if (win && win._isHideOperation) {
            // OPACITY TRICK: Disables GNOME's minimize animation (ALWAYS active)
            // This differentiates Hide (instant vanish) from manual Minimize (fly animation)
            actor.opacity = 255;

            // Apply HIDDEN effect only if user enabled overview effects
            if (switcher._settings.get_boolean('enable-overview-effects')) {
                applyHiddenEffect(win);
            }

            delete win._isHideOperation;
        }
    });
    switcher._hideHandlingSignals.push({
        obj: global.window_manager,
        id: hideMinimizeId
    });

    // Remove hidden effects on unminimize - ALWAYS active
    const hideUnminimizeId = global.window_manager.connect('unminimize', (wm, actor) => {
        // SAFETY: Ensure actor still exists
        if (!actor || actor.is_destroyed()) return;

        const win = actor.get_meta_window();
        if (win) {
            // Remove hidden effects
            const winActor = win.get_compositor_private();
            if (winActor) {
                winActor.remove_effect_by_name('hidden-desaturation');
                winActor.remove_effect_by_name('hidden-brightness');
            }
        }
    });
    switcher._hideHandlingSignals.push({
        obj: global.window_manager,
        id: hideUnminimizeId
    });
}

/**
 * Disable core hide handling
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 */
export function disableHideHandling(switcher) {
    // Clear any pending stagger animation timeouts
    if (switcher._staggerTimeoutIds) {
        switcher._staggerTimeoutIds.forEach(id => GLib.Source.remove(id));
        switcher._staggerTimeoutIds = [];
    }

    // Clear pending menu refresh timeout
    switcher._clearTimeout('_updateTimeoutId');

    // Remove all hidden effects
    const windows = global.display.list_all_windows();
    windows.forEach(win => {
        const actor = win.get_compositor_private();
        if (actor) {
            actor.remove_effect_by_name('hidden-desaturation');
            actor.remove_effect_by_name('hidden-brightness');
        }
    });

    // Disconnect signals
    if (switcher._hideHandlingSignals) {
        switcher._hideHandlingSignals.forEach(({
            obj,
            id
        }) => {
            obj.disconnect(id);
        });
        switcher._hideHandlingSignals = [];
    }
}

/**
 * Initialize OPTIONAL minimized window effects (user toggleable)
 * Applies subtle visual effect to manually minimized windows
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 */
export function enableMinimizedEffect(switcher) {
    // Store signal IDs for cleanup
    if (!switcher._minimizedEffectSignals) {
        switcher._minimizedEffectSignals = [];
    }

    // Apply minimized effects to already-minimized windows
    const windows = global.display.list_all_windows();
    windows.forEach(win => {
        if (win.window_type === Meta.WindowType.NORMAL && win.minimized) {
            // Only apply if NOT a hidden window
            if (!switcher._lastHiddenWindows?.some(hw => hw?.get_id() === win.get_id())) {
                applyMinimizedEffect(win);
            }
        }
    });

    // Apply minimized effect on manual minimize
    const minimizeId = global.window_manager.connect('minimize', (wm, actor) => {
        const win = actor.get_meta_window();
        if (win && !win._isHideOperation) {
            // Manual minimize (not our hide) - apply subtle effect if enabled
            if (switcher._settings.get_boolean('enable-overview-effects')) {
                applyMinimizedEffect(win);
            }
        }
    });
    switcher._minimizedEffectSignals.push({
        obj: global.window_manager,
        id: minimizeId
    });

    // Remove minimized effects on unminimize
    const unminimizeId = global.window_manager.connect('unminimize', (wm, actor) => {
        const win = actor.get_meta_window();
        if (win) {
            const winActor = win.get_compositor_private();
            if (winActor) {
                winActor.remove_effect_by_name('minimized-desaturation');
                winActor.remove_effect_by_name('minimized-brightness');
            }
        }
    });
    switcher._minimizedEffectSignals.push({
        obj: global.window_manager,
        id: unminimizeId
    });
}

/**
 * Disable optional minimized window effects
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 */
export function disableMinimizedEffect(switcher) {
    // Remove all minimized effects
    const windows = global.display.list_all_windows();
    windows.forEach(win => {
        const actor = win.get_compositor_private();
        if (actor) {
            actor.remove_effect_by_name('minimized-desaturation');
            actor.remove_effect_by_name('minimized-brightness');
        }
    });

    // Disconnect signals
    if (switcher._minimizedEffectSignals) {
        switcher._minimizedEffectSignals.forEach(({
            obj,
            id
        }) => {
            obj.disconnect(id);
        });
        switcher._minimizedEffectSignals = [];
    }
}

/**
 * Align window menu terminology with extension behavior
 * 
 * Updates labels for consistency with our Move/Send workspace operations:
 * - Our "Move to Workspace" submenu moves window and switches workspace
 * - Our "Send to Workspace" (Alt) moves window without switching
 * - GNOME's titlebar menu moves WITHOUT switching, so we label it "Send"
 * 
 * Also clarifies "Hide" as "Minimize" to match the actual window.minimize() call.
 * 
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 */
export function fixWindowMenuLabels(switcher) {
    if (!switcher._originalBuildMenu) {
        switcher._originalBuildMenu = WindowMenu.WindowMenu.prototype._buildMenu;
    }

    WindowMenu.WindowMenu.prototype._buildMenu = function(window) {
        switcher._originalBuildMenu.call(this, window);

        // Update terminology for consistency with our extension
        this._getMenuItems().forEach(item => {
            if (!item.label) return;

            const text = item.label.text;

            // Change "Hide" to "Minimize" (matches actual behavior)
            if (text === _('Hide')) {
                item.label.text = _('Minimize');
            }
            // Change "Move to Workspace" to "Send to Workspace"
            // (GNOME's menu doesn't switch workspace, matches our Send behavior)
            else if (text === _('Move to Workspace Left')) {
                item.label.text = _('Send to Workspace Left');
            } else if (text === _('Move to Workspace Right')) {
                item.label.text = _('Send to Workspace Right');
            }
        });
    };
}

/**
 * Restore GNOME default labelling
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 */
export function restoreWindowMenuLabels(switcher) {
    if (switcher._originalBuildMenu) {
        WindowMenu.WindowMenu.prototype._buildMenu = switcher._originalBuildMenu;
        delete switcher._originalBuildMenu;
    }
}

/**
 * Store original Overview functions for restoration
 */
let _originalIsOverviewWindow = null;

/**
 * Enable filtering of hidden windows from Activities Overview
 * Also monitors window focus to clear hidden state when windows are activated externally
 * 
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 */
export function enableHiddenWindowFiltering(switcher) {
    // Store original function
    if (!_originalIsOverviewWindow) {
        _originalIsOverviewWindow = Workspace.prototype._isOverviewWindow;
    }

    // Defer the override to avoid race conditions with Shell's workspace animation
    // This ensures Shell finishes any ongoing rendering before we change filtering
    GLib.idle_add(GLib.PRIORITY_LOW, () => {
        // Override to filter out our hidden windows
        Workspace.prototype._isOverviewWindow = function(win) {
            const show = _originalIsOverviewWindow.call(this, win);

            let metaWindow = win;
            if (win.get_meta_window) {
                metaWindow = win.get_meta_window();
            }

            // Check if this window is in our hidden list
            if (switcher._lastHiddenWindows && switcher._lastHiddenWindows.length > 0) {
                const isHidden = switcher._lastHiddenWindows.some(hiddenWin =>
                    hiddenWin && metaWindow && hiddenWin.get_id() === metaWindow.get_id()
                );

                if (isHidden) {
                    return false; // Don't show in Overview!
                }
            }

            return show;
        };

        return GLib.SOURCE_REMOVE;
    });

    // Monitor window focus to clear hidden state when activated externally
    // (e.g., clicking in Dash, App Grid, or Alt+Tab)
    switcher._hiddenWindowFocusId = global.display.connect('notify::focus-window', () => {
        const focusedWindow = global.display.focus_window;

        // Defensive: Bail early if no focused window or no tracking
        if (!focusedWindow || !switcher._lastHiddenWindows || switcher._lastHiddenWindows.length === 0) {
            return;
        }

        // Get the app for this focused window
        const focusedApp = Shell.WindowTracker.get_default().get_window_app(focusedWindow);

        // Defensive: Bail if no app or destroyed workspace
        if (!focusedApp) return;

        const workspace = focusedWindow.get_workspace();
        if (!workspace) return;

        // Get ALL windows for this app on this workspace
        const appWindows = focusedApp.get_windows().filter(w =>
            w && w.get_workspace() === workspace
        );

        // Defensive: Check each window before unminimizing
        appWindows.forEach(win => {
            if (!win) return;

            const wasHidden = switcher._lastHiddenWindows.some(
                hiddenWin => hiddenWin && hiddenWin.get_id() === win.get_id()
            );

            if (wasHidden && win.minimized) {
                win.unminimize();
            }
        });

        // Remove ALL windows of this app from hidden tracking
        switcher._lastHiddenWindows = switcher._lastHiddenWindows.filter(hiddenWin => {
            if (!hiddenWin) return false;
            return !appWindows.some(appWin => appWin && appWin.get_id() === hiddenWin.get_id());
        });

        // If we've cleared all hidden windows, clear the app tracking too
        if (switcher._lastHiddenWindows.length === 0) {
            switcher._lastHiddenApp = null;
        }
    });
}

/**
 * Disable hidden window filtering and restore original Overview behavior
 * @param {ClassicAppSwitcher} switcher - The switcher instance
 */
export function disableHiddenWindowFiltering(switcher) {
    // Defer the restore to avoid race conditions
    GLib.idle_add(GLib.PRIORITY_LOW, () => {
        if (_originalIsOverviewWindow) {
            Workspace.prototype._isOverviewWindow = _originalIsOverviewWindow;
            _originalIsOverviewWindow = null;
        }
        return GLib.SOURCE_REMOVE;
    });

    // Disconnect focus monitoring immediately
    if (switcher._hiddenWindowFocusId) {
        global.display.disconnect(switcher._hiddenWindowFocusId);
        switcher._hiddenWindowFocusId = null;
    }
}
