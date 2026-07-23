package com.ktmoyakhe.vscode.velocity.handler;

import com.ktmoyakhe.vscode.velocity.mock.MockHttpServletRequest;
import com.ktmoyakhe.vscode.velocity.mock.MockObject;
import com.ktmoyakhe.vscode.velocity.util.EscapeTool;
import com.ktmoyakhe.vscode.velocity.util.LocaleHelper;
import com.ktmoyakhe.vscode.velocity.util.TemplateMessages;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.apache.velocity.VelocityContext;
import org.apache.velocity.app.VelocityEngine;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.stream.Collectors;

public class RenderHandler implements HttpHandler {
    private static final Logger logger = LogManager.getLogger(RenderHandler.class);
    private static final String TEMPLATE_KEY = "template";
    private final VelocityEngine velocityEngine;

    public RenderHandler(VelocityEngine velocityEngine) {
        this.velocityEngine = velocityEngine;
    }

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        configureCors(exchange);

        if ("OPTIONS".equals(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(204, -1);
            return;
        }

        if (!"POST".equals(exchange.getRequestMethod())) {
            sendResponse(exchange, 405, "Method Not Allowed");
            return;
        }

        try {
            String requestBody = readRequestBody(exchange);
            JSONObject json = new JSONObject(requestBody);
            logRequestDetails(json);

            System.out.println("[DEBUG] Creating VelocityContext...");
            VelocityContext context = createVelocityContext(json);
            System.out.println("[DEBUG] VelocityContext created successfully");
            
            System.out.println("[DEBUG] About to render template...");
            String renderedOutput = renderTemplate(json.getString(TEMPLATE_KEY), context);
            System.out.println("[DEBUG] Template rendered successfully, output length: " + renderedOutput.length());

            System.out.println("[DEBUG] Sending response...");
            sendResponse(exchange, 200, renderedOutput);
            System.out.println("[DEBUG] Response sent successfully");

        } catch (Exception e) {
            System.out.println("[ERROR] Exception in handle(): " + e.getClass().getName() + ": " + e.getMessage());
            e.printStackTrace();
            handleError(exchange, e);
        }
    }

    private void configureCors(HttpExchange exchange) {
        exchange.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
        exchange.getResponseHeaders().add("Access-Control-Allow-Methods", "POST, OPTIONS");
        exchange.getResponseHeaders().add("Access-Control-Allow-Headers", "Content-Type");
    }

    private String readRequestBody(HttpExchange exchange) throws IOException {
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(exchange.getRequestBody(), StandardCharsets.UTF_8))) {
            return reader.lines().collect(Collectors.joining("\n"));
        }
    }

    private void logRequestDetails(JSONObject json) {
        logger.debug("Received render request, body length: {}", json.toString().length());

        if (logger.isDebugEnabled()) {
            String template = json.getString(TEMPLATE_KEY);
            JSONObject variables = json.optJSONObject("variables");
            JSONObject methods = json.optJSONObject("methods");

            logger.debug("Template: {}", template.substring(0, Math.min(50, template.length())));

            logger.debug("Variables keys: {}", (variables != null ? variables.keySet() : "null"));
            logger.debug("Methods keys: {}", (methods != null ? methods.keySet() : "null"));
            logger.debug("Messages Properties Path: {}", json.optString("messagesPropertiesPath", null));
            logger.debug("Language: {}", json.optString("language", "en"));
        }
    }

    private VelocityContext createVelocityContext(JSONObject json) {
        VelocityContext context = new VelocityContext();

        JSONObject variables = json.optJSONObject("variables");
        JSONObject methods = json.optJSONObject("methods");

        Set<String> methodKeys = getMethodKeys(methods);
        addVariablesToContext(context, variables, methodKeys);
        addMethodsToContext(context, methods, variables);
        addUtilityTools(context, json);

        return context;
    }

    private Set<String> getMethodKeys(JSONObject methods) {
        Set<String> methodKeys = new HashSet<>();
        if (methods != null) {
            methodKeys.addAll(methods.keySet());
        }
        return methodKeys;
    }

    private void addVariablesToContext(VelocityContext context, JSONObject variables, Set<String> methodKeys) {
        if (variables == null) {
            System.out.println("[DEBUG] addVariablesToContext: variables is null");
            return;
        }

        System.out.println("[DEBUG] addVariablesToContext: Processing " + variables.keySet().size() + " variables");
        for (String key : variables.keySet()) {
            System.out.println("[DEBUG]   Variable key: " + key + ", isMethod: " + methodKeys.contains(key));
            if (!methodKeys.contains(key)) {
                try {
                    Object value = parseValue(variables.get(key));
                    System.out.println("[DEBUG]   Parsed value type: " + (value != null ? value.getClass().getName() : "null"));
                    Object contextValue = convertToContextValue(value);
                    System.out.println("[DEBUG]   Context value type: " + (contextValue != null ? contextValue.getClass().getName() : "null"));
                    context.put(key, contextValue);
                    System.out.println("[DEBUG]   Successfully added to context: " + key);
                } catch (Exception e) {
                    System.out.println("[ERROR]   Failed to add variable " + key + ": " + e.getMessage());
                    e.printStackTrace();
                }
            } else {
                System.out.println("[DEBUG]   Skipped (is method): " + key);
            }
        }
        System.out.println("[DEBUG] Context keys after adding variables: " + context.getKeys().length);
    }

    private Object convertToContextValue(Object value) {
        if (value instanceof Map) {
            @SuppressWarnings("unchecked")
            Map<String, Object> map = (Map<String, Object>) value;
            if (map.containsKey("_httpServletRequest") && map.containsKey("url")) {
                String url = (String) map.get("url");
                String headers = (String) map.getOrDefault("headers", "");
                return new MockHttpServletRequest(url, headers);
            }
        }
        return value;
    }

    private void addMethodsToContext(VelocityContext context, JSONObject methods, JSONObject variables) {
        if (methods == null) {
            return;
        }

        for (String className : methods.keySet()) {
            JSONObject classMethods = methods.getJSONObject(className);
            MockObject mockObj = createMockObject(className, classMethods, variables);
            context.put(className, mockObj);
        }
    }

    private MockObject createMockObject(String className, JSONObject classMethods, JSONObject variables) {
        MockObject mockObj = new MockObject();

        addPropertiesToMock(mockObj, className, variables);
        addMethodsToMock(mockObj, classMethods);

        return mockObj;
    }

    private void addPropertiesToMock(MockObject mockObj, String className, JSONObject variables) {
        if (variables != null && variables.has(className)) {
            Object varValue = variables.get(className);
            if (varValue instanceof JSONObject) {
                JSONObject props = (JSONObject) varValue;
                for (String propName : props.keySet()) {
                    mockObj.addProperty(propName, parseValue(props.get(propName)));
                }
            }
        }
    }

    private void addMethodsToMock(MockObject mockObj, JSONObject classMethods) {
        for (String methodName : classMethods.keySet()) {
            JSONObject methodDef = classMethods.getJSONObject(methodName);
            String implementation = methodDef.getString("implementation");
            mockObj.addMethod(methodName, implementation);
        }
    }

    private void addUtilityTools(VelocityContext context, JSONObject json) {
        System.out.println("[DEBUG] ========== UTILITY TOOLS SETUP ==========");
        
        // Get variable names
        String templateMessagesVar = json.optString("templateMessagesVar", "templateMessages");
        String localeVar = json.optString("localeVar", "locale");
        String escapeToolVar = json.optString("escapeToolVar", "escape");
        
        System.out.println("[DEBUG] Variable name for messages: $" + templateMessagesVar);
        System.out.println("[DEBUG] Variable name for locale: $" + localeVar);
        System.out.println("[DEBUG] Variable name for escape: $" + escapeToolVar);
        
        // Get message file paths array
        List<String> messageFilePaths = new ArrayList<>();
        if (json.has("messagesPropertiesPaths")) {
            JSONArray pathsArray = json.optJSONArray("messagesPropertiesPaths");
            if (pathsArray != null) {
                for (int i = 0; i < pathsArray.length(); i++) {
                    String path = pathsArray.optString(i);
                    if (path != null && !path.isEmpty()) {
                        messageFilePaths.add(path);
                    }
                }
            }
        }
        
        System.out.println("[DEBUG] Received " + messageFilePaths.size() + " message file path(s)");
        for (int i = 0; i < messageFilePaths.size(); i++) {
            System.out.println("[DEBUG]   File " + (i + 1) + ": " + messageFilePaths.get(i));
        }
        
        if (!messageFilePaths.isEmpty()) {
            System.out.println("[DEBUG] Creating TemplateMessages instance with " + messageFilePaths.size() + " file(s)...");
            TemplateMessages messagesObj = new TemplateMessages(messageFilePaths);
            context.put(templateMessagesVar, messagesObj);
            System.out.println("[DEBUG] Added TemplateMessages to context as: $" + templateMessagesVar);
            System.out.println("[DEBUG] TemplateMessages object: " + messagesObj);
        } else {
            System.out.println("[DEBUG] No message file paths provided, skipping TemplateMessages");
        }

        String language = json.optString("language", "en");
        System.out.println("[DEBUG] Creating locale helper with language: " + language);
        context.put(localeVar, new LocaleHelper(language));
        context.put(escapeToolVar, new EscapeTool());
        
        System.out.println("[DEBUG] Final variable mappings:");
        System.out.println("[DEBUG]   - $" + localeVar + " = LocaleHelper");
        System.out.println("[DEBUG]   - $" + templateMessagesVar + " = TemplateMessages");
        System.out.println("[DEBUG]   - $" + escapeToolVar + " = EscapeTool");
        System.out.println("[DEBUG] ===========================================");
    }

    private String renderTemplate(String template, VelocityContext context) {
        System.out.println("[DEBUG] renderTemplate: About to evaluate template");
        System.out.println("[DEBUG] Template preview: " + template.substring(0, Math.min(200, template.length())));
        System.out.println("[DEBUG] Context keys before evaluation: " + context.getKeys().length);
        
        // Print all context keys and their types
        System.out.println("[DEBUG] Detailed context contents:");
        for (Object key : context.getKeys()) {
            Object value = context.get(key.toString());
            String valueType = value != null ? value.getClass().getName() : "null";
            System.out.println("[DEBUG]   - " + key + " = " + valueType);
            if ("scenarioInfo".equals(key)) {
                System.out.println("[DEBUG]     scenarioInfo details: " + value);
            }
        }
        
        StringWriter writer = new StringWriter();
        try {
            velocityEngine.evaluate(context, writer, TEMPLATE_KEY, template);
            System.out.println("[DEBUG] Template evaluated successfully");
        } catch (Exception e) {
            System.out.println("[ERROR] Template evaluation failed: " + e.getMessage());
            e.printStackTrace();
            throw e;
        }
        return writer.toString();
    }

    private void handleError(HttpExchange exchange, Exception e) {
        logger.error("Error handling render request: {}", e.getMessage(), e);

        StringWriter sw = new StringWriter();
        PrintWriter pw = new PrintWriter(sw);
        e.printStackTrace(pw);

        String errorResponse = String.format(
                "<html><body><h1>Velocity Error</h1><pre>%s%n%nStack Trace:%n%s</pre></body></html>",
                e.getMessage(),
                sw.toString());

        try {
            sendResponse(exchange, 500, errorResponse);
        } catch (IOException ioe) {
            logger.error("Error sending error response: {}", ioe.getMessage(), ioe);
        }
    }

    private void sendResponse(HttpExchange exchange, int statusCode, String response) throws IOException {
        exchange.getResponseHeaders().set("Content-Type", "text/html; charset=UTF-8");
        byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(statusCode, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }

    private Object parseValue(Object value) {
        if (value instanceof org.json.JSONObject) {
            JSONObject obj = (JSONObject) value;
            Map<String, Object> map = new LinkedHashMap<>();
            for (String key : obj.keySet()) {
                map.put(key, parseValue(obj.get(key)));
            }
            return map;
        } else if (value instanceof org.json.JSONArray) {
            org.json.JSONArray arr = (org.json.JSONArray) value;
            List<Object> list = new ArrayList<>();
            for (int i = 0; i < arr.length(); i++) {
                list.add(parseValue(arr.get(i)));
            }
            return list;
        } else if (value == JSONObject.NULL) {
            return null;
        }
        return value;
    }
}
