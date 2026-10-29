'use strict';

/**
 * @fileoverview Window Manager - Window animations, visual effects, hide/restore
 * operations and state tracking for Classic App Switcher.
 *
 * @module windowManager
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Dash from 'resource:///org/gnome/shell/ui/dash.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as WindowMenu from 'resource:///org/gnome/shell/ui/windowMenu.js';
import {Workspace} from 'resource:///org/gnome/shell/ui/workspace.js';

/** @constant {number} Hide/show animation duration in milliseconds */
const HIDE_WINDOW_ANIMATION_TIME = 250;

/** @constant {number} Staggered hide animation duration in milliseconds */
const HIDE_OTHERS_ANIMATION_TIME = 150;

// ─────────────────────────────────────────────────────────────────────────────
// Visual Effects
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applies the hidden visual effect (desaturation and brightness/contrast) to a window.
 *
 * @param {Meta.Window} window - The window to apply the effect to.
 */
function applyHiddenEffect(window) {
    if (window.window_type !== Meta.WindowType.NORMAL) return;
    const actor = window.get_compositor_private();
    if (!actor || actor.is_destroyed()) return;

    if (!actor.get_effect('hidden-desaturation')) {
        const desaturate = new Clutter.DesaturateEffect();
        desaturate.set_factor(1.0);
        actor.add_effect_with_name('hidden-desaturation', desaturate);

        const brightness = new Clutter.BrightnessContrastEffect();
        brightness.set_brightness(-0.05);
        brightness.set_contrast(-0.05);
        actor.add_effect_with_name('hidden-brightness', brightness);
    }
}

/**
 * Applies the minimized visual effect to a window.
 *
 * @param {Meta.Window} window - The window to apply the minimized effect to.
 */
function applyMinimizedEffect(window) {
    if (window.window_type !== Meta.WindowType.NORMAL) return;
    const actor = window.get_compositor_private();
    if (!actor || actor.is_destroyed()) return;

    if (!actor.get_effect('minimized-desaturation')) {
        const desaturate = new Clutter.DesaturateEffect();
        desaturate.set_factor(0.25);
        actor.add_effect_with_name('minimized-desaturation', desaturate);

        const brightness = new Clutter.BrightnessContrastEffect();
        brightness.set_brightness(0.05);
        brightness.set_contrast(-0.05);
        actor.add_effect_with_name('minimized-brightness', brightness);
    }
}

/**
 * Removes all hidden and minimized effects from a window's actor.
 *
 * @param {Meta.Window} window - The window whose effects should be removed.
 */
function removeAllEffects(window) {
    const actor = window.get_compositor_private();
    if (!actor) return;
    [
        'hidden-desaturation',
        'hidden-brightness',
        'minimized-desaturation',
        'minimized-brightness',
    ].forEach(name => {
        actor.remove_effect_by_name(name);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Animations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fades in a batch of windows and activates the target window upon completion.
 *
 * @param {Meta.Window[]} windows - Array of windows to fade in.
 * @param {Meta.Window} targetWindow - The target window to activate after animations complete.
 */
function fadeInAndActivate(windows, targetWindow) {
    if (!windows.length) {
        if (targetWindow)
            Main.activateWindow(targetWindow, global.get_current_time());
        return;
    }

    let completed = 0;
    const timestamp = global.get_current_time();

    windows.forEach(window => {
        const actor = window.get_compositor_private();
        if (actor) actor.opacity = 0;
        window._isUnhideOperation = true;
        window.unminimize();
    });

    for (let i = windows.length - 1; i >= 0; i--) {
        windows[i].raise();
    }

    windows.forEach(window => {
        const actor = window.get_compositor_private();
        const finishStep = () => {
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                window._isUnhideOperation = null;
                completed++;
                if (completed === windows.length && targetWindow) {
                    Main.activateWindow(targetWindow, timestamp);
                }
                return GLib.SOURCE_REMOVE;
            });
        };

        if (actor && !actor.is_destroyed()) {
            actor.ease({
                opacity: 255,
                duration: HIDE_WINDOW_ANIMATION_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onStopped: finishStep,
            });
        } else {
            finishStep();
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Window State Tracking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initializes the switcher state tracking properties if not already present.
 *
 * @param {Object} switcher - The switcher instance.
 */
function initSwitcherState(switcher) {
    if (!switcher._lastHiddenWindows) switcher._lastHiddenWindows = [];
}

/**
 * Adds a window to the switcher's list of hidden windows.
 *
 * @param {Object} switcher - The switcher instance.
 * @param {Meta.Window} window - The window to track as hidden.
 */
function addHidden(switcher, window) {
    initSwitcherState(switcher);
    if (
        !switcher._lastHiddenWindows.some(w => w.get_id() === window.get_id())
    ) {
        switcher._lastHiddenWindows.push(window);
    }
}

/**
 * Clears tracking for all windows belonging to a specific application.
 *
 * @param {Object} switcher - The switcher instance.
 * @param {Shell.App} app - The application whose windows should be cleared.
 */
function clearAppTracking(switcher, app) {
    if (!switcher._lastHiddenWindows?.length) return;
    const appWindowIds = new Set(app.get_windows().map(w => w.get_id()));
    switcher._lastHiddenWindows = switcher._lastHiddenWindows.filter(
        win => !appWindowIds.has(win.get_id())
    );
    if (switcher._lastHiddenWindows.length === 0) {
        switcher._lastHiddenApp = null;
    }
}

// ============================================================================
// Core Exported API
// ============================================================================

/**
 * Raises a list of windows to the front by activating them in reverse order.
 *
 * @param {Meta.Window[]} windows - Array of windows to raise.
 */
export function raiseWindowsToFront(windows) {
    if (!windows?.length) return;
    const timestamp = global.get_current_time();
    for (let i = windows.length - 1; i >= 0; i--) {
        Main.activateWindow(windows[i], timestamp);
    }
}

/**
 * Activates a specific application within a given workspace, managing its window states
 * while respecting pre-minimized windows.
 *
 * @param {Object} switcher - The switcher instance.
 * @param {Shell.App} app - The application to activate.
 * @param {Meta.Workspace} workspace - The workspace context.
 */
export function activateApplication(switcher, app, workspace) {
    switcher._closeAllMenus();

    const allWindows = global.display.get_tab_list(
        Meta.TabList.NORMAL,
        workspace
    );
    const appWindows = allWindows.filter(
        window =>
            app.get_windows().includes(window) &&
            window.get_workspace() === workspace
    );

    if (!appWindows.length) return;
    appWindows.sort((a, b) => b.get_user_time() - a.get_user_time());

    const hiddenIds = new Set(
        switcher._lastHiddenWindows?.map(w => w.get_id()) || []
    );

    // Find all windows flagged as hidden for this app
    const rawHiddenWindows = appWindows.filter(
        w => w.minimized && (w._isHidden || hiddenIds.has(w.get_id()))
    );

    // Separate genuinely hidden windows from those that were already minimized before being hidden
    const fadeWindows = [];
    rawHiddenWindows.forEach(window => {
        if (window._wasMinimizedBeforeHide) {
            window._isHidden = null;
            window._wasMinimizedBeforeHide = null;
            removeAllEffects(window);
            if (switcher._settings.get_boolean('enable-overview-effects'))
                applyMinimizedEffect(window);
            window.notify('minimized');
        } else {
            fadeWindows.push(window);
        }
    });

    const manuallyMinimized = appWindows.filter(
        w =>
            w.minimized &&
            !w._isHidden &&
            !hiddenIds.has(w.get_id()) &&
            !w._wasMinimizedBeforeHide
    );
    const visible = appWindows.filter(w => !w.minimized);

    if (fadeWindows.length > 0) {
        fadeInAndActivate(fadeWindows, fadeWindows[0]);
    } else if (manuallyMinimized.length > 0 && visible.length === 0) {
        const targetWindow = manuallyMinimized[0];
        targetWindow.unminimize();
        Main.activateWindow(targetWindow, global.get_current_time());
    } else if (visible.length > 1) {
        raiseWindowsToFront(visible);
    } else if (visible.length === 1) {
        Main.activateWindow(visible[0], global.get_current_time());
    } else if (manuallyMinimized.length > 0) {
        const targetWindow = manuallyMinimized[0];
        targetWindow.unminimize();
        Main.activateWindow(targetWindow, global.get_current_time());
    }

    clearAppTracking(switcher, app);

    switcher._clearTimeout('_updateTimeoutId');
    switcher._updateTimeoutId = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        100,
        () => {
            switcher._update();
            switcher._updateTimeoutId = null;
            return GLib.SOURCE_REMOVE;
        }
    );
}

/**
 * Hides all windows belonging to the currently focused application.
 *
 * @param {Object} switcher - The switcher instance.
 */
export function hideCurrentApp(switcher) {
    const focusedApp = Shell.WindowTracker.get_default().focus_app;
    if (!focusedApp) return;

    const workspace = global.workspace_manager.get_active_workspace();
    initSwitcherState(switcher);

    focusedApp.get_windows().forEach(window => {
        if (window.get_workspace() !== workspace) return;

        addHidden(switcher, window);

        if (window.minimized) {
            if (switcher._settings.get_boolean('enable-overview-effects'))
                applyHiddenEffect(window);
            window._isHidden = true;
            window._wasMinimizedBeforeHide = true;
            window.notify('minimized');
        } else {
            const actor = window.get_compositor_private();
            if (actor && !actor.is_destroyed()) {
                actor.ease({
                    opacity: 0,
                    duration: HIDE_WINDOW_ANIMATION_TIME,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onStopped: () => {
                        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                            if (window && window.get_compositor_private()) {
                                window._isHideOperation = true;
                                window.minimize();
                            }
                            if (actor && !actor.is_destroyed())
                                actor.opacity = 255;
                            return GLib.SOURCE_REMOVE;
                        });
                    },
                });
            } else {
                window._isHideOperation = true;
                window.minimize();
            }
        }
    });

    switcher._lastHiddenApp = focusedApp;
    switcher._scheduleUpdate();
}

/**
 * Restores the most recently hidden application's windows (undo last hide).
 * If no specific app is targeted (_lastHiddenApp is null), does nothing —
 * use showAll() to restore any remaining hidden windows.
 *
 * @param {Object} switcher - The switcher instance.
 */
export function showRecentApp(switcher) {
    if (!switcher._lastHiddenWindows?.length) return;

    const targetApp = switcher._lastHiddenApp;
    if (!targetApp) return;

    const workspace = global.workspace_manager.get_active_workspace();
    const targetIds = new Set(targetApp.get_windows().map(w => w.get_id()));

    const windowsToRestore = switcher._lastHiddenWindows.filter(
        w =>
            w?.minimized &&
            w.get_workspace() === workspace &&
            targetIds.has(w.get_id())
    );
    const remainingHidden = switcher._lastHiddenWindows.filter(
        w => !targetIds.has(w.get_id())
    );

    if (!windowsToRestore.length) {
        switcher._lastHiddenWindows = remainingHidden;
        switcher._lastHiddenApp = null;
        return;
    }

    const allWindows = global.display.get_tab_list(
        Meta.TabList.NORMAL,
        workspace
    );
    const windowIdsToRestore = new Set(windowsToRestore.map(w => w.get_id()));
    const orderedWindows = allWindows.filter(w =>
        windowIdsToRestore.has(w.get_id())
    );

    const fadeWindows = [];

    orderedWindows.forEach(window => {
        if (window._wasMinimizedBeforeHide) {
            window._isHidden = null;
            window._wasMinimizedBeforeHide = null;
            removeAllEffects(window);
            if (switcher._settings.get_boolean('enable-overview-effects'))
                applyMinimizedEffect(window);
            window.notify('minimized');
        } else {
            fadeWindows.push(window);
        }
    });

    for (let i = orderedWindows.length - 1; i >= 0; i--) {
        orderedWindows[i].raise();
    }

    fadeInAndActivate(fadeWindows, orderedWindows[0]);

    switcher._lastHiddenWindows = remainingHidden;
    switcher._lastHiddenApp = null;
    switcher._scheduleUpdate();
}

/**
 * Hides all windows except those belonging to the currently focused application.
 *
 * @param {Object} switcher - The switcher instance.
 */
export function hideOthers(switcher) {
    const focusedApp = Shell.WindowTracker.get_default().focus_app;
    if (!focusedApp) return;

    const workspace = global.workspace_manager.get_active_workspace();
    const allWindows = global.display.get_tab_list(
        Meta.TabList.NORMAL,
        workspace
    );
    const tracker = Shell.WindowTracker.get_default();

    initSwitcherState(switcher);
    const windowsToHide = [];

    allWindows.forEach(window => {
        const windowApp = tracker.get_window_app(window);
        if (!windowApp || windowApp === focusedApp) return;

        addHidden(switcher, window);

        if (window.minimized) {
            if (switcher._settings.get_boolean('enable-overview-effects'))
                applyHiddenEffect(window);
            window._isHidden = true;
            window._wasMinimizedBeforeHide = true;
            window.notify('minimized');
        } else {
            windowsToHide.push(window);
        }
    });

    switcher._lastHiddenApp = null;

    if (switcher._staggerTimeoutIds) {
        switcher._staggerTimeoutIds.forEach(id => GLib.Source.remove(id));
    }
    switcher._staggerTimeoutIds = [];

    if (!windowsToHide.length) {
        switcher._scheduleUpdate();
        return;
    }

    windowsToHide.forEach((window, index) => {
        const actor = window.get_compositor_private();
        const isLastWindow = index === windowsToHide.length - 1;

        if (!actor || actor.is_destroyed()) {
            window._isHideOperation = true;
            window.minimize();
            if (isLastWindow) switcher._scheduleUpdate();
            return;
        }

        const timeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            index * 30,
            () => {
                switcher._staggerTimeoutIds =
                    switcher._staggerTimeoutIds?.filter(
                        id => id !== timeoutId
                    ) ?? [];
                if (actor.is_destroyed()) {
                    window._isHideOperation = true;
                    window.minimize();
                    if (isLastWindow) switcher._scheduleUpdate();
                    return GLib.SOURCE_REMOVE;
                }

                actor.ease({
                    opacity: 0,
                    duration: HIDE_OTHERS_ANIMATION_TIME,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onStopped: () => {
                        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                            if (window && window.get_compositor_private()) {
                                window._isHideOperation = true;
                                window.minimize();
                            }
                            if (actor && !actor.is_destroyed())
                                actor.opacity = 255;
                            if (isLastWindow) switcher._scheduleUpdate();
                            return GLib.SOURCE_REMOVE;
                        });
                    },
                });
                return GLib.SOURCE_REMOVE;
            }
        );
        switcher._staggerTimeoutIds.push(timeoutId);
    });
}

/**
 * Shows all windows on the current workspace — both extension-hidden
 * and manually minimized. This is the nuclear option, clearing
 * all hide state in the process.
 *
 * @param {Object} switcher - The switcher instance.
 */
export function showAll(switcher) {
    const workspace = global.workspace_manager.get_active_workspace();
    const allWindows = global.display.get_tab_list(
        Meta.TabList.NORMAL,
        workspace
    );

    const hidden = allWindows.filter(w => w.minimized);

    if (!hidden.length) return;
    hidden.sort((a, b) => b.get_user_time() - a.get_user_time());

    fadeInAndActivate(hidden, hidden[0]);

    switcher._lastHiddenWindows = [];
    switcher._lastHiddenApp = null;
    switcher._scheduleUpdate();
}

/**
 * Minimizes the currently focused window.
 *
 * @param {Object} switcher - The switcher instance.
 */
export function minimizeCurrentWindow(switcher) {
    const window = global.display.focus_window;
    if (!window) return;
    switcher._lastMinimizedWindow = window;
    window.minimize();
    switcher._scheduleUpdate();
}

/**
 * Unminimizes and activates the most recently minimized window.
 *
 * @param {Object} switcher - The switcher instance.
 */
export function unminimizeRecentWindow(switcher) {
    const window = switcher._lastMinimizedWindow;
    const workspace = global.workspace_manager.get_active_workspace();

    if (window?.minimized && window.get_workspace() === workspace) {
        window.unminimize();
        Main.activateWindow(window, global.get_current_time());
    }
    switcher._lastMinimizedWindow = null;
    switcher._scheduleUpdate();
}

/**
 * Closes the currently focused window.
 */
export function closeCurrentWindow() {
    const window = global.display.focus_window;
    if (window) window.delete(global.get_current_time());
}

/**
 * Requests to quit the currently focused application.
 */
export function quitCurrentApp() {
    const app = Shell.WindowTracker.get_default().focus_app;
    if (app) app.request_quit();
}

/**
 * Enables handling of window hiding operations and connects relevant window manager signals.
 *
 * @param {Object} switcher - The switcher instance.
 */
export function enableHideHandling(switcher) {
    if (!switcher._hideHandlingSignals) switcher._hideHandlingSignals = [];

    if (!Main.wm._animateActorFilters_mrPixel) {
        Main.wm._animateActorFilters_mrPixel = new Set();
        Main.wm._origShouldAnimateActor_mrPixel =
            Main.wm._shouldAnimateActor.bind(Main.wm);
        Main.wm._shouldAnimateActor = (actor, types) => {
            for (const filter of Main.wm._animateActorFilters_mrPixel) {
                if (!filter(actor, types)) return false;
            }
            return Main.wm._origShouldAnimateActor_mrPixel(actor, types);
        };
    }

    switcher._casAnimateActorFilter = actor => {
        const win =
            actor.meta_window ||
            (actor.get_meta_window ? actor.get_meta_window() : null);
        return !(win?._isHideOperation || win?._isUnhideOperation);
    };
    Main.wm._animateActorFilters_mrPixel.add(switcher._casAnimateActorFilter);

    const minimizeId = global.window_manager.connect(
        'minimize',
        (wm, actor) => {
            if (!actor || actor.is_destroyed()) return;
            const window = actor.get_meta_window();
            if (window && window._isHideOperation) {
                actor.opacity = 255;
                if (switcher._settings.get_boolean('enable-overview-effects')) {
                    applyHiddenEffect(window);
                }
                window._isHidden = true;
                window._isHideOperation = null;
            }
        }
    );

    const unminimizeId = global.window_manager.connect(
        'unminimize',
        (wm, actor) => {
            if (!actor || actor.is_destroyed()) return;
            const window = actor.get_meta_window();
            if (!window) return;

            removeAllEffects(window);

            if (window._isHidden && switcher._lastHiddenWindows) {
                const windowId = window.get_id();
                switcher._lastHiddenWindows =
                    switcher._lastHiddenWindows.filter(
                        w => w.get_id() !== windowId
                    );
                if (switcher._lastHiddenWindows.length === 0)
                    switcher._lastHiddenApp = null;
            }
            window._isHidden = null;
        }
    );

    switcher._hideHandlingSignals.push({
        obj: global.window_manager,
        id: minimizeId,
    });
    switcher._hideHandlingSignals.push({
        obj: global.window_manager,
        id: unminimizeId,
    });
}

/**
 * Disables custom hide handling and disconnects associated signals.
 *
 * @param {Object} switcher - The switcher instance.
 */
export function disableHideHandling(switcher) {
    if (switcher._staggerTimeoutIds) {
        switcher._staggerTimeoutIds.forEach(id => GLib.Source.remove(id));
        switcher._staggerTimeoutIds = [];
    }

    switcher._clearTimeout('_updateTimeoutId');

    if (
        Main.wm._animateActorFilters_mrPixel &&
        switcher._casAnimateActorFilter
    ) {
        Main.wm._animateActorFilters_mrPixel.delete(
            switcher._casAnimateActorFilter
        );
        switcher._casAnimateActorFilter = null;
    }

    if (
        Main.wm._animateActorFilters_mrPixel?.size === 0 &&
        Main.wm._origShouldAnimateActor_mrPixel
    ) {
        Main.wm._shouldAnimateActor = Main.wm._origShouldAnimateActor_mrPixel;
        Main.wm._animateActorFilters_mrPixel = null;
        Main.wm._origShouldAnimateActor_mrPixel = null;
    }

    global.display
        .list_all_windows()
        .forEach(window => removeAllEffects(window));

    if (switcher._hideHandlingSignals) {
        switcher._hideHandlingSignals.forEach(({obj, id}) =>
            obj.disconnect(id)
        );
        switcher._hideHandlingSignals = [];
    }
}

/**
 * Enables minimized window visual effects across all windows.
 *
 * @param {Object} switcher - The switcher instance.
 */
export function enableMinimizedEffect(switcher) {
    if (!switcher._minimizedEffectSignals)
        switcher._minimizedEffectSignals = [];

    const hiddenIds = new Set(
        switcher._lastHiddenWindows?.map(w => w.get_id()) || []
    );
    global.display.list_all_windows().forEach(window => {
        if (
            window.window_type === Meta.WindowType.NORMAL &&
            window.minimized &&
            !hiddenIds.has(window.get_id())
        ) {
            applyMinimizedEffect(window);
        }
    });

    const minimizeId = global.window_manager.connect(
        'minimize',
        (wm, actor) => {
            const window = actor.get_meta_window();
            if (
                window &&
                !window._isHideOperation &&
                switcher._settings.get_boolean('enable-overview-effects')
            ) {
                applyMinimizedEffect(window);
            }
        }
    );

    const unminimizeId = global.window_manager.connect(
        'unminimize',
        (wm, actor) => {
            const window = actor.get_meta_window();
            if (window) removeAllEffects(window);
        }
    );

    switcher._minimizedEffectSignals.push({
        obj: global.window_manager,
        id: minimizeId,
    });
    switcher._minimizedEffectSignals.push({
        obj: global.window_manager,
        id: unminimizeId,
    });
}

/**
 * Disables minimized window visual effects and disconnects their signals.
 *
 * @param {Object} switcher - The switcher instance.
 */
export function disableMinimizedEffect(switcher) {
    global.display
        .list_all_windows()
        .forEach(window => removeAllEffects(window));
    if (switcher._minimizedEffectSignals) {
        switcher._minimizedEffectSignals.forEach(({obj, id}) =>
            obj.disconnect(id)
        );
        switcher._minimizedEffectSignals = [];
    }
}

/**
 * Fixes window menu labels (e.g., changing 'Hide' to 'Minimize').
 *
 * @param {Object} switcher - The switcher instance.
 */
export function fixWindowMenuLabels(switcher) {
    if (!switcher._originalBuildMenu) {
        switcher._originalBuildMenu =
            WindowMenu.WindowMenu.prototype._buildMenu;
        WindowMenu.WindowMenu.prototype._buildMenu = function (window) {
            switcher._originalBuildMenu.call(this, window);
            this._getMenuItems().forEach(item => {
                if (!item.label) return;
                const text = item.label.text;
                if (text === _('Hide')) item.label.text = _('Minimize');
                else if (text === _('Move to Workspace Left'))
                    item.label.text = _('Send to Workspace Left');
                else if (text === _('Move to Workspace Right'))
                    item.label.text = _('Send to Workspace Right');
            });
        };
    }
}

/**
 * Restores original window menu labels.
 *
 * @param {Object} switcher - The switcher instance.
 */
export function restoreWindowMenuLabels(switcher) {
    if (switcher._originalBuildMenu) {
        WindowMenu.WindowMenu.prototype._buildMenu =
            switcher._originalBuildMenu;
        switcher._originalBuildMenu = null;
    }
}

/**
 * Enables hidden window filtering in the overview/switcher.
 *
 * @param {Object} switcher - The switcher instance.
 */
export function enableHiddenWindowFiltering(switcher) {
    const installFilter = () => {
        if (!Workspace.prototype._sharedOverviewFilters_mrPixel) {
            Workspace.prototype._sharedOverviewFilters_mrPixel = new Set();
            Workspace.prototype._originalIsOverviewWindow_mrPixel =
                Workspace.prototype._isOverviewWindow;

            Workspace.prototype._sharedOverviewDispatcher_mrPixel = function (
                win
            ) {
                const show =
                    Workspace.prototype._originalIsOverviewWindow_mrPixel.call(
                        this,
                        win
                    );
                if (!show) return false;
                for (const filter of this._sharedOverviewFilters_mrPixel) {
                    if (!filter.call(this, win)) return false;
                }
                return true;
            };
            Workspace.prototype._isOverviewWindow =
                Workspace.prototype._sharedOverviewDispatcher_mrPixel;
        }

        switcher._casOverviewFilter = function (win) {
            let metaWindow = win;
            if (win.get_meta_window) metaWindow = win.get_meta_window();
            if (switcher._lastHiddenWindows?.length > 0) {
                const windowId = metaWindow?.get_id();
                if (
                    windowId &&
                    switcher._lastHiddenWindows.some(
                        w => w.get_id() === windowId
                    )
                ) {
                    return false;
                }
            }
            return true;
        };

        Workspace.prototype._sharedOverviewFilters_mrPixel.add(
            switcher._casOverviewFilter
        );
    };

    if (!Workspace.prototype._sharedOverviewFilters_mrPixel) {
        switcher._filterInstallIdleId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
            switcher._filterInstallIdleId = null;
            installFilter();
            return GLib.SOURCE_REMOVE;
        });
    } else {
        installFilter();
    }

    switcher._hiddenWindowFocusId = global.display.connect(
        'notify::focus-window',
        () => {
            const focusedWindow = global.display.focus_window;
            if (!focusedWindow || !switcher._lastHiddenWindows?.length) return;

            const focusedApp =
                Shell.WindowTracker.get_default().get_window_app(focusedWindow);
            if (!focusedApp) return;

            const workspace = focusedWindow.get_workspace();
            if (!workspace) return;

            const appWindows = focusedApp
                .get_windows()
                .filter(w => w && w.get_workspace() === workspace);
            const appWindowIds = new Set(appWindows.map(w => w.get_id()));

            appWindows.forEach(window => {
                if (!window || !window.minimized) return;
                if (
                    switcher._lastHiddenWindows.some(
                        w => w.get_id() === window.get_id()
                    )
                ) {
                    window._isUnhideOperation = true;
                    window.unminimize();
                    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                        window._isUnhideOperation = null;
                        return GLib.SOURCE_REMOVE;
                    });
                }
            });

            switcher._lastHiddenWindows = switcher._lastHiddenWindows.filter(
                w => !appWindowIds.has(w.get_id())
            );
            if (switcher._lastHiddenWindows.length === 0)
                switcher._lastHiddenApp = null;
        }
    );
}

/**
 * Disables hidden window filtering and cleans up filters/signals.
 *
 * @param {Object} switcher - The switcher instance.
 */
export function disableHiddenWindowFiltering(switcher) {
    if (switcher._filterInstallIdleId) {
        GLib.Source.remove(switcher._filterInstallIdleId);
        switcher._filterInstallIdleId = null;
    }

    if (
        Workspace.prototype._sharedOverviewFilters_mrPixel &&
        switcher._casOverviewFilter
    ) {
        Workspace.prototype._sharedOverviewFilters_mrPixel.delete(
            switcher._casOverviewFilter
        );
        switcher._casOverviewFilter = null;
    }

    if (
        Workspace.prototype._sharedOverviewFilters_mrPixel?.size === 0 &&
        Workspace.prototype._originalIsOverviewWindow_mrPixel
    ) {
        GLib.idle_add(GLib.PRIORITY_LOW, () => {
            if (
                Workspace.prototype._sharedOverviewFilters_mrPixel?.size ===
                    0 &&
                Workspace.prototype._originalIsOverviewWindow_mrPixel &&
                Workspace.prototype._isOverviewWindow ===
                    Workspace.prototype._sharedOverviewDispatcher_mrPixel
            ) {
                Workspace.prototype._isOverviewWindow =
                    Workspace.prototype._originalIsOverviewWindow_mrPixel;
                Workspace.prototype._sharedOverviewFilters_mrPixel = null;
                Workspace.prototype._originalIsOverviewWindow_mrPixel = null;
                Workspace.prototype._sharedOverviewDispatcher_mrPixel = null;
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    if (switcher._hiddenWindowFocusId) {
        global.display.disconnect(switcher._hiddenWindowFocusId);
        switcher._hiddenWindowFocusId = null;
    }
}

/**
 * Overrides DashIcon activation to apply CAS hide/restore logic.
 *
 * DashIcon (dash.js) extends AppDisplay.AppIcon without defining its own
 * activate() — we add one directly to DashIcon.prototype, shadowing the
 * parent only for Dash clicks and leaving the app grid untouched.
 *
 * Modifier shortcuts (Ctrl+click, middle-click) pass through unchanged.
 * Apps with no windows on the current workspace (stopped, or on another
 * workspace) fall back to native app.activate() so launching and
 * workspace-switching both work correctly.
 *
 * @param {import('./indicator.js').ClassicAppSwitcher} switcher
 * @returns {void}
 */
export function enableDashIconActivation(switcher) {
    if (switcher._origDashIconActivate) return;

    Dash.DashIcon.prototype.activate = function (button) {
        const event = Clutter.get_current_event();
        const modifiers = event ? event.get_state() : 0;
        const isMiddleButton = button && button === Clutter.BUTTON_MIDDLE;
        const isCtrlPressed =
            (modifiers & Clutter.ModifierType.CONTROL_MASK) !== 0;
        const openNewWindow =
            this.app.can_open_new_window() &&
            this.app.state === Shell.AppState.RUNNING &&
            (isCtrlPressed || isMiddleButton);

        if (this.app.state === Shell.AppState.STOPPED || openNewWindow)
            this.animateLaunch();

        if (openNewWindow) {
            this.app.open_new_window(-1);
        } else {
            const workspace = global.workspace_manager.get_active_workspace();
            const hasWindowsHere = this.app
                .get_windows()
                .some(w => w.get_workspace() === workspace);

            if (hasWindowsHere) {
                activateApplication(switcher, this.app, workspace);
            } else {
                // Stopped or all windows on another workspace — native activate
                // handles launching and workspace-switching correctly
                this.app.activate();
            }
        }

        Main.overview.hide();
    };

    // Store our function as the installed sentinel
    switcher._origDashIconActivate = Dash.DashIcon.prototype.activate;
}

/**
 * Removes the DashIcon activation override, restoring prototype chain
 * lookup to AppDisplay.AppIcon.prototype.activate.
 *
 * @param {import('./indicator.js').ClassicAppSwitcher} switcher
 * @returns {void}
 */
export function disableDashIconActivation(switcher) {
    if (switcher._origDashIconActivate) {
        delete Dash.DashIcon.prototype.activate;
        switcher._origDashIconActivate = null;
    }
}

