# Architecture

The extension has three parts:

```
VS Code extension host (TypeScript, extension/)
 ├─ Context Manager view ── webview UI (webview-ui/) ── postMessage
 ├─ Preview server (Node http, localhost) ── browser tab
 └─ Velocity server client ── HTTP + token ── Java Velocity server (server/)
```

- The **extension** owns all state: it reads and writes the environment context file and drives the UI.
- The **Java server** only renders: given a template and values, it returns HTML.
- The **browser tab** shows the preview, served by the extension's own local server.

## Layout

```
extension/
  extension.ts                 Activation: commands, view, watchers, server start
  preview.ts                   Preview server, page and toolbar, live updates
  context/
    contextManager.ts          Context Manager view provider; loads/saves the context file,
                               builds render contexts, dispatches webview messages
    contextManagerServices.ts  Pure helpers (scenario variables, URLs, headers) and the
                               IContextServices interface the services depend on
    contextWebviewRenderer.ts  Builds the view's HTML from webview-ui/webview.html
    environmentContextService.ts  Environment tab: file, messages, headers, CSP, variables, mocks
    scenarioService.ts         Scenarios: create/rename/delete/switch, variables, request
    templateDataService.ts     Template variables and their values
    templateGroupService.ts    Template groups
    inputDialogService.ts      Input prompts
  server/
    velocityServerClient.ts    Starts the Java server and calls it
    screenshotRunner.ts        Screenshot tests (playwright-core, system Chrome/Edge)
  shared/
    templateParser.ts          Static analysis of templates (variables, methods, params, branches)
    renderInput.ts             Splits a render context into variables and method mocks
    messageTypes.ts            Webview ↔ extension message types and validation
    types.ts                   Context file types
    debugLogging.ts            The velocity.debugLogging switch
webview-ui/                    Context Manager HTML, CSS and script (copied to out/ by the build)
server/                        Java Velocity server (Maven), see SERVER.md
syntaxes/                      TextMate grammar and language configuration
media/                         Logos and the Activity Bar icon
```

## Activation

The extension activates for the `velocity` language, its commands, and its view. `activate()`:

1. starts the Java server (unless `velocity.useApacheVelocity` is off);
2. creates the `ContextManager` and `VelocityPreviewProvider`;
3. registers commands, the Context Manager view (`velocity.contextManager`), and watchers for document edits and `.properties` saves.

On deactivation the preview tells open tabs to close, and the Java server is shut down.

## Context Manager

`ContextManager` is a `WebviewViewProvider` in the side bar. It holds the loaded environment context in memory and saves the whole file on each change. A file watcher, with a suppression counter around the extension's own writes, picks up external edits.

The view is rendered from `webview-ui/webview.html` by `ContextWebviewRenderer`. User actions post messages, which `handleWebviewMessage` validates (`isWebviewMessage`) and dispatches to the services. Most changes reply with targeted messages so the view updates in place; larger changes re-render the view.

The services receive the manager as `IContextServices`, which keeps them independent of the class and testable.

## Rendering

`ContextManager.getContextForTemplate()` builds a template's values. The template's group's context is used if it's in one, otherwise its own entry under `templates`. The values are:

1. the environment variables;
2. the active scenario's values merged over them;
3. a request object (`{ _httpServletRequest: true, url, headers }`) if the template uses one.

`splitVariablesAndMocks` (`shared/renderInput.ts`) splits these into plain variables and method mocks (objects whose members have `_implementation`); `preview.ts` and the screenshot runner then call `VelocityServerClient.render()` with them, the messages files, the language, and the tool variable names.

## Preview

`VelocityPreviewProvider` runs a Node HTTP server on a free port in 8100–8200, bound to localhost.

| Path | Serves |
|------|--------|
| `/velocity-preview.html` | The page: toolbar and frames. `?template=`, `?scenario=`, `?compare=` change what's previewed |
| `/velocity-preview-content.html`, `/velocity-preview-compare.html` | The rendered templates, with the CSP tag, `<base>`, and the navigation-capture script |
| `/__events` | Server-sent events: version numbers to reload the page or a frame, and `close` on shutdown |
| `/__open-template` | Opens the previewed or compared template in VS Code |
| anything else | Assets under the template root or its parent |

Every request must be addressed to `localhost`/`127.0.0.1`/`[::1]` on the preview port, and must not come from another site (`Sec-Fetch-Site`). Asset paths are resolved, including symlinks, and refused outside their root. No CORS headers are sent.

An open `/__events` connection is how the extension knows a tab is open: **Open Preview** reuses it instead of opening another. On shutdown, each tab gets `event: close` and closes itself. Navigation within the page uses `location.replace()` so the tab keeps a single history entry, which browsers require before a script may close a tab.

## Java server

`VelocityServerClient` starts `java -jar server/target/velocity-server-1.0.0.jar` with:
- the newest Java 17+ it finds (`JAVA_HOME`, common JDK folders, `PATH`);
- a random token in `VELOCITY_SERVER_TOKEN`.

The server writes one line to stdout, `{"event":"ready","port":N}`, once it's listening; its logs go to stderr, which is shown in the **Velocity Server** output channel. Every request carries the token in `X-Velocity-Token`. See [SERVER.md](SERVER.md).

## Building

```bash
npm install
npm run compile        # esbuild: extension → out/extension.js; copies webview-ui/ and codicons into out/
npm run build:java     # mvn clean package → server/target/velocity-server-1.0.0.jar
npm run build:all      # both
npm run watch          # rebuild the extension on change
```

Building the server needs Maven and JDK 17+.

## Running and debugging

Press **F5** to start an Extension Development Host. In development mode `velocity.debugLogging` is always on:
- the Java server logs each render step;
- the client logs each render request;
- the preview page logs captured navigation to the browser console.

Use **Velocity: Open Developer Tools** to inspect the Context Manager view.

## Lint and tests

```bash
npm run lint   # ESLint 9 (eslint.config.mjs): typescript-eslint for extension/, browser rules for webview-ui/
npm test
```

Jest, with `vscode` mocked by `extension/__mocks__/vscode.ts`. The suites cover the template parser, message validation, scenario and render helpers (including the variable/mock split), and the preview server's security checks (which start the real server).

## Packaging

```bash
npx @vscode/vsce package
```

`vscode:prepublish` runs `build:all`. `.vscodeignore` keeps the package to what runs: `out/`, `media/` (logos and icons), `syntaxes/` (grammar and language configuration), the server jar, `playwright-core`, `README.md`, `CHANGELOG.md`, `LICENSE` and `package.json`. Check with `npx @vscode/vsce ls`.
