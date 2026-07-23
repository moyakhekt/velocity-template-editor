# Scenario-Based Testing Feature Plan

## Overview
Enable testing Velocity templates with multiple named scenarios, each with different variable values while keeping methods shared.

## Data Structure

### New Format (.context.json)
```json
{
  "url": "https://...",
  "headers": "...",
  "httpServletRequestVar": "HttpServletRequest",
  
  "methods": {
    "locale": {
      "getLanguage": { "_implementation": "return 'en'" }
    },
    "templateMessages": {
      "getMessage": { "_implementation": "return 'Hello'" }
    }
  },
  
  "scenarios": {
    "Default": {
      "username": "",
      "authnMessageKey": ""
    },
    "Incorrect Creds": {
      "username": "wronguser",
      "authnMessageKey": "authn.srvr.msg.invalid.credentials"
    },
    "Locked": {
      "username": "lockeduser",
      "authnMessageKey": "authn.srvr.msg.account.locked"
    },
    "Disabled": {
      "username": "disableduser",
      "authnMessageKey": "authn.srvr.msg.account.disabled"
    }
  },
  
  "activeScenario": "Default"
}
```

### Migration from Legacy Format
- Old format: `{ context: { ...all vars and methods... } }`
- New format: Separate methods from variables
- All variables go to "Default" scenario
- Methods stay in `methods` section

## UI Design

### Context Manager Layout
```
Environment Tab | Template Tab
-------------------------
[URL Configuration]
[Headers Configuration]
[HttpServletRequest Variable]

┌─ Methods ─────────────────┐
│ ▼ locale                   │
│   └─ getLanguage()        │
│ ▼ templateMessages        │
│   └─ getMessage()         │
└───────────────────────────┘

┌─ Variables ───────────────┐
│ Scenario: [Default ▼] [➕]│
│                            │
│ username: [      ]         │
│ authnMessageKey: [      ]  │
└───────────────────────────┘

[Scenarios]
├─ ✓ Default
├─ Incorrect Creds
├─ Locked
└─ Disabled
```

### Scenario Dropdown Features
- Select active scenario
- Create new scenario (button)
- Rename scenario (context menu)
- Delete scenario (cannot delete Default)
- Duplicate scenario

### Variable Inheritance
- Default scenario: Base variables
- Other scenarios: Override specific variables
- UI shows overridden vars in different color
- Empty field = use Default value

## Implementation Tasks

### ✅ Phase 1: Data Structure (DONE)
- [x] Update TypeScript interfaces
- [x] Add migration logic for legacy format
- [x] Update `getContextForTemplate()` to merge scenarios
- [x] Add helper methods (`isMethodsObject`, `getScenarioVariables`)

### 🚧 Phase 2: Context Loading
- [ ] Update `getTemplateOnlyContext()` for scenarios
- [ ] Update `saveContext()` to preserve scenario structure
- [ ] Add cache invalidation when scenarios change
- [ ] Test migration from legacy files

### 📋 Phase 3: UI Refactor
- [ ] Split UI into Methods and Variables sections
- [ ] Add scenario dropdown
- [ ] Add "Create Scenario" button
- [ ] Show inherited vs overridden variables
- [ ] Add scenario management (rename, delete, duplicate)

### 📋 Phase 4: Preview Integration
- [ ] Update preview to use active scenario
- [ ] Auto-refresh on scenario switch
- [ ] Show active scenario name in preview

### 📋 Phase 5: Testing
- [ ] Test with existing templates (backward compatibility)
- [ ] Test scenario creation and switching
- [ ] Test variable inheritance
- [ ] Test preview with different scenarios

## Benefits
1. **Better Testing**: Test multiple scenarios without editing variables
2. **Reusability**: Shared methods across all scenarios
3. **Organization**: Clear separation of methods vs variables
4. **Productivity**: Quickly switch between test cases
5. **Documentation**: Scenario names document test cases

## Backward Compatibility
- Legacy files automatically migrated on load
- All variables moved to "Default" scenario
- Methods separated automatically
- No data loss during migration
