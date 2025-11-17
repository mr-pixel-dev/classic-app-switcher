## Introduction

Classic App Switcher is a Mac OS 9-style application switcher extension for GNOME Shell. The minimal design blends discreetly into the GNOME UI, providing a familiar workflow for users transitioning from macOS while respecting GNOME's design principles.

The extension places an app indicator (icon and title) on the panel showing the currently focused application. This serves as a helpful anchor on both single and multi-workspace setups, especially useful since GNOME removed window titles from the top bar.

**Key Features:**
- Panel button opens a menu with window management functions
- Lists running applications on the current workspace
- Easily hide an app and retrieve all of its open windows
- Hide all other apps/windows allowing you to focus on the active window
- Window count showing visible and hidden (or minimised) windows and apps
- Workspace-isolated behaviour for fluid multi-workspace workflows
- Complements native GNOME features (Activities, Dash, Dynamic Workspaces)

**Design Philosophy:**

Classic App Switcher augments GNOME's existing workflow rather than replacing it. Unlike dock or taskbar extensions, it works *with* GNOME's full-screen launcher and Activities Overview, not against them.

**Best Experienced:**
- On vanilla GNOME with a clean default panel
- Without competing taskbar/dock extensions
- Embracing GNOME's unique interface paradigm
- Remember: The Dash is NOT a Dock!

**Built for:**

New users seeking familiarity and experienced users wanting enhanced lightweight app/window management.

**Notice:**

1. In order to display a symbolic icon in the panel indicator, developers must ensure they have included a symbolic version of their app-icon in their package. Missing icons will result in the default full-color Icon being displayed. If you spot an application that has a missing icon please reach out to their developers politely requesting they add one!

2. This extension will function perfectly well if you do not have the minimise button enabled for window management - though you may find it helpful to enable this via GNOME Tweaks for an enhanced experience, particularly if you tend to work with multiple windows and apps on a single workspace. Note: GNOME 47+ disables the minimize button by default.
