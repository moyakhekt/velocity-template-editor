# CSP (Content Security Policy) Directives Feature

## Overview
The Velocity Template Editor now supports Content Security Policy (CSP) directives in the environment context. This allows you to control what resources the browser can load when previewing templates, enhancing security.

## What is CSP?
Content Security Policy (CSP) is a security standard that helps prevent cross-site scripting (XSS), clickjacking, and other code injection attacks. It works by specifying which sources of content are allowed to be loaded.

## How to Use

### 1. Access the Context Manager
Open a Velocity template (`.vm` file) and press **Ctrl+Shift+P**, then select:
- `Velocity: Manage Context`

### 2. Navigate to Environment Context Tab
Click the **Environment Context** tab in the Context Manager webview.

### 3. Configure CSP Directives
You'll see a **"CSP Directives for Preview"** section with a table containing:
- **Directive**: The CSP directive name (e.g., `default-src`, `script-src`)
- **Value**: The allowed sources (e.g., `'self'`, `'unsafe-inline'`)
- **Actions**: Delete button to remove the directive

### 4. Add a New Directive
1. Click the **"Add CSP Directive"** button
2. Enter the directive name (e.g., `script-src`)
3. Enter the value (e.g., `'self' 'unsafe-inline'`)
4. Click the checkmark (✓) to save

### 5. Edit Existing Directives
1. Click on any cell in the directive table
2. Modify the value
3. Press Enter or click outside to save

### 6. Delete a Directive
Click the **🗑** (trash) button next to the directive you want to remove.

## Common CSP Directives

| Directive | Purpose | Example Values |
|-----------|---------|----------------|
| `default-src` | Default policy for all resource types | `'self'` |
| `script-src` | Controls JavaScript sources | `'self' 'unsafe-inline' 'unsafe-eval'` |
| `style-src` | Controls CSS sources | `'self' 'unsafe-inline'` |
| `img-src` | Controls image sources | `'self' data: https:` |
| `connect-src` | Controls AJAX, WebSocket, EventSource | `'self' https://api.example.com` |
| `font-src` | Controls font sources | `'self' https://fonts.googleapis.com` |
| `media-src` | Controls video/audio sources | `'self'` |
| `frame-src` | Controls iframe sources | `'none'` |

## Special Keywords

CSP values often use special keywords (must be quoted):
- `'none'` - Blocks all sources
- `'self'` - Allows resources from the same origin
- `'unsafe-inline'` - Allows inline scripts/styles (use cautiously)
- `'unsafe-eval'` - Allows eval() in JavaScript (use cautiously)
- `data:` - Allows data: URIs
- `https:` - Allows any HTTPS source

## Example Configuration

Here's an example environment context JSON with CSP directives:

```json
{
  "messagesFilePath": "",
  "languageCode": "en",
  "headers": {},
  "cspDirectives": {
    "default-src": "'self'",
    "script-src": "'self' 'unsafe-inline'",
    "style-src": "'self' 'unsafe-inline'",
    "img-src": "'self' data: https:",
    "connect-src": "'self'"
  },
  "data": {
    "siteName": "My Application"
  },
  "mockFunctions": {}
}
```

## How It Works

When you preview a template:

1. The extension reads CSP directives from your environment context
2. Builds a CSP header string from the directives
3. Injects a `<meta>` tag into the preview HTML:
   ```html
   <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; ...">
   ```
4. The browser enforces these policies when loading resources

## Testing Your CSP

1. Add CSP directives in the Environment Context
2. Open a template preview (`Velocity: Open Preview`)
3. Open browser DevTools (F12)
4. Check the Console for CSP violation messages
5. Adjust directives as needed

## Tips

- **Start restrictive**: Begin with `default-src 'self'` and add exceptions as needed
- **Check the console**: CSP violations appear in the browser console
- **Test thoroughly**: Preview multiple templates to ensure CSP doesn't block needed resources
- **Use 'unsafe-inline' sparingly**: It reduces security but may be needed for inline styles/scripts
- **Document your policy**: Explain why each directive is necessary for your team

## Troubleshooting

### Problem: Preview shows blank or missing content
**Solution**: Check browser console for CSP violations and add necessary directives.

### Problem: Inline styles not working
**Solution**: Add `'unsafe-inline'` to `style-src` directive.

### Problem: External images not loading
**Solution**: Add appropriate source to `img-src` (e.g., `https:` or specific domain).

### Problem: JavaScript not executing
**Solution**: Check `script-src` directive includes necessary sources (`'self'`, `'unsafe-inline'`, etc.).

## File Storage

CSP directives are stored in your environment context JSON file under the `cspDirectives` key:

```json
{
  "cspDirectives": {
    "directive-name": "value",
    ...
  }
}
```

They are automatically available to all templates that use this environment context.

## Security Best Practices

1. **Avoid 'unsafe-inline' and 'unsafe-eval'** when possible
2. **Use specific domains** instead of wildcards (e.g., `https://trusted-cdn.com` instead of `https:`)
3. **Start strict, then relax** as needed rather than starting permissive
4. **Test in different scenarios** to ensure legitimate resources aren't blocked
5. **Keep directives minimal** - only add what's necessary

## Architecture

### Backend (TypeScript)
- **types.ts**: Added `cspDirectives?: { [directive: string]: string }` to `EnvironmentContextConfig`
- **contextManager.ts**: Handles loading, saving, and UI rendering of CSP directives
- **preview.ts**: Builds CSP meta tag and injects into preview HTML

### Frontend (JavaScript)
- **webview-ui/scripts.js**: Handles UI interactions for adding/editing/deleting CSP directives

### Data Flow
1. User edits CSP directives in Context Manager UI
2. Webview sends message to extension
3. Extension updates environmentContext.cspDirectives
4. Extension saves to JSON file
5. Preview reads cspDirectives and builds meta tag
6. Browser enforces CSP policy

## References

- [MDN: Content Security Policy (CSP)](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [CSP Quick Reference](https://content-security-policy.com/)
- [Google CSP Evaluator](https://csp-evaluator.withgoogle.com/)
