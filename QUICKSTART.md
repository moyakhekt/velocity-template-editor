# Quick Start Guide

## Prerequisites
- **Java 8+** installed and in PATH (`java -version` to verify)
- **VS Code 1.80.0+**

## Testing the Extension

### 1. Launch the Extension
Press **F5** in VS Code to open the Extension Development Host window.

### 2. Open the Example Template
In the new window, open `example.vm` from the workspace.

### 3. Try the Features

#### Syntax Highlighting ✨
The Velocity syntax is automatically highlighted:
- **Directives** (`#if`, `#foreach`, `#set`) - keyword color
- **Variables** (`$user.name`, `$items`) - variable color
- **Methods** (`$user.getName()`) - function call color
- **Comments** (`##` line, `#* *#` block) - comment color
- **Strings** (`"text"`, `'text'`) - string color

#### Context Manager 🔧
**Opening:**
- Press `Ctrl+Shift+P` → "Velocity: Manage Context"
- Context Manager opens in side panel

**Template Context Tab** (selected by default):
1. All variables/properties/methods from your template are listed
2. Each item shows a **Template/Global** toggle:
   - **Template** (left button): Item stored in template-specific `.context.json`
   - **Global** (right button): Item stored in shared global context file
3. When toggle is set to **Template**:
   - Value is editable
   - Click 💾 to save changes
   - Click 🗑 to delete
4. When toggle is set to **Global**:
   - Value is read-only (edit in Global Context tab)
   - Shown with italic text

**Global Context Tab**:
1. Click 📂 **Load Global Context File** to select an existing JSON file
2. Or start adding items - you'll be prompted to choose a save location
3. Edit variables, properties, and method implementations
4. Click 💾 to save changes
5. All templates automatically get access to these values

**How Context Merging Works:**
- When rendering, global context is loaded first
- Template context values override/extend global values
- If both define an object (e.g., `$user`), they are merged:
  - Global: `{"user": {"getEmail": {...}}}`
  - Template: `{"user": {"role": "Admin"}}`
  - Merged: `{"user": {"getEmail": {...}, "role": "Admin"}}`

#### Live Preview 📄
1. Click the preview icon (📄) in the editor title bar
2. Or `Ctrl+Shift+P` → "Velocity: Open Preview"
3. Preview opens in split view showing rendered HTML
4. Edit template or context - preview updates automatically
5. If Velocity server isn't running, it starts automatically on port 9876

#### Format Document ✨
1. Press `Shift+Alt+F` (Windows/Linux) or `Shift+Option+F` (Mac)
2. Or right-click → "Format Document"
3. Template is auto-indented based on directive nesting

## Creating Your Own Template

1. Create a new file: `mytemplate.vm`
2. Start typing Velocity syntax - highlighting activates automatically
3. Example content:
   ```velocity
   <h1>Hello, $name!</h1>
   
   #if($user)
     <p>Welcome, $user.getName()!</p>
   #end
   
   #foreach($item in $items)
     <li>$item</li>
   #end
   ```
4. Open Context Manager (`Ctrl+Shift+P` → "Velocity: Manage Context")
5. Add variables and methods:
   - Variable `name`: `"World"`
   - Object `user` with method `getName()`: `return "John Doe"`
   - Array `items`: `["Apple", "Banana", "Cherry"]`
6. Open preview to see rendered output
7. Context is automatically saved to `mytemplate.context.json`

## File Structure

For a template named `mytemplate.vm`:
```
mytemplate.vm              # Your Velocity template
mytemplate.context.json    # Template-specific context (auto-created)
```

Optional global context (shared across all templates):
```
global-context.json        # User-specified location
```

## Variable Examples

### Simple Variables
```json
{
  "name": "John Doe",
  "age": 30,
  "active": true,
  "score": 95.5
}
```
In template: `$name`, `$age`, `$active`, `$score`

### Objects with Properties
```json
{
  "user": {
    "name": "John",
    "email": "john@example.com",
    "role": "Admin"
  }
}
```
In template: `$user.name`, `$user.email`, `$user.role`

### Arrays
```json
{
  "items": ["Apple", "Banana", "Cherry"],
  "users": [
    {"name": "John", "age": 30},
    {"name": "Jane", "age": 25}
  ]
}
```
In template:
```velocity
#foreach($item in $items)
  <li>$item</li>
#end

#foreach($u in $users)
  <p>$u.name is $u.age years old</p>
#end
```

## Method Examples

### No Arguments
```javascript
// Implementation:
return "Hello World"

// Template usage:
$greeting.getMessage()
```

### With Arguments
```javascript
// Implementation:
return args[0].toUpperCase()

// Template usage:
$util.uppercase("hello")  // Returns: HELLO
```

### Complex Logic
```javascript
// Implementation:
const value = args[0];
if (value > 100) {
  return "High";
} else if (value > 50) {
  return "Medium";
} else {
  return "Low";
}

// Template usage:
$calc.getLevel(75)  // Returns: Medium
```

### Multiple Arguments
```javascript
// Implementation:
const firstName = args[0];
const lastName = args[1];
return firstName + " " + lastName;

// Template usage:
$user.getFullName("John", "Doe")  // Returns: John Doe
```

## Tips & Best Practices

### Context Management
- **Use global context** for values shared across multiple templates (e.g., common utility methods, configuration)
- **Use template context** for template-specific values (e.g., page title, content)
- **Toggle between sources** easily - click the Template/Global toggle to move items
- **Objects are merged** - if both contexts define `$user`, properties combine automatically

### Templates
- Use `$!variable` for silent references (no error if undefined)
- Use `${variable}` when followed by other characters: `${name}Test`
- Method mocks use JavaScript - access arguments via `args[0]`, `args[1]`, etc.
- Preview updates automatically as you type (500ms delay)

### Performance
- Template context is cached - changes reload from file
- Global context loaded once and persists across templates
- Velocity server starts on first use and runs in background

### Organization
- Keep global context file in project root or shared location
- Template `.context.json` files stay alongside their templates
- Use meaningful names for variables and methods
- Document complex method implementations with comments

## Troubleshooting

### Preview Shows Errors
**"Variable $name is undefined":**
- Open Context Manager
- Add the variable with a value
- Save and preview will update

**"Method $obj.method() not found":**
- Open Context Manager
- Add the object and method with JavaScript implementation
- Example: `return "result"`

**"Velocity server not running":**
- Check Java is installed: `java -version`
- Check Output panel → "Velocity Server" for errors
- Restart VS Code and try again

### Context Manager Issues
**Context Manager shows blank:**
- Check browser console: `Ctrl+Shift+P` → "Developer: Open Webview Developer Tools"
- Look for JavaScript errors
- Reload window: `Ctrl+Shift+P` → "Developer: Reload Window"

**Changes not saving:**
- Check file permissions for `.context.json` file
- Verify JSON syntax is valid
- Check VS Code Output panel for errors

**Global context not loading:**
- Ensure file path is accessible
- Verify JSON syntax with a validator
- Try using an absolute path
- Check file isn't open in another application

### Syntax Highlighting Issues
**Not working:**
- Verify file extension: `.vm`, `.vtl`, or `.velocity`
- Reload window: `Ctrl+Shift+P` → "Developer: Reload Window"
- Check language mode in status bar (should show "Velocity")

**Wrong colors:**
- VS Code theme determines colors
- Try different theme to see if issue persists
- TextMate grammar defines scope names only

## Advanced Usage

### Sharing Global Context
Place your `global-context.json` in:
- Project root for project-specific shared values
- User home directory for user-wide defaults
- Network location for team-shared values

### Version Control
**Recommended `.gitignore` entries:**
```gitignore
# Include global context if shared with team
# global-context.json

# Usually include template contexts (template-specific)
# *.context.json

# Exclude if contexts contain sensitive data
*.context.json
global-context.json
```

### CI/CD Integration
- Context files are plain JSON
- Can be generated programmatically
- Can use environment variables to populate values
- Velocity server can run headless for testing
