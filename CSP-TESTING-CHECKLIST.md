# CSP Feature Testing Checklist

## Prerequisites
- [ ] VS Code Extension Development Host launched (F5)
- [ ] Test workspace open with at least one `.vm` file
- [ ] Browser DevTools knowledge (F12)

## Test 1: Environment Context Setup
- [ ] Open any `.vm` file in workspace
- [ ] Press `Ctrl+Shift+P`
- [ ] Run command: `Velocity: Manage Context`
- [ ] Click **Environment Context** tab
- [ ] Verify "CSP Directives for Preview" section exists
- [ ] Verify empty table with "Add CSP Directive" button

## Test 2: Add CSP Directive
- [ ] Click **Add CSP Directive** button
- [ ] New row appears with two input fields
- [ ] Enter directive name: `default-src`
- [ ] Enter value: `'self'`
- [ ] Click checkmark (✓) to save
- [ ] Verify row appears in table with entered values
- [ ] Verify status message: "$(check) CSP directive added"

## Test 3: Add Multiple Directives
- [ ] Click **Add CSP Directive** again
- [ ] Enter directive: `script-src`, value: `'self' 'unsafe-inline'`
- [ ] Save and verify
- [ ] Add directive: `style-src`, value: `'self' 'unsafe-inline'`
- [ ] Add directive: `img-src`, value: `'self' data: https:`
- [ ] Add directive: `connect-src`, value: `'self'`
- [ ] Verify all 5 directives appear in table

## Test 4: Edit Directive Name
- [ ] Click on `default-src` directive name cell
- [ ] Row enters edit mode (cell becomes input field)
- [ ] Change name to `base-src`
- [ ] Press Enter or click outside
- [ ] Verify name updated in table
- [ ] Verify status message: "$(check) CSP directive updated"

## Test 5: Edit Directive Value
- [ ] Click on `script-src` value cell
- [ ] Change value to `'self' 'unsafe-inline' 'unsafe-eval'`
- [ ] Press Enter or tab out
- [ ] Verify value updated in table
- [ ] Verify status message appears

## Test 6: Delete Directive
- [ ] Click 🗑 (trash) button next to `base-src` directive
- [ ] Verify row removed from table
- [ ] Verify status message: "$(check) CSP directive deleted"
- [ ] Verify remaining 4 directives still present

## Test 7: Persistence Test
- [ ] Close Context Manager webview
- [ ] Reopen Context Manager (`Ctrl+Shift+P` → "Velocity: Manage Context")
- [ ] Navigate to Environment Context tab
- [ ] Verify all 4 directives are still present
- [ ] Check environment context JSON file in workspace
- [ ] Verify `cspDirectives` object exists with correct values

## Test 8: Validation - Empty Name
- [ ] Click **Add CSP Directive**
- [ ] Leave directive name empty
- [ ] Enter value: `'self'`
- [ ] Click checkmark
- [ ] Verify error message: "Both CSP directive and value are required."
- [ ] Verify row not added

## Test 9: Validation - Empty Value
- [ ] Click **Add CSP Directive**
- [ ] Enter directive name: `font-src`
- [ ] Leave value empty
- [ ] Click checkmark
- [ ] Verify error message: "Both CSP directive and value are required."
- [ ] Verify row not added

## Test 10: Validation - Duplicate Directive
- [ ] Note existing directive (e.g., `script-src`)
- [ ] Click **Add CSP Directive**
- [ ] Enter same directive name: `script-src`
- [ ] Enter any value
- [ ] Click checkmark
- [ ] Verify error message: 'CSP directive "script-src" already exists.'
- [ ] Verify duplicate not added

## Test 11: Cancel New Directive
- [ ] Click **Add CSP Directive**
- [ ] Enter directive name and value
- [ ] Click X (cancel) button instead of checkmark
- [ ] Verify row removed from table
- [ ] Verify no changes saved

## Test 12: Preview Integration - Basic CSP
- [ ] Ensure CSP directive `default-src` = `'self'` exists
- [ ] Open template preview (Click preview icon or `Ctrl+Shift+P` → "Velocity: Open Preview")
- [ ] Right-click preview → Inspect
- [ ] In DevTools Elements tab, check `<head>` section
- [ ] Verify meta tag exists: `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; ...">`
- [ ] Verify all directives included in content attribute

## Test 13: Preview Integration - CSP Enforcement
- [ ] Create template with external resource (e.g., `<img src="https://example.com/image.jpg">`)
- [ ] Set CSP: `img-src` = `'self'` (blocks external images)
- [ ] Open preview
- [ ] Open DevTools Console (F12)
- [ ] Verify CSP violation error appears for blocked image
- [ ] Change CSP: `img-src` = `'self' https:`
- [ ] Refresh preview
- [ ] Verify image now loads (no CSP error)

## Test 14: Preview Integration - Inline Scripts
- [ ] Create template with inline script: `<script>alert('test');</script>`
- [ ] Set CSP: `script-src` = `'self'` (blocks inline scripts)
- [ ] Open preview
- [ ] Open DevTools Console
- [ ] Verify CSP violation for inline script
- [ ] Change CSP: `script-src` = `'self' 'unsafe-inline'`
- [ ] Refresh preview
- [ ] Verify script executes (alert appears)

## Test 15: Preview Integration - No CSP
- [ ] Delete all CSP directives
- [ ] Open preview
- [ ] Inspect HTML in DevTools
- [ ] Verify NO CSP meta tag in `<head>`
- [ ] Verify preview works normally without CSP restrictions

## Test 16: JSON File Format
- [ ] Open environment context JSON file
- [ ] Verify structure:
```json
{
  "messagesFilePath": "...",
  "languageCode": "...",
  "headers": {...},
  "cspDirectives": {
    "directive-1": "value-1",
    "directive-2": "value-2"
  },
  "data": {...},
  "mockFunctions": {...}
}
```
- [ ] Verify `cspDirectives` is at root level
- [ ] Verify all directives present

## Test 17: Load Environment Context
- [ ] Click 📂 (folder) icon in Environment Context tab
- [ ] Select `environment-context-example.json` file
- [ ] Verify CSP directives loaded into table:
  - `default-src`: `'self'`
  - `script-src`: `'self' 'unsafe-inline'`
  - `style-src`: `'self' 'unsafe-inline'`
  - `img-src`: `'self' data: https:`
  - `connect-src`: `'self'`

## Test 18: Save Environment Context
- [ ] Make changes to CSP directives
- [ ] Click 💾 (save) icon
- [ ] Select save location
- [ ] Open saved JSON file
- [ ] Verify `cspDirectives` object contains all changes

## Test 19: Common CSP Directives
Test adding these common directives:
- [ ] `default-src`: `'none'`
- [ ] `script-src`: `'self' https://cdn.example.com`
- [ ] `style-src`: `'self' https://fonts.googleapis.com`
- [ ] `font-src`: `'self' https://fonts.gstatic.com`
- [ ] `img-src`: `*`
- [ ] `media-src`: `'self'`
- [ ] `frame-src`: `'none'`
- [ ] `connect-src`: `'self' wss: https:`

## Test 20: Edge Cases
- [ ] Directive with spaces: `script-src` = `'self'   'unsafe-inline'` (multiple spaces)
- [ ] Directive with numbers: `default-src` = `'self' https://example.com:8080`
- [ ] Directive with wildcards: `img-src` = `*.example.com`
- [ ] Directive with hash: `script-src` = `'self' 'sha256-abc123...'`
- [ ] Very long value (100+ characters)

## Test Results Summary

### Passed Tests: __ / 20

### Failed Tests:
- [ ] Test #___: [Description of failure]
- [ ] Test #___: [Description of failure]

### Issues Found:
1. [Issue description]
2. [Issue description]

### Notes:
- [Any additional observations]

## Sign-off
- [ ] All critical tests passed
- [ ] No blockers found
- [ ] Feature ready for production

**Tester**: _______________
**Date**: _______________
**Build/Version**: _______________
