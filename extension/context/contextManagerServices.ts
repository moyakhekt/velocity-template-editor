import * as path from "node:path";
import * as vscode from "vscode";
import type { ContextData, ContextFileData } from "./contextManager";
import type { EnvironmentContextConfig, ScenariosData, ScenarioData } from "../shared/types";
import type { ScenarioHeaderItem, ScenarioVariableItem, UrlSourceOption } from "../shared/messageTypes";
import type { ContextItem, InferredType } from "../shared/templateParser";

/**
 * Interface exposing the coordinator (ContextManager) capabilities to all service classes.
 * ContextManager implements this interface and passes `this` to each service constructor.
 */
export interface IContextServices {
  // Readonly state
  readonly outputChannel: vscode.OutputChannel;
  readonly context: vscode.ExtensionContext;
  readonly view: vscode.WebviewView | undefined;
  readonly templateFilePath: string;
  readonly contextCache: Map<string, ContextFileData>;

  // Environment context state
  getEnvironmentContext(): EnvironmentContextConfig;
  setEnvironmentContext(config: EnvironmentContextConfig): void;
  setEnvironmentContextLoaded(loaded: boolean): void;

  // Webview operations
  updateWebview(templatePath: string): Promise<void>;
  postWebviewMessage(message: unknown): void;

  // File / environment operations
  saveEnvironmentContext(): Promise<void>;
  refreshPreviewIfOpen(templatePath: string): void;
  writeContextFile(filePath: string, content: string): Promise<void>;
  ensureEnvironmentContextFile(): Promise<boolean>;

  // Template context operations
  saveTemplateContext(templatePath: string, data: ContextFileData): Promise<void>;
  saveContext(templatePath: string, contextData: ContextData): Promise<void>;
  getTemplateContextFileData(templatePath: string): Promise<ContextFileData>;
  getTemplateOnlyContext(templatePath: string): Promise<ContextData>;
  getContextFilePath(templatePath: string): string | undefined;
  getEmptyContextData(): ContextFileData;
  normalizeTemplatePath(templatePath: string): string;
  findTemplateGroupName(templatePath: string): string | undefined;
  detectHttpServletRequestVariable(templatePath: string): Promise<string | undefined>;
}

// ---------------------------------------------------------------------------
// Pure standalone helpers shared between ScenarioService, TemplateDataService,
// and ContextWebviewRenderer.  No class state required.
// ---------------------------------------------------------------------------

export function getUrlWithSource(
  scenarioName: string,
  fileData: ContextFileData,
): { url: string; urlSource: string } {
  const scenarios = fileData.scenarios || {};
  const scenario = scenarios[scenarioName];

  if (scenario?.url) {
    return { url: scenario.url, urlSource: "Self" };
  }
  if (scenario?.urlSource) {
    const sourceScenario = scenarios[scenario.urlSource];
    if (sourceScenario?.url) {
      return { url: sourceScenario.url, urlSource: scenario.urlSource };
    }
  }
  if (fileData.url && scenarioName === "Default") {
    return { url: fileData.url, urlSource: "Self" };
  }
  return { url: "", urlSource: "Self" };
}

export function getUrlSourceOptionsData(
  currentScenario: string,
  scenarios: ScenariosData,
  fileData: ContextFileData,
): UrlSourceOption[] {
  let { urlSource } = getUrlWithSource(currentScenario, fileData);
  if (!urlSource || urlSource === "") {
    urlSource = "Self";
  }
  if (currentScenario === "Default") {
    return [{ value: "self", label: "Self", selected: true }];
  }
  const opts: UrlSourceOption[] = [
    { value: "self", label: "Self", selected: urlSource === "Self" },
  ];
  for (const scenarioName of Object.keys(scenarios)) {
    if (scenarioName !== currentScenario) {
      opts.push({
        value: scenarioName,
        label: scenarioName,
        selected: urlSource === scenarioName,
      });
    }
  }
  return opts;
}

export function getScenarioHeadersData(
  scenario: ScenarioData,
  legacyHeaders: string,
): ScenarioHeaderItem[] {
  const headers: ScenarioHeaderItem[] = [];
  const headerSources = scenario.headerSources || {};
  if (scenario.headers && typeof scenario.headers === "object") {
    Object.entries(scenario.headers).forEach(([name, value]) => {
      headers.push({ name, value: String(value), source: headerSources[name] || "self" });
    });
  } else if (legacyHeaders) {
    legacyHeaders.split("\n").forEach((line) => {
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        const name = line.substring(0, colonIdx).trim();
        const value = line.substring(colonIdx + 1).trim();
        if (name) {
          headers.push({ name, value, source: "self" });
        }
      }
    });
  }
  return headers;
}

export function getScenarioVariablesData(
  scenario: ScenarioData,
  allScenarios: ScenariosData,
  activeScenarioName: string,
  envData: Record<string, unknown>,
  templateItems: ContextItem[],
  excludeNames: Set<string> = new Set(),
): ScenarioVariableItem[] {
  const isDefault = activeScenarioName === 'Default';
  const variableSources = scenario.variableSources ?? {};
  const ownVars = scenario.variables ?? {};
  const variableJsonFlags = scenario.variableJsonFlags ?? {};

  const defaultScenario = allScenarios['Default'];
  const defaultVars = defaultScenario?.variables ?? {};
  const defaultJsonFlags = defaultScenario?.variableJsonFlags ?? {};

  // Union of all known variable names
  const allVarNames = new Set<string>();
  for (const item of templateItems) {
    if (!excludeNames.has(item.name)) allVarNames.add(item.name);
  }
  if (isDefault) {
    for (const name of Object.keys(envData)) {
      if (!excludeNames.has(name)) allVarNames.add(name);
    }
  } else {
    for (const name of Object.keys(defaultVars)) {
      if (!excludeNames.has(name)) allVarNames.add(name);
    }
  }
  for (const name of Object.keys(ownVars)) {
    if (!excludeNames.has(name)) allVarNames.add(name);
  }
  for (const name of Object.keys(variableSources)) {
    if (!excludeNames.has(name)) allVarNames.add(name);
  }

  return Array.from(allVarNames).sort().map((name): ScenarioVariableItem => {
    // Parent resolution: Default inherits from env; others inherit from Default
    const rawParent: unknown = isDefault ? envData[name] : defaultVars[name];
    const hasParent = rawParent !== undefined;

    // A variable is "overriding" when it has its own value in this scenario
    const isOverride = name in ownVars;

    // JSON flag: auto-true for object-type template items; editable only in Default
    const isObjectType = templateItems.some(i => i.name === name && i.type === 'object');
    let isJson: boolean;
    let isJsonEditable: boolean;
    if (isDefault) {
      isJson = variableJsonFlags[name] !== undefined
        ? variableJsonFlags[name] === true
        : isObjectType;
      isJsonEditable = true;
    } else {
      isJson = defaultJsonFlags[name] !== undefined
        ? defaultJsonFlags[name] === true
        : isObjectType;
      isJsonEditable = false;
    }

    const rawOwn = ownVars[name];
    const ownValue = rawOwn !== undefined
      ? (typeof rawOwn === 'string' ? rawOwn : JSON.stringify(rawOwn))
      : '';
    const parentValue = rawParent !== undefined
      ? (typeof rawParent === 'string' ? rawParent : JSON.stringify(rawParent))
      : '';

    return {
      name,
      ownValue,
      parentValue,
      isJson,
      isOverride,
      hasParent,
      isJsonEditable,
    };
  });
}

/**
 * The values a scenario contributes to a render, by the same rules the Context
 * Manager shows (getScenarioVariablesData):
 * - Default contributes its own values (the environment is merged in separately);
 * - any other scenario starts from Default's values and overrides what it sets itself;
 * - a value is parsed as JSON when Default's JSON flag says so, or, with no flag,
 *   when the template uses it as an object.
 */
export function resolveScenarioValues(
  allScenarios: ScenariosData,
  activeScenarioName: string,
  templateItems: ContextItem[],
): Record<string, unknown> {
  const defaultScenario = allScenarios['Default'];
  const activeScenario = allScenarios[activeScenarioName];
  const isDefault = activeScenarioName === 'Default';
  const jsonFlags = defaultScenario?.variableJsonFlags ?? {};
  const objectNames = new Set(templateItems.filter(i => i.type === 'object').map(i => i.name));

  const raw: Record<string, unknown> = {
    ...(isDefault ? {} : defaultScenario?.variables ?? {}),
    ...(activeScenario?.variables ?? {}),
  };

  const values: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(raw)) {
    const isJson = jsonFlags[name] !== undefined ? jsonFlags[name] === true : objectNames.has(name);
    if (isJson && typeof value === 'string') {
      try {
        values[name] = JSON.parse(value);
        continue;
      } catch {
        // Not valid JSON: render the text as typed
      }
    }
    values[name] = value;
  }
  return values;
}

/**
 * Turns a template's method mappings ("object.method" -> mock function name) into
 * method mocks on the render context. A mapping applies when the object has no
 * value or is a plain object (its properties are kept); a list or other value keeps
 * its real methods, e.g. a JSON array's size().
 */
export function applyMethodMappings(
  context: Record<string, unknown>,
  methodMappings: Record<string, string> | undefined,
  mockFunctions: Record<string, string> | undefined,
): void {
  for (const [fullName, functionName] of Object.entries(methodMappings ?? {})) {
    const implementation = functionName ? mockFunctions?.[functionName] : undefined;
    const dot = fullName.indexOf('.');
    if (implementation === undefined || dot <= 0 || dot === fullName.length - 1) {
      continue;
    }
    const objectName = fullName.slice(0, dot);
    const methodName = fullName.slice(dot + 1);
    const existing = context[objectName];
    if (existing !== undefined && (typeof existing !== 'object' || existing === null || Array.isArray(existing))) {
      continue;
    }
    context[objectName] = {
      ...(existing as Record<string, unknown> | undefined),
      [methodName]: { _implementation: implementation },
    };
  }
}

/**
 * Compares two template paths as stored in the environment context file
 * (slash direction ignored; case-insensitive on Windows).
 */
export function isSameTemplatePath(a: string, b: string): boolean {
  const normalize = (p: string) => {
    const slashes = p.replace(/\\/g, "/");
    return process.platform === "win32" ? slashes.toLowerCase() : slashes;
  };
  return normalize(a) === normalize(b);
}

/**
 * Absolute path for a template path as stored in the environment context file
 * (relative paths are relative to the first workspace folder).
 */
export function resolveTemplatePath(storedPath: string): string {
  if (path.isAbsolute(storedPath)) {
    return storedPath;
  }
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return workspaceRoot ? path.join(workspaceRoot, storedPath) : storedPath;
}

// ---------------------------------------------------------------------------
// Helpers for auto-scaffolding starter context values from static analysis.
// ---------------------------------------------------------------------------

/**
 * Names of query parameters already present in a URL's query string (if any).
 */
export function extractQueryParamNames(url: string | undefined): string[] {
  const trimmed = (url || "").trim();
  const queryStart = trimmed.indexOf("?");
  if (queryStart === -1) {
    return [];
  }
  const query = trimmed.slice(queryStart + 1);
  return query
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      try {
        return decodeURIComponent(pair.split("=")[0] || "");
      } catch {
        return pair.split("=")[0] || "";
      }
    })
    .filter(Boolean);
}

/**
 * Append query parameters to a URL's query string, skipping any name that's
 * already present (either already in the query string, or already scaffolded
 * before). Preserves everything else about the URL untouched. If url is empty,
 * produces a bare "?name=value&..." string as a starter — the developer still
 * needs to fill in the actual scheme/host/path.
 */
export function appendQueryParams(
  url: string | undefined,
  params: { name: string; value: string }[],
): string {
  if (params.length === 0) {
    return url || "";
  }
  const trimmed = (url || "").trim();
  const queryStart = trimmed.indexOf("?");
  const base = queryStart === -1 ? trimmed : trimmed.slice(0, queryStart);
  const existingQuery = queryStart === -1 ? "" : trimmed.slice(queryStart + 1);
  const existingNames = new Set(extractQueryParamNames(trimmed));

  const additions = params
    .filter((p) => p.name && !existingNames.has(p.name))
    .map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.value)}`);

  if (additions.length === 0) {
    return trimmed;
  }

  const newQuery = [existingQuery, ...additions].filter(Boolean).join("&");
  return `${base}?${newQuery}`;
}

/**
 * A generic, type-based starter value for a variable the scaffolder has never
 * seen before. isJson controls whether the stored string gets JSON.parse'd back
 * into a real type before rendering (see getScenarioVariables) — this matters
 * for booleans and numbers specifically, since Velocity's #if treats any non-null
 * *string* (including the literal string "false") as truthy. Without the JSON
 * flag, a "false" placeholder would silently render the true branch.
 */
export function genericPlaceholderFor(type: InferredType | undefined): { value: string; isJson: boolean } {
  switch (type) {
    case "boolean":
      return { value: "false", isJson: true };
    case "number":
      return { value: "0", isJson: true };
    case "url":
      return { value: "https://example.com", isJson: false };
    case "string":
    case "unknown":
    default:
      return { value: "", isJson: false };
  }
}
