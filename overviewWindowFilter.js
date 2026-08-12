'use strict';

export function shouldShowInOverview(metaWindow, hiddenWindows, hideHidden, hideMinimized) {
    const isHidden = hiddenWindows.some(hiddenWindow =>
        hiddenWindow && hiddenWindow.get_id() === metaWindow.get_id()
    );
    const isOrdinarilyMinimized = metaWindow.minimized && !isHidden;

    return !(hideHidden && isHidden) && !(hideMinimized && isOrdinarilyMinimized);
}
