# Velocity Template Editor: notes for AI assistants

A VS Code extension for editing Apache Velocity templates and previewing them with mocked data. Read [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) before changing code; user-facing behaviour is described in [docs/](../docs/README.md).

## Shape of the code

- `extension/`: TypeScript extension host, bundled by esbuild into `out/extension.js`.
  - `context/contextManager.ts`: the Context Manager side bar view, the environment context file, and the render context.
  - `context/*Service.ts`: features behind `IContextServices`.
  - `preview.ts`: the local preview server and browser page.
  - `server/velocityServerClient.ts`: starts and calls the Java server.
- `webview-ui/`: the Context Manager's HTML, CSS and script. Plain JavaScript, copied to `out/webview-ui/`.
- `server/`: Java 17 Maven project, package `com.moyakhekt.vscode.velocity`. Renders with Velocity 2.3; mock methods run in Nashorn.
- All template data lives in one environment context JSON file. See [docs/CONTEXT-FILE.md](../docs/CONTEXT-FILE.md).

## Rules that matter

- **Java server:** keep it loopback-only and token-protected (`AuthFilter`). Its stdout carries only the `{"event":"ready","port":N}` handshake; log to stderr through log4j.
- **Preview server:** keep its host and `Sec-Fetch-Site` checks and its asset path containment. Don't add CORS headers.
- **Sandboxes:** mock JavaScript runs with `--no-java` and a deny-all class filter, and templates use `SecureUberspector`. Don't widen either.
- **Webview messages:** validate them with `isWebviewMessage` (`shared/messageTypes.ts`) before acting on them.
- **Logging:** gate debug output on `isDebugLogging()` (`shared/debugLogging.ts`). No bare `console.log` in the extension host.
- **Line endings:** match each file's existing line endings (most are CRLF).

## Commands

```bash
npm run compile      # extension (esbuild)
npm run build:java   # server jar (Maven)
npm test             # Jest
npx @vscode/vsce ls  # what the .vsix will contain
```
