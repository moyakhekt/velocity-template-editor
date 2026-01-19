# Velocity Server

HTTP server component for rendering Apache Velocity templates with 100% compatibility.

## Prerequisites

- Java 11 or higher
- Maven 3.6 or higher

## Build

```bash
cd velocity-server
mvn clean package
```

This creates `target/velocity-server-1.0.0.jar` (fat JAR with all dependencies).

## Run Standalone (for testing)

```bash
java -jar target/velocity-server-1.0.0.jar
```

Server starts on `http://localhost:9876`

## API Endpoints

### POST /render

Render a Velocity template with variables and method mocks.

**Request:**
```json
{
  "template": "#set($name = 'World')\nHello $name!",
  "variables": {
    "user": {
      "name": "John",
      "age": 30
    }
  },
  "methods": {
    "util": {
      "upper": {
        "name": "upper",
        "implementation": "return args[0].toUpperCase()"
      }
    }
  }
}
```

**Response:** Rendered HTML (200 OK)

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "engine": "Apache Velocity"
}
```

### POST /shutdown

Graceful shutdown.

**Response:**
```json
{
  "status": "shutting down"
}
```

## Features

- **Apache Velocity 2.3** - 100% official implementation
- **GraalVM JavaScript** - Execute JavaScript method mocks
- **Properties files** - Support for loading .properties files
- **HTTP Server** - Lightweight, fast, no external dependencies
- **CORS enabled** - Works with webviews
- **Error handling** - Detailed error messages with stack traces

## Method Mocks

Method implementations use JavaScript (via GraalVM):

```javascript
// Access parameters via args array
return args[0] + " " + args[1]

// Complex logic
const value = args[0] || "default";
return value.toUpperCase()

// Multiple statements
const a = args[0];
const b = args[1];
return Math.max(a, b)
```

## VS Code Extension Integration

The server starts automatically when the VS Code extension activates and stops on deactivation. No manual intervention required.
