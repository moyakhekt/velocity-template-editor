# Content Security Policy

CSP directives in the environment context control what the preview page may load: scripts, styles, images, fonts and connections. Use them to preview a template under the same policy it gets in production.

## Setting directives

In the [Context Manager](CONTEXT-MANAGER.md), open **Environment Context** › **CSP Directives for Preview**:

- **Add CSP Directive** adds a row: enter the directive (such as `script-src`) and its value (such as `'self' 'unsafe-inline'`).
- Click a cell to edit it; press Enter or click away to save.
- The delete button removes a directive.

Changes apply to the next render. With no directives, the preview has no policy.

They're stored under `cspDirectives` in the [context file](CONTEXT-FILE.md):

```json
"cspDirectives": {
  "default-src": "'self'",
  "script-src": "'self' 'unsafe-inline'",
  "style-src": "'self' 'unsafe-inline'",
  "img-src": "'self' data: https:",
  "connect-src": "'self'"
}
```

## How it's applied

Each render adds a `<meta http-equiv="Content-Security-Policy">` tag built from the directives.

The preview injects a small inline script to [capture links and forms](PREVIEW.md#links-forms-and-scripts), so `'unsafe-inline'` is added to any `script-src` directive. Bear that in mind when checking whether your own inline scripts would be blocked in production.

If you set `default-src` without a `script-src`, that script is blocked and links and forms navigate normally instead of being captured. Add a `script-src` directive to keep capture working.

## Common directives

| Directive | Controls | Example |
|-----------|----------|---------|
| `default-src` | Anything without its own directive | `'self'` |
| `script-src` | JavaScript | `'self' https://www.googletagmanager.com` |
| `style-src` | CSS | `'self' 'unsafe-inline' https://fonts.googleapis.com` |
| `img-src` | Images | `'self' data: https:` |
| `font-src` | Fonts | `'self' https://fonts.gstatic.com data:` |
| `connect-src` | `fetch`, XHR, WebSocket, EventSource | `'self' https://api.example.com` |
| `media-src` | Audio and video | `'self'` |
| `frame-src` | Frames | `'none'` |

Keywords are quoted: `'none'`, `'self'`, `'unsafe-inline'`, `'unsafe-eval'`. Schemes such as `data:` and `https:` aren't.

## Finding what's blocked

Open the browser's developer tools (F12) on the preview tab. Blocked resources are reported in the console with the directive that blocked them. Add the source to that directive, or leave it blocked if production blocks it too.

## References

- [MDN: Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [Google CSP Evaluator](https://csp-evaluator.withgoogle.com/)
