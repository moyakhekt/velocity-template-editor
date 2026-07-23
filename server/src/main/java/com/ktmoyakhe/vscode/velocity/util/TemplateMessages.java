package com.ktmoyakhe.vscode.velocity.util;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;

/**
 * TemplateMessages helper for internationalization in Velocity templates.
 * Supports loading multiple properties files, with later files overriding earlier ones.
 */
public class TemplateMessages {
    private static final Logger logger = LogManager.getLogger(TemplateMessages.class);
    private final Map<String, String> properties;
    private final List<String> propertiesPaths;
    
    public TemplateMessages(List<String> propertiesPaths) {
        logger.info("[TemplateMessages] Creating instance with {} file(s)", propertiesPaths.size());
        this.propertiesPaths = propertiesPaths;
        this.properties = new HashMap<>();
        loadAllProperties();
        logger.info("[TemplateMessages] Instance created with {} total messages loaded", properties.size());
    }
    
    private void loadAllProperties() {
        for (int i = 0; i < propertiesPaths.size(); i++) {
            String propertiesPath = propertiesPaths.get(i);
            logger.info("[TemplateMessages] Loading file {}/{}: {}", i + 1, propertiesPaths.size(), propertiesPath);
            loadPropertiesFromFile(propertiesPath);
        }
    }
    
    private void loadPropertiesFromFile(String propertiesPath) {
        logger.info("[TemplateMessages] Loading properties from: {}", propertiesPath);
        Properties props = new Properties();
        
        try {
            File file = new File(propertiesPath);
            logger.info("[TemplateMessages] File object created, checking existence...");
            logger.info("[TemplateMessages] File exists: {}", file.exists());
            logger.info("[TemplateMessages] Is file: {}", file.isFile());
            logger.info("[TemplateMessages] Absolute path: {}", file.getAbsolutePath());
            logger.info("[TemplateMessages] Can read: {}", file.canRead());
            
            if (!file.exists() || !file.isFile()) {
                logger.warn("[TemplateMessages] Messages properties file not found or not a file: {}", propertiesPath);
                return;
            }
            
            logger.info("[TemplateMessages] Opening file stream...");
            try (FileInputStream fis = new FileInputStream(file);
                 InputStreamReader isr = new InputStreamReader(fis, StandardCharsets.UTF_8)) {
                logger.info("[TemplateMessages] Loading properties...");
                props.load(isr);
                logger.info("[TemplateMessages] Properties loaded, raw count: {}", props.size());
            }
            
            // Convert Properties to Map<String, String> (later files override earlier ones)
            logger.info("[TemplateMessages] Merging {} properties into main map...", props.size());
            int count = 0;
            int newKeys = 0;
            int overriddenKeys = 0;
            
            for (String key : props.stringPropertyNames()) {
                boolean wasPresent = properties.containsKey(key);
                properties.put(key, props.getProperty(key));
                
                if (wasPresent) {
                    overriddenKeys++;
                } else {
                    newKeys++;
                }
                
                count++;
                if (count <= 5) {
                    logger.info("[TemplateMessages] Sample key {}: {} = {}", count, key, props.getProperty(key).substring(0, Math.min(50, props.getProperty(key).length())));
                }
            }
            
            logger.info("[TemplateMessages] Successfully loaded from {}: {} new keys, {} overridden keys", propertiesPath, newKeys, overriddenKeys);
            logger.info("[TemplateMessages] Total messages now: {}", properties.size());
        } catch (IOException e) {
            logger.error("[TemplateMessages] Error loading messages from {}: {}", propertiesPath, e.getMessage(), e);
        }
    }
    
    public String getMessage(String prefix, String suffix, String... params) {
        logger.debug("[TemplateMessages] getMessage(prefix='{}', suffix='{}', params={})", prefix, suffix, params.length);
        
        if (prefix == null) {
            logger.warn("[TemplateMessages] Invalid message key: prefix is null");
            return "[Invalid message key: prefix=null]";
        }

        // Handle null suffix: strip trailing dot from prefix and use as full key
        if (suffix == null) {
            logger.warn("[TemplateMessages] suffix is null, falling back to prefix-only lookup");
            String key = prefix.endsWith(".") ? prefix.substring(0, prefix.length() - 1) : prefix;
            return getMessage(key, params);
        }

        String fullKey = prefix + suffix;
        logger.info("[TemplateMessages] Looking up message with key: '{}'", fullKey);
        logger.info("[TemplateMessages] Total messages available: {}", properties.size());
        
        String message = properties.get(fullKey);
        
        if (message == null) {
            logger.warn("[TemplateMessages] Message not found for key: '{}'", fullKey);
            logger.info("[TemplateMessages] Available keys containing '{}': {}", 
                suffix, properties.keySet().stream()
                    .filter(k -> k.contains(suffix))
                    .limit(10)
                    .toArray());
            return "[Message not found: " + fullKey + "]";
        }
        
        message = substitutePlaceholders(message, params);
        logger.info("[TemplateMessages] Found message for key '{}': '{}'", fullKey, message.substring(0, Math.min(50, message.length())));
        return message;
    }
    
    public String getMessage(String key, String... params) {
        logger.debug("[TemplateMessages] getMessage(key='{}', params={})", key, params.length);
        
        if (key == null) {
            logger.warn("[TemplateMessages] Invalid message key: null");
            return "[Invalid message key: null]";
        }
        
        logger.info("[TemplateMessages] Looking up message with key: '{}'", key);
        logger.info("[TemplateMessages] Total messages available: {}", properties.size());
        
        String message = properties.get(key);
        
        if (message == null) {
            logger.warn("[TemplateMessages] Message not found for key: '{}'", key);
            logger.info("[TemplateMessages] Available keys starting with same prefix: {}", 
                properties.keySet().stream()
                    .filter(k -> k.length() > 3 && key.length() > 3 && k.substring(0, 3).equals(key.substring(0, 3)))
                    .limit(10)
                    .toArray());
            return "[Message not found: " + key + "]";
        }
        
        message = substitutePlaceholders(message, params);
        logger.info("[TemplateMessages] Found message for key '{}': '{}'", key, message.substring(0, Math.min(50, message.length())));
        return message;
    }

    private String substitutePlaceholders(String message, String... params) {
        if (params == null || params.length == 0) {
            return message;
        }
        for (int i = 0; i < params.length; i++) {
            String replacement = params[i] != null ? params[i] : "";
            message = message.replace("{" + i + "}", replacement);
        }
        return message;
    }
}
