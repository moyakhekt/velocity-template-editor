package com.moyakhekt.vscode.velocity.util;

import org.apache.commons.text.StringEscapeUtils;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * EscapeTool for escaping strings in various formats for Velocity templates.
 * Provides methods compatible with Apache Velocity Tools EscapeTool.
 */
public class EscapeTool {
    
    /**
     * HTML escape (default method)
     */
    public String escape(String input) {
        return html(input);
    }
    
    /**
     * HTML4 escape
     */
    public String html(String input) {
        if (input == null) {
            return null;
        }
        return StringEscapeUtils.escapeHtml4(input);
    }
    
    /**
     * JavaScript/ECMAScript escape
     */
    public String forJavaScript(String input) {
        return javascript(input);
    }
    
    /**
     * JavaScript/ECMAScript escape (alias)
     */
    public String javascript(String input) {
        if (input == null) {
            return null;
        }
        return StringEscapeUtils.escapeEcmaScript(input);
    }
    
    /**
     * XML escape
     */
    public String xml(String input) {
        if (input == null) {
            return null;
        }
        return StringEscapeUtils.escapeXml11(input);
    }
    
    /**
     * URL encode (UTF-8)
     */
    public String url(String input) {
        if (input == null) {
            return null;
        }
        return URLEncoder.encode(input, StandardCharsets.UTF_8);
    }
    
    /**
     * CSV escape
     */
    public String csv(String input) {
        if (input == null) {
            return null;
        }
        return StringEscapeUtils.escapeCsv(input);
    }
    
    /**
     * Java string escape
     */
    public String java(String input) {
        if (input == null) {
            return null;
        }
        return StringEscapeUtils.escapeJava(input);
    }
    
    @Override
    public String toString() {
        return "EscapeTool";
    }
}
