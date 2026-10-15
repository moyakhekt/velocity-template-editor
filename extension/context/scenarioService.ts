import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  IContextServices,
  getUrlWithSource,
  getScenarioHeadersData,
  getScenarioVariablesData,
  getUrlSourceOptionsData,
} from "./contextManagerServices";
import { ContextData } from "./contextManager";
import type { ScenarioData } from "../shared/types";
import { TemplateParser, ContextItem } from "../shared/templateParser";
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
  EditScenarioVariableInEditorCommand,
} from "../shared/messageTypes";

export class ScenarioService {
  private readonly openJsonEditors = new Map<string, { tempPath: string; disposables: vscode.Disposable[] }>();

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

    const { url, urlSource } = getUrlWithSource(message.scenario, fileData);

    const headersData = getScenarioHeadersData(activeScenario, fileData.headers || "");

    // Gather template-detected variables plus the names to exclude (mapped special
    // vars, foreach loop sources) the same way the full webview render does, so the
    // DOM patch after a scenario switch shows exactly the same rows.
    let templateItems: ContextItem[] = [];
    const excludeNames = new Set<string>(
      [fileData.httpServletRequestVar, fileData.localeVar, fileData.templateMessagesVar, fileData.escapeToolVar]
        .filter((v): v is string => !!v),
    );
    try {
      const templateContent = await fs.promises.readFile(currentTemplatePath, "utf8");
      templateItems = Array.from(TemplateParser.analyzeContext(templateContent).values());
      TemplateParser.extractForeachLoopVariables(templateContent).forEach((v) => excludeNames.add(v));
    } catch {
      // Template unreadable — fall back to whatever's already stored in the scenario.
    }

    const variablesData = getScenarioVariablesData(
      activeScenario,
      scenarios,
      message.scenario,
      this.deps.getEnvironmentContext().data,
      templateItems,
      excludeNames,
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
    const activeScenarioName = fileData.activeScenario || "Default";
    const scenario = fileData.scenarios?.[activeScenarioName];
    if (!scenario) return;

    if (!scenario.variables) scenario.variables = {};
    if (!scenario.variableSources) scenario.variableSources = {};

    // Clear the value but keep the row (do not delete variableSources)
    delete scenario.variables[name];
    scenario.variableSources[name] = "self";

    await this.deps.saveTemplateContext(currentTemplatePath, fileData);

    const isDefault = activeScenarioName === "Default";
    const rawParent = isDefault
      ? this.deps.getEnvironmentContext().data[name]
      : (fileData.scenarios?.["Default"]?.variables ?? {})[name];
    const hasParent = rawParent !== undefined;

    this.deps.postWebviewMessage({
      command: "deleteScenarioVariable",
      variable: {
        name,
        ownValue: "",
        parentValue: hasParent
          ? (typeof rawParent === "string" ? rawParent : JSON.stringify(rawParent))
          : "",
        isJson: scenario.variableJsonFlags?.[name] === true,
        isOverride: false,
        hasParent,
        isJsonEditable: isDefault,
      },
    });

    this.deps.refreshPreviewIfOpen(currentTemplatePath);
    vscode.window.setStatusBarMessage(`$(check) Cleared variable: ${name}`, 3000);
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
    if (!fileData.scenarios[targetScenario].variableSources) fileData.scenarios[targetScenario].variableSources = {};
    fileData.scenarios[targetScenario].variableSources![name] = 'self';

    if (isJson !== undefined) {
      if (!fileData.scenarios[targetScenario].variableJsonFlags) fileData.scenarios[targetScenario].variableJsonFlags = {};
      fileData.scenarios[targetScenario].variableJsonFlags![name] = !!isJson;
    }

    await this.deps.saveTemplateContext(currentTemplatePath, fileData);
    // Don't call updateWebview here — the client already updates the DOM on blur; a full
    // refresh would reset the scroll position.
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
    const activeScenario: ScenarioData | undefined = fileData.scenarios?.[activeScenarioName];
    if (!activeScenario) return;

    if (!activeScenario.variableSources) activeScenario.variableSources = {};
    if (!activeScenario.variables) activeScenario.variables = {};
    if (!activeScenario.variableJsonFlags) activeScenario.variableJsonFlags = {};

    if (source === "self") {
      const currentSrc = activeScenario.variableSources[name];
      if (currentSrc && currentSrc !== "self") {
        const srcScenario: ScenarioData | undefined = fileData.scenarios?.[currentSrc];
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
          variables: Object.keys(sc.variables || {}).filter((vn) => {
            const src = (sc.variableSources || {})[vn];
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

  async handleToggleScenarioVariableOverride(
    message: { name: string; isOverride: boolean },
    currentTemplatePath: string,
  ): Promise<void> {
    const { name, isOverride } = message;
    if (!name) return;

    const fileData = await this.deps.getTemplateContextFileData(currentTemplatePath);
    const activeScenarioName = fileData.activeScenario || 'Default';
    const scenario = fileData.scenarios?.[activeScenarioName];
    if (!scenario) return;

    if (!scenario.variableSources) scenario.variableSources = {};
    if (!scenario.variables) scenario.variables = {};

    if (isOverride) {
      scenario.variableSources[name] = 'self';
      // Seed with inherited value if no own value yet
      if (!(name in scenario.variables)) {
        const isDefault = activeScenarioName === 'Default';
        const parentValue = isDefault
          ? this.deps.getEnvironmentContext().data[name]
          : (fileData.scenarios?.['Default']?.variables ?? {})[name];
        scenario.variables[name] = parentValue !== undefined
          ? (typeof parentValue === 'string' ? parentValue : JSON.stringify(parentValue))
          : '';
      }
    } else {
      delete scenario.variables[name];
      delete (scenario.variableSources ?? {})[name];
      delete (scenario.variableJsonFlags ?? {})[name];
    }

    await this.deps.saveTemplateContext(currentTemplatePath, fileData);
    void this.deps.updateWebview(currentTemplatePath);
    this.deps.refreshPreviewIfOpen(currentTemplatePath);
    vscode.window.setStatusBarMessage(
      `$(check) Variable $${name} override: ${isOverride ? 'on' : 'off'}`, 2000,
    );
  }

  private sanitizeForFilename(s: string): string {
    const cleaned = s.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60);
    return cleaned || 'value';
  }

  /**
   * Opens a scenario's JSON-flagged variable value in a real VS Code editor tab
   * (backed by a temp .json file) instead of the small inline textarea, so the
   * developer gets syntax highlighting and VS Code's own JSON validation. Saving
   * the temp file writes the value back into the scenario, same as the inline
   * textarea does on blur.
   */
  async handleEditScenarioVariableInEditor(
    message: EditScenarioVariableInEditorCommand,
    currentTemplatePath: string,
  ): Promise<void> {
    const { name, value } = message;
    if (!name) return;

    const fileData = await this.deps.getTemplateContextFileData(currentTemplatePath);
    const activeScenarioName = fileData.activeScenario || 'Default';
    const scenario = fileData.scenarios?.[activeScenarioName];
    if (!scenario) return;

    const editorKey = `${currentTemplatePath}::${activeScenarioName}::${name}`;
    const existing = this.openJsonEditors.get(editorKey);
    if (existing) {
      const doc = await vscode.workspace.openTextDocument(existing.tempPath);
      await vscode.window.showTextDocument(doc, { preview: false });
      return;
    }

    // Pretty-print if the current value is already valid JSON, so the editor opens
    // with readable formatting; otherwise seed the raw text as-is so nothing is lost.
    let seedContent = value ?? '';
    try {
      seedContent = JSON.stringify(JSON.parse(seedContent), null, 2);
    } catch {
      // Not valid JSON yet (e.g. a brand-new/empty variable) — leave as typed.
    }

    const tempDir = path.join(os.tmpdir(), 'vtl-editor-scenario-json');
    await fs.promises.mkdir(tempDir, { recursive: true });
    const fileName = `${this.sanitizeForFilename(path.basename(currentTemplatePath))}__${this.sanitizeForFilename(activeScenarioName)}__${this.sanitizeForFilename(name)}.json`;
    const tempPath = path.join(tempDir, fileName);
    await fs.promises.writeFile(tempPath, seedContent, 'utf8');

    const doc = await vscode.workspace.openTextDocument(tempPath);
    await vscode.window.showTextDocument(doc, { preview: false });

    const cleanup = () => {
      const entry = this.openJsonEditors.get(editorKey);
      if (entry) {
        entry.disposables.forEach((d) => d.dispose());
        this.openJsonEditors.delete(editorKey);
      }
      fs.promises.unlink(tempPath).catch(() => { /* best-effort cleanup */ });
    };

    const saveListener = vscode.workspace.onDidSaveTextDocument(async (savedDoc) => {
      if (savedDoc.uri.fsPath !== tempPath) return;

      const text = savedDoc.getText();
      try {
        JSON.parse(text);
      } catch (e) {
        vscode.window.showErrorMessage(
          `$${name}: not valid JSON — fix and save again. (${e instanceof Error ? e.message : String(e)})`,
        );
        return;
      }

      const latestFileData = await this.deps.getTemplateContextFileData(currentTemplatePath);
      const latestScenario = latestFileData.scenarios?.[activeScenarioName];
      if (!latestScenario) return;

      if (!latestScenario.variables) latestScenario.variables = {};
      if (!latestScenario.variableSources) latestScenario.variableSources = {};
      if (!latestScenario.variableJsonFlags) latestScenario.variableJsonFlags = {};
      latestScenario.variables[name] = text;
      latestScenario.variableSources[name] = 'self';
      latestScenario.variableJsonFlags[name] = true;

      await this.deps.saveTemplateContext(currentTemplatePath, latestFileData);
      this.deps.refreshPreviewIfOpen(currentTemplatePath);

      const isDefault = activeScenarioName === 'Default';
      const rawParent = isDefault
        ? this.deps.getEnvironmentContext().data[name]
        : (latestFileData.scenarios?.['Default']?.variables ?? {})[name];
      const hasParent = rawParent !== undefined;

      this.deps.postWebviewMessage({
        command: 'refreshScenarioVariableRow',
        variable: {
          name,
          ownValue: text,
          parentValue: hasParent
            ? (typeof rawParent === 'string' ? rawParent : JSON.stringify(rawParent))
            : '',
          isJson: true,
          isOverride: true,
          hasParent,
          isJsonEditable: isDefault,
        },
      });

      vscode.window.setStatusBarMessage(`$(check) Updated variable: ${name}`, 3000);
    });

    const closeListener = vscode.workspace.onDidCloseTextDocument((closedDoc) => {
      if (closedDoc.uri.fsPath === tempPath) {
        cleanup();
      }
    });

    this.openJsonEditors.set(editorKey, { tempPath, disposables: [saveListener, closeListener] });
  }

}
