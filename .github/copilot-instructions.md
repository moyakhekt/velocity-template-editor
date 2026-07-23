# VS Code Extension: Velocity Template Editor

## Project Status - STATE MANAGEMENT REFACTOR IN PROGRESS
- [x] Create workspace instructions and get project setup info
- [x] Scaffold VS Code extension project structure
- [x] Implement Velocity syntax highlighting (TextMate grammar)
- [x] Implement formatting provider with smart indentation
- [x] Implement live preview webview with Apache Velocity server
- [x] Implement unified Context Manager with dual-context support
- [x] Implement template-specific context (`.context.json` files)
- [x] Implement environment shared context with user-specified file
- [x] Implement context merging for rendering (environment + template)
- [x] Implement source toggles (Template/Environment)
- [x] Implement JavaScript method mocks with Nashorn engine
- [x] Install dependencies and compile
- [x] VS Code theme integration for webview UI
- [x] **NEW: Create ContextState centralized state management**
- [x] **NEW: Define comprehensive message type system**
- [x] **NEW: Implement file watcher suppression to prevent scroll jumps**
- [ ] **IN PROGRESS: Replace updateWebview() calls with targeted DOM updates**
- [ ] **TODO: Complete integration of ContextState into ContextManager**

## IMPORTANT: Current Architecture Refactoring

### Problem Being Solved
The extension had 50+ calls to `updateWebview()` causing full page refreshes on every change, resulting in:
- Lost scroll position on every update
- Poor performance (regenerating entire page HTML)
- FileSystemWatcher infinite loops
- Difficult to debug update flow

### New Architecture (Event-Driven State Management)

```
User Action → Webview → ContextManager → ContextState (in-memory)
                         ↓                    ↓
                    postMessage          File Write (suppressed)
                         ↓                    ↓
                    Webview          Change Event Emitted
                         ↓                    ↓
            Targeted DOM Update      FileSystemWatcher (skips if suppressed)
```

**Key Files**:
- `extension/contextState.ts` - Centralized state with change detection & events
- `extension/messageTypes.ts` - All message type definitions
- `docs/ARCHITECTURE.md` - Complete architecture documentation with sequence diagrams
- `docs/REFACTORING-GUIDE.md` - Step-by-step refactoring guide

**Core Principle**: No full page refreshes. Every operation sends a specific update message that modifies only the affected DOM elements.

## Project Overview
VS Code extension for editing Apache Velocity templates with:
- **Syntax highlighting**: TextMate grammar for Velocity directives, variables, methods
- **Document formatting**: Smart indentation based on directive nesting
- **Live preview**: Real-time rendering using Apache Velocity 2.3 server (Java + Nashorn)
- **Context Manager**: Unified webview for managing variables, properties, and methods
- **Dual-context system**: 
  - Template context: Per-template `.context.json` files
  - Environment context: Shared JSON file (user-specified location)
- **Context merging**: Automatic merging of environment + template contexts for rendering
- **Source toggles**: Move items between template/environment with UI controls
- **Method mocks**: JavaScript implementations with `args[]` access

## Running the Extension
1. Press **F5** to launch Extension Development Host
2. Open a `.vm` file (e.g., `docs/examples/example.vm`)
3. Use commands from Command Palette (**Ctrl+Shift+P**):
   - `Velocity: Open Preview` - Live template rendering
   - `Velocity: Manage Context` - Unified context manager
   - `Velocity: Format Document` - Smart indentation

## Project Structure
```
extension/
  extension.ts           - Extension activation and command registration
  formatting.ts          - Document formatting provider
  preview.ts             - Live preview webview with Velocity server integration
  contextManager.ts      - Unified context manager (1400+ lines)
  templateParser.ts      - Template analysis for variable/method detection
  velocityServerClient.ts - Java Velocity server communication
  types.ts               - TypeScript type definitions
webview-ui/
  webview.html           - Context Manager webview UI
  scripts.js             - Client-side JavaScript for webview
  styles.css             - Webview styles
syntaxes/
  velocity.tmLanguage.json - TextMate grammar for syntax highlighting
language-configuration.json - Brackets, comments, auto-closing pairs
server/
  src/main/java/com/ktmoyakhe/vscode/velocity/
    VelocityServer.java  - Apache Velocity 2.3 + Nashorn JavaScript
  pom.xml                - Maven build configuration
  target/
    velocity-server-1.0.jar - Compiled server JAR
```

## Key Features

### Context Manager (contextManager.ts)
- **Dual-tab interface**: Template Context / Environment Context
- **Template Context tab**:
  - Shows all variables, properties, methods from template
  - Source toggle (Template/Environment) for each item
  - Edit and save when source = Template
  - Read-only display when source = Environment
  - Delete button for template items
- **Environment Context tab**:
  - Load/Save environment context file (📂/💾 buttons)
  - Edit environment variables, properties, methods
  - Accessible to all templates automatically
- **Context merging** (automatic during rendering):
  - `getContextForTemplate()`: Returns merged environment + template context
  - `getTemplateOnlyContext()`: Returns template-only for UI display
  - Objects are merged: `{...environment.obj, ...template.obj}`

### Velocity Server (VelocityServer.java)
- Apache Velocity 2.3 engine
- Nashorn JavaScript engine for method mocks
- HTTP server on port 9876
- Accepts POST requests with:
  - `template`: Velocity template string
  - `variables`: JSON object with variables
  - `mocks`: Object with method implementations
- Returns rendered HTML or error details

### Preview (preview.ts)
- Splits context into variables and mocks
- Sends to Velocity server via HTTP
- Displays rendered output in webview
- Auto-refresh on template/context changes

## Data Formats

### Template Context (.context.json)
```json
{
  "variableName": "value",
  "user": {
    "name": "John",
    "getEmail": {
      "_implementation": "return 'john@example.com'"
    }
  }
}
```

### Environment Context (user-specified .json)
```json
{
  "locale": {
    "getLanguage": {
      "_implementation": "return 'en'"
    }
  },
  "config": {
    "apiUrl": "https://api.example.com"
  }
}
```

### Method Mock Format
Methods must have `_implementation` key with JavaScript code:
```json
{
  "objectName": {
    "methodName": {
      "_implementation": "return args[0].toUpperCase()"
    }
  }
}
```

## Development Commands
```bash
npm install          # Install dependencies
npm run compile      # Compile TypeScript (watch mode)
npm run package      # Package extension as VSIX
```

## Testing
1. F5 to launch Extension Development Host
2. Open `docs/examples/example.vm` in test workspace
3. Test Context Manager: Ctrl+Shift+P → "Velocity: Manage Context"
4. Test Preview: Click preview icon or Ctrl+Shift+P → "Velocity: Open Preview"
5. Verify context merging: Add items to environment, check they appear in preview

## Architecture Notes
- **Context separation**: UI uses `getTemplateOnlyContext()`, rendering uses `getContextForTemplate()`
- **Caching**: Template contexts are cached to avoid repeated file reads
- **Global state**: Environment context path persisted in VS Code's global state
- **Theme integration**: All colors use VS Code CSS variables (e.g., `--vscode-button-background`)
- **Message passing**: Webview ↔ Extension via `postMessage` API
