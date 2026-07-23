package com.ktmoyakhe.vscode.velocity.util;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.Properties;

/**
 * Helper class for JavaScript utils object that provides file utilities.
 */
public class UtilsHelper {
    private static final Logger logger = LogManager.getLogger(UtilsHelper.class);
    
    public Map<String, String> loadProperties(String filePath) {
        Map<String, String> props = new HashMap<>();
        Properties properties = new Properties();
        
        try {
            File file = new File(filePath);
            if (!file.exists() || !file.isFile()) {
                logger.warn("Properties file not found: {}", filePath);
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
            
            logger.info("Loaded {} properties from: {}", props.size(), filePath);
        } catch (IOException e) {
            logger.error("Error loading properties from {}: {}", filePath, e.getMessage(), e);
        }
        
        return props;
    }
    
    public String getProperty(Map<String, String> properties, String key, String defaultValue) {
        if (properties == null) {
            return defaultValue;
        }
        return properties.getOrDefault(key, defaultValue);
    }
}
