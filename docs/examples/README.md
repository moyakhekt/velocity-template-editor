# Examples

This folder contains example Velocity templates, context files, and test scripts.

## Velocity Templates

### example.vm
Basic Velocity template demonstrating:
- Variables (`$name`, `$user`)
- Conditionals (`#if`, `#else`)
- Loops (`#foreach`)
- Method calls (`$user.getEmail()`)
- Comments (`##`)

### example-scenarios.vm
Advanced template showcasing the scenario-based testing feature:
- Multiple test scenarios in one context file
- Scenario-specific variables
- HttpServletRequest mocking
- Locale handling
- Template message system

## Context Files

### example.properties
Properties file for template internationalization with `$templateMessages` tool.

### example-scenarios.context.json
Example context file with multiple scenarios showing:
- Scenario management
- Variable organization
- Method implementations with JavaScript
- HTTP headers configuration

## Test Scripts

### test-simple.js
Basic test demonstrating template rendering with simple variables.

### test-velocity-syntax.js
Tests all Velocity syntax features (directives, variables, macros).

### test-actual-data.js
Real-world example with complex data structures.

### test-utils-load.js
Tests utility tools like `$locale`, `$templateMessages`, `$escape`, `$HttpServletRequest`.

## Usage

To use these examples:

1. Open any `.vm` file in VS Code
2. Press **F5** to launch Extension Development Host
3. Open the example template in the new window
4. Use **Ctrl+Shift+P** → "Velocity: Manage Context" to edit variables
5. Use **Ctrl+Shift+P** → "Velocity: Open Preview" to see rendered output

## Running Test Scripts

```bash
# From the extension root directory
node docs/examples/test-simple.js
node docs/examples/test-velocity-syntax.js
node docs/examples/test-actual-data.js
node docs/examples/test-utils-load.js
```

Note: Ensure the Velocity server is running before executing test scripts.
