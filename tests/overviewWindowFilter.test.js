'use strict';

import {shouldShowInOverview} from '../overviewWindowFilter.js';

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

class TestWindow {
    constructor(id, minimized) {
        this._id = id;
        this.minimized = minimized;
    }

    get_id() {
        return this._id;
    }
}

const visibleWindow = new TestWindow(1, false);
const hiddenWindow = new TestWindow(2, true);
const minimizedWindow = new TestWindow(3, true);

assertEqual(
    shouldShowInOverview(visibleWindow, [hiddenWindow], false, false),
    true,
    'visible window must remain visible when hidden filtering is disabled'
);
assertEqual(
    shouldShowInOverview(hiddenWindow, [hiddenWindow], true, false),
    false,
    'tracked hidden window must be omitted when hidden filtering is enabled'
);
assertEqual(
    shouldShowInOverview(hiddenWindow, [hiddenWindow], false, false),
    true,
    'tracked hidden window must remain visible when hidden filtering is disabled'
);
assertEqual(
    shouldShowInOverview(minimizedWindow, [hiddenWindow], false, true),
    false,
    'ordinary minimized window must be omitted when minimized filtering is enabled'
);
assertEqual(
    shouldShowInOverview(minimizedWindow, [hiddenWindow], true, false),
    true,
    'ordinary minimized window must remain visible when minimized filtering is disabled'
);
assertEqual(
    shouldShowInOverview(hiddenWindow, [hiddenWindow], false, true),
    true,
    'tracked hidden window must remain visible when only minimized filtering is enabled'
);
assertEqual(
    shouldShowInOverview(hiddenWindow, [hiddenWindow], true, true),
    false,
    'tracked hidden window must be omitted when both filters are enabled'
);
assertEqual(
    shouldShowInOverview(minimizedWindow, [hiddenWindow], true, true),
    false,
    'ordinary minimized window must be omitted when both filters are enabled'
);

print('overview window filter tests passed');
