<p align="center">
  <svg width="80" height="80" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="ext-logo-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#FF6B35;stop-opacity:1" />
        <stop offset="50%" style="stop-color:#F7931E;stop-opacity:1" />
        <stop offset="100%" style="stop-color:#FDC830;stop-opacity:1" />
      </linearGradient>
    </defs>
    <circle cx="50" cy="50" r="48" fill="url(#ext-logo-gradient)" stroke="#FF6B35" stroke-width="2"/>
    <path d="M 30 25 L 50 65 L 45 65 L 25 25 Z" fill="white" />
    <path d="M 50 25 L 70 65 L 65 65 L 45 25 Z" fill="white" />
    <path d="M 70 25 L 75 25 L 55 65 L 50 65 Z" fill="white" />
    <path d="M 35 70 L 65 70 L 63 75 L 37 75 Z" fill="white" opacity="0.8"/>
    <path d="M 40 78 L 60 78 L 58 82 L 42 82 Z" fill="white" opacity="0.6"/>
  </svg>
</p>

# Extension Module

TypeScript source code for the VS Code extension logic. This module handles extension activation, command registration, and orchestrates communication between the webview UI, Java server, and VS Code APIs.

## Architecture

The extension follows a modular architecture with clear separation of concerns:

```
extension/
├── extension.ts             # Extension entry point & lifecycle management
├── contextManager.ts        # Context data management & persistence (3500+ lines)
├── preview.ts              # Live preview webview & template rendering
├── templateParser.ts       # Velocity template analysis & variable extraction
├── velocityServerClient.ts # Java Velocity server communication
└── types.ts                # TypeScript interfaces & type definitions
```

## Core Files

### extension.ts
**Purpose:** Extension activation and command registration

**Key Responsibilities:**
- VS Code extension lifecycle (activate/deactivate)
- Command registration (preview, format, context manager)
- Apache Velocity server initialization
- Output channel management for logging
- Document formatting provider registration

**Commands Registered:**
- `velocity.openPreview` - Open live preview panel
- `velocity.formatDocument` - Format Velocity template with smart indentation
- `velocity.showContext` - Open Context Manager webview

**Dependencies:**
- Starts `VelocityServerClient` on activation (if enabled in settings)
- Instantiates `VelocityPreviewProvider` and `ContextManager`
- Registers document formatting provider for `.vm` files

### contextManager.ts
**Purpose:** Unified context management system with dual-context support

**Size:** ~3,500 lines (largest module in the extension)

**Key Features:**
- **Template Context**: Per-template `.context.json` files with variables, properties, methods
- **Environment Context**: Shared JSON file (user-specified) accessible to all templates
- **Context Merging**: Automatic merging of environment + template contexts for rendering
- **Source Tracking**: Each context item tracks whether it comes from 'environment' or 'template'
- **Scenario Support**: Named variable sets with inheritance (e.g., "logged-in", "admin")
- **Webview UI**: Dual-tab interface for managing template vs environment contexts
- **Properties Files**: Support for `.properties` files (e.g., `messages.properties`)
- **Mock Methods**: JavaScript method implementations using `args[]` parameter access

**Data Structures:**
```typescript
interface EnvironmentContextConfig {
  filePath?: string;                    // Path to environment context JSON
  messagesPropertiesPath?: string;      // Path to messages.properties
  language?: string;                    // Language code (e.g., 'en')
  headers?: { [key: string]: string };  // HTTP headers
  mockFunctions?: { [name: string]: string }; // JavaScript implementations
  data: any;                            // Other environment variables
}

interface ScenarioData {
  url?: string;                         // Request URL
  headers?: { [key: string]: any };     // Scenario-specific headers
  variables: { [key: string]: any };    // Scenario variables
  methods?: any;                        // Method overrides
  inheritFrom?: string;                 // Parent scenario name
}
```

**Key Methods:**
- `getContextForTemplate()` - Returns merged environment + template context (for rendering)
- `getTemplateOnlyContext()` - Returns template-only context (for UI display)
- `loadEnvironmentContext()` - Loads shared environment context from user-specified file
- `saveTemplateContext()` - Persists template context to `.context.json`
- `moveToEnvironment()` / `moveToTemplate()` - Source toggle operations
- `loadPropertiesFile()` - Parse `.properties` files for internationalization

**Caching:**
- Template contexts are cached in memory (`contextCache: Map<string, ContextData>`)
- Environment context is loaded once and reused across all templates
- Cache invalidation on file changes

### preview.ts
**Purpose:** Live template preview with real-time rendering

**Key Features:**
- **Webview Panel**: Creates VS Code webview panel for rendered output
- **HTTP Server**: Built-in HTTP server (port 8100-8200) to serve static assets
- **Auto-refresh**: Automatic re-render on template or context changes
- **Apache Velocity Integration**: Communicates with Java server for 100% compatible rendering
- **Asset Loading**: Handles CSS, JavaScript, and image references in templates
- **Error Display**: Shows Velocity parsing errors with stack traces

**Rendering Pipeline:**
1. User opens preview command → `showPreview()`
2. Start local HTTP server for static assets → `startPreviewServer()`
3. Get merged context from ContextManager → `getContextForTemplate()`
4. Split context into variables and method mocks
5. Send to Velocity server via HTTP POST → `velocityServerClient.render()`
6. Receive rendered HTML and display in webview
7. Watch for file changes → auto-refresh

**Static Asset Serving:**
- Serves CSS, JS, images from template directory
- Random port selection (8100-8200) to avoid conflicts
- MIME type detection for proper content-type headers

### templateParser.ts
**Purpose:** Analyze Velocity templates to extract variables and method calls

**Key Features:**
- **Variable Detection**: Identifies `$variable` and `${variable}` references
- **Method Detection**: Finds method calls like `$object.method()` or `$object.getProperty()`
- **Property Detection**: Extracts property access patterns like `$user.name`
- **Directive Analysis**: Parses `#set`, `#foreach`, `#if` directives
- **Duplicate Removal**: Returns unique set of context items

**Parsing Strategy:**
- Regex-based parsing for performance
- Handles nested structures: `$user.address.city`
- Detects method parameters: `$util.format("value", 123)`
- Ignores Velocity comments: `##` and `#* ... *#`

**Return Type:**
```typescript
interface ContextItem {
  name: string;      // Variable name (e.g., "user")
  path: string;      // Full path (e.g., "user.getName")
  type: 'variable' | 'method' | 'property';
}
```

**Used By:**
- Context Manager to populate "Add from Template" suggestions
- Auto-completion features (future)
- Template validation (future)

### velocityServerClient.ts
**Purpose:** HTTP client for communicating with Apache Velocity Java server

**Key Features:**
- **Singleton Pattern**: Single server instance shared across extension
- **Server Lifecycle**: Start, health check, graceful shutdown
- **Process Management**: Spawns Java process, monitors output/errors
- **Port Management**: Configurable port (default 9876)
- **Retry Logic**: Connection retries with exponential backoff
- **Error Handling**: Detailed error messages from server

**API Methods:**
```typescript
class VelocityServerClient {
  static getInstance(extensionPath: string): VelocityServerClient
  async start(): Promise<void>
  async render(template: string, variables: any, methods: any): Promise<string>
  async healthCheck(): Promise<boolean>
  async stop(): Promise<void>
}
```

**Server Communication:**
- **POST /render**: Send template + context, receive rendered HTML
- **GET /health**: Check if server is running
- **POST /shutdown**: Graceful server termination

**Java Process:**
- Spawns: `java -jar server/target/velocity-server-1.0.0.jar`
- Working directory: `server/` folder
- Output captured to VS Code output channel
- Process cleanup on extension deactivation

### types.ts
**Purpose:** Shared TypeScript type definitions and interfaces

**Key Interfaces:**
```typescript
interface VariableData {
  [key: string]: any;  // Generic key-value data
}

interface MethodMock {
  name: string;           // Method name
  implementation: string; // JavaScript code
}

interface ScenarioData {
  url?: string;
  headers?: { [key: string]: any };
  variables: { [key: string]: any };
  methods?: any;
  inheritFrom?: string;  // Scenario inheritance
}

interface ScenariosData {
  [scenarioName: string]: ScenarioData;
}

interface ContextData {
  httpServletRequestVar?: string;      // Maps to $request
  localeVar?: string;                  // Maps to $locale
  templateMessagesVar?: string;        // Maps to $messages
  methodMappings?: { [key: string]: string }; // Method aliases
  scenarios: ScenariosData;
  activeScenario: string;
}

interface EnvironmentContextConfig {
  filePath?: string;
  messagesPropertiesPath?: string;
  language?: string;
  headers?: { [key: string]: string };
  mockFunctions?: { [name: string]: string };
  data: any;
}
```

**Usage:**
- Shared across all extension modules
- Type safety for context data structures
- IntelliSense support in VS Code
- Documentation for data formats

## Data Flow

### 1. Extension Activation
```
User opens .vm file
    ↓
extension.ts: activate()
    ↓
Start VelocityServerClient (Java process)
    ↓
Register commands & providers
    ↓
Ready for user interaction
```

### 2. Live Preview Rendering
```
User: Ctrl+Shift+P → "Velocity: Open Preview"
    ↓
preview.ts: showPreview()
    ↓
contextManager.ts: getContextForTemplate()
    ↓
Merge environment + template contexts
    ↓
Split into variables and method mocks
    ↓
velocityServerClient.ts: render(template, variables, methods)
    ↓
HTTP POST to Java server (localhost:9876/render)
    ↓
Receive rendered HTML
    ↓
Display in VS Code webview panel
```

### 3. Context Management
```
User: Ctrl+Shift+P → "Velocity: Manage Context"
    ↓
contextManager.ts: openContextManager()
    ↓
Create webview panel with dual-tab UI
    ↓
Load template context from .context.json
    ↓
Load environment context from global config
    ↓
Display in webview (Template tab / Environment tab)
    ↓
User edits variables/methods
    ↓
Webview sends postMessage to extension
    ↓
contextManager.ts handles save/delete/move operations
    ↓
Persist changes to .context.json or environment file
```

### 4. Template Parsing
```
User opens Context Manager
    ↓
contextManager.ts: analyze template
    ↓
templateParser.ts: parseTemplate(templateContent)
    ↓
Extract variables, methods, properties via regex
    ↓
Return array of ContextItem[]
    ↓
Display "Add from Template" suggestions in UI
```

## Configuration

Extension settings in `package.json`:

```json
{
  "velocity.useApacheVelocity": true,     // Enable Java server
  "velocity.serverPort": 9876,            // Velocity server port
  "velocity.autoPreview": false,          // Auto-open preview on .vm file open
  "velocity.formatOnSave": false          // Auto-format on save
}
```

## Development

### Building
```bash
npm install          # Install dependencies
npm run compile      # Compile TypeScript → out/extension/
npm run watch        # Watch mode for development
```

### Testing
Press **F5** in VS Code to launch Extension Development Host with the extension loaded.

### Debugging
- Set breakpoints in TypeScript files
- Use VS Code debugger (F5)
- Check "Velocity Server" output channel for server logs
- Use `console.log()` for extension debugging (appears in Debug Console)

## Dependencies

**Runtime:**
- `vscode` - VS Code Extension API
- `node:fs` - File system operations
- `node:path` - Path manipulation
- `node:http` - HTTP client/server
- `node:child_process` - Java process spawning

**DevDependencies:**
- `@types/vscode` - VS Code type definitions
- `@types/node` - Node.js type definitions
- `typescript` - TypeScript compiler
- `esbuild` - Fast bundler for production builds

## Output Structure

After compilation:
```
out/
├── extension/
│   ├── extension.js          # Compiled extension entry point
│   ├── contextManager.js     # Context management logic
│   ├── preview.js            # Preview provider
│   ├── templateParser.js     # Template analysis
│   ├── velocityServerClient.js
│   └── types.js
└── webview-ui/              # Copied webview assets
    ├── webview.html
    ├── scripts.js
    └── styles.css
```

## Integration Points

### ↔ webview-ui/
- Loads HTML from `webview-ui/webview.html`
- Injects webview JavaScript from `webview-ui/scripts.js`
- Applies styles from `webview-ui/styles.css`
- Bidirectional messaging via `postMessage` API

### ↔ server/
- Spawns Java process: `java -jar server/target/velocity-server-1.0.0.jar`
- HTTP communication on port 9876
- Sends template + context → receives rendered HTML
- Health checks and graceful shutdown

### ↔ VS Code APIs
- Document providers for `.vm` files
- Webview panels for preview and context manager
- Output channels for logging
- File watchers for auto-refresh
- Global state for persistent configuration

## Key Algorithms

### Context Merging (contextManager.ts)
```typescript
// Merge environment + template contexts
// Environment variables are overridden by template variables
const merged = {
  ...environmentContext.data,
  ...templateContext,
  // Deep merge for objects:
  user: {
    ...environmentContext.data.user,
    ...templateContext.user
  }
};
```

### Template Variable Extraction (templateParser.ts)
```typescript
// Regex patterns for Velocity syntax
const patterns = {
  variable: /\$\{?([a-zA-Z_][a-zA-Z0-9_]*)\}?/g,
  method: /\$([a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*)\(/g,
  property: /\$([a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_\.]*)/g
};
```

### Server Health Check (velocityServerClient.ts)
```typescript
// Retry logic with exponential backoff
const maxRetries = 10;
const baseDelay = 500; // ms
for (let i = 0; i < maxRetries; i++) {
  if (await healthCheck()) return true;
  await delay(baseDelay * Math.pow(2, i));
}
throw new Error('Server failed to start');
```

## Error Handling

### Server Startup Failures
- Display error message in VS Code notification
- Show "Velocity Server" output channel with Java errors
- Disable preview features gracefully
- Allow retry attempts

### Rendering Errors
- Catch Velocity parsing errors from server
- Display error details in preview panel
- Show stack trace for debugging
- Preserve template content for editing

### Context File Errors
- Validate JSON structure before saving
- Show error messages for malformed context files
- Provide default empty context on load failure
- Prevent data loss with backup mechanisms

## Testing Strategy

### Manual Testing
1. Open `.vm` file in test workspace
2. Test preview: Ctrl+Shift+P → "Velocity: Open Preview"
3. Test context manager: Ctrl+Shift+P → "Velocity: Manage Context"
4. Verify context merging: Add items to environment, check preview
5. Test source toggles: Move items between template/environment
6. Test scenario switching: Change active scenario, verify preview updates

### Automated Testing
Currently manual testing only. Future: Unit tests with Mocha/Jest.

## Performance Considerations

- **Context Caching**: Template contexts cached to avoid repeated file reads
- **Lazy Loading**: Environment context loaded only once on first use
- **Debounced Refresh**: Preview refresh debounced (500ms) to avoid excessive re-renders
- **HTTP Keep-Alive**: Reuses HTTP connections to Java server
- **Incremental Parsing**: Only re-parse template when content changes

## Known Limitations

- Template parsing is regex-based (not a full AST parser)
- No syntax validation before rendering (relies on server errors)
- Large context files (>10MB) may cause performance issues
- Java server startup takes 2-3 seconds on cold start

## Future Enhancements

- Auto-completion for Velocity directives
- Hover tooltips for variable definitions
- Go-to-definition for context variables
- Rename refactoring across template and context
- Syntax validation before rendering
- Test coverage with unit tests
- Performance profiling and optimization
