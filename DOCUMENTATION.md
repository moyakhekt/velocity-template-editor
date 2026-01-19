# Documentation Overview

This document provides an index of all documentation for the Velocity Template Editor extension.

## Main Documentation

### [README.md](README.md)
**Primary documentation for users and developers**

Contents:
- Feature overview and capabilities
- Installation instructions
- Usage guide for Context Manager (Template & Global contexts)
- Variable and method examples
- Configuration settings
- Architecture overview
- File structure and context resolution
- Requirements and troubleshooting
- Known limitations
- Changelog

**Audience:** End users, developers, contributors

### [QUICKSTART.md](QUICKSTART.md)
**Quick start guide for testing and using the extension**

Contents:
- Prerequisites (Java 8+, VS Code 1.80+)
- Step-by-step feature walkthrough
- Context Manager usage (Template & Global tabs)
- Creating custom templates
- Variable and method examples
- Tips and best practices
- Troubleshooting common issues
- Advanced usage scenarios

**Audience:** New users, testers

### [.github/copilot-instructions.md](.github/copilot-instructions.md)
**Technical reference for GitHub Copilot and developers**

Contents:
- Project status checklist
- Architecture overview
- Component descriptions
- File structure
- Key features and implementation details
- Data formats (JSON schemas)
- Development commands
- Testing procedures
- Architecture notes

**Audience:** Developers, AI assistants, maintainers

## Additional Documentation

### [velocity-server/README.md](velocity-server/README.md)
**Apache Velocity server documentation**

Contents:
- Java server implementation details
- Apache Velocity 2.3 engine integration
- Nashorn JavaScript engine for method mocks
- HTTP API endpoints
- Build and deployment instructions

**Audience:** Backend developers, server maintainers

## Removed Documentation

The following outdated files were consolidated into the main documentation:

- ❌ `GLOBAL_CONTEXT_STATUS.md` - Implementation status (now in README.md Changelog)
- ❌ `GLOBAL_CONTEXT_IMPLEMENTATION.md` - Technical details (now in copilot-instructions.md)
- ❌ `AUTO-EXTRACT-FEATURE.md` - Feature planning (feature is implemented)
- ❌ `APACHE-VELOCITY-SETUP.md` - Setup instructions (now in README.md Requirements)

## Documentation Updates

### Changes Made (January 2026)
1. **Unified Context System**: Updated all docs to reflect single Context Manager with dual-context support
2. **Removed Legacy References**: Eliminated mentions of separate variable/mock managers
3. **Added Context Merging**: Documented automatic global + template context merging
4. **Updated File Formats**: Changed from `.vars.json`/`.mocks.json` to unified `.context.json`
5. **Enhanced Examples**: Added comprehensive examples showing Template/Global context usage
6. **Improved Troubleshooting**: Added specific solutions for common issues
7. **Architecture Details**: Added context resolution and merging documentation

### Migration Notes
- Old format: `template.vars.json` + `template.mocks.json`
- New format: `template.context.json` (unified)
- Methods now use `_implementation` key
- No automatic migration - manual update required

## Contributing to Documentation

When updating documentation:

1. **README.md**: Update for user-facing changes, new features, API changes
2. **QUICKSTART.md**: Update for workflow changes, new commands, UI changes
3. **copilot-instructions.md**: Update for architecture changes, new components, data formats
4. **DOCUMENTATION.md** (this file): Update when adding/removing doc files

### Style Guidelines
- Use clear, concise language
- Include code examples for complex features
- Add troubleshooting sections for common issues
- Keep examples up-to-date with current data formats
- Use emoji sparingly for visual hierarchy (✅, ❌, 🔧, etc.)
- Format code blocks with proper language tags

### Version Control
- Document breaking changes in CHANGELOG section
- Update version numbers when releasing
- Tag documentation updates in commit messages
- Link to issues/PRs when documenting bug fixes

## Quick Reference

| Need to... | Read... |
|------------|---------|
| Install and use the extension | README.md |
| Test extension features quickly | QUICKSTART.md |
| Understand architecture | copilot-instructions.md |
| Work on the Velocity server | velocity-server/README.md |
| Configure Context Manager | README.md (Context Manager section) |
| Debug issues | QUICKSTART.md (Troubleshooting) |
| Contribute code | README.md (Contributing section) |
| Add new features | copilot-instructions.md (Architecture Notes) |

## Documentation Best Practices

### For Users
- Start with QUICKSTART.md for hands-on learning
- Reference README.md for comprehensive feature details
- Check Troubleshooting sections when issues arise

### For Developers
- Read copilot-instructions.md for architecture understanding
- Reference README.md for API and configuration details
- Keep documentation in sync with code changes

### For Contributors
- Update relevant docs when adding features
- Add examples for new functionality
- Include troubleshooting tips for common pitfalls
- Test documentation examples before committing
