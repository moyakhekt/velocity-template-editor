# Testing Scenario-Based Feature

## Test Files Created
- `example-scenarios.vm` - Test template
- `example-scenarios.context.json` - Test context with 4 scenarios

## How to Test

### 1. Reload Extension
Press **F5** to reload the Extension Development Host

### 2. Open Test Files
1. Open `example-scenarios.vm`
2. Open Context Manager: **Ctrl+Shift+P** → "Velocity: Manage Context"

### 3. Verify Scenario UI
You should see:
- ✅ Scenario dropdown with: Default, Incorrect Creds, Account Locked, Account Disabled
- ✅ ➕ button to create new scenarios
- ✅ 🗑 button to delete scenarios (not visible on Default)
- ✅ Info banner explaining inheritance

### 4. Test Scenario Switching
1. Open Preview: **Ctrl+Shift+P** → "Velocity: Open Preview"
2. Switch scenarios in Context Manager dropdown:
   - **Default**: No error shown, empty username
   - **Incorrect Creds**: Shows "Invalid username or password", username = "wronguser"
   - **Account Locked**: Shows "Your account has been locked", username = "lockeduser"
   - **Account Disabled**: Shows "Your account has been disabled", username = "disableduser"
3. Preview should auto-refresh on scenario change

### 5. Test Scenario Creation
1. Click **➕** button
2. Enter name: "Success Login"
3. Verify new scenario appears in dropdown
4. Verify it's selected automatically
5. Edit variables for this scenario
6. Save and verify preview updates

### 6. Test Scenario Deletion
1. Select "Success Login" scenario
2. Click **🗑** button
3. Confirm deletion
4. Verify it switches back to "Default"

### 7. Verify Methods Work
All scenarios should show:
- Language: `en` (from `locale.getLanguage()`)
- Theme: `ClassicDark` (from `$HttpServletRequest.getParameter('theme')`)
- Correct error message (from `templateMessages.getMessage()`)

### 8. Test Legacy Migration
1. Open `examples/example.vm` (old format)
2. Open Context Manager
3. Verify it auto-migrates to new format with "Default" scenario
4. Verify all existing variables/methods still work

## Expected Results
✅ Scenario dropdown works
✅ Preview auto-refreshes on scenario switch  
✅ Variables override correctly
✅ Methods shared across scenarios
✅ Create/delete scenarios works
✅ Legacy files migrated automatically
✅ HttpServletRequest still works
✅ Backward compatibility maintained

## Known Issues
None expected - feature is complete!
