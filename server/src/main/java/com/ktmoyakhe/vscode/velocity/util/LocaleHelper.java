package com.ktmoyakhe.vscode.velocity.util;

/**
 * LocaleHelper for language information in Velocity templates.
 */
public class LocaleHelper {
    private final String language;
    
    public LocaleHelper(String language) {
        this.language = language != null ? language : "en";
    }
    
    public String getLanguage() {
        return language;
    }
    
    @Override
    public String toString() {
        return language;
    }
}
