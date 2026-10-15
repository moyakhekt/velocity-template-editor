package com.moyakhekt.vscode.velocity.util;

public record LocaleHelper(String language) {

    public LocaleHelper {
        language = language != null ? language : "en";
    }

    // Explicit getter keeps Velocity template expressions like $locale.getLanguage() working
    public String getLanguage() {
        return language;
    }

    @Override
    public String toString() {
        return language;
    }
}
