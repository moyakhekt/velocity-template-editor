# Context Manager

The Context Manager is where you give templates the values they render with. Open it from the **{ V }** icon on the Activity Bar, or with **Manage Context** on a Velocity template. It follows the template you're editing.

Everything it edits is saved in one [environment context file](CONTEXT-FILE.md). It has three tabs.

## Environment Context

Settings and values shared by every template.

| Section | What it's for |
|---------|---------------|
| **Environment Context File** | The file in use. Load a different one or reload it after editing by hand. |
| **Messages Properties Files** | `.properties` files that `$templateMessages.getMessage("key")` reads, in order. Saving one of them refreshes the preview. |
| **Default Language Code** | What `$locale.getLanguage()` returns, for example `en`. |
| **Environment Headers** | HTTP headers every scenario's request starts with (see [Request](#request)). |
| **CSP Directives for Preview** | The Content Security Policy applied to the preview. See [CSP](CSP.md). |
| **Environment Variables** | Values available to every template. A template's own value with the same name takes precedence; objects are merged key by key. |
| **Mock Functions** | Named JavaScript functions that template methods can be mapped to (see [Template Bindings](#template-bindings)). |

### Mock functions

A mock function is the body of a JavaScript function. Its arguments are in `args`:

```javascript
// $user.getFullName("Ann", "Lee")
return args[0] + " " + args[1];
```

Inside a mock you can also use:
- the object's other properties, by name;
- `utils.loadProperties(path)` and `utils.getProperty(props, key, fallback)` to read a `.properties` file.

Mocks are sandboxed: they can't reach Java classes, the file system (other than through `utils`), or the network.

## Template Groups

A group is a set of templates that share one template context: the same scenarios and bindings. Use it when templates are variants of each other, such as a default login page and its branded copies, and should be tested against the same scenarios. Group members can be [compared side by side](PREVIEW.md#comparing-templates) in the preview.

- **Create a group** from the template open in Template Context; it starts with that template's scenarios.
- **Add templates** to a group; their own scenarios are replaced by the group's.
- **Remove a template** from a group, or **delete** a group; members keep a copy of the scenarios.
- **Rename** a group at any time.

**Ungrouped** lists templates in the context file that aren't in a group.

## Template Context

The template you're editing: its bindings, scenarios and values. If the template is in a group, everything here is shared with the group.

### Template Bindings

**Mapped Variables** shows which of the template's variables stand for the standard tools. These are detected automatically:

| Tool | Provides |
|------|----------|
| HTTP Servlet Request | A mock request built from the scenario's [URL and headers](#request): `getParameter`, `getParameterValues`, `getParameterMap`, `getHeader`, `getHeaderMap`, `getQueryString`, `getRequestURI`, `getRequestURL` |
| Locale Provider | `getLanguage()`, from **Default Language Code** |
| Message Provider | `getMessage(key, params...)`, from the **Messages Properties Files** |
| Escape Tool | `html`, `xml`, `javascript`, `url`, `csv`, `java` escaping |

**Template Methods** lists the methods the template calls on objects that aren't tools. Map each one to a [mock function](#mock-functions) so it returns something during preview. A mapping applies when the object has no value or is a JSON object; if the scenario gives it a list or text, its real methods (such as a list's `size()`) are used instead.

### Scenarios

A scenario is a named set of values. **Default** always exists and holds the template's baseline values; every other scenario inherits Default's values and overrides only what's different.

- **+** adds a scenario, and the pencil renames it. Delete removes it; Default can't be deleted.
- The selected scenario is the one the preview renders. Switching it here or in the preview toolbar does the same thing.

### Variables

One row per variable: everything the template uses, plus anything set in this scenario or inherited.

- **Value**: type to set it. An empty value shows **(not set)**.
- **JSON**: parse the value as JSON (an object or array). Set in Default and followed by other scenarios.
- **Override**: in a scenario other than Default, tick to give it its own value; untick to inherit again. In Default, it overrides the environment's value of the same name.
- **Filter variables** and **Overridden only** narrow the list.
- **Edit in VS Code editor** opens a long JSON value in a full editor.

### Request

What the mock HTTP request looks like in this scenario:
- **Scenario URL**: the request URL; its query string supplies `getParameter`. A non-Default scenario can take its URL from another scenario.
- **Scenario Headers**: added to the **Environment Headers**.

### Detected

A read-only analysis of the template:
- **Request Parameters**: the parameters it reads, so you can add them to a scenario's URL.
- **Conditional Branches**: its `#if`/`#elseif` conditions, to help you design scenarios that cover each branch.

## Title bar

- **Run Screenshot Tests**: renders every scenario of every template to PNG files. See [Preview](PREVIEW.md#screenshot-tests).
- **Open Developer Tools**: inspect the Context Manager itself.
