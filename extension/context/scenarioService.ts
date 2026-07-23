import * as fs from "node:fs";
import * as vscode from "vscode";
import {
  IContextServices,
  getUrlWithSource,
  getScenarioHeadersData,
  getScenarioVariablesData,
  getUrlSourceOptionsData,
} from "./contextManagerServices";
import { ContextData } from "./contextManager";
import { TemplateParser } from "../shared/templateParser";
import {
  SwitchScenarioCommand,
  SaveNewScenarioCommand,
  DeleteScenarioCommand,
  RenameScenarioCommand,
  SaveMethodMappingCommand,
  SaveScenarioHeaderValueCommand,
  SaveNewScenarioHeaderCommand,
  DeleteScenarioHeaderCommand,
  DeleteScenarioVariableCommand,
  SaveNewScenarioVariableCommand,
  SaveScenarioVariableValueCommand,
  ToggleScenarioVariableJsonCommand,
  ChangeScenarioVariableSourceCommand,
} from "../shared/messageTypes";

export class ScenarioService {
  constructor(private readonly deps: IContextServices) {}

  async handleSwitchScenario(
    message: SwitchScenarioCommand,
    currentTemplatePath: string,
  ): Promise<void> {
    const fileData = await this.deps.getTemplateContextFileData(currentTemplatePath);
    fileData.activeScenario = message.scenario;

    await this.deps.saveTemplateContext(currentTemplatePath, fileData);

    const scenarios = fileData.scenarios || { Default: { variables: {} } };
    const activeScenario = scenarios[message.scenario] || { variables: {} };
    const contextData = await this.deps.getTemplateOnlyContext(currentTemplatePath);

    const { url, urlSource } = getUrlWithSource(message.scenario, fileData);

    const headersData = getScenarioHeadersData(activeScenario, fileData.headers || "");
    const variablesData = getScenarioVariablesData(
      activeScenario,
      contextData,
      scenarios,
      message.scenario,
    );

    const urlSourceOptionsData = getUrlSourceOptionsData(
      message.scenario,
      fileData.scenarios || {},
      fileData,
    );

    this.deps.postWebviewMessage({
      command: "updateScenario",
      scenarioName: message.scenario,
      url: url,
      urlSource: urlSource,
      urlSourceOptions: urlSourceOptionsData,
      headers: headersData,
      variables: variablesData,
    });

    this.deps.refreshPreviewIfOpen(currentTemplatePath);
    vscode.window.setStatusBarMessage(
      `$(check) Switched to scenario: ${message.scenario}`,
      3000,
    );
  }

  async handleCreateScenario(currentTemplatePath: string): Promise<void> {
    const newScenarioName = await vscode.window.showInputBox({
      prompt: "Enter scenario name",
      placeHolder: "e.g., Incorrect Creds, Account Locked",
      validateInput: async (value) => {
        if (!value) return "Scenario name cannot be empty";
        const fileData = await this.deps.getTemplateContextFileData(currentTemplatePath);
        if (fileData.scenarios?.[value]) {
          return "Scenario already exists";
        }
        return null;
      },
    });
    if (newScenarioName) {
      const fileData = await this.deps.getTemplateContextFileData(currentTemplatePath);
      if (!fileData.scenarios) {
        fileData.scenarios = { Default: { variables: {} } };
      }
      fileData.scenarios[newScenarioName] = { variables: {} };
      fileData.activeScenario = newScenarioName;
      const contextFilePath = this.deps.getContextFilePath(currentTemplatePath);
      if (contextFilePath) {
        await this.deps.writeContextFile(contextFilePath, JSON.stringify(fileData, null, 2));
        this.deps.contextCache.set(contextFilePath, fileData);
      }
      void this.deps.updateWebview(currentTemplatePath);
      this.deps.refreshPreviewIfOpen(currentTemplatePath);
      vscode.window.setStatusBarMessage(`$(check) Created scenario: ${newScenarioName}`, 3000);
    }
  }

  async handleSaveNewScenario(
    message: SaveNewScenarioCommand,
    currentTemplatePath: string,
  ): Promise<void> {
    const { name } = message;
    if (!name || !name.trim()) {
      vscode.window.showErrorMessage("Scenario name cannot be empty");
      return;
    }

    const fileData = await this.deps.getTemplateContextFileData(currentTemplatePath);
    if (!fileData.scenarios) {
      fileData.scenarios = { Default: { variables: {} } };
    }
    if (fileData.scenarios[name]) {
      vscode.window.showErrorMessage(`Scenario "${name}" already exists`);
      return;
    }

    fileData.scenarios[name] = { variables: {} };
    fileData.activeScenario = name;

    await this.deps.saveTemplateContext(currentTemplatePath, fileData);
    void this.deps.updateWebview(currentTemplatePath);
    vscode.window.setStatusBarMessage(`$(check) Created scenario: ${name}`, 3000);
  }

  async handleDeleteScenario(
    message: DeleteScenarioCommand,
    currentTemplatePath: string,
  ): Promise<void> {
    const scenarioName = message.scenario || message.name;
    if (!scenarioName) return;

    if (scenarioName === "Default") {
      vscode.window.showWarningMessage("Cannot delete the Default scenario");
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Delete scenario "${scenarioName}"?`,
      { modal: true },
      "Delete",
    );
    if (confirm === "Delete") {
      const fileData = await this.deps.getTemplateContextFileData(currentTemplatePath);
      if (fileData.scenarios) {
        delete fileData.scenarios[scenarioName];
        if (fileData.activeScenario === scenarioName) {
          fileData.activeScenario = "Default";
        }
      }
      await this.deps.saveTemplateContext(currentTemplatePath, fileData);
      void this.deps.updateWebview(currentTemplatePath);
      this.deps.refreshPreviewIfOpen(currentTemplatePath);
      vscode.window.setStatusBarMessage(`$(check) Deleted scenario: ${scenarioName}`, 3000);
    }
  }

  async handleRenameScenario(
    message: RenameScenarioCommand,
    currentTemplatePath: string,
  ): Promise<void> {
    const oldName = message.oldName;
    const newName = message.newName;

    if (!oldName || !newName) {
      vscode.window.showErrorMessage("Invalid scenario names");
      return;
    }
    if (oldName === "Default") {
      vscode.window.showWarningMessage("Cannot rename the Default scenario");
      void this.deps.updateWebview(currentTemplatePath);
      return;
    }
    if (oldName === newName) return;

    const fileData = await this.deps.getTemplateContextFileData(currentTemplatePath);
    if (fileData.scenarios && fileData.scenarios[newName]) {
      vscode.window.showErrorMessage(`A scenario named "${newName}" already exists`);
      void this.deps.updateWebview(currentTemplatePath);
      return;
    }
    if (!fileData.scenarios || !fileData.scenarios[oldName]) {
      vscode.window.showErrorMessage(`Scenario "${oldName}" not found`);
      void this.deps.updateWebview(currentTemplatePath);
      return;
    }

    fileData.scenarios[newName] = fileData.scenarios[oldName];
    delete fileData.scenarios[oldName];

    if (fileData.activeScenario === oldName) {
      fileData.activeScenario = newName;
    }

    Object.keys(fileData.scenarios).forEach((scenarioKey) => {
      const scenario = fileData.scenarios![scenarioKey];
      if (scenario.urlSource === oldName) {
        scenario.urlSource = newName;
      }
    });

    await this.deps.saveTemplateContext(currentTemplatePath, fileData);
    void this.deps.updateWebview(currentTemplatePath);
    this.deps.refreshPreviewIfOpen(currentTemplatePath);
    vscode.window.setStatusBarMessage(
      `$(check) Renamed scenario: ${oldName} → ${newName}`,
      3000,
    );
  }

  async handleSaveMethodMapping(
    message: SaveMethodMappingCommand,
    contextData: ContextData,
    currentTemplatePath: string,
  ): Promise<void> {
    const methodName = message.method;
    const mappedTo = message.mappedTo || "";

    if (!contextData.methodMappings) {
      contextData.methodMappings = {};
    }

    if (mappedTo) {
      (contextData.methodMappings as Record<string, string>)[methodName] = mappedTo;
    } else {
      delete (contextData.methodMappings as Record<string, string>)[methodName];
    }

    await this.deps.saveContext(currentTemplatePath, contextData);
    void this.deps.updateWebview(currentTemplatePath);
    this.deps.refreshPreviewIfOpen(currentTemplatePath);

    const statusMessage = mappedTo
      ? `$(check) Mapped ${methodName} to ${mappedTo}`
      : `$(check) Unmapped ${methodName}`;
    vscode.window.setStatusBarMessage(statusMessage, 3000);
  }

  async handleSaveScenarioHeaderValue(
    message: SaveScenarioHeaderValueCommand,
    currentTemplatePath: string,
  ): Promise<void> {
    const fileData = await this.deps.getTemplateContextFileData(currentTemplatePath);
    const activeScenario = fileData.activeScenario || "Default";
    const scenario = fileData.scenarios?.[activeScenario];
    if (!scenario) return;

    if (!scenario.headers || typeof scenario.headers !== "object") {
      scenario.headers = {};
    }
    scenario.headers[message.name] = message.value;

    await this.deps.saveTemplateContext(currentTemplatePath, fileData);
    void this.deps.updateWebview(currentTemplatePath);
    this.deps.refreshPreviewIfOpen(currentTemplatePath);
    vscode.window.setStatusBarMessage(`$(check) Header "${message.name}" updated`, 3000);
  }

  async handleSaveNewScenarioHeader(
    message: SaveNewScenarioHeaderCommand,
    currentTemplatePath: string,
  ): Promise<void> {
    const { name, value } = message;
    if (!name || !name.trim()) {
      vscode.window.showErrorMessage("Header name cannot be empty");
      return;
    }

    const fileData = await this.deps.getTemplateContextFileData(currentTemplatePath);
    const activeScenario = fileData.activeScenario || "Default";

    if (!fileData.scenarios) fileData.scenarios = { Default: { variables: {} } };
    if (!fileData.scenarios[activeScenario]) fileData.scenarios[activeScenario] = { variables: {} };
    if (!fileData.scenarios[activeScenario].headers) fileData.scenarios[activeScenario].headers = {};

    const headers = fileData.scenarios[activeScenario].headers;
    if (typeof headers === "string") {
      vscode.window.showErrorMessage("Cannot add header to legacy string format headers");
      return;
    }
    if (headers[name]) {
      vscode.window.showErrorMessage(`Header "${name}" already exists`);
      return;
    }

    headers[name] = value;
    await this.deps.saveTemplateContext(currentTemplatePath, fileData);
    void this.deps.updateWebview(currentTemplatePath);
    this.deps.refreshPreviewIfOpen(currentTemplatePath);
    vscode.window.setStatusBarMessage(`$(check) Added header: ${name}`, 3000);
  }

  async handleDeleteScenarioHeader(
    message: DeleteScenarioHeaderCommand,
    currentTemplatePath: string,
  ): Promise<void> {
    const { name } = message;
    const fileData = await this.deps.getTemplateContextFileData(currentTemplatePath);
    const activeScenario = fileData.activeScenario || "Default";

    const headers = fileData.scenarios?.[activeScenario]?.headers;
    if (headers && typeof headers === "object") {
      delete headers[name];
      if (fileData.scenarios[activeScenario].headerSources?.[name]) {
        delete fileData.scenarios[activeScenario].headerSources[name];
      }
      await this.deps.saveTemplateContext(currentTemplatePath, fileData);
      void this.deps.updateWebview(currentTemplatePath);
      this.deps.refreshPreviewIfOpen(currentTemplatePath);
      vscode.window.setStatusBarMessage(`$(check) Deleted header: ${name}`, 3000);
    }
  }

  async handleDeleteScenarioVariable(
    message: DeleteScenarioVariableCommand,
    currentTemplatePath: string,
  ): Promise<void> {
    const { name } = message;
    const fileData = await this.deps.getTemplateContextFileData(currentTemplatePath);
    const activeScenario = fileData.activeScenario || "Default";

    if (!fileData.scenarios?.[activeScenario]?.variables?.[name]) {
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Delete variable "${name}" from scenario "${activeScenario}"?`,
      { modal: true },
      "Delete",
    );

    if (confirm === "Delete") {
      delete fileData.scenarios[activeScenario].variables[name];
      
      // Also clean up metadata
      if (fileData.scenarios[activeScenario].variableSources?.[name]) {
        delete fileData.scenarios[activeScenario].variableSources[name];
      }
      if (fileData.scenarios[activeScenario].variableJsonFlags?.[name]) {
        delete fileData.scenarios[activeScenario].variableJsonFlags[name];
      }

      await this.deps.saveTemplateContext(currentTemplatePath, fileData);
      
      // Send targeted DOM update instead of full refresh
      this.deps.postWebviewMessage({
        command: 'deleteScenarioVariable',
        name: name
      });
      
      this.deps.refreshPreviewIfOpen(currentTemplatePath);
      vscode.window.setStatusBarMessage(`$(check) Deleted variable: ${name}`, 3000);
    }
  }

  async handleSaveNewScenarioVariable(
    message: SaveNewScenarioVariableCommand,
    currentTemplatePath: string,
  ): Promise<void> {
    const { name, value, isJson, source } = message;

    if (!name || !name.trim()) {
      this.deps.postWebviewMessage({ command: "showRowError", message: "Variable name cannot be empty" });
      return;
    }

    const fileData = await this.deps.getTemplateContextFileData(currentTemplatePath);
    const activeScenario = fileData.activeScenario || "Default";

    if (!fileData.scenarios) fileData.scenarios = { Default: { variables: {} } };
    if (!fileData.scenarios[activeScenario]) fileData.scenarios[activeScenario] = { variables: {} };
    if (!fileData.scenarios[activeScenario].variables) fileData.scenarios[activeScenario].variables = {};

    const variables = fileData.scenarios[activeScenario].variables;
    const existingSources = fileData.scenarios[activeScenario].variableSources || {};
    if (variables![name] || existingSources[name]) {
      this.deps.postWebviewMessage({
        command: "showRowError",
        message: `Variable "${name}" already exists in this scenario`,
      });
      return;
    }

    if (!fileData.scenarios[activeScenario].variableSources) fileData.scenarios[activeScenario].variableSources = {};
    if (!fileData.scenarios[activeScenario].variableJsonFlags) fileData.scenarios[activeScenario].variableJsonFlags = {};

    if (source && source !== "self") {
      fileData.scenarios[activeScenario].variableSources![name] = source;
    } else {
      const cleanValue = typeof value === "string" ? value : String(value);
      variables![name] = cleanValue;
      fileData.scenarios[activeScenario].variableSources![name] = "self";
      fileData.scenarios[activeScenario].variableJsonFlags![name] = !!isJson;
    }

    await this.deps.saveTemplateContext(currentTemplatePath, fileData);
    void this.deps.updateWebview(currentTemplatePath);
    this.deps.refreshPreviewIfOpen(currentTemplatePath);
    vscode.window.setStatusBarMessage(`$(check) Added variable: ${name}`, 3000);
  }

  async handleSaveScenarioVariableValue(
    message: SaveScenarioVariableValueCommand,
    currentTemplatePath: string,
  ): Promise<void> {
    const { name, value, scenario, isJson } = message;
    if (!name) return;

    const fileData = await this.deps.getTemplateContextFileData(currentTemplatePath);
    const targetScenario = scenario || fileData.activeScenario || "Default";

    if (!fileData.scenarios || !fileData.scenarios[targetScenario]) return;
    if (!fileData.scenarios[targetScenario].variables) fileData.scenarios[targetScenario].variables = {};

    const cleanValue = typeof value === "string" ? value : String(value);
    fileData.scenarios[targetScenario].variables[name] = cleanValue;

    if (isJson !== undefined) {
      if (!fileData.scenarios[targetScenario].variableJsonFlags) fileData.scenarios[targetScenario].variableJsonFlags = {};
      fileData.scenarios[targetScenario].variableJsonFlags![name] = !!isJson;
    }

    await this.deps.saveTemplateContext(currentTemplatePath, fileData);
    void this.deps.updateWebview(currentTemplatePath);
    this.deps.refreshPreviewIfOpen(currentTemplatePath);
    vscode.window.setStatusBarMessage(`$(check) Updated variable: ${name}`, 3000);
  }

  async handleToggleScenarioVariableJson(
    message: ToggleScenarioVariableJsonCommand,
    currentTemplatePath: string,
  ): Promise<void> {
    const { name, isJson } = message;
    if (!name) return;

    const fileData = await this.deps.getTemplateContextFileData(currentTemplatePath);
    const activeScenario = fileData.activeScenario || "Default";
    if (!fileData.scenarios?.[activeScenario]) return;

    if (!fileData.scenarios[activeScenario].variableJsonFlags) fileData.scenarios[activeScenario].variableJsonFlags = {};
    fileData.scenarios[activeScenario].variableJsonFlags![name] = !!isJson;

    await this.deps.saveTemplateContext(currentTemplatePath, fileData);
    this.deps.refreshPreviewIfOpen(currentTemplatePath);
    vscode.window.setStatusBarMessage(
      `$(check) Variable $${name} JSON parsing: ${isJson ? "on" : "off"}`,
      2000,
    );
  }

  async handleChangeScenarioVariableSource(
    message: ChangeScenarioVariableSourceCommand,
    currentTemplatePath: string,
  ): Promise<void> {
    const { name, source } = message;
    if (!name) return;

    const fileData = await this.deps.getTemplateContextFileData(currentTemplatePath);
    const activeScenarioName = fileData.activeScenario || "Default";
    const activeScenario = fileData.scenarios?.[activeScenarioName] as any;
    if (!activeScenario) return;

    if (!activeScenario.variableSources) activeScenario.variableSources = {};
    if (!activeScenario.variables) activeScenario.variables = {};
    if (!activeScenario.variableJsonFlags) activeScenario.variableJsonFlags = {};

    if (source === "self") {
      const currentSrc = activeScenario.variableSources[name];
      if (currentSrc && currentSrc !== "self") {
        const srcScenario = fileData.scenarios?.[currentSrc] as any;
        if (srcScenario) {
          const inheritedValue = (srcScenario.variables || {})[name];
          if (inheritedValue !== undefined) activeScenario.variables[name] = inheritedValue;
          const inheritedJson = (srcScenario.variableJsonFlags || {})[name];
          if (inheritedJson !== undefined) activeScenario.variableJsonFlags[name] = inheritedJson;
        }
      }
      activeScenario.variableSources[name] = "self";
    } else {
      delete activeScenario.variables[name];
      delete activeScenario.variableJsonFlags[name];
      activeScenario.variableSources[name] = source;
    }

    await this.deps.saveTemplateContext(currentTemplatePath, fileData);
    void this.deps.updateWebview(currentTemplatePath);
    this.deps.refreshPreviewIfOpen(currentTemplatePath);
    vscode.window.setStatusBarMessage(
      `$(check) Variable $${name} source: ${source === "self" ? "Self" : source}`,
      2000,
    );
  }

  async handleGetAvailableScenarioVariables(currentTemplatePath: string): Promise<void> {
    try {
      const templateContent = await fs.promises.readFile(currentTemplatePath, "utf8");
      const extractedVars = TemplateParser.extractVariables(templateContent);
      const templateVarNames = extractedVars.map((v) => v.name);

      const fileData = await this.deps.getTemplateContextFileData(currentTemplatePath);
      const activeScenario = fileData.activeScenario || "Default";
      const definedVars = Object.keys(fileData.scenarios?.[activeScenario]?.variables || {});
      const inheritedVars = Object.keys(fileData.scenarios?.[activeScenario]?.variableSources || {});
      const availableVars = templateVarNames.filter(
        (name) => !definedVars.includes(name) && !inheritedVars.includes(name),
      );

      const otherScenarios = Object.entries(fileData.scenarios || {})
        .filter(([sn]) => sn !== activeScenario)
        .map(([sn, sc]) => ({
          name: sn,
          variables: Object.keys((sc as any).variables || {}).filter((vn) => {
            const src = ((sc as any).variableSources || {})[vn];
            return src === "self" || src === undefined;
          }),
        }));

      this.deps.postWebviewMessage({
        command: "availableScenarioVariables",
        variables: availableVars,
        scenarios: otherScenarios,
      });
    } catch {
      this.deps.postWebviewMessage({
        command: "availableScenarioVariables",
        variables: [],
        scenarios: [],
        error: "Failed to extract variables from template",
      });
    }
  }
}
