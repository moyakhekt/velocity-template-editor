# Preview

**Open Preview** (editor title bar, or **Velocity: Open Preview**) renders the template in your default browser. The preview runs on a local server that only your machine can reach.

## Live updates

The preview re-renders when you:
- edit the template (after `velocity.preview.refreshDelay` ms; turn off `velocity.preview.autoRefresh` to stop this);
- change a value or switch scenarios in the Context Manager;
- save a messages `.properties` file.

Only the frame whose content changed reloads, so scroll position is kept where possible.

## One tab

Previewing from VS Code reuses the preview tab that's already open; a new tab only opens when there isn't one. The tab closes itself when VS Code closes or the extension stops. If the browser won't let it close (for example after you've navigated elsewhere in that tab), it says the preview has ended instead.

## Toolbar

| Control | Does |
|---------|------|
| **Template** | Switch to any template in the context file, grouped by template group. Type to search. |
| **Scenario** | Switch the active scenario. |
| **Compare** | Show another template from the same group (see below). |
| **Primary / Compare / Both** | Which frame to show while comparing. |
| **Open in VS Code** | Open the previewed template in the editor. |
| **⌃** (right end) | Hide the toolbar. A small logo tab in the top-left corner brings it back. |

The dropdowns open scrolled to the current choice, and work from the keyboard: arrows to move, Enter to choose, Esc to close.

The page URL always reflects the template, scenario and comparison, so a refresh or bookmark shows the same thing.

## Comparing templates

For templates in a [template group](CONTEXT-MANAGER.md#template-groups), **Compare** shows another member rendered with the same scenario. Choose **Both** to see them side by side; click a frame's label to open that template in VS Code.

## Links, forms and scripts

The preview doesn't navigate away. Following a link, submitting a form, `window.open`, or script navigation opens a dialog showing where it would have gone, with the method and form data. This lets you check what a page would send without a real backend.

## Assets

Relative URLs in the template (CSS, images, scripts) are served from the template's root: the nearest `conf/template` folder above it, or else the template's own folder. Files in the parent of that folder are found too. Nothing outside those folders is served.

The [CSP directives](CSP.md) in the context file control what else the page may load.

## Screenshot tests

**Run Screenshot Tests** (Context Manager title bar, or **Velocity: Run Screenshot Tests**) renders every scenario of every template in the context file and saves a full-page PNG of each:

1. Choose the template root folder; template paths in the context file are resolved against it.
2. Choose the output folder.

Files are named `<template>-<scenario>.png`. It needs Google Chrome or Microsoft Edge installed; nothing is downloaded.
