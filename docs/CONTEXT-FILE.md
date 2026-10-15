# Context file format

The environment context is one JSON file holding everything the preview renders with. The [Context Manager](CONTEXT-MANAGER.md) reads and writes it, so you rarely need to edit it by hand. When you do, use **Reload** in the Context Manager afterwards.

The extension remembers which file you last used.

## Top level

```json
{
  "messagesPropertiesPaths": ["conf/language-packs/messages.properties"],
  "language": "en",
  "headers": { "Accept-Language": "en-ZA" },
  "cspDirectives": { "default-src": "'self'", "img-src": "'self' data:" },
  "context": { "siteName": "My Application" },
  "mockFunctions": { "getSize": "return 0;" },
  "templates": { },
  "templateGroups": { }
}
```

| Key | Type | Meaning |
|-----|------|---------|
| `messagesPropertiesPaths` | string[] | `.properties` files read by the message tool, in order |
| `language` | string | Language returned by the locale tool; default `en` |
| `headers` | object | HTTP headers every scenario's request starts with |
| `cspDirectives` | object | Directive name → value, applied to the preview. See [CSP](CSP.md) |
| `context` | object | Environment variables shared by all templates |
| `mockFunctions` | object | Mock function name → JavaScript body (arguments in `args`) |
| `templates` | object | Template path → [template context](#template-context) |
| `templateGroups` | object | Group name → [template group](#template-groups) |

### Methods on environment objects

An environment variable that's an object can carry method mocks: any member that's an object with `_implementation` is a method. A template's own object of the same name is merged into it, so the method can use the template's values.

```json
"context": {
  "user": {
    "getEmail": { "_implementation": "return name.toLowerCase().replace(' ', '.') + '@example.com';" }
  }
}
```

With a scenario value `user = {"name": "Ann Lee"}`, `$user.getEmail()` renders `ann.lee@example.com`. Mapping the method to a mock function (`mappedMethods`) does the same per template; see the [examples](examples/README.md).

## Template context

Keys of `templates` are template paths relative to the workspace folder, with forward slashes, for example `conf/template/login.template.html`. Templates outside the workspace use their absolute path.

```json
"templates": {
  "conf/template/login.template.html": {
    "mappedVariables": {
      "httpServletRequestVar": "HttpServletRequest",
      "localeVar": "locale",
      "templateMessagesVar": "templateMessages",
      "escapeToolVar": "escape"
    },
    "mappedMethods": { "altAuthSources.size": "getSize" },
    "activeScenario": "Default",
    "scenarios": {
      "Default": {
        "url": "https://sso.example.com/login?theme=dark",
        "headers": { "X-Trace": "1" },
        "variables": { "username": "", "showError": false },
        "variableJsonFlags": {}
      },
      "Invalid password": {
        "variables": { "username": "ann", "showError": true }
      }
    }
  }
}
```

| Key | Meaning |
|-----|---------|
| `mappedVariables` | Which template variables are the request, locale, message and escape tools. Detected automatically |
| `mappedMethods` | Template method (`object.method`) → mock function name. Applies when the object has no value or is an object; a list or text keeps its real methods (such as `size()`) |
| `activeScenario` | The scenario the preview renders |
| `scenarios` | Scenario name → scenario. `Default` always exists |

The Context Manager also keeps `autoScaffoldedVariables` and `autoScaffoldedRequestParams` lists here; leave them as they are.

### Scenario

| Key | Meaning |
|-----|---------|
| `variables` | The scenario's own values. In other scenarios, anything not set here comes from `Default` |
| `variableJsonFlags` | Variable → `true` to parse its string value as JSON. Set on `Default` |
| `url` | Request URL; its query string supplies `getParameter` |
| `urlSource` | Another scenario to take the URL from, instead of `url` |
| `headers` | Request headers, added to the top-level `headers` |
| `variableSources`, `headerSources` | Where each value comes from. Managed by the Context Manager |

Values in `variables` can be strings, numbers, booleans, objects or arrays.

## Template groups

A group has the same keys as a template context, plus its member list. Members use the group's scenarios and mappings; any entry of their own under `templates` is ignored.

```json
"templateGroups": {
  "Login pages": {
    "templates": [
      "conf/template/login.template.html",
      "conf/template/brand-a/login.template.html"
    ],
    "activeScenario": "Default",
    "scenarios": { "Default": { "variables": {} } }
  }
}
```

## What a render sees

For the active scenario, the template is rendered with:

1. the environment variables (`context`);
2. the scenario's values, which take precedence (objects are merged key by key);
3. the request tool built from the scenario's URL and headers;
4. the locale, message and escape tools, under the variable names in `mappedVariables`;
5. mapped methods, which call their mock functions (unless the value is a list or text, which keeps its real methods).
