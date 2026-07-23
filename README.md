<p align="center">
  <img src="https://raw.githubusercontent.com/user/repo/main/logo.svg" alt="Velocity Template Editor Logo" width="120" height="120">
</p>

<p align="center">
  <svg width="120" height="120" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="logo-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#FF6B35;stop-opacity:1" />
        <stop offset="50%" style="stop-color:#F7931E;stop-opacity:1" />
        <stop offset="100%" style="stop-color:#FDC830;stop-opacity:1" />
      </linearGradient>
    </defs>
    <circle cx="50" cy="50" r="48" fill="url(#logo-gradient)" stroke="#FF6B35" stroke-width="2"/>
    <path d="M 30 25 L 50 65 L 45 65 L 25 25 Z" fill="white" />
    <path d="M 50 25 L 70 65 L 65 65 L 45 25 Z" fill="white" />
    <path d="M 70 25 L 75 25 L 55 65 L 50 65 Z" fill="white" />
    <path d="M 35 70 L 65 70 L 63 75 L 37 75 Z" fill="white" opacity="0.8"/>
    <path d="M 40 78 L 60 78 L 58 82 L 42 82 Z" fill="white" opacity="0.6"/>
  </svg>
</p>

# Velocity Template Editor

A comprehensive VS Code extension for editing and previewing Apache Velocity templates with an integrated context management system.

## Features

### 🎨 Syntax Highlighting
- Full Velocity template language syntax highlighting
- Support for directives: `#if`, `#foreach`, `#set`, `#macro`, etc.
- Variable and method call highlighting
- HTML integration for mixed content

### ✨ Code Formatting
- Smart indentation for Velocity directives
- Configurable indent size
- Format on save support
- Command: `Velocity: Format Document`

### 👁️ Live Preview
- Real-time template rendering with Apache Velocity 2.3
- Java-based Velocity server with Nashorn JavaScript engine
- Side-by-side preview panel
- Automatic context merging (environment + template)
- Error highlighting with detailed messages
- Command: `Velocity: Open Preview`

### 🔧 Context Manager
Unified management system for template variables, properties, and methods with dual-context support:

#### Template Context
- Variables, properties, and methods specific to individual templates
- Saved per-template in `.context.json` files
- Source toggle to move items between template and environment contexts
- Full editing capabilities with type support (strings, numbers, objects, arrays)

#### Environment Context
- Shared variables, properties, and methods across all templates
- Saved in a single environment JSON file (user-specified location)
- Automatically merged into template context during rendering
- Prompt-on-demand file creation (only when needed)

**Features:**
- **Dual-tab interface**: Switch between Template and Environment contexts
- **Source toggles**: Move items between template/environment with one click
- **Smart merging**: Objects are merged when both contexts define them
- **JavaScript methods**: Design-time implementations with `args[]` access
- **Live updates**: Changes immediately reflected in preview
- Command: `Velocity: Manage Context`

## Installation

1. Open VS Code
2. Press `Ctrl+Shift+X` (or `Cmd+Shift+X` on Mac)
3. Search for "Velocity Template Editor"
4. Click Install

Or install from VSIX:
```bash
code --install-extension velocity-template-editor-0.0.1.vsix
```

## Usage

### Basic Editing
1. Open any `.vm`, `.vtl`, or `.velocity` file
2. Syntax highlighting activates automatically
3. Use `Format Document` to format your template

### Context Manager

#### Opening the Context Manager
1. Open a Velocity template file
2. Press `Ctrl+Shift+P` and select "Velocity: Manage Context"
3. The Context Manager opens in a side panel

#### Working with Template Context
1. Switch to the **Template Context** tab (selected by default)
2. All variables, properties, and methods from your template are listed
3. For each item:
   - Use the **Template/Environment** toggle to set where it's stored
   - When set to **Template**: Edit the value and click 💾 to save
   - When set to **Environment**: Value is read-only (edit in Environment Context tab)
   - Click 🗑 to delete the item

#### Working with Environment Context
1. Switch to the **Environment Context** tab
2. Click 📂 **Load Environment Context File** to load an existing file
3. Click 💾 **Save Environment Context File** to save to a new/existing file
4. Edit environment variables, properties, and methods
5. These values are automatically available to all templates

#### Context Merging (Automatic)
When rendering templates:
- Environment context values are loaded first
- Template context values override/extend environment values
- Objects are merged (template properties take precedence)
- This happens automatically - no configuration needed

### Variable Types

**Simple Variables:**
```json
{
  "name": "John Doe",
  "age": 30,
  "active": true
}
```

**Objects with Properties:**
```json
{
  "user": {
    "name": "John",
    "email": "john@example.com"
  }
}
```

**Arrays:**
```json
{
  "items": [
    {"name": "Item 1", "price": 10},
    {"name": "Item 2", "price": 20}
  ]
}
```

### Method Implementations

Methods use JavaScript with access to arguments via `args[]`:

**Simple method (no arguments):**
```javascript
return "Hello World"
```

**Method with arguments:**
```javascript
return args[0].toUpperCase()
```

**Complex logic:**
```javascript
const value = args[0];
if (value > 100) {
  return "High";
} else {
  return "Low";
}
```

### Live Preview
1. Open a Velocity template
2. Click the preview icon (📄) in the editor title bar
3. Or press `Ctrl+Shift+P` → "Velocity: Open Preview"
4. Edit the template or context and watch it update in real-time

## Example

**Template:** `docs/examples/example.vm`
```velocity
## This is a comment
<h1>Hello, $name!</h1>

#if($showDetails)
  <div>
    <p>Email: $user.getEmail()</p>
    <p>Role: $user.role</p>
    <p>Language: $locale.getLanguage()</p>
  </div>
#end

<ul>
#foreach($item in $items)
  <li>$item.name - $item.price</li>
#end
</ul>
```

**Template Context:** `example.context.json`
```json
{
  "name": "World",
  "showDetails": true,
  "user": {
    "role": "Admin"
  },
  "items": [
    {"name": "Item 1", "price": "$10"},
    {"name": "Item 2", "price": "$20"}
  ]
}
```

**Environment Context:** `environment-context.json` (separate file)
```json
{
  "user": {
    "getEmail": {
      "_implementation": "return 'user@example.com'"
    }
  },
  "locale": {
    "getLanguage": {
      "_implementation": "return 'en'"
    }
  }
}
```

**Rendered Output:** (automatic merging)
```html
<h1>Hello, World!</h1>
<div>
  <p>Email: user@example.com</p>
  <p>Role: Admin</p>
  <p>Language: en</p>
</div>
<ul>
  <li>Item 1 - $10</li>
  <li>Item 2 - $20</li>
</ul>
```

Note: `user` object is merged - `role` from template, `getEmail()` from environment.

## Configuration

Available settings:

```json
{
  "velocity.preview.autoRefresh": true,
  "velocity.preview.refreshDelay": 500,
  "velocity.format.indentSize": 2
}
```

## Architecture

### Components
- **Extension Host** (TypeScript): VS Code extension activation and command registration
- **Velocity Server** (Java): Apache Velocity 2.3 with Nashorn JavaScript engine for method mocks
- **Context Manager** (TypeScript + Webview): Unified UI for managing template and environment contexts
- **Preview Provider** (TypeScript + Webview): Real-time template rendering with merged context

### File Structure
```
template.vm                 # Your Velocity template
template.context.json       # Template-specific context (optional)
environment-context.json         # Shared environment context (user-specified location)
```

### Context Resolution
1. Environment context loaded from user-specified file
2. Template context loaded from `.context.json` file
3. Contexts merged: `merged = {...environment, ...template}`
4. Objects with same key are merged: `merged.obj = {...environment.obj, ...template.obj}`
5. Merged context passed to Velocity renderer

## Supported Velocity Features

- ✅ Variables: `$variable`, `${variable}`, `$!variable`
- ✅ Properties: `$object.property`
- ✅ Methods: `$object.method()`, `$object.method($arg)`
- ✅ Directives: `#set`, `#if/#elseif/#else/#end`, `#foreach/#end`
- ✅ Comments: `##` (line), `#* *#` (block)
- ✅ String literals: `"text"`, `'text'`
- ✅ Numbers and booleans
- ✅ Operators: `==`, `!=`, `<`, `>`, `&&`, `||`, `!`

## File Associations

The extension automatically activates for:
- `.vm` files (standard Velocity)
- `.vtl` files (Velocity Template Language)
- `.velocity` files

## Requirements

- **Java Runtime**: Java 8+ required for Apache Velocity server
- **VS Code**: Version 1.80.0 or higher
- **Operating Systems**: Windows, macOS, Linux

The Velocity server starts automatically when:
- Opening a preview
- Using the context manager
- The server runs on port 9876 (configurable)

## Development

### Building from Source
```bash
npm install
npm run compile
```

### Running in Development
1. Open the project in VS Code
2. Press `F5` to launch Extension Development Host
3. Open a `.vm` file to test

### Packaging
```bash
npm install -g @vscode/vsce
vsce package
```

## Known Limitations

- Macro definitions (`#macro`) are parsed but not fully executed in preview
- Some complex Velocity expressions may not evaluate correctly
- Method mocks require JavaScript syntax (Nashorn engine)
- Environment context requires manual file path selection on first use

## Troubleshooting

**Preview not working:**
- Ensure Java 8+ is installed: `java -version`
- Check Output panel → "Velocity Server" for errors
- Verify port 9876 is not in use by another application

**Context Manager shows blank:**
- Reload window: `Ctrl+Shift+P` → "Developer: Reload Window"
- Check browser console in webview: `Ctrl+Shift+P` → "Developer: Open Webview Developer Tools"

**Variables not showing in preview:**
- Verify JSON syntax in `.context.json` files
- Check that variable names match template exactly (case-sensitive)
- Try clearing cache: Close and reopen the preview

**Environment context not loading:**
- Ensure file path is accessible
- Verify JSON syntax is valid
- Check file permissions

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Submit a pull request

## License

MIT

## Changelog

### 0.0.1 (Current Release)
- ✅ Syntax highlighting for Velocity templates (TextMate grammar)
- ✅ Document formatting with smart indentation
- ✅ Live preview with Apache Velocity 2.3 server
- ✅ Unified Context Manager with dual-context support
- ✅ Template-specific context (`.context.json` files)
- ✅ Environment shared context (user-specified JSON file)
- ✅ Automatic context merging for rendering
- ✅ Source toggles to move items between contexts
- ✅ JavaScript-based method implementations (Nashorn)
- ✅ Object merging when both contexts define same object
- ✅ VS Code theme integration for UI
- ✅ Real-time preview updates

### Migration from Earlier Versions
If upgrading from a version that used `.vars.json` and `.mocks.json`:
- Variables and mocks are now unified in `.context.json` files
- Old files are not automatically migrated
- Manual migration: Copy variables and format methods with `_implementation` key

## Documentation

For detailed guides and reference documentation:

- **[Quick Start Guide](docs/QUICKSTART.md)** - Get started quickly with step-by-step instructions
- **[Documentation Index](docs/DOCUMENTATION.md)** - Complete documentation overview
- **[Examples](docs/examples/)** - Sample templates and test scripts
- **[Architecture Guide](.github/copilot-instructions.md)** - Technical implementation details

## Support

For issues and feature requests, please visit:
[GitHub Issues](https://github.com/yourusername/velocity-template-editor/issues)
