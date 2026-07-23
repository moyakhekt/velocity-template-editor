// Type definitions for Velocity template context

export type VariableData = Record<string, unknown>;

/** A Velocity method mock with a JavaScript implementation body. */
export interface MethodImpl {
    _implementation: string;
}

/** Maps object names to their method mocks: { objectName: { methodName: MethodImpl } } */
export type MethodsRecord = Record<string, Record<string, MethodImpl>>;

/** Interface for the preview provider (avoids circular import from preview.ts). */
export interface IPreviewProvider {
    previewFilePath: string | undefined;
    refresh(doc: import('vscode').TextDocument): void;
}

export interface MethodMock {
    name: string;
    implementation: string;
}

export interface MethodMockData {
    [className: string]: {
        [methodName: string]: MethodMock;
    };
}

export interface ScenarioData {
    url?: string;
    urlSource?: string; // Source for URL: 'self', 'environment', or scenario name
    headers?: string | Record<string, string>; // Legacy string or new object format
    headerSources?: { [key: string]: string }; // Source for each header: 'self', 'environment', or scenario name
    variables: Record<string, unknown>;
    variableSources?: { [key: string]: string }; // Source for each variable: 'self', 'environment', or scenario name
    variableJsonFlags?: { [key: string]: boolean }; // Whether each variable value should be parsed as JSON
    methods?: MethodsRecord; // Scenario-specific method overrides
    inheritFrom?: string; // Name of parent scenario to inherit from
}

export interface ScenariosData {
    [scenarioName: string]: ScenarioData;
}

export interface ContextData {
    httpServletRequestVar?: string;
    localeVar?: string; // Template variable mapped to $locale
    templateMessagesVar?: string; // Template variable mapped to $templateMessages
    methodMappings?: { [methodFullName: string]: string }; // Maps template methods to environment mock function names (e.g., "user.getName" -> "getUserName")
    scenarios: ScenariosData; // Named variable sets
    activeScenario: string; // Currently selected scenario
}

export interface TemplateContextInEnvironment {
    mappedVariables?: {
        httpServletRequestVar?: string;
        localeVar?: string;
        templateMessagesVar?: string;
        escapeToolVar?: string;
    };
    mappedMethods?: { [methodFullName: string]: string }; // Maps template methods to environment mock function names
    scenarios: ScenariosData; // Scenarios for this template
    activeScenario: string; // Currently active scenario for this template
}

export interface EnvironmentContextConfig {
    filePath?: string; // Path to environment context file
    messagesPropertiesPath?: string; // Path to messages.properties file (deprecated, use messagesPropertiesPaths)
    messagesPropertiesPaths?: string[]; // Paths to messages.properties files (supports multiple)
    language?: string; // Language code (e.g., 'en', 'fr')
    headers?: { [key: string]: string }; // Headers as key-value pairs
    cspDirectives?: { [directive: string]: string }; // CSP directives for preview (e.g., 'default-src': "'self'")
    mockFunctions?: { [name: string]: string }; // Environment mock functions (name -> implementation)
    data: Record<string, unknown>; // Other environment context variables
    templates?: { [templatePath: string]: TemplateContextInEnvironment }; // Template-specific context (scenarios, mappings)
}

