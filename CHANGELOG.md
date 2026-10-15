# Changelog

## 0.1.0

First release.

- Syntax highlighting for Velocity templates.
- Live browser preview rendered by Apache Velocity 2.3:
  - searchable Template, Scenario and Compare menus;
  - side-by-side comparison of grouped templates;
  - a hideable toolbar;
  - captured links and forms;
  - Content Security Policy;
  - one reusable preview tab.
- Context Manager in the side bar:
  - environment variables, headers, messages files and mock functions;
  - per-template scenarios with inheritance from Default;
  - template groups;
  - request URL and headers per scenario;
  - automatic detection of the request, locale, message and escape tools.
- Screenshot tests for every scenario of every template, using Chrome or Edge.
- `velocity.debugLogging` setting for detailed render logs.
- Sandboxed rendering: loopback-only server with a per-session token; mocks and templates without access to Java classes.
