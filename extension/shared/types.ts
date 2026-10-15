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
    variableSources?: { [key: string]: string }; // 'self' = own value; absent = inheriting
    variableJsonFlags?: { [key: string]: boolean }; // parse value as JSON
    methods?: MethodsRecord;
    inheritFrom?: string;
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
    // Names of simple variables ever auto-scaffolded into the Default scenario by
    // static analysis of the template. Once a name is in this list it is never
    // auto-added again, even if a developer later deletes it (e.g. to deliberately
    // test the "variable not present" rendering path) — this list is what prevents
    // the scaffolder from re-adding something that was intentionally removed.
    autoScaffoldedVariables?: string[];
    // Same idea, but for HTTP request parameter names appended to the Default
    // scenario's URL query string.
    autoScaffoldedRequestParams?: string[];
}

/**
 * A set of templates that share one template context (scenarios, mappings).
 * Used when templates are customized copies of a default template and should
 * be tested against the same scenarios. Membership here takes precedence over
 * an entry for the same path in `templates`.
 */
export interface TemplateContextGroup extends TemplateContextInEnvironment {
    templates: string[]; // Member template paths, normalized the same way as `templates` keys
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
    templateGroups?: { [groupName: string]: TemplateContextGroup }; // Templates sharing one context
}

