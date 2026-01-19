# VS Code Extension: Velocity Template Editor

## Project Status
- [x] Create workspace instructions and get project setup info
- [x] Scaffold VS Code extension project structure
- [x] Implement Velocity syntax highlighting (TextMate grammar)
- [x] Implement formatting provider with smart indentation
- [x] Implement live preview webview with Apache Velocity server
- [x] Implement unified Context Manager with dual-context support
- [x] Implement template-specific context (`.context.json` files)
- [x] Implement global shared context with user-specified file
- [x] Implement context merging for rendering (global + template)
- [x] Implement source toggles (Template/Global)
- [x] Implement JavaScript method mocks with Nashorn engine
- [x] Install dependencies and compile
- [x] VS Code theme integration for webview UI

## Project Overview
VS Code extension for editing Apache Velocity templates with:
- **Syntax highlighting**: TextMate grammar for Velocity directives, variables, methods
- **Document formatting**: Smart indentation based on directive nesting
- **Live preview**: Real-time rendering using Apache Velocity 2.3 server (Java + Nashorn)
- **Context Manager**: Unified webview for managing variables, properties, and methods
- **Dual-context system**: 
  - Template context: Per-template `.context.json` files
  - Global context: Shared JSON file (user-specified location)
- **Context merging**: Automatic merging of global + template contexts for rendering
- **Source toggles**: Move items between template/global with UI controls
- **Method mocks**: JavaScript implementations with `args[]` access

## Running the Extension
1. Press **F5** to launch Extension Development Host
2. Open a `.vm` file (e.g., `example.vm`)
3. Use commands from Command Palette (**Ctrl+Shift+P**):
   - `Velocity: Open Preview` - Live template rendering
   - `Velocity: Manage Context` - Unified context manager
   - `Velocity: Format Document` - Smart indentation

## Project Structure
```
src/
  extension.ts           - Extension activation and command registration
  formatting.ts          - Document formatting provider
  preview.ts             - Live preview webview with Velocity server integration
  contextManager.ts      - Unified context manager (1400+ lines)
  templateParser.ts      - Template analysis for variable/method detection
  velocityServerClient.ts - Java Velocity server communication
  types.ts               - TypeScript type definitions
syntaxes/
  velocity.tmLanguage.json - TextMate grammar for syntax highlighting
language-configuration.json - Brackets, comments, auto-closing pairs
velocity-server/
  src/main/java/com/vscode/velocity/
    VelocityServer.java  - Apache Velocity 2.3 + Nashorn JavaScript
  pom.xml                - Maven build configuration
  target/
    velocity-server-1.0.jar - Compiled server JAR
```

## Key Features

### Context Manager (contextManager.ts)
- **Dual-tab interface**: Template Context / Global Context
- **Template Context tab**:
  - Shows all variables, properties, methods from template
  - Source toggle (Template/Global) for each item
  - Edit and save when source = Template
  - Read-only display when source = Global
  - Delete button for template items
- **Global Context tab**:
  - Load/Save global context file (📂/💾 buttons)
  - Edit global variables, properties, methods
  - Accessible to all templates automatically
- **Context merging** (automatic during rendering):
  - `getContextForTemplate()`: Returns merged global + template context
  - `getTemplateOnlyContext()`: Returns template-only for UI display
  - Objects are merged: `{...global.obj, ...template.obj}`

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

### Global Context (user-specified .json)
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
2. Open `example.vm` in test workspace
3. Test Context Manager: Ctrl+Shift+P → "Velocity: Manage Context"
4. Test Preview: Click preview icon or Ctrl+Shift+P → "Velocity: Open Preview"
5. Verify context merging: Add items to global, check they appear in preview

## Architecture Notes
- **Context separation**: UI uses `getTemplateOnlyContext()`, rendering uses `getContextForTemplate()`
- **Caching**: Template contexts are cached to avoid repeated file reads
- **Global state**: Global context path persisted in VS Code's global state
- **Theme integration**: All colors use VS Code CSS variables (e.g., `--vscode-button-background`)
- **Message passing**: Webview ↔ Extension via `postMessage` API
