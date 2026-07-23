import * as vscode from "vscode";
import type { ContextData, ContextFileData } from "./contextManager";
import type { EnvironmentContextConfig, ScenariosData, ScenarioData } from "../shared/types";
import type { ScenarioHeaderItem, ScenarioVariableItem, UrlSourceOption } from "../shared/messageTypes";

/**
 * Interface exposing the coordinator (ContextManager) capabilities to all service classes.
 * ContextManager implements this interface and passes `this` to each service constructor.
 */
export interface IContextServices {
  // Readonly state
  readonly outputChannel: vscode.OutputChannel;
  readonly context: vscode.ExtensionContext;
  readonly panel: vscode.WebviewPanel | undefined;
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
  contextData: ContextData,
  allScenarios: ScenariosData = {},
  activeScenarioName: string = "Default",
): ScenarioVariableItem[] {
  const variableSources: Record<string, string> = scenario.variableSources || {};
  const variableJsonFlags: Record<string, boolean> = scenario.variableJsonFlags || {};
  const ownVars: Record<string, unknown> = scenario.variables || {};

  const allVarNames = new Set<string>();
  Object.keys(ownVars).forEach((n) => allVarNames.add(n));
  Object.entries(variableSources).forEach(([n, src]) => {
    if (src !== "self") allVarNames.add(n);
  });
  if (allVarNames.size === 0) {
    Object.keys(contextData).forEach((name) => {
      if (
        !["url", "headers", "scenarios", "activeScenario", "httpServletRequestVar", "localeVar", "templateMessagesVar", "escapeToolVar"].includes(name)
      ) {
        allVarNames.add(name);
      }
    });
  }

  return Array.from(allVarNames).map((name) => {
    const source = variableSources[name] || "self";
    const isSelf = source === "self";
    let value: unknown;
    let isJson: boolean;
    if (isSelf) {
      value = ownVars[name];
      isJson = variableJsonFlags[name] === true;
    } else {
      const srcData = allScenarios[source] ?? { variables: {}, variableJsonFlags: {} };
      value = (srcData.variables ?? {})[name];
      isJson = (srcData.variableJsonFlags ?? {})[name] === true;
    }
    const valueStr =
      typeof value === "string" ? value : value !== undefined ? JSON.stringify(value) : "";

    const inheritableFrom = Object.entries(allScenarios)
      .filter(([sn, sc]) => {
        if (sn === activeScenarioName) return false;
        const scVars = sc.variables || {};
        const scSources = sc.variableSources || {};
        return name in scVars && (scSources[name] === "self" || scSources[name] === undefined);
      })
      .map(([sn]) => sn);

    return { name, value: valueStr, isJson, source, inheritableFrom };
  });
}
