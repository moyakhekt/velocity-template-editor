# Examples

Two templates and a context file that covers both.

| File | Shows |
|------|-------|
| `profile.vm` | Variables, objects and lists; `#if`/`#elseif`, `#foreach`, `#set`; a mocked method (`$user.getEmail()`); `$!` for optional values; comments |
| `login.vm` | Scenarios for each state of a page, the request tool (`getParameter`), the locale tool, and messages from a `.properties` file |
| `environment-context.json` | The [context file](../CONTEXT-FILE.md): two scenarios for `profile.vm` and three for `login.vm` (each overriding only what differs from Default), and `user.getEmail` mapped to the `emailFromName` mock function |
| `messages.properties` | The messages `login.vm` shows for each error |

## Try them

1. Open this repository's folder in VS Code. The template paths in the context file are relative to it, for example `docs/examples/login.vm`.
2. Open `login.vm`, click **Manage Context**, choose **Open Existing Context**, and pick `docs/examples/environment-context.json`.
3. In **Environment Context** › **Messages Properties Files**, add `docs/examples/messages.properties`.
4. Click **Open Preview**, then switch between **Default**, **Invalid password** and **Account locked** in the preview toolbar.
5. Use the toolbar's **Template** menu to switch to `profile.vm`, and try its **New member** scenario.
