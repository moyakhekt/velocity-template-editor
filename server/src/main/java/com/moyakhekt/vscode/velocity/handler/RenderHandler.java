package com.moyakhekt.vscode.velocity.handler;

import com.moyakhekt.vscode.velocity.mock.MockHttpServletRequest;
import com.moyakhekt.vscode.velocity.mock.MockObject;
import com.moyakhekt.vscode.velocity.util.EscapeTool;
import com.moyakhekt.vscode.velocity.util.LocaleHelper;
import com.moyakhekt.vscode.velocity.util.TemplateMessages;
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

public class RenderHandler implements HttpHandler {
    private static final Logger logger = LogManager.getLogger(RenderHandler.class);
    private static final String TEMPLATE_KEY = "template";
    private final VelocityEngine velocityEngine;

    public RenderHandler(VelocityEngine velocityEngine) {
        this.velocityEngine = velocityEngine;
    }

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        // No CORS headers: only the extension (not web pages) may call this server
        if (!"POST".equals(exchange.getRequestMethod())) {
            sendResponse(exchange, 405, "Method Not Allowed");
            return;
        }

        try {
            String requestBody = readRequestBody(exchange);
            JSONObject json = new JSONObject(requestBody);
            logRequestDetails(json);

            logger.debug("Creating VelocityContext...");
            VelocityContext context = createVelocityContext(json);
            logger.debug("VelocityContext created successfully");
            
            logger.debug("About to render template...");
            String renderedOutput = renderTemplate(json.getString(TEMPLATE_KEY), context);
            logger.debug("Template rendered successfully, output length: " + renderedOutput.length());

            logger.debug("Sending response...");
            sendResponse(exchange, 200, renderedOutput);
            logger.debug("Response sent successfully");

        } catch (Throwable t) {
            handleError(exchange, t);
        }
    }

    private String readRequestBody(HttpExchange exchange) throws IOException {
        return new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
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
            logger.debug("addVariablesToContext: variables is null");
            return;
        }

        logger.debug("addVariablesToContext: Processing " + variables.keySet().size() + " variables");
        for (String key : variables.keySet()) {
            logger.debug("  Variable key: " + key + ", isMethod: " + methodKeys.contains(key));
            if (!methodKeys.contains(key)) {
                try {
                    Object value = parseValue(variables.get(key));
                    logger.debug("  Parsed value type: " + (value != null ? value.getClass().getName() : "null"));
                    Object contextValue = convertToContextValue(value);
                    logger.debug("  Context value type: " + (contextValue != null ? contextValue.getClass().getName() : "null"));
                    context.put(key, contextValue);
                    logger.debug("  Successfully added to context: " + key);
                } catch (Exception e) {
                    // Skipped so the rest of the template still renders
                    logger.warn("Failed to add variable {}: {}", key, e.getMessage(), e);
                }
            } else {
                logger.debug("  Skipped (is method): " + key);
            }
        }
        logger.debug("Context keys after adding variables: " + context.getKeys().length);
    }

    private Object convertToContextValue(Object value) {
        if (value instanceof Map<?, ?> map
                && map.containsKey("_httpServletRequest")
                && map.get("url") instanceof String url) {
            var headers = map.get("headers") instanceof String h ? h : "";
            return new MockHttpServletRequest(url, headers);
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
        if (variables != null && variables.has(className)
                && variables.get(className) instanceof JSONObject props) {
            for (var propName : props.keySet()) {
                mockObj.addProperty(propName, parseValue(props.get(propName)));
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
        logger.debug("========== UTILITY TOOLS SETUP ==========");
        
        // Get variable names
        String templateMessagesVar = json.optString("templateMessagesVar", "templateMessages");
        String localeVar = json.optString("localeVar", "locale");
        String escapeToolVar = json.optString("escapeToolVar", "escape");
        
        logger.debug("Variable name for messages: $" + templateMessagesVar);
        logger.debug("Variable name for locale: $" + localeVar);
        logger.debug("Variable name for escape: $" + escapeToolVar);
        
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
        
        logger.debug("Received " + messageFilePaths.size() + " message file path(s)");
        for (int i = 0; i < messageFilePaths.size(); i++) {
            logger.debug("  File " + (i + 1) + ": " + messageFilePaths.get(i));
        }
        
        if (!messageFilePaths.isEmpty()) {
            logger.debug("Creating TemplateMessages instance with " + messageFilePaths.size() + " file(s)...");
            TemplateMessages messagesObj = new TemplateMessages(messageFilePaths);
            context.put(templateMessagesVar, messagesObj);
            logger.debug("Added TemplateMessages to context as: $" + templateMessagesVar);
            logger.debug("TemplateMessages object: " + messagesObj);
        } else {
            logger.debug("No message file paths provided, skipping TemplateMessages");
        }

        String language = json.optString("language", "en");
        logger.debug("Creating locale helper with language: " + language);
        context.put(localeVar, new LocaleHelper(language));
        context.put(escapeToolVar, new EscapeTool());
        
        logger.debug("Final variable mappings:");
        logger.debug("  - $" + localeVar + " = LocaleHelper");
        logger.debug("  - $" + templateMessagesVar + " = TemplateMessages");
        logger.debug("  - $" + escapeToolVar + " = EscapeTool");
        logger.debug("===========================================");
    }

    private String renderTemplate(String template, VelocityContext context) throws Throwable {
        logger.debug("renderTemplate: About to evaluate template");
        logger.debug("Template preview: " + template.substring(0, Math.min(200, template.length())));
        logger.debug("Context keys before evaluation: " + context.getKeys().length);
        
        // Print all context keys and their types
        if (logger.isDebugEnabled()) {
            logger.debug("Detailed context contents:");
            for (Object key : context.getKeys()) {
                Object value = context.get(key.toString());
                String valueType = value != null ? value.getClass().getName() : "null";
                logger.debug("  - {} = {}", key, valueType);
                if ("scenarioInfo".equals(key)) {
                    logger.debug("    scenarioInfo details: {}", value);
                }
            }
        }
        
        StringWriter writer = new StringWriter();
        velocityEngine.evaluate(context, writer, TEMPLATE_KEY, template);
        logger.debug("Template evaluated successfully");
        return writer.toString();
    }

    private void handleError(HttpExchange exchange, Throwable t) {
        logger.error("Error handling render request: {}", t.getMessage(), t);

        StringWriter sw = new StringWriter();
        PrintWriter pw = new PrintWriter(sw);
        t.printStackTrace(pw);

        var errorResponse = "<html><body><h1>Velocity Error</h1><pre>%s%n%nStack Trace:%n%s</pre></body></html>"
                .formatted(t.getMessage(), sw);

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
        if (value instanceof JSONObject obj) {
            var map = new LinkedHashMap<String, Object>();
            for (var key : obj.keySet()) {
                map.put(key, parseValue(obj.get(key)));
            }
            return map;
        } else if (value instanceof JSONArray arr) {
            var list = new ArrayList<Object>();
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
