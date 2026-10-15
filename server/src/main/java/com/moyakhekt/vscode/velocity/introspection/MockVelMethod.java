package com.moyakhekt.vscode.velocity.introspection;

import com.moyakhekt.vscode.velocity.mock.MockObject;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.apache.velocity.util.introspection.VelMethod;

public record MockVelMethod(String methodName, MockObject mockObject) implements VelMethod {
    private static final Logger logger = LogManager.getLogger(MockVelMethod.class);

    @Override
    public Object invoke(Object o, Object[] params) {
        try {
            return mockObject.invokeMethod(methodName, params);
        } catch (Exception e) {
            logger.error("Error invoking method {}: {}", methodName, e.getMessage(), e);
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
    public Class<?> getReturnType() {
        return Object.class;
    }

    @Override
    public java.lang.reflect.Method getMethod() {
        return null;
    }
}
