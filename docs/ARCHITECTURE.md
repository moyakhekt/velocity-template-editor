# Velocity Template Editor - Architecture Documentation

## Overview

This document describes the event-driven architecture for the Velocity Template Editor VS Code extension. The architecture eliminates full-page refreshes in favor of targeted, reactive DOM updates.

## Core Principles

1. **Single Source of Truth**: `ContextState` holds all template and environment context data in memory
2. **Event-Driven Updates**: Changes emit events that trigger targeted UI updates
3. **Change Detection**: Updates only occur when data actually changes (deep equality check)
4. **File Synchronization**: File system writes are suspended during programmatic updates to prevent recursive triggers
5. **No Full Page Refreshes**: Every operation sends specific update messages to update only affected DOM elements

## Architecture Components

```mermaid
graph TB
    subgraph "VS Code Extension Host"
        CM[ContextManager]
        CS[ContextState]
        FW[FileSystemWatcher]
        PP[PreviewProvider]
    end
    
    subgraph "Webview UI"
        WV[Webview HTML/JS]
        DOM[DOM Elements]
    end
    
    subgraph "File System"
        TCF[Template Context Files<br/>.context.json]
        ECF[Environment Context File<br/>.json]
    end
    
    User -->|Actions| WV
    WV -->|postMessage<br/>Commands| CM
    CM -->|Updates| CS
    CS -->|Events| CM
    CM -->|postMessage<br/>Updates| WV
    WV -->|Update DOM| DOM
    CS <-->|Read/Write<br/>Suspended| TCF
    CS <-->|Read/Write<br/>Suspended| ECF
    FW -->|File Change| CS
    CS -->|Context Data| PP
    PP -->|Render| User
```

## State Management Flow

### Scenario Switching

```mermaid
sequenceDiagram
    participant User
    participant Webview
    participant ContextManager
    participant ContextState
    participant FileSystem
    
    User->>Webview: Click scenario radio button
    Webview->>ContextManager: postMessage({command: 'switchScenario', scenario: 'Test'})
    ContextManager->>ContextState: updateTemplateContext(ctx => ctx.activeScenario = 'Test')
    
    alt Data Actually Changed
        ContextState->>ContextState: deep equality check
        ContextState->>ContextState: emit change event
        ContextState->>FileSystem: writeFileSync (watcher suspended)
        Note over ContextState,FileSystem: 100ms suppression window
        ContextState-->>ContextManager: change event fired
        ContextManager->>ContextManager: generate scenario HTML
        ContextManager->>Webview: postMessage({command: 'updateScenario', ...data})
        Webview->>Webview: updateScenarioDOM()
        Note over Webview: Updates:<br/>- Radio button checked<br/>- Scenario title<br/>- URL input & source<br/>- Headers table<br/>- Variables table
    else No Change
        ContextState->>ContextState: skip emit & file write
    end
```

### Variable Update

```mermaid
sequenceDiagram
    participant User
    participant Webview
    participant ContextManager
    participant ContextState
    participant FileSystem
    
    User->>Webview: Edit variable value in table
    Webview->>Webview: onBlur/onChange event
    Webview->>ContextManager: postMessage({command: 'saveScenarioVariable', name: 'user', value: 'John'})
    ContextManager->>ContextState: updateTemplateContext(ctx => {...})
    ContextState->>ContextState: deep equality check
    
    alt Data Changed
        ContextState->>FileSystem: writeFileSync (suppressed)
        ContextState-->>ContextManager: emit change event
        ContextManager->>Webview: postMessage({command: 'updateScenarioVariable', name: 'user', value: 'John'})
        Webview->>Webview: updateScenarioVariableDOM()
        Note over Webview: Updates only the<br/>specific variable row
    end
```

### File System Change (External Edit)

```mermaid
sequenceDiagram
    participant ExternalEditor
    participant FileSystem
    participant FileSystemWatcher
    participant ContextState
    participant ContextManager
    participant Webview
    
    ExternalEditor->>FileSystem: Save .context.json file
    FileSystem-->>FileSystemWatcher: onDidChange event
    FileSystemWatcher->>ContextState: handleFileChange(filePath)
    
    alt Not Suppressed
        ContextState->>FileSystem: readFileSync(filePath)
        ContextState->>ContextState: deep equality check
        
        alt Data Changed
            ContextState->>ContextState: emit change event
            ContextState-->>ContextManager: change event
            ContextManager->>Webview: postMessage({command: 'updateScenario', ...})
            Webview->>Webview: Update affected DOM sections
        end
    else Suppressed (Programmatic Write)
        ContextState->>ContextState: skip reload
        Note over ContextState: Suppression cleared<br/>after 100ms
    end
```

### Create New Scenario

```mermaid
sequenceDiagram
    participant User
    participant Webview
    participant ContextManager
    participant ContextState
    participant FileSystem
    
    User->>Webview: Click "New Scenario" button
    Webview->>ContextManager: postMessage({command: 'createScenario'})
    ContextManager->>ContextManager: showInputBox("Enter scenario name")
    User->>ContextManager: Enter "Account Locked"
    ContextManager->>ContextState: updateTemplateContext(ctx => {...})
    Note over ContextState: ctx.scenarios['Account Locked'] = {variables: {}}<br/>ctx.activeScenario = 'Account Locked'
    
    ContextState->>FileSystem: writeFileSync (suppressed)
    ContextState-->>ContextManager: emit change event
    ContextManager->>ContextManager: generate radio button HTML
    ContextManager->>Webview: postMessage({command: 'addScenario', scenarioName: 'Account Locked', radioButtonHtml: '...'})
    Webview->>Webview: addScenarioDOM()
    Note over Webview: - Adds new radio button<br/>- Switches to new scenario<br/>- Updates all scenario sections
```

## Key Classes

### ContextState

**Purpose**: Centralized state management with change detection and event emission.

**Responsibilities**:
- Store template and environment context in memory
- Detect changes via deep equality comparison
- Emit events only when data actually changes
- Synchronize with file system (with watcher suspension)
- Provide read-only snapshots of state

**Key Methods**:
```typescript
loadTemplateContext(templatePath: string, contextPath: string): void
loadEnvironmentContext(filePath: string): void
updateTemplateContext(updater: (ctx: ContextFileData) => void, source: 'ui' | 'api'): void
updateEnvironmentContext(updater: (ctx: ContextData) => void, source: 'ui' | 'api'): void
getTemplateContext(): Readonly<ContextFileData> | null
getEnvironmentContext(): Readonly<ContextData>
getMergedContext(): ContextData
handleFileChange(filePath: string): void
```

**Event System**:
```typescript
interface ContextStateChangeEvent {
    type: 'templateContext' | 'environmentContext';
    source: 'file' | 'ui' | 'api';
    oldValue: any;
    newValue: any;
}
```

### ContextManager

**Purpose**: Mediates between VS Code extension, ContextState, and Webview UI.

**Responsibilities**:
- Handle webview commands from UI
- Subscribe to ContextState change events
- Generate HTML for UI updates
- Send targeted update messages to webview
- Coordinate with PreviewProvider

**Message Flow**:
1. Receive command from webview via `postMessage`
2. Update ContextState via updater function
3. Listen for change event from ContextState
4. Generate necessary HTML
5. Send specific update message to webview

### Webview Scripts

**Purpose**: Handle DOM updates without full page reloads.

**Key Functions**:
```javascript
updateScenarioDOM(msg)           // Switch scenario
updateScenarioVariableDOM(msg)   // Update single variable
updateScenarioHeaderDOM(msg)     // Update single header
addScenarioDOM(msg)              // Add new scenario
deleteScenarioDOM(msg)           // Remove scenario
renameScenarioDOM(msg)           // Rename scenario
updateUrlDOM(msg)                // Update URL field
```

**Update Strategy**:
- Find specific DOM element by ID or data attribute
- Update only that element's content/attributes
- Preserve scroll position
- Maintain focus where appropriate
- No innerHTML replacement of large sections

## File System Synchronization

### Write Suppression

To prevent infinite loops when writing to files monitored by FileSystemWatcher:

1. ContextState sets `suppressFileWrite = true`
2. Writes to file system
3. Sets timeout to clear flag after 100ms
4. FileSystemWatcher checks suppression flag in `handleFileChange()`
5. If suppressed, skips reload

```typescript
private writeToFile(): void {
    this.suppressFileWrite = true;
    fs.writeFileSync(this.contextFilePath, JSON.stringify(this.templateContext, null, 2), 'utf8');
    setTimeout(() => {
        this.suppressFileWrite = false;
    }, 100);
}
```

### Cache Invalidation

- ContextManager maintains a cache for performance
- Cache is updated immediately when ContextState changes
- FileSystemWatcher clears cache on external file changes
- Lazy reload on next access

## Performance Optimizations

1. **Change Detection**: Deep equality check prevents unnecessary updates
2. **Targeted DOM Updates**: Only affected elements are updated
3. **Event Debouncing**: File system changes debounced via suppression window
4. **HTML Pre-generation**: HTML generated once in extension, sent to webview
5. **Lazy Load**: File reads deferred until needed

## Migration Strategy

The refactor from full-page refreshes to targeted updates is done incrementally:

1. ✅ Create ContextState class with event system
2. ✅ Define message types for all operations
3. ✅ Create DOM update functions in webview
4. 🔄 Refactor high-frequency operations (scenario switching, variable edits)
5. 🔄 Refactor medium-frequency operations (headers, URLs)
6. 🔄 Refactor low-frequency operations (create/delete scenarios)
7. 🔄 Replace all `updateWebview()` calls with specific messages
8. ✅ Document architecture and create sequence diagrams

## Testing Strategy

### Unit Tests
- ContextState change detection
- Deep equality comparisons
- Event emission logic

### Integration Tests
- ContextManager → ContextState interaction
- File system watcher behavior
- Message passing between extension and webview

### Manual Testing
1. Switch scenarios → verify no scroll, data updates
2. Edit variables → verify only that row updates
3. Create scenario → verify radio button added correctly
4. External file edit → verify UI reflects changes
5. Rapid successive edits → verify no duplicate updates

## Benefits of New Architecture

1. **No Scroll Jumps**: Targeted updates preserve scroll position
2. **Better Performance**: Only affected DOM elements are updated
3. **Clearer Code**: Explicit message types instead of monolithic refresh
4. **Easier Debugging**: Each operation has specific message flow
5. **Maintainable**: Changes isolated to specific update handlers
6. **Extensible**: New features add new message types, not complexity to existing code
