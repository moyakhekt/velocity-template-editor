package com.moyakhekt.vscode.velocity.mock;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

/**
 * Mock HttpServletRequest for testing Velocity templates.
 */
public class MockHttpServletRequest {
    private static final Logger logger = LogManager.getLogger(MockHttpServletRequest.class);
    private final String url;
    private final Map<String, String[]> parameterMap;
    private final Map<String, String> headerMap;
    
    public MockHttpServletRequest(String url, String headers) {
        this.url = url;
        this.parameterMap = new HashMap<>();
        this.headerMap = new HashMap<>();
        
        logger.debug("=== MockHttpServletRequest Debug ===");
        logger.debug("URL: {}", url);
        
        // Parse headers
        if (headers != null && !headers.isEmpty()) {
            var lines = headers.split("\n");
            for (var line : lines) {
                int colonIdx = line.indexOf(':');
                if (colonIdx > 0) {
                    var name = line.substring(0, colonIdx).trim();
                    var value = line.substring(colonIdx + 1).trim();
                    if (!name.isEmpty()) {
                        headerMap.put(name.toLowerCase(), value);
                    }
                }
            }
        }
        
        // Parse URL and extract query parameters
        if (url != null && url.contains("?")) {
            String query = url.substring(url.indexOf("?") + 1);
            logger.debug("Query string: {}", query);
            String[] pairs = query.split("&");
            logger.debug("Number of pairs: {}", pairs.length);
            for (var pair : pairs) {
                int idx = pair.indexOf("=");
                try {
                    if (idx > 0) {
                        var key = URLDecoder.decode(pair.substring(0, idx), StandardCharsets.UTF_8);
                        var value = URLDecoder.decode(pair.substring(idx + 1), StandardCharsets.UTF_8);
                        logger.debug("  Parameter: {} = {}", key, value);
                        
                        // Support multiple values for same parameter
                        var existing = parameterMap.get(key);
                        if (existing != null) {
                            var newArray = Arrays.copyOf(existing, existing.length + 1);
                            newArray[existing.length] = value;
                            parameterMap.put(key, newArray);
                        } else {
                            parameterMap.put(key, new String[]{value});
                        }
                    }
                } catch (Exception e) {
                    logger.warn("Error parsing parameter: {}", pair);
                }
            }
            if (logger.isDebugEnabled()) {
                logger.debug("Total parameters parsed: {}", parameterMap.size());
                for (String key : parameterMap.keySet()) {
                    logger.debug("  {} -> {}", key, String.join(", ", parameterMap.get(key)));
                }
            }
        }
        
        logger.debug("=====================================");
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
