# Velocity server

A small Java HTTP server that renders templates with Apache Velocity 2.3. The extension starts it, sends it templates and values, and shows the HTML it returns. It runs mock methods with the Nashorn JavaScript engine.

Source is in `server/` (Maven, Java 17). The package is `com.moyakhekt.vscode.velocity`.

```
VelocityServer.java            Entry point: engine, HTTP server, handshake
handler/
  AuthFilter.java              Token check on every endpoint
  RenderHandler.java           POST /render
  HealthHandler.java           GET /health
  ShutdownHandler.java         POST /shutdown
introspection/
  CustomUberspect.java         Routes mock method calls; secure introspection
  MockVelMethod.java           A mock method as a Velocity method
mock/
  MockObject.java              An object with properties and JavaScript methods (sandboxed Nashorn)
  MockHttpServletRequest.java  The request tool
util/
  LocaleHelper.java            The locale tool
  TemplateMessages.java        The message tool (.properties files)
  EscapeTool.java              The escape tool
  UtilsHelper.java             `utils` inside mocks: loadProperties, getProperty
```

## Build

```bash
cd server
mvn clean package -DskipTests
```

This produces `target/velocity-server-1.0.0.jar`, a single jar with all dependencies. `npm run build:java` does the same from the project root.

## Security

- **Network:** it listens on `127.0.0.1` only.
- **Token:** every request must send the `X-Velocity-Token` header matching `VELOCITY_SERVER_TOKEN`; anything else gets `401`. Without the variable, the server makes up a token and prints it to stderr.
- **No CORS:** no CORS headers are sent, so web pages can't call it.
- **Mock sandbox:** mock JavaScript runs with `--no-java` and a class filter that denies every class, so mocks have no `Java.type`, `Packages`, or reflection.
- **Template sandbox:** templates use Velocity's `SecureUberspector`, which blocks `Class`, `ClassLoader`, `Runtime`, `System`, threads and reflection.

## Startup handshake

stdout is reserved for the extension. Once listening, the server writes exactly one line:

```
{"event":"ready","port":53817}
```

Logs, and everything else meant for people, go to stderr.

The port is a free one unless `-Dvelocity.port=N` is given. Set `-Dvelocity.logLevel=debug` for detailed render logs; the extension does this when `velocity.debugLogging` is on.

## Run it by hand

```bash
VELOCITY_SERVER_TOKEN=dev-token java -Dvelocity.port=9876 -jar target/velocity-server-1.0.0.jar

curl -H "X-Velocity-Token: dev-token" http://127.0.0.1:9876/health

curl -X POST http://127.0.0.1:9876/render \
  -H "X-Velocity-Token: dev-token" \
  -H "Content-Type: application/json" \
  -d '{"template": "Hello $name!", "variables": {"name": "World"}}'

curl -X POST -H "X-Velocity-Token: dev-token" http://127.0.0.1:9876/shutdown
```

To debug from an IDE, add `-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=5005` and attach to port 5005. `.vscode/launch.json` also has a Java launch configuration.

## API

### POST /render

```json
{
  "template": "Hi $user.name, you have $cart.count() items. $templateMessages.getMessage('greeting')",
  "variables": {
    "user": { "name": "Ann" },
    "HttpServletRequest": {
      "_httpServletRequest": true,
      "url": "https://example.com/login?theme=dark",
      "headers": "Accept-Language: en\nX-Trace: 1"
    }
  },
  "methods": {
    "cart": { "count": { "implementation": "return 3;" } }
  },
  "messagesPropertiesPaths": ["C:/project/conf/messages.properties"],
  "language": "en",
  "localeVar": "locale",
  "templateMessagesVar": "templateMessages",
  "escapeToolVar": "escape"
}
```

| Field | Meaning |
|-------|---------|
| `template` | The template text (required) |
| `variables` | Values. An object with `_httpServletRequest: true` becomes a request tool built from its `url` and `headers` (one `Name: value` per line) |
| `methods` | Object name → method name → `{ "implementation": "JavaScript body" }`. Arguments are in `args`; the object's properties are available by name |
| `messagesPropertiesPaths` | `.properties` files for the message tool, in order |
| `language` | What the locale tool returns; default `en` |
| `localeVar`, `templateMessagesVar`, `escapeToolVar` | Variable names for the locale, message and escape tools; defaults `locale`, `templateMessages`, `escape` |

**Responses:**
- **200:** the rendered HTML.
- **500:** an HTML page with the error message and stack trace.
- **401:** missing or wrong token.
- **405:** not a POST.

### GET /health

`{"status":"ok","version":"1.0.0"}`

### POST /shutdown

Replies `{"status":"shutting down"}`, then stops the server.

## Tools

| Tool | Methods |
|------|---------|
| Request | `getParameter(name)`, `getParameterValues(name)`, `getParameterMap()`, `getHeader(name)`, `getHeaderMap()`, `getQueryString()`, `getRequestURI()`, `getRequestURL()` |
| Locale | `getLanguage()` |
| Messages | `getMessage(key, params...)`, `getMessage(prefix, suffix, params...)`. A missing key renders as `[Message not found: key]` |
| Escape | `html`, `xml`, `javascript` / `forJavaScript`, `url`, `csv`, `java`, `escape` |
| `utils` (in mocks) | `loadProperties(path)` → map, `getProperty(map, key, fallback)` |
