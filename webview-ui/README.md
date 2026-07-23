# Webview-UI Module

Frontend user interface for the Context Manager webview. Provides a rich, interactive UI for managing Velocity template contexts using HTML, JavaScript, and CSS fully integrated with VS Code theming.

## Architecture

```
webview-ui/
├── webview.html    # HTML structure with Mustache-style placeholders
├── scripts.js      # Client-side JavaScript (~2700 lines)
└── styles.css      # VS Code theme-aware styles (~1050 lines)
```

## Overview

The webview-ui provides a **dual-tab interface** for managing two types of contexts:

1. **Template Context Tab**: Per-template variables, properties, methods, and scenarios
2. **Environment Context Tab**: Shared context accessible to all templates

All UI components use **VS Code CSS variables** for seamless dark/light theme integration.

## Core Files

### webview.html
**Purpose:** HTML structure template for the Context Manager webview

**Key Features:**
- **Mustache-style placeholders**: `{{templateName}}`, `{{environmentFilePath}}`, etc.
- **CSP compliance**: Content Security Policy with nonce-based script loading
- **Codicon integration**: Uses VS Code's icon font (`codicon.css`)
- **Dynamic content injection**: Extension injects tab content at runtime

**Structure:**
```html
<!DOCTYPE html>
<html>
<head>
    <!-- CSP with nonce for security -->
    <meta http-equiv="Content-Security-Policy" content="...">
    <!-- Codicon font for icons -->
    <link rel="stylesheet" href="{{codiconUri}}">
    <!-- Injected styles -->
    {{styles}}
</head>
<body>
    <!-- Header with title and template name -->
    <div class="header">
        <h1>Velocity Context Manager</h1>
        <div class="template-name">Template: {{templateName}}</div>
    </div>
    
    <!-- Tab navigation -->
    <div class="tabs">
        <div class="tab" data-tab="environment">Environment Context</div>
        <div class="tab active" data-tab="template">Template Context</div>
    </div>
    
    <!-- Template Context tab content -->
    <div id="template-tab" class="tab-content active">
        {{templateTabContent}}
    </div>
    
    <!-- Environment Context tab content -->
    <div id="environment-tab" class="tab-content">
        <div class="config-section">
            <!-- Environment file path input with Load/Reload buttons -->
            <input type="text" id="environment-context-file-path" value="{{environmentFilePath}}" />
            <button data-action="loadEnvironmentContext">Load</button>
            <button data-action="reloadEnvironmentContext">Reload</button>
        </div>
        {{environmentTabContent}}
    </div>
    
    <!-- Injected scripts -->
    {{scripts}}
</body>
</html>
```

**Placeholders Replaced by Extension:**
- `{{cspSource}}` - Content Security Policy source (vscode-webview://)
- `{{nonce}}` - Random nonce for CSP script whitelisting
- `{{codiconUri}}` - URI to codicon.css font file
- `{{styles}}` - Inline `<style>` tag with styles.css content
- `{{scripts}}` - Inline `<script>` tag with scripts.js content
- `{{templateName}}` - Name of the current template file
- `{{environmentFilePath}}` - Path to loaded environment context file
- `{{templateTabContent}}` - Generated HTML for template context items
- `{{environmentTabContent}}` - Generated HTML for environment context items

**Security:**
- **CSP**: Prevents inline scripts/styles without nonce (XSS protection)
- **No external resources**: All assets loaded from extension directory
- **Sandboxed execution**: Webview runs in isolated context

### scripts.js
**Purpose:** Client-side JavaScript for interactive UI logic

**Size:** ~2,700 lines

**Key Features:**

#### 1. VS Code API Communication
```javascript
const vscode = acquireVsCodeApi();

// Send message to extension
vscode.postMessage({
    command: 'saveTemplateContext',
    context: { /* data */ }
});

// Receive messages from extension
window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.command === 'updateContext') {
        // Handle update
    }
});
```

#### 2. Tab Management
```javascript
function switchTab(tabName) {
    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(content => {
        content.style.display = 'none';
    });
    
    // Show selected tab content
    document.getElementById(`${tabName}-tab`).style.display = 'block';
    
    // Update tab button states (active/inactive)
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.toggle('active', tab.getAttribute('data-tab') === tabName);
    });
}
```

#### 3. Event Delegation
```javascript
// Use event delegation for dynamically created elements
document.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-action]');
    if (button) {
        const action = button.getAttribute('data-action');
        if (action === 'deleteItem') {
            deleteItem(/* params */);
        } else if (action === 'loadEnvironmentContext') {
            loadEnvironmentContext();
        }
        // ... more actions
    }
});
```

#### 4. Template Context Operations
```javascript
// Save entire template context to .context.json
function saveTemplateContext() {
    const context = getTemplateContextData();
    vscode.postMessage({
        command: 'saveTemplateContext',
        context: context
    });
}

// Delete a context item (variable, property, method)
function deleteItem(type, name, obj, prop, method) {
    vscode.postMessage({
        command: 'deleteItem',
        type: type,
        name: name,
        object: obj,
        property: prop,
        method: method
    });
}

// Move item from template to environment
function moveToEnvironment(type, name) {
    vscode.postMessage({
        command: 'moveToEnvironment',
        type: type,
        name: name
    });
}

// Move item from environment to template
function moveToTemplate(type, name) {
    vscode.postMessage({
        command: 'moveToTemplate',
        type: type,
        name: name
    });
}
```

#### 5. Environment Context Operations
```javascript
// Load environment context file (triggers file picker in extension)
function loadEnvironmentContext() {
    vscode.postMessage({ command: 'loadEnvironmentContext' });
}

// Reload environment context from current file
function reloadEnvironmentContext() {
    vscode.postMessage({ command: 'reloadEnvironmentContext' });
}

// Save environment context changes
function saveEnvironmentContext() {
    const context = getEnvironmentContextData();
    vscode.postMessage({
        command: 'saveEnvironmentContext',
        context: context
    });
}

// Delete environment variable/header/method
function deleteEnvironmentVariable(name) {
    vscode.postMessage({
        command: 'deleteEnvironmentVariable',
        name: name
    });
}
```

#### 6. Scenario Management
```javascript
// Switch active scenario (named variable set)
function setActiveScenario(scenarioName) {
    vscode.postMessage({
        command: 'setActiveScenario',
        scenarioName: scenarioName
    });
}

// Create new scenario
function addScenario() {
    const name = prompt('Enter scenario name:');
    if (name) {
        vscode.postMessage({
            command: 'addScenario',
            name: name
        });
    }
}

// Delete scenario
function deleteScenario(scenarioName) {
    if (confirm(`Delete scenario "${scenarioName}"?`)) {
        vscode.postMessage({
            command: 'deleteScenario',
            name: scenarioName
        });
    }
}
```

#### 7. HTTP Request Mock Editor
```javascript
// Edit mock HTTP request URL
function editRequestUrl() {
    const currentUrl = document.getElementById('request-url-value')?.textContent || '';
    const newUrl = prompt('Enter request URL:', currentUrl);
    if (newUrl !== null) {
        vscode.postMessage({
            command: 'updateRequestUrl',
            url: newUrl
        });
    }
}

// Edit HTTP headers (JSON format)
function editRequestHeaders() {
    const currentHeaders = document.getElementById('request-headers-value')?.textContent || '{}';
    const newHeaders = prompt('Enter headers (JSON):', currentHeaders);
    if (newHeaders !== null) {
        vscode.postMessage({
            command: 'updateRequestHeaders',
            headers: newHeaders
        });
    }
}
```

#### 8. Data Collection from UI
```javascript
// Collect all template context data from form inputs
function getTemplateContextData() {
    const context = {
        httpServletRequestVar: document.getElementById('http-servlet-request-var')?.value || '',
        localeVar: document.getElementById('locale-var')?.value || '',
        templateMessagesVar: document.getElementById('template-messages-var')?.value || '',
        escapeToolVar: document.getElementById('escape-tool-var')?.value || '',
        variables: {},
        methods: {},
        scenarios: {}
    };
    
    // Collect variables from form inputs
    document.querySelectorAll('[data-variable-name]').forEach(input => {
        const name = input.getAttribute('data-variable-name');
        const value = input.value;
        context.variables[name] = parseValue(value);
    });
    
    // Collect methods
    document.querySelectorAll('[data-method-implementation]').forEach(textarea => {
        const path = textarea.getAttribute('data-method-path');
        const implementation = textarea.value;
        setNestedValue(context.methods, path, { _implementation: implementation });
    });
    
    return context;
}
```

#### 9. Value Parsing & Validation
```javascript
// Parse string input to appropriate JavaScript type
function parseValue(value) {
    if (value === '') return '';
    if (value === 'null') return null;
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (!isNaN(value) && value.trim() !== '') return Number(value);
    
    // Try parsing as JSON (objects/arrays)
    try {
        return JSON.parse(value);
    } catch {
        return value; // Return as string
    }
}

// Validate JSON input
function validateJSON(str) {
    try {
        JSON.parse(str);
        return true;
    } catch {
        return false;
    }
}
```

#### 10. Message Handlers
```javascript
window.addEventListener('message', (event) => {
    const message = event.data;
    
    switch (message.command) {
        case 'updateContext':
            // Refresh UI with new context data
            updateUI(message.context);
            break;
            
        case 'error':
            // Show error notification
            alert(message.message);
            break;
            
        case 'success':
            // Show success notification
            console.log('Success:', message.message);
            break;
    }
});
```

**Code Organization:**
- Event listeners setup (tabs, buttons, forms)
- Data collection functions (getTemplateContextData, getEnvironmentContextData)
- UI update functions (renderVariables, renderMethods, renderScenarios)
- Communication functions (postMessage to extension)
- Utility functions (parseValue, validateJSON, setNestedValue)

### styles.css
**Purpose:** VS Code theme-aware CSS styling

**Size:** ~1,050 lines

**Key Features:**

#### 1. VS Code Theme Integration
All colors use VS Code CSS variables for automatic dark/light theme support:
```css
body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
}

button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: 1px solid var(--vscode-button-border);
}

button:hover {
    background: var(--vscode-button-hoverBackground);
}

input {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
}

input:focus {
    outline: 1px solid var(--vscode-focusBorder);
}
```

#### 2. Component Styles

**Header:**
```css
.header {
    background: var(--vscode-editorGroupHeader-tabsBackground);
    padding: 16px 20px;
    border-bottom: 1px solid var(--vscode-panel-border);
}
```

**Tabs:**
```css
.tabs {
    display: flex;
    background: var(--vscode-editorGroupHeader-tabsBackground);
    border-bottom: 1px solid var(--vscode-panel-border);
}

.tab {
    padding: 10px 20px;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    opacity: 0.7;
}

.tab.active {
    opacity: 1;
    border-bottom-color: var(--vscode-focusBorder);
}
```

**Form Controls:**
```css
input, textarea, select {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    padding: 6px 8px;
    border-radius: 3px;
    font-family: var(--vscode-font-family);
}

textarea {
    font-family: 'Courier New', monospace;
    min-height: 60px;
    resize: vertical;
}
```

**Buttons:**
```css
button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    padding: 6px 12px;
    border-radius: 3px;
    cursor: pointer;
}

button:hover {
    background: var(--vscode-button-hoverBackground);
}

button.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
}
```

**Codicon Icons:**
```css
.codicon {
    font-family: 'codicon';
    font-size: 16px;
    cursor: pointer;
}

.codicon.codicon-trash {
    color: var(--vscode-errorForeground);
}

.codicon.codicon-info {
    color: var(--vscode-descriptionForeground);
}
```

#### 3. Layout Styles

**Grid Layouts:**
```css
.context-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
    padding: 20px;
}

@media (max-width: 768px) {
    .context-grid {
        grid-template-columns: 1fr; /* Stack on small screens */
    }
}
```

**Sections:**
```css
.section {
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    padding: 16px;
    margin-bottom: 16px;
}

.section-label {
    font-weight: 600;
    font-size: 0.9em;
    color: var(--vscode-foreground);
    margin-bottom: 8px;
    display: block;
}
```

**Item Lists:**
```css
.item {
    display: flex;
    align-items: center;
    padding: 8px;
    margin-bottom: 8px;
    background: var(--vscode-list-inactiveSelectionBackground);
    border-radius: 3px;
}

.item:hover {
    background: var(--vscode-list-hoverBackground);
}
```

#### 4. Utility Classes

**Spacing:**
```css
.mb-8 { margin-bottom: 8px; }
.mb-16 { margin-bottom: 16px; }
.mt-8 { margin-top: 8px; }
.p-16 { padding: 16px; }
```

**Flex Utilities:**
```css
.flex { display: flex; }
.flex-column { flex-direction: column; }
.align-center { align-items: center; }
.justify-between { justify-content: space-between; }
.gap-8 { gap: 8px; }
```

**Text Utilities:**
```css
.text-muted {
    color: var(--vscode-descriptionForeground);
}

.text-error {
    color: var(--vscode-errorForeground);
}

.text-success {
    color: var(--vscode-charts-green);
}
```

#### 5. Source Toggle Styles
```css
.source-select {
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border);
    border-radius: 3px;
    padding: 4px 8px;
    font-size: 11px;
    cursor: pointer;
    min-width: 80px;
}

.source-select option {
    background-color: var(--vscode-dropdown-listBackground);
    color: var(--vscode-dropdown-foreground);
}
```

#### 6. Scenario Styles
```css
.scenario-card {
    background: var(--vscode-editor-background);
    border: 2px solid var(--vscode-panel-border);
    border-radius: 4px;
    padding: 12px;
    margin-bottom: 12px;
    cursor: pointer;
    transition: border-color 0.2s;
}

.scenario-card.active {
    border-color: var(--vscode-focusBorder);
    background: var(--vscode-list-activeSelectionBackground);
}

.scenario-card:hover {
    border-color: var(--vscode-list-hoverForeground);
}
```

## UI Components

### 1. Template Context Tab
**Components:**
- **HTTP Request Mock**: URL and headers editor
- **Variable Mappings**: Map special variables (locale, messages, esc, utils)
- **Variables Section**: List of template variables with values
- **Methods Section**: List of methods with JavaScript implementations
- **Scenarios Section**: Named variable sets with inheritance

**Features:**
- **Source Toggles**: Move items between template/environment
- **Add/Edit/Delete**: Full CRUD operations on context items
- **Method Editor**: Syntax-highlighted textarea for JavaScript code
- **Scenario Switcher**: Dropdown to select active scenario

### 2. Environment Context Tab
**Components:**
- **File Selector**: Input field with Load/Reload buttons
- **Headers Section**: HTTP headers shared across all templates
- **Variables Section**: Shared variables accessible to all templates
- **Mock Functions Section**: JavaScript method implementations

**Features:**
- **File Picker**: Browse for environment context JSON file
- **Save Button**: Save all changes to environment file
- **Reload Button**: Discard changes and reload from file
- **Delete Buttons**: Remove individual items

### 3. Shared UI Elements
- **Codicon Icons**: VS Code icon font (trash, folder, refresh, info, etc.)
- **Tooltips**: Hover hints on info icons
- **Form Validation**: Real-time validation for JSON inputs
- **Responsive Layout**: Grid layout adapts to webview width

## Message Protocol

Communication between webview and extension uses `postMessage` API:

### Messages from Webview → Extension

```typescript
// Save template context
{ command: 'saveTemplateContext', context: ContextData }

// Save environment context
{ command: 'saveEnvironmentContext', context: EnvironmentContextConfig }

// Delete item from template
{ command: 'deleteItem', type: string, name: string, object?: string, property?: string, method?: string }

// Move item between contexts
{ command: 'moveToEnvironment', type: string, name: string }
{ command: 'moveToTemplate', type: string, name: string }

// Load/reload environment
{ command: 'loadEnvironmentContext' }
{ command: 'reloadEnvironmentContext' }

// Scenario operations
{ command: 'setActiveScenario', scenarioName: string }
{ command: 'addScenario', name: string }
{ command: 'deleteScenario', name: string }

// HTTP mock operations
{ command: 'updateRequestUrl', url: string }
{ command: 'updateRequestHeaders', headers: string }
```

### Messages from Extension → Webview

```typescript
// Update UI with new context data
{ command: 'updateContext', context: ContextData }

// Display error message
{ command: 'error', message: string }

// Display success notification
{ command: 'success', message: string }

// Refresh entire webview
{ command: 'refresh' }
```

## Data Flow

### 1. Initial Load
```
User opens Context Manager
    ↓
extension/contextManager.ts: openContextManager()
    ↓
Load template context from .context.json
    ↓
Load environment context from global state
    ↓
Generate HTML with webview.html template
    ↓
Inject templateTabContent and environmentTabContent
    ↓
Inline scripts.js and styles.css
    ↓
Display webview in VS Code
```

### 2. User Edits Variable
```
User types in input field
    ↓
Input 'change' event fired
    ↓
scripts.js: Collect form data with getTemplateContextData()
    ↓
postMessage({ command: 'saveTemplateContext', context })
    ↓
extension/contextManager.ts: Receive message
    ↓
Validate and save to .context.json
    ↓
postMessage({ command: 'success', message: 'Context saved' })
    ↓
scripts.js: Update UI (if needed)
```

### 3. Switch Source (Template ↔ Environment)
```
User clicks source dropdown
    ↓
Select 'change' event fired
    ↓
scripts.js: postMessage({ command: 'moveToEnvironment', type, name })
    ↓
extension/contextManager.ts: Receive message
    ↓
Remove from template context
    ↓
Add to environment context
    ↓
Save both contexts
    ↓
Regenerate webview HTML
    ↓
postMessage({ command: 'updateContext', context })
    ↓
scripts.js: Update UI with new context
```

## Development

### File Locations
After build, webview files are copied to `out/webview-ui/`:
```
out/
└── webview-ui/
    ├── webview.html
    ├── scripts.js
    └── styles.css
```

### Hot Reload
Changes to webview files require:
1. **Edit** `webview-ui/` files
2. **Compile**: `npm run compile` (copies to `out/`)
3. **Reload Extension**: Press F5 or Ctrl+R in Extension Development Host
4. **Reopen Context Manager**: Close and reopen the webview

### Debugging Webview

#### Open Developer Tools
1. Open Context Manager webview
2. Press **Ctrl+Shift+P** → "Developer: Open Webview Developer Tools"
3. Inspect HTML, view console logs, debug JavaScript

#### Console Logging
```javascript
// In scripts.js
console.log('[Debug] Variable saved:', variableName, value);
```

View logs in Developer Tools console.

#### VS Code Extension Debugger
Set breakpoints in `extension/contextManager.ts` to debug message handlers:
```typescript
case 'saveTemplateContext':
    console.log('Received template context:', message.context); // Breakpoint here
    this.saveTemplateContext(message.context);
    break;
```

## Theme Integration

All colors automatically adapt to VS Code theme (dark/light/high contrast):

### Common VS Code CSS Variables
```css
--vscode-foreground                  /* Main text color */
--vscode-background                  /* Main background */
--vscode-editor-background           /* Editor background */
--vscode-button-background           /* Button color */
--vscode-button-hoverBackground      /* Button hover */
--vscode-input-background            /* Input field background */
--vscode-input-foreground            /* Input text color */
--vscode-input-border                /* Input border */
--vscode-focusBorder                 /* Focus outline color */
--vscode-panel-border                /* Border between sections */
--vscode-list-hoverBackground        /* Hover highlight */
--vscode-errorForeground             /* Error text color */
--vscode-descriptionForeground       /* Muted text */
```

### Color Scheme Support
```css
:root {
    color-scheme: dark; /* Tells browser to use dark scrollbars, etc. */
}

/* Light theme automatically uses light colors via VS Code variables */
/* No manual theme detection needed */
```

## Performance Considerations

### Large Context Files
- **Debouncing**: Input changes debounced (500ms) before saving
- **Lazy Rendering**: Only render visible tab (template or environment)
- **JSON Parsing**: Memoize parsed JSON values to avoid re-parsing

### Memory Management
- **Event Delegation**: Single event listener per event type (not per element)
- **No Memory Leaks**: Clean up event listeners when webview is disposed
- **Efficient DOM Updates**: Update only changed elements (not full re-render)

### Optimization Tips
1. **Minimize postMessage calls**: Batch updates when possible
2. **Avoid large inline data**: Use references, not full objects
3. **Lazy load scenarios**: Only load active scenario data
4. **Debounce search filters**: Wait for user to finish typing

## Known Limitations

### Browser Compatibility
- Webview uses Chromium (VS Code's webview engine)
- Modern JavaScript (ES6+) is supported
- No need for polyfills

### CSP Restrictions
- Cannot load external resources (CDNs)
- Cannot use inline event handlers (must use addEventListener)
- Cannot use `eval()` or `new Function()`

### UI Constraints
- Limited to webview size (can't open native dialogs)
- File picker requires extension API call (not native HTML input)
- Clipboard access requires extension API

## Future Enhancements

- [ ] **Autocomplete** for variable names in method editors
- [ ] **Syntax highlighting** in JavaScript method editors (CodeMirror/Monaco)
- [ ] **Inline validation** for JSON inputs with error tooltips
- [ ] **Search/filter** for large context items (100+ variables)
- [ ] **Diff viewer** to compare template vs environment contexts
- [ ] **Import/export** context as JSON file (drag-and-drop)
- [ ] **Undo/redo** for context changes
- [ ] **Bulk operations** (delete multiple items at once)

## Testing

### Manual Testing Checklist
- [ ] Switch between Template/Environment tabs
- [ ] Add/edit/delete variables
- [ ] Add/edit/delete methods with JavaScript code
- [ ] Create/delete scenarios
- [ ] Switch active scenario
- [ ] Load environment context file
- [ ] Move items between template/environment (source toggle)
- [ ] Edit HTTP request URL and headers
- [ ] Save changes and verify persistence
- [ ] Test in dark and light themes

### Edge Cases to Test
- Empty context files
- Malformed JSON input
- Very long variable names (>100 chars)
- Large method implementations (>1000 lines)
- Many scenarios (>50)
- Special characters in variable names
- Nested objects with deep nesting (>10 levels)

## Accessibility

### Keyboard Navigation
- **Tab**: Navigate between form inputs
- **Enter**: Submit forms, trigger buttons
- **Space**: Toggle checkboxes, click buttons
- **Arrow Keys**: Navigate dropdown menus

### Screen Reader Support
- All buttons have `title` attributes for tooltips
- Form inputs have associated `<label>` elements
- Icons have `aria-label` attributes
- Focus indicators visible (VS Code's `--vscode-focusBorder`)

### High Contrast Theme
- All colors use VS Code variables (automatically adapt)
- Border contrast meets WCAG AA standards
- Focus indicators clearly visible

## Troubleshooting

### Webview doesn't load
**Solution:** Check extension activation logs in Output panel ("Velocity Server" channel)

### Styles look wrong
**Cause:** CSS not loaded or CSP blocking styles
**Solution:** Verify `{{styles}}` placeholder is replaced in HTML. Check Developer Tools console for CSP errors.

### Buttons don't work
**Cause:** JavaScript not loaded or event listeners not attached
**Solution:** Check Developer Tools console for errors. Verify `{{scripts}}` placeholder replaced.

### Theme colors don't match VS Code
**Cause:** Using hardcoded colors instead of CSS variables
**Solution:** Replace all hardcoded colors with `var(--vscode-*)` variables

### Changes don't persist
**Cause:** `postMessage` not reaching extension or save handler failing
**Solution:** Debug message handler in `extension/contextManager.ts`. Check file permissions for `.context.json`.

## Security

### Content Security Policy (CSP)
```html
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'none'; 
               style-src {{cspSource}} 'nonce-{{nonce}}'; 
               font-src {{cspSource}}; 
               script-src 'nonce-{{nonce}}';">
```

**What this means:**
- `default-src 'none'`: Block all resources by default
- `style-src {{cspSource}} 'nonce-{{nonce}}'`: Allow styles from extension only (with nonce)
- `font-src {{cspSource}}`: Allow fonts from extension only
- `script-src 'nonce-{{nonce}}'`: Allow scripts with matching nonce only

**Benefits:**
- Prevents XSS attacks
- Blocks untrusted external resources
- Whitelists only extension-provided assets

### Input Sanitization
- **HTML Escaping**: All user input escaped before rendering
- **JSON Validation**: Validate JSON before parsing
- **No `eval()`**: JavaScript code executed in Java server sandbox, not in webview

### Data Privacy
- All context data stored locally (no external API calls)
- No telemetry or analytics in webview
- File paths never exposed to external services

## License

Part of the Velocity Template Editor VS Code extension. See main project LICENSE file.
