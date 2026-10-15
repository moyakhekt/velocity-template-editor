package com.moyakhekt.vscode.velocity.introspection;

import com.moyakhekt.vscode.velocity.mock.MockHttpServletRequest;
import com.moyakhekt.vscode.velocity.mock.MockObject;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.apache.velocity.util.introspection.Info;
import org.apache.velocity.util.introspection.SecureUberspector;
import org.apache.velocity.util.introspection.VelMethod;

/**
 * Custom Uberspect for handling MockObject method calls in Velocity templates.
 * Secure: templates may come from cloned repos, so Velocity's introspector.restrict.*
 * defaults apply (no Class, ClassLoader, Runtime, System, reflection, ...).
 */
public class CustomUberspect extends SecureUberspector {
    private static final Logger logger = LogManager.getLogger(CustomUberspect.class);
    
    @Override
    public void init() {
        try {
            super.init();
            logger.debug("CustomUberspect initialized");
        } catch (Exception e) {
            logger.error("Error initializing CustomUberspect: {}", e.getMessage(), e);
        }
    }
    
    @Override
    public VelMethod getMethod(Object obj, String methodName, Object[] args, Info i) {
        try {
            // Debug: Log all method lookups on MockHttpServletRequest
            if (obj instanceof MockHttpServletRequest) {
                logger.debug("CustomUberspect: Looking up method '{}' on MockHttpServletRequest", methodName);
            }
            
            // Handle MockObject method calls
            if (obj instanceof MockObject mockObj && mockObj.hasMethod(methodName)) {
                logger.debug("Resolving method: {} on MockObject", methodName);
                return new MockVelMethod(methodName, mockObj);
            }
            
            // Fall back to default behavior
            VelMethod method = super.getMethod(obj, methodName, args, i);
            if (obj instanceof MockHttpServletRequest) {
                logger.debug("CustomUberspect: Method '{}' resolved: {}", methodName, (method != null));
            }
            return method;
        } catch (Exception e) {
            logger.error("Error in getMethod for {}: {}", methodName, e.getMessage(), e);
            return null;
        }
    }
}
