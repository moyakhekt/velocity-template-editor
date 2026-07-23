/**
 * Message types for communication between extension and webview.
 * These enable targeted DOM updates instead of full page refreshes.
 */

// =============================================================================
// Extension → Webview Messages (Updates)
// =============================================================================

export type WebviewUpdateMessage =
    | UpdateScenarioMessage
    | UpdateUrlMessage
    | UpdateScenarioVariableMessage
    | UpdateScenarioHeaderMessage
    | AddScenarioHeaderMessage
    | DeleteScenarioHeaderMessage
    | UpdateTemplateHeadersMessage
    | UpdateHttpServletRequestVarMessage
    | UpdateLocaleVarMessage
    | UpdateTemplateMessagesVarMessage
    | UpdateEscapeToolVarMessage
    | UpdateMessagesFilePathMessage
    | AddScenarioMessage
    | DeleteScenarioMessage
    | RenameScenarioMessage
    | UpdateEnvironmentVariableMessage
    | DeleteEnvironmentVariableMessage
    | UpdateEnvironmentMockFunctionMessage
    | DeleteEnvironmentMockFunctionMessage
    | UpdateMethodSourceMessage
    | UpdateVariableSourceMessage;

// ---------------------------------------------------------------------------
// Structured item types for scenario DOM updates
// ---------------------------------------------------------------------------

export interface ScenarioHeaderItem {
    name: string;
    value: string;
    /** 'self' | 'environment' | inherited scenario name */
    source: string;
}

export interface ScenarioVariableItem {
    name: string;
    value: string;
    isJson: boolean;
    /** 'self' or the name of the scenario being inherited from */
    source: string;
    /** Other scenario names that define this variable with source='self' */
    inheritableFrom: string[];
}

export interface UrlSourceOption {
    value: string;
    label: string;
    selected: boolean;
}

export interface UpdateScenarioMessage {
    command: 'updateScenario';
    scenarioName: string;
    url: string;
    urlSource: string;
    urlSourceOptions: UrlSourceOption[];
    headers: ScenarioHeaderItem[];
    variables: ScenarioVariableItem[];
}

export interface UpdateUrlMessage {
    command: 'updateUrl';
    url: string;
    urlSource: string;
}

export interface UpdateScenarioVariableMessage {
    command: 'updateScenarioVariable';
    name: string;
    value: unknown;
    source: 'template' | 'environment';
}

export interface UpdateScenarioHeaderMessage {
    command: 'updateScenarioHeader';
    name: string;
    value: string;
}

export interface AddScenarioHeaderMessage {
    command: 'addScenarioHeader';
    name: string;
    value: string;
}

export interface DeleteScenarioHeaderMessage {
    command: 'deleteScenarioHeader';
    name: string;
}

export interface UpdateTemplateHeadersMessage {
    command: 'updateTemplateHeaders';
    headers: string;
}

export interface UpdateHttpServletRequestVarMessage {
    command: 'updateHttpServletRequestVar';
    variable: string;
}

export interface UpdateLocaleVarMessage {
    command: 'updateLocaleVar';
    variable: string;
}

export interface UpdateTemplateMessagesVarMessage {
    command: 'updateTemplateMessagesVar';
    variable: string;
}

export interface UpdateEscapeToolVarMessage {
    command: 'updateEscapeToolVar';
    variable: string;
}

export interface UpdateMessagesFilePathMessage {
    command: 'updateMessagesFilePath';
    filePath: string;
}

export interface AddScenarioMessage {
    command: 'addScenario';
    scenarioName: string;
    radioButtonHtml: string;
}

export interface DeleteScenarioMessage {
    command: 'deleteScenario';
    scenarioName: string;
    newActiveScenario: string;
}

export interface RenameScenarioMessage {
    command: 'renameScenario';
    oldName: string;
    newName: string;
}

export interface UpdateEnvironmentVariableMessage {
    command: 'updateEnvironmentVariable';
    name: string;
    value: unknown;
}

export interface DeleteEnvironmentVariableMessage {
    command: 'deleteEnvironmentVariable';
    name: string;
}

export interface UpdateEnvironmentMockFunctionMessage {
    command: 'updateEnvironmentMockFunction';
    name: string;
    implementation: string;
}

export interface DeleteEnvironmentMockFunctionMessage {
    command: 'deleteEnvironmentMockFunction';
    name: string;
}

export interface UpdateMethodSourceMessage {
    command: 'updateMethodSource';
    objectName: string;
    methodName: string;
    source: 'template' | 'environment';
}

export interface UpdateVariableSourceMessage {
    command: 'updateVariableSource';
    name: string;
    source: 'template' | 'environment';
}

// =============================================================================
// Webview → Extension Messages (Commands)
// =============================================================================

export type WebviewCommandMessage =
    | SwitchScenarioCommand
    | CreateScenarioCommand
    | DeleteScenarioCommand
    | RenameScenarioCommand
    | SaveScenarioUrlCommand
    | SaveScenarioHeaderCommand
    | SaveScenarioHeaderValueCommand
    | AddScenarioHeaderCommand
    | DeleteScenarioHeaderCommand
    | SaveScenarioVariableCommand
    | DeleteScenarioVariableCommand
    | ChangeUrlSourceCommand
    | SaveTemplateHeadersCommand
    | SaveHttpServletRequestVarCommand
    | ClearHttpServletRequestVarCommand
    | SaveLocaleVarCommand
    | SaveTemplateMessagesVarCommand
    | SaveEscapeToolVarCommand
    | SaveMessagesFilePathCommand
    | SaveEnvironmentVariableCommand
    | DeleteEnvironmentVariableCommand
    | SaveEnvironmentMockFunctionCommand
    | DeleteEnvironmentMockFunctionCommand
    | SetVariableSourceCommand
    | SetMethodSourceCommand
    | LoadEnvironmentContextCommand
    | SaveEnvironmentContextCommand
    | TestCommand
    | ReloadEnvironmentContextCommand
    | ChangeTemplateContextFileCommand
    | ReloadTemplateContextCommand
    | SaveEnvironmentPropertyCommand
    | SaveEnvironmentMethodCommand
    | PromoteToEnvironmentCommand
    | SetPropertySourceCommand
    | SetSourceEnvironmentCommand
    | SetSourceTemplateCommand
    | SaveVariableCommand
    | SavePropertyCommand
    | SaveMethodCommand
    | SaveTemplateUrlCommand
    | DeleteMessagesFileCommand
    | SaveEnvironmentLanguageCommand
    | AddVariableToConfigCommand
    | SaveEnvironmentHeadersCommand
    | SaveEnvironmentHeaderRowCommand
    | SaveNewEnvironmentHeaderCommand
    | DeleteEnvironmentHeaderCommand
    | SaveEnvironmentCspDirectiveRowCommand
    | SaveNewEnvironmentCspDirectiveCommand
    | DeleteEnvironmentCspDirectiveCommand
    | SaveEnvironmentVariableRowCommand
    | SaveNewEnvironmentVariableCommand
    | SaveNewEnvironmentMockFunctionCommand
    | SaveEnvironmentMockFunctionRowCommand
    | RequestVariableInputCommand
    | RequestPropertyInputCommand
    | RequestMethodInputCommand
    | RequestDeleteConfirmCommand
    | SaveNewScenarioCommand
    | SaveMethodMappingCommand
    | SaveNewScenarioHeaderCommand
    | SaveNewScenarioVariableCommand
    | SaveScenarioVariableValueCommand
    | ToggleScenarioVariableJsonCommand
    | ChangeScenarioVariableSourceCommand
    | GetAvailableScenarioVariablesCommand;

export interface SwitchScenarioCommand {
    command: 'switchScenario';
    scenario: string;
}

export interface CreateScenarioCommand {
    command: 'createScenario';
}

export interface DeleteScenarioCommand {
    command: 'deleteScenario';
    name?: string;
    scenario?: string;
}

export interface RenameScenarioCommand {
    command: 'renameScenario';
    oldName: string;
    newName: string;
}

export interface SaveScenarioUrlCommand {
    command: 'saveScenarioUrl';
    url: string;
}

export interface SaveScenarioHeaderCommand {
    command: 'saveScenarioHeader';
    name: string;
    value: string;
}

export interface SaveScenarioHeaderValueCommand {
    command: 'saveScenarioHeaderValue';
    name: string;
    value: string;
}

export interface AddScenarioHeaderCommand {
    command: 'addScenarioHeader';
    name: string;
    value: string;
}

export interface DeleteScenarioHeaderCommand {
    command: 'deleteScenarioHeader';
    name: string;
}

export interface SaveScenarioVariableCommand {
    command: 'saveScenarioVariable';
    name: string;
    value: unknown;
}

export interface DeleteScenarioVariableCommand {
    command: 'deleteScenarioVariable';
    name: string;
}

export interface ChangeUrlSourceCommand {
    command: 'changeUrlSource';
    source: string;
}

export interface SaveTemplateHeadersCommand {
    command: 'saveTemplateHeaders';
    headers: string;
}

export interface SaveHttpServletRequestVarCommand {
    command: 'saveHttpServletRequestVar';
    variable: string;
}

export interface ClearHttpServletRequestVarCommand {
    command: 'clearHttpServletRequestVar';
}

export interface SaveLocaleVarCommand {
    command: 'saveLocaleVar';
    variable: string;
}

export interface SaveTemplateMessagesVarCommand {
    command: 'saveTemplateMessagesVar';
    variable: string;
}

export interface SaveEscapeToolVarCommand {
    command: 'saveEscapeToolVar';
    variable: string;
}

export interface SaveMessagesFilePathCommand {
    command: 'saveMessagesFilePath';
    filePath: string;
}

export interface SaveEnvironmentVariableCommand {
    command: 'saveEnvironmentVariable';
    name: string;
    value: unknown;
}

export interface DeleteEnvironmentVariableCommand {
    command: 'deleteEnvironmentVariable';
    name: string;
}

export interface SaveEnvironmentMockFunctionCommand {
    command: 'saveEnvironmentMockFunction';
    name: string;
    implementation: string;
}

export interface DeleteEnvironmentMockFunctionCommand {
    command: 'deleteEnvironmentMockFunction';
    name: string;
}

export interface SetVariableSourceCommand {
    command: 'setVariableSource';
    name: string;
    source: 'template' | 'environment';
}

export interface SetMethodSourceCommand {
    command: 'setMethodSource';
    objectName: string;
    methodName: string;
    source: 'template' | 'environment';
}

export interface LoadEnvironmentContextCommand {
    command: 'loadEnvironmentContext';
}

export interface SaveEnvironmentContextCommand {
    command: 'saveEnvironmentContext';
}

// ---------------------------------------------------------------------------
// Additional Webview → Extension commands
// ---------------------------------------------------------------------------

export interface TestCommand {
    command: 'test';
    message: string;
}

export interface ReloadEnvironmentContextCommand {
    command: 'reloadEnvironmentContext';
}

export interface ChangeTemplateContextFileCommand {
    command: 'changeTemplateContextFile';
}

export interface ReloadTemplateContextCommand {
    command: 'reloadTemplateContext';
}

export interface SaveEnvironmentPropertyCommand {
    command: 'saveEnvironmentProperty';
    objectName: string;
    propertyName: string;
    value: unknown;
}

export interface SaveEnvironmentMethodCommand {
    command: 'saveEnvironmentMethod';
    objectName: string;
    methodName: string;
    implementation: string;
}

export interface PromoteToEnvironmentCommand {
    command: 'promoteToEnvironment';
    itemType: 'variable' | 'property' | 'method';
    name: string;
    objectName: string;
    propertyName: string;
    methodName: string;
}

export interface SetPropertySourceCommand {
    command: 'setPropertySource';
    source: 'template' | 'environment';
    objectName: string;
    propertyName: string;
}

export interface SetSourceEnvironmentCommand {
    command: 'setSourceEnvironment';
    itemType: 'variable' | 'property' | 'method';
    name: string;
    objectName: string;
    propertyName: string;
    methodName: string;
}

export interface SetSourceTemplateCommand {
    command: 'setSourceTemplate';
    itemType: 'variable' | 'property' | 'method';
    name: string;
    objectName: string;
    propertyName: string;
    methodName: string;
}

export interface SaveVariableCommand {
    command: 'saveVariable';
    name: string;
    value: unknown;
}

export interface SavePropertyCommand {
    command: 'saveProperty';
    objectName: string;
    propertyName: string;
    value: unknown;
}

export interface SaveMethodCommand {
    command: 'saveMethod';
    objectName: string;
    methodName: string;
    implementation: string;
}

export interface SaveTemplateUrlCommand {
    command: 'saveTemplateUrl';
    url: string;
}

export interface DeleteMessagesFileCommand {
    command: 'deleteMessagesFile';
    fileIndex: string;
}

export interface SaveEnvironmentLanguageCommand {
    command: 'saveEnvironmentLanguage';
    language: string;
}

export interface AddVariableToConfigCommand {
    command: 'addVariableToConfig';
    type: 'variable' | 'object';
    name: string;
}

export interface SaveEnvironmentHeadersCommand {
    command: 'saveEnvironmentHeaders';
    headers: Record<string, string>;
}

export interface SaveEnvironmentHeaderRowCommand {
    command: 'saveEnvironmentHeaderRow';
    oldName: string;
    part: 'name' | 'value';
    value: string;
}

export interface SaveNewEnvironmentHeaderCommand {
    command: 'saveNewEnvironmentHeader';
    name: string;
    value: string;
}

export interface DeleteEnvironmentHeaderCommand {
    command: 'deleteEnvironmentHeader';
    name: string;
}

export interface SaveEnvironmentCspDirectiveRowCommand {
    command: 'saveEnvironmentCspDirectiveRow';
    oldName: string;
    part: 'name' | 'value';
    value: string;
}

export interface SaveNewEnvironmentCspDirectiveCommand {
    command: 'saveNewEnvironmentCspDirective';
    name: string;
    value: string;
}

export interface DeleteEnvironmentCspDirectiveCommand {
    command: 'deleteEnvironmentCspDirective';
    name: string;
}

export interface SaveEnvironmentVariableRowCommand {
    command: 'saveEnvironmentVariableRow';
    oldName: string;
    part: 'name' | 'value';
    value: string;
}

export interface SaveNewEnvironmentVariableCommand {
    command: 'saveNewEnvironmentVariable';
    name: string;
    value: string;
}

export interface SaveNewEnvironmentMockFunctionCommand {
    command: 'saveNewEnvironmentMockFunction';
    implementation: string;
}

export interface SaveEnvironmentMockFunctionRowCommand {
    command: 'saveEnvironmentMockFunctionRow';
    oldName: string;
    value: string;
}

export interface RequestVariableInputCommand {
    command: 'requestVariableInput';
    name: string;
    inferredType: string;
}

export interface RequestPropertyInputCommand {
    command: 'requestPropertyInput';
    objectName: string;
    propertyName: string;
    inferredType: string;
}

export interface RequestMethodInputCommand {
    command: 'requestMethodInput';
    objectName: string;
    methodName: string;
    paramCount: number;
}

export interface RequestDeleteConfirmCommand {
    command: 'requestDeleteConfirm';
    message: string;
    type: 'variable' | 'property' | 'method';
    name: string;
    objectName: string;
    propertyName: string;
    methodName: string;
}

export interface SaveNewScenarioCommand {
    command: 'saveNewScenario';
    name: string;
}

export interface SaveMethodMappingCommand {
    command: 'saveMethodMapping';
    method: string;
    mappedTo: string;
}

export interface SaveNewScenarioHeaderCommand {
    command: 'saveNewScenarioHeader';
    name: string;
    value: string;
}

export interface SaveNewScenarioVariableCommand {
    command: 'saveNewScenarioVariable';
    name: string;
    value: string;
    isJson?: boolean;
    source?: string;
}

export interface SaveScenarioVariableValueCommand {
    command: 'saveScenarioVariableValue';
    name: string;
    value: string;
    scenario?: string;
    isJson?: boolean;
}

export interface ToggleScenarioVariableJsonCommand {
    command: 'toggleScenarioVariableJson';
    name: string;
    isJson: boolean;
}

export interface ChangeScenarioVariableSourceCommand {
    command: 'changeScenarioVariableSource';
    name: string;
    source: string;
}

export interface GetAvailableScenarioVariablesCommand {
    command: 'getAvailableScenarioVariables';
}

// =============================================================================
// Runtime type guard for incoming webview → extension messages
// =============================================================================

/**
 * Validates that an incoming postMessage payload is a non-null, non-array
 * object with a non-empty string `command` property.
 *
 * This is the security boundary for all messages received from the webview.
 * Messages that fail this check are malformed and must be rejected before
 * any handler logic runs.
 */
export function isWebviewMessage(
    msg: unknown
): msg is Record<string, unknown> & { command: string } {
    return (
        typeof msg === 'object' &&
        msg !== null &&
        !Array.isArray(msg) &&
        Object.prototype.hasOwnProperty.call(msg, 'command') &&
        typeof (msg as Record<string, unknown>)['command'] === 'string' &&
        (msg as Record<string, unknown>)['command'] !== ''
    );
}
