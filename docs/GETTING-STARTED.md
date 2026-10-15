# Getting started

## Requirements

- **Java 17 or newer.** The preview renders templates with Apache Velocity in a small Java server that the extension starts for you. It looks in `JAVA_HOME`, the usual JDK install folders, and `PATH`.
- **VS Code 1.85 or newer.**
- **Google Chrome or Microsoft Edge**, only for [screenshot tests](PREVIEW.md#screenshot-tests).

## 1. Open a template

Files ending in `.vm`, `.vtl` or `.velocity` open as Velocity automatically.

`.html` templates stay HTML until you opt in, so ordinary HTML isn't mistaken for Velocity. Open one and run **Velocity: Detect Velocity Syntax** from the Command Palette. If it finds Velocity, it switches the file and offers **Always**, which adds a workspace setting such as:

```json
"files.associations": {
    "**/conf/template/**/*.html": "velocity"
}
```

## 2. Create an environment context

Everything the preview needs (shared variables, mock functions, each template's scenarios) lives in one JSON file, the *environment context*. See [Context file format](CONTEXT-FILE.md).

1. With the template open, click **Manage Context** in the editor title bar (or run **Velocity: Manage Context (Variables & Objects)**).
2. Choose **Create New Context** and pick where to save it, for example `environment-context.json` in your project. Or choose **Open Existing Context** to use one you already have.
3. If the template isn't in the file yet, choose **Add to Current Context**.

The Context Manager opens in the side bar. You can open it any time from the **{ V }** icon on the Activity Bar.

## 3. Give the template some values

In the Context Manager, open **Template Context** › **Variables**. Every variable the template uses is listed. Type a value into a row to set it for the **Default** scenario. Tick **JSON** to enter an object or array, for example `{"name": "Ann", "roles": ["admin"]}`.

Values shared by many templates belong in **Environment Context** › **Environment Variables** instead; a template's own values take precedence.

## 4. Preview

Click **Open Preview** in the editor title bar (or run **Velocity: Open Preview**). The template renders in your default browser and updates as you type, save values, or switch scenarios.

## 5. Add scenarios

Scenarios are named sets of values for testing a template's states, such as *Logged out*, *Invalid password* or *Account locked*. In **Template Context** › **Scenarios**, click **+** to add one, then override only the values that differ from **Default**. Switch scenarios from the Context Manager or the preview toolbar.

## Next

- [Context Manager](CONTEXT-MANAGER.md): template groups, request URLs and headers, messages files, mock functions.
- [Preview](PREVIEW.md): comparing templates side by side, captured links and forms, screenshots.
- [Examples](examples/README.md): a ready-made template and context file.

## Troubleshooting

**"Failed to start Apache Velocity server"**
Open **View › Output** and pick **Velocity Server**. Most often no Java 17+ runtime was found: install one (for example Eclipse Temurin) or point `JAVA_HOME` at it, then reload the window.

**The preview shows a Velocity error page**
The page shows Velocity's message and stack trace. A line and column in the message point into your template.

**A variable shows as `$name` in the preview**
It has no value in the active scenario or the environment. Set it in **Template Context** › **Variables**. Use `$!name` in the template to render nothing instead.

**The Context Manager says the template needs an environment context**
Click **Set up context**, or **Manage Context** on the template.

**More detail for a bug report**
Turn on the `velocity.debugLogging` setting and restart VS Code. The Velocity Server output then shows each render step, and the preview page logs captured navigation to the browser console.
