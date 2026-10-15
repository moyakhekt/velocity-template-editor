package com.moyakhekt.vscode.velocity.util;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
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
            var path = Path.of(filePath);
            if (!Files.isRegularFile(path)) {
                logger.warn("Properties file not found: {}", filePath);
                return props;
            }
            
            try (var reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
                properties.load(reader);
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
