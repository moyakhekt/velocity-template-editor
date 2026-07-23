package com.ktmoyakhe.vscode.velocity.introspection;

import com.ktmoyakhe.vscode.velocity.mock.MockHttpServletRequest;
import com.ktmoyakhe.vscode.velocity.mock.MockObject;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.apache.velocity.util.introspection.Info;
import org.apache.velocity.util.introspection.UberspectImpl;
import org.apache.velocity.util.introspection.VelMethod;

/**
 * Custom Uberspect for handling MockObject method calls in Velocity templates.
 */
public class CustomUberspect extends UberspectImpl {
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
            if (obj instanceof MockObject) {
                MockObject mockObj = (MockObject) obj;
                if (mockObj.hasMethod(methodName)) {
                    logger.debug("Resolving method: {} on MockObject", methodName);
                    return new MockVelMethod(methodName, mockObj);
                }
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
