package com.vscode.velocity;

import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpExchange;
import org.apache.velocity.VelocityContext;
import org.apache.velocity.app.VelocityEngine;
import org.apache.velocity.runtime.RuntimeConstants;
import org.apache.velocity.util.introspection.*;
import org.apache.velocity.util.StringUtils;
import org.json.JSONObject;
import org.json.JSONArray;

import javax.script.*;

import java.io.*;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.stream.Collectors;
import java.util.Properties;

public class VelocityServer {
    private static final int PORT = 9876;
    private static VelocityEngine velocityEngine;
    private static final String VERSION = "1.0.0";

    public static void main(String[] args) throws IOException {
        System.out.println("Starting Velocity Server v" + VERSION + "...");
        
        // Initialize Velocity Engine
        velocityEngine = new VelocityEngine();
        Properties props = new Properties();
        props.setProperty(RuntimeConstants.RUNTIME_LOG_NAME, "velocity");
        props.setProperty(RuntimeConstants.RESOURCE_LOADERS, "file");
        props.setProperty(RuntimeConstants.FILE_RESOURCE_LOADER_PATH, "");
        props.setProperty(RuntimeConstants.FILE_RESOURCE_LOADER_CACHE, "false");
        
        // Use custom Uberspect for dynamic method resolution
        props.setProperty(RuntimeConstants.UBERSPECT_CLASSNAME, CustomUberspect.class.getName());
        
        velocityEngine.init(props);

        // Create HTTP Server
        HttpServer server = HttpServer.create(new InetSocketAddress(PORT), 0);
        server.createContext("/render", new RenderHandler());
        server.createContext("/health", new HealthHandler());
        server.createContext("/shutdown", new ShutdownHandler(server));
        server.setExecutor(null);
        server.start();

        System.out.println("Velocity Server started on port " + PORT);
        System.out.println("Endpoints:");
        System.out.println("  POST /render - Render Velocity templates");
        System.out.println("  GET /health - Health check");
        System.out.println("  POST /shutdown - Graceful shutdown");
    }

    static class RenderHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            // Enable CORS
            exchange.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
            exchange.getResponseHeaders().add("Access-Control-Allow-Methods", "POST, OPTIONS");
            exchange.getResponseHeaders().add("Access-Control-Allow-Headers", "Content-Type");

            if ("OPTIONS".equals(exchange.getRequestMethod())) {
                exchange.sendResponseHeaders(204, -1);
                return;
            }

            if (!"POST".equals(exchange.getRequestMethod())) {
                sendResponse(exchange, 405, "Method Not Allowed");
                return;
            }

            try {
                // Read request body
                String requestBody = new BufferedReader(
                    new InputStreamReader(exchange.getRequestBody(), StandardCharsets.UTF_8))
                    .lines()
                    .collect(Collectors.joining("\n"));

                System.out.println("Received render request, body length: " + requestBody.length());
                
                JSONObject json = new JSONObject(requestBody);
                String template = json.getString("template");
                JSONObject variables = json.optJSONObject("variables");
                JSONObject methods = json.optJSONObject("methods");
                
                System.out.println("Template: " + template.substring(0, Math.min(50, template.length())));
                System.out.println("Variables keys: " + (variables != null ? variables.keySet() : "null"));
                System.out.println("Methods keys: " + (methods != null ? methods.keySet() : "null"));

                // Create Velocity Context
                VelocityContext context = new VelocityContext();

                // Track which keys have methods
                Set<String> methodKeys = new HashSet<>();
                if (methods != null) {
                    methodKeys.addAll(methods.keySet());
                }

                // Add variables (but skip those that will be merged with methods)
                if (variables != null) {
                    for (String key : variables.keySet()) {
                        if (!methodKeys.contains(key)) {
                            Object value = parseValue(variables.get(key));
                            // Special handling for HttpServletRequest
                            if (value instanceof Map) {
                                Map<String, Object> map = (Map<String, Object>) value;
                                if (map.containsKey("_httpServletRequest") && map.containsKey("url")) {
                                    String url = (String) map.get("url");
                                    String headers = (String) map.getOrDefault("headers", "");
                                    context.put(key, new MockHttpServletRequest(url, headers));
                                } else {
                                    context.put(key, value);
                                }
                            } else {
                                context.put(key, value);
                            }
                        }
                    }
                }

                // Add method mocks (merge with variables if both exist)
                if (methods != null) {
                    for (String className : methods.keySet()) {
                        JSONObject classMethods = methods.getJSONObject(className);
                        MockObject mockObj = new MockObject();
                        
                        // Add properties from variables if they exist
                        if (variables != null && variables.has(className)) {
                            Object varValue = variables.get(className);
                            if (varValue instanceof JSONObject) {
                                JSONObject props = (JSONObject) varValue;
                                for (String propName : props.keySet()) {
                                    mockObj.addProperty(propName, parseValue(props.get(propName)));
                                }
                            }
                        }
                        
                        // Add methods
                        for (String methodName : classMethods.keySet()) {
                            JSONObject methodDef = classMethods.getJSONObject(methodName);
                            String implementation = methodDef.getString("implementation");
                            mockObj.addMethod(methodName, implementation);
                        }
                        
                        context.put(className, mockObj);
                    }
                }

                // Render template
                StringWriter writer = new StringWriter();
                velocityEngine.evaluate(context, writer, "template", template);

                // Send response
                sendResponse(exchange, 200, writer.toString());

            } catch (Exception e) {
                System.err.println("Error handling render request: " + e.getMessage());
                e.printStackTrace(System.err);
                
                StringWriter sw = new StringWriter();
                PrintWriter pw = new PrintWriter(sw);
                e.printStackTrace(pw);
                
                String errorResponse = String.format(
                    "<html><body><h1>Velocity Error</h1><pre>%s\n\nStack Trace:\n%s</pre></body></html>",
                    e.getMessage(),
                    sw.toString()
                );
                
                try {
                    sendResponse(exchange, 500, errorResponse);
                } catch (IOException ioe) {
                    System.err.println("Error sending error response: " + ioe.getMessage());
                }
            }
        }

        private Object parseValue(Object value) {
            if (value instanceof JSONObject) {
                JSONObject obj = (JSONObject) value;
                Map<String, Object> map = new LinkedHashMap<>();
                for (String key : obj.keySet()) {
                    map.put(key, parseValue(obj.get(key)));
                }
                return map;
            } else if (value instanceof JSONArray) {
                JSONArray arr = (JSONArray) value;
                List<Object> list = new ArrayList<>();
                for (int i = 0; i < arr.length(); i++) {
                    list.add(parseValue(arr.get(i)));
                }
                return list;
            }
            return value;
        }

        private void sendResponse(HttpExchange exchange, int statusCode, String response) throws IOException {
            byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "text/html; charset=UTF-8");
            exchange.sendResponseHeaders(statusCode, bytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(bytes);
            }
        }
    }

    static class HealthHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            String response = String.format(
                "{\"status\":\"ok\",\"version\":\"%s\",\"engine\":\"Apache Velocity\"}",
                VERSION
            );
            byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, bytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(bytes);
            }
        }
    }

    static class ShutdownHandler implements HttpHandler {
        private final HttpServer server;

        ShutdownHandler(HttpServer server) {
            this.server = server;
        }

        @Override
        public void handle(HttpExchange exchange) throws IOException {
            String response = "{\"status\":\"shutting down\"}";
            byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, bytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(bytes);
            }

            // Shutdown server after response
            new Thread(() -> {
                try {
                    Thread.sleep(500);
                    server.stop(0);
                    System.out.println("Server stopped");
                    System.exit(0);
                } catch (InterruptedException e) {
                    e.printStackTrace();
                }
            }).start();
        }
    }

    // Mock object for method implementations using JavaScript
    // Extends HashMap so Velocity can access properties like $user.name
    static class MockObject extends HashMap<String, Object> {
        private final Map<String, String> methods = new HashMap<>();
        private static ScriptEngine scriptEngine = null;
        
        public MockObject() {
            super();
            // Initialize JavaScript engine lazily (thread-safe singleton)
            if (scriptEngine == null) {
                synchronized (MockObject.class) {
                    if (scriptEngine == null) {
                        try {
                            ScriptEngineManager manager = new ScriptEngineManager();
                            scriptEngine = manager.getEngineByName("nashorn");
                            if (scriptEngine == null) {
                                scriptEngine = manager.getEngineByName("js");
                            }
                            if (scriptEngine == null) {
                                System.err.println("Warning: No JavaScript engine found!");
                            }
                        } catch (Exception e) {
                            System.err.println("Error initializing JavaScript engine: " + e.getMessage());
                        }
                    }
                }
            }
        }

        public void addProperty(String name, Object value) {
            System.out.println("Adding property: " + name + " = " + value);
            this.put(name, value);
        }

        public void addMethod(String name, String implementation) {
            System.out.println("Adding method: " + name);
            methods.put(name, implementation);
        }
        
        // Override get to handle method calls
        @Override
        public Object get(Object key) {
            String name = String.valueOf(key);
            
            // First check if it's a regular property
            if (this.containsKey(name)) {
                return super.get(name);
            }
            
            // If it's a method, return a callable wrapper
            if (methods.containsKey(name)) {
                return new MethodWrapper(name, this);
            }
            
            return null;
        }
        
        // Velocity calls methods via reflection - we need to handle them dynamically
        // This is a catch-all method that Velocity can find
        public Object invokeMethod(String name, Object... args) {
            String impl = methods.get(name);
            if (impl == null) {
                return "[Method not mocked: " + name + "]";
            }
            
            try {
                return evalJavaScript(impl, args);
            } catch (Exception e) {
                return "[Mock Error: " + e.getMessage() + "]";
            }
        }
        
        // Velocity-specific method invocation support
        // When Velocity evaluates $user.getEmail(), it looks for a getEmail() method
        // We intercept these using java.lang.reflect.InvocationHandler would be complex
        // Instead, we'll use Velocity's Uberspect mechanism by returning a special object
        
        // Helper: check if a key is a method
        public boolean hasMethod(String name) {
            return methods.containsKey(name);
        }
        
        // Get method names for debugging
        public Set<String> getMethodNames() {
            return methods.keySet();
        }

        private Object evalJavaScript(String code, Object... args) {
            if (scriptEngine == null) {
                return "[JavaScript engine not available]";
            }
            
            try {
                // Create bindings for this evaluation
                Bindings bindings = scriptEngine.createBindings();
                bindings.put("args", args);
                
                // Provide utils object with loadProperties and getProperty methods
                bindings.put("utils", new UtilsHelper());
                
                // Make properties available as 'this' object and as individual variables
                Map<String, Object> thisObject = new HashMap<>();
                for (Map.Entry<String, Object> prop : this.entrySet()) {
                    if (!methods.containsKey(prop.getKey())) {
                        bindings.put(prop.getKey(), prop.getValue());
                        thisObject.put(prop.getKey(), prop.getValue());
                    }
                }
                bindings.put("this", thisObject);
                
                // For Nashorn compatibility: replace const/let with var
                String compatibleCode = code.replaceAll("\\bconst\\b", "var").replaceAll("\\blet\\b", "var");
                
                // Wrap code in an ES5-style function to allow return statements
                String wrappedCode = "(function() { " + compatibleCode + " })()";
                Object result = scriptEngine.eval(wrappedCode, bindings);
                
                return result != null ? result : "";
            } catch (Exception e) {
                System.err.println("JavaScript evaluation error: " + e.getMessage());
                e.printStackTrace(System.err);
                return "[JS Error: " + e.getMessage() + "]";
            }
        }
    }
    
    // Custom Uberspect for handling MockObject method calls
    public static class CustomUberspect extends UberspectImpl {
        
        @Override
        public void init() {
            try {
                super.init();
                System.out.println("CustomUberspect initialized");
            } catch (Exception e) {
                System.err.println("Error initializing CustomUberspect: " + e.getMessage());
                e.printStackTrace(System.err);
            }
        }
        
        @Override
        public VelMethod getMethod(Object obj, String methodName, Object[] args, Info i) {
            try {
                // Debug: Log all method lookups on MockHttpServletRequest
                if (obj instanceof MockHttpServletRequest) {
                    System.out.println("CustomUberspect: Looking up method '" + methodName + "' on MockHttpServletRequest");
                }
                
                // Handle MockObject method calls
                if (obj instanceof MockObject) {
                    MockObject mockObj = (MockObject) obj;
                    if (mockObj.hasMethod(methodName)) {
                        System.out.println("Resolving method: " + methodName + " on MockObject");
                        return new MockVelMethod(methodName, mockObj);
                    }
                }
                
                // Fall back to default behavior
                VelMethod method = super.getMethod(obj, methodName, args, i);
                if (obj instanceof MockHttpServletRequest) {
                    System.out.println("CustomUberspect: Method '" + methodName + "' resolved: " + (method != null));
                }
                return method;
            } catch (Exception e) {
                System.err.println("Error in getMethod for " + methodName + ": " + e.getMessage());
                e.printStackTrace(System.err);
                return null;
            }
        }
    }
    
    // VelMethod implementation for MockObject methods
    static class MockVelMethod implements VelMethod {
        private final String methodName;
        private final MockObject mockObject;
        
        public MockVelMethod(String methodName, MockObject mockObject) {
            this.methodName = methodName;
            this.mockObject = mockObject;
        }
        
        @Override
        public Object invoke(Object o, Object[] params) {
            try {
                return mockObject.invokeMethod(methodName, params);
            } catch (Exception e) {
                System.err.println("Error invoking method " + methodName + ": " + e.getMessage());
                e.printStackTrace(System.err);
                return "[Error: " + e.getMessage() + "]";
            }
        }
        
        @Override
        public boolean isCacheable() {
            return true;
        }
        
        @Override
        public String getMethodName() {
            return methodName;
        }
        
        @Override
        public Class getReturnType() {
            return Object.class;
        }
        
        // Required by VelMethod interface
        @Override
        public java.lang.reflect.Method getMethod() {
            return null;
        }
    }
    
    // Wrapper class that makes methods callable from Velocity
    static class MethodWrapper {
        private final String methodName;
        private final MockObject mockObject;
        
        public MethodWrapper(String methodName, MockObject mockObject) {
            this.methodName = methodName;
            this.mockObject = mockObject;
        }
        
        // When Velocity calls $user.getEmail(), it first gets the MethodWrapper,
        // then calls toString() on it. We override toString to execute the method.
        @Override
        public String toString() {
            Object result = mockObject.invokeMethod(methodName);
            return result != null ? result.toString() : "";
        }
        
        // For method calls with arguments like $user.greet("John")
        // Velocity will try to call invoke() or call()
        public Object invoke(Object... args) {
            return mockObject.invokeMethod(methodName, args);
        }
        
        public Object call(Object... args) {
            return invoke(args);
        }
    }
    
    // Helper class for JavaScript utils object
    public static class UtilsHelper {
        
        // Load properties from a file
        public Map<String, String> loadProperties(String filePath) {
            Map<String, String> props = new HashMap<>();
            Properties properties = new Properties();
            
            try {
                File file = new File(filePath);
                if (!file.exists() || !file.isFile()) {
                    System.err.println("Properties file not found: " + filePath);
                    return props;
                }
                
                try (FileInputStream fis = new FileInputStream(file);
                     InputStreamReader isr = new InputStreamReader(fis, StandardCharsets.UTF_8)) {
                    properties.load(isr);
                }
                
                // Convert Properties to Map<String, String>
                for (String key : properties.stringPropertyNames()) {
                    props.put(key, properties.getProperty(key));
                }
                
                System.out.println("Loaded " + props.size() + " properties from: " + filePath);
            } catch (IOException e) {
                System.err.println("Error loading properties from " + filePath + ": " + e.getMessage());
            }
            
            return props;
        }
        
        // Get a property value with a default
        public String getProperty(Map<String, String> properties, String key, String defaultValue) {
            if (properties == null) {
                return defaultValue;
            }
            return properties.getOrDefault(key, defaultValue);
        }
    }

    // Mock HttpServletRequest for testing templates
    public static class MockHttpServletRequest {
        private final String url;
        private final Map<String, String[]> parameterMap;
        private final Map<String, String> headerMap;
        
        public MockHttpServletRequest(String url, String headers) {
            this.url = url;
            this.parameterMap = new HashMap<>();
            this.headerMap = new HashMap<>();
            
            System.out.println("=== MockHttpServletRequest Debug ===");
            System.out.println("URL: " + url);
            
            // Parse headers
            if (headers != null && !headers.isEmpty()) {
                String[] lines = headers.split("\n");
                for (String line : lines) {
                    int colonIdx = line.indexOf(':');
                    if (colonIdx > 0) {
                        String name = line.substring(0, colonIdx).trim();
                        String value = line.substring(colonIdx + 1).trim();
                        if (!name.isEmpty()) {
                            headerMap.put(name.toLowerCase(), value);
                        }
                    }
                }
            }
            
            // Parse URL and extract query parameters
            if (url != null && url.contains("?")) {
                String query = url.substring(url.indexOf("?") + 1);
                System.out.println("Query string: " + query);
                String[] pairs = query.split("&");
                System.out.println("Number of pairs: " + pairs.length);
                for (String pair : pairs) {
                    int idx = pair.indexOf("=");
                    try {
                        if (idx > 0) {
                            String key = java.net.URLDecoder.decode(pair.substring(0, idx), "UTF-8");
                            String value = java.net.URLDecoder.decode(pair.substring(idx + 1), "UTF-8");
                            System.out.println("  Parameter: " + key + " = " + value);
                            
                            // Support multiple values for same parameter
                            if (parameterMap.containsKey(key)) {
                                String[] existing = parameterMap.get(key);
                                String[] newArray = new String[existing.length + 1];
                                System.arraycopy(existing, 0, newArray, 0, existing.length);
                                newArray[existing.length] = value;
                                parameterMap.put(key, newArray);
                            } else {
                                parameterMap.put(key, new String[]{value});
                            }
                        }
                    } catch (Exception e) {
                        System.err.println("Error parsing parameter: " + pair);
                    }
                }
                System.out.println("Total parameters parsed: " + parameterMap.size());
                for (String key : parameterMap.keySet()) {
                    System.out.println("  " + key + " -> " + String.join(", ", parameterMap.get(key)));
                }
            }
            
            System.out.println("=====================================");
        }
        
        public String getParameter(String name) {
            String[] values = parameterMap.get(name);
            return (values != null && values.length > 0) ? values[0] : null;
        }
        
        public String[] getParameterValues(String name) {
            return parameterMap.get(name);
        }
        
        public Map<String, String[]> getParameterMap() {
            return new HashMap<>(parameterMap);
        }
        
        public String getHeader(String name) {
            if (name == null) {
                return null;
            }
            return headerMap.get(name.toLowerCase());
        }
        
        public Map<String, String> getHeaderMap() {
            return new HashMap<>(headerMap);
        }
        
        public String getQueryString() {
            if (url != null && url.contains("?")) {
                return url.substring(url.indexOf("?") + 1);
            }
            return null;
        }
        
        public String getRequestURI() {
            if (url != null) {
                int idx = url.indexOf("?");
                return idx > 0 ? url.substring(0, idx) : url;
            }
            return null;
        }
        
        public String getRequestURL() {
            return url;
        }
    }
}
