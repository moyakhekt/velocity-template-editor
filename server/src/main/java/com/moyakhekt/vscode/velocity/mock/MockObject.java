package com.moyakhekt.vscode.velocity.mock;

import com.moyakhekt.vscode.velocity.util.UtilsHelper;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import org.openjdk.nashorn.api.scripting.NashornScriptEngineFactory;

import javax.script.Bindings;
import javax.script.ScriptEngine;
import java.util.*;

/**
 * Mock object for method implementations using JavaScript.
 * Extends HashMap so Velocity can access properties like $user.name
 */
public class MockObject extends HashMap<String, Object> {
    private static final Logger logger = LogManager.getLogger(MockObject.class);
    private final Map<String, String> methods = new HashMap<>();
    private static volatile ScriptEngine scriptEngine = null;
    
    public MockObject() {
        super();
        // Initialize JavaScript engine lazily (thread-safe singleton)
        if (scriptEngine == null) {
            synchronized (MockObject.class) {
                if (scriptEngine == null) {
                    try {
                        // Sandboxed: mock code comes from context files (possibly from a cloned
                        // repo), so it gets no Java access (no Java.type/Packages, no classes)
                        // beyond the objects bound in evalJavaScript()
                        scriptEngine = new NashornScriptEngineFactory()
                                .getScriptEngine(new String[] { "--no-java" }, MockObject.class.getClassLoader(), className -> false);
                    } catch (Exception e) {
                        logger.error("Error initializing JavaScript engine: {}", e.getMessage(), e);
                    }
                }
            }
        }
    }

    public void addProperty(String name, Object value) {
        logger.debug("Adding property: {} = {}", name, value);
        this.put(name, value);
    }

    public void addMethod(String name, String implementation) {
        logger.debug("Adding method: {}", name);
        methods.put(name, implementation);
    }
    
    @Override
    public Object get(Object key) {
        String name = String.valueOf(key);
        
        // First check if it's a regular property
        if (this.containsKey(name)) {
            return super.get(name);
        }
        
        // If it's a method, return the method name (CustomUberspect will handle the invocation)
        if (methods.containsKey(name)) {
            return "[Method: " + name + "]";
        }
        
        return null;
    }
    
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
    
    public boolean hasMethod(String name) {
        return methods.containsKey(name);
    }
    
    public Set<String> getMethodNames() {
        return methods.keySet();
    }

    @Override
    public boolean equals(Object obj) {
        if (this == obj) return true;
        if (!super.equals(obj)) return false;
        if (!(obj instanceof MockObject other)) return false;
        return Objects.equals(methods, other.methods);
    }

    @Override
    public int hashCode() {
        return Objects.hash(super.hashCode(), methods);
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
            logger.error("JavaScript evaluation error: {}", e.getMessage(), e);
            return "[JS Error: " + e.getMessage() + "]";
        }
    }
}
