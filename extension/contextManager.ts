import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { TemplateParser, ContextItem } from "./templateParser";
import { ScenariosData, ScenarioData, EnvironmentContextConfig, MethodImpl, MethodsRecord, IPreviewProvider } from "./types";
import { IContextServices } from "./contextManagerServices";
import { EnvironmentContextService } from "./environmentContextService";
import { TemplateDataService } from "./templateDataService";
import { InputDialogService } from "./inputDialogService";
import { ScenarioService } from "./scenarioService";
import { VelocityServerClient } from "./velocityServerClient";
import { runScreenshots } from "./screenshotRunner";
import {
  TestCommand,
  ReloadEnvironmentContextCommand,
  ChangeTemplateContextFileCommand,
  ReloadTemplateContextCommand,
  SaveEnvironmentVariableCommand,
  SaveEnvironmentPropertyCommand,
  SaveEnvironmentMethodCommand,
  PromoteToEnvironmentCommand,
  SetVariableSourceCommand,
  SetPropertySourceCommand,
  SetMethodSourceCommand,
  SetSourceEnvironmentCommand,
  SetSourceTemplateCommand,
  SaveVariableCommand,
  SavePropertyCommand,
  SaveMethodCommand,
  SaveTemplateUrlCommand,
  SaveTemplateHeadersCommand,
  SaveHttpServletRequestVarCommand,
  SaveLocaleVarCommand,
  SaveTemplateMessagesVarCommand,
  SaveEscapeToolVarCommand,
  SaveMessagesFilePathCommand,
  DeleteMessagesFileCommand,
  SaveEnvironmentLanguageCommand,
  AddVariableToConfigCommand,
  SaveEnvironmentHeadersCommand,
  SaveEnvironmentHeaderRowCommand,
  SaveNewEnvironmentHeaderCommand,
  DeleteEnvironmentHeaderCommand,
  SaveEnvironmentCspDirectiveRowCommand,
  SaveNewEnvironmentCspDirectiveCommand,
  DeleteEnvironmentCspDirectiveCommand,
  SaveEnvironmentVariableRowCommand,
  SaveNewEnvironmentVariableCommand,
  DeleteEnvironmentVariableCommand,
  SaveNewEnvironmentMockFunctionCommand,
  SaveEnvironmentMockFunctionRowCommand,
  DeleteEnvironmentMockFunctionCommand,
  RequestVariableInputCommand,
  RequestPropertyInputCommand,
  RequestMethodInputCommand,
  RequestDeleteConfirmCommand,
  SwitchScenarioCommand,
  SaveNewScenarioCommand,
  DeleteScenarioCommand,
  RenameScenarioCommand,
  SaveMethodMappingCommand,
  SaveScenarioHeaderValueCommand,
  SaveNewScenarioHeaderCommand,
  DeleteScenarioHeaderCommand,
  SaveNewScenarioVariableCommand,
  SaveScenarioVariableValueCommand,
  ToggleScenarioVariableJsonCommand,
  ChangeScenarioVariableSourceCommand,
  ChangeUrlSourceCommand,
  isWebviewMessage,
  ScenarioHeaderItem,
  ScenarioVariableItem,
  UrlSourceOption,
} from "./messageTypes";

export type ContextData = Record<string, unknown>;

export interface HttpServletRequestConfig {
  url: string;
  headers: string;
}

export interface ContextFileData {
  url?: string;
  headers?: string;
  httpServletRequestVar?: string;
  localeVar?: string;
  templateMessagesVar?: string;
  escapeToolVar?: string;
  methods: MethodsRecord; // Shared methods across scenarios
  methodMappings?: { [methodFullName: string]: string }; // Maps template methods to environment mock function names
  scenarios: ScenariosData; // Named variable sets
  activeScenario: string; // Currently selected scenario
}

export interface ContextItemWithSource {
  value: unknown;
  source: "environment" | "template";
}

export class ContextManager implements IContextServices {
  public readonly context: vscode.ExtensionContext;
  public readonly contextCache: Map<string, ContextFileData> = new Map();
  public panel: vscode.WebviewPanel | undefined;
  private environmentContext: EnvironmentContextConfig = {
    data: {},
    mockFunctions: {},
    templates: {},
  };
  private environmentContextLoaded: boolean = false;
  private previewProvider: IPreviewProvider | undefined = undefined;
  private velocityServer: VelocityServerClient | undefined = undefined;
  public templateFilePath: string = "";
  public readonly outputChannel: vscode.OutputChannel;
  private contextFileWatcher: vscode.FileSystemWatcher | undefined;
  private suppressFileWatcherCount: number = 0;
  private readonly envService: EnvironmentContextService;
  private readonly templateDataService: TemplateDataService;
  private readonly inputDialogService: InputDialogService;
  private readonly scenarioService: ScenarioService;

  constructor(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
    this.context = context;
    this.outputChannel = outputChannel;
    this.envService = new EnvironmentContextService(this);
    this.templateDataService = new TemplateDataService(this);
    this.inputDialogService = new InputDialogService(this);
    this.scenarioService = new ScenarioService(this);
    void this.loadEnvironmentContextPath();
    this.setupContextFileWatcher();
  }

  private setupContextFileWatcher(): void {
    // Watch all .context.json files for changes
    this.contextFileWatcher =
      vscode.workspace.createFileSystemWatcher("**/*.context.json");

    // Clear cache when a context file changes
    this.contextFileWatcher.onDidChange((uri) => {
      this.outputChannel.appendLine(
        `[FileWatcher] Context file changed: ${uri.fsPath}`,
      );
      this.contextCache.delete(uri.fsPath);

      // If suppressed (programmatic change), skip webview refresh
      if (this.suppressFileWatcherCount > 0) {
        this.outputChannel.appendLine(
          "[FileWatcher] Refresh suppressed (programmatic change)",
        );
        return;
      }

      // If this is the active template's context file, refresh the webview
      if (this.templateFilePath) {
        const contextFilePath = this.getContextFilePath(this.templateFilePath);
        if (
          contextFilePath && (
            uri.fsPath === contextFilePath ||
            uri.fsPath.toLowerCase() === contextFilePath.toLowerCase()
          )
        ) {
          this.outputChannel.appendLine(
            "[FileWatcher] Active template context changed, refreshing webview",
          );
          void this.updateWebview(this.templateFilePath);
        }
      }
    });

    // Clear cache when a context file is deleted
    this.contextFileWatcher.onDidDelete((uri) => {
      this.outputChannel.appendLine(
        `[FileWatcher] Context file deleted: ${uri.fsPath}`,
      );
      this.contextCache.delete(uri.fsPath);
    });

    this.context.subscriptions.push(this.contextFileWatcher);
  }

  /**
   * Write to context file with file watcher suppression to prevent full webview refresh
   */
  public async writeContextFile(filePath: string, content: string): Promise<void> {
    this.suppressFileWatcherCount++;
    try {
      await fs.promises.writeFile(filePath, content, "utf8");
    } finally {
      // Decrement counter after delay to cover async FS event delivery
      setTimeout(() => {
        this.suppressFileWatcherCount = Math.max(0, this.suppressFileWatcherCount - 1);
      }, 100);
    }
  }

  /**
   * Save template context - decides whether to save to environment or local file
   * NEW ARCHITECTURE: Prioritizes environment context storage
   */
  public async saveTemplateContext(templatePath: string, contextData: ContextFileData): Promise<void> {
    // If environment context is loaded, ALWAYS save to environment
    if (this.environmentContext.filePath && this.environmentContextLoaded) {
      this.saveTemplateContextToEnvironment(templatePath, contextData);
      
      // Clear cache to ensure fresh data is loaded on next read
      const contextFilePath = this.getContextFilePath(templatePath);
      if (contextFilePath) { this.contextCache.delete(contextFilePath); }
      return;
    }

    // Fallback: Save to local .context.json file (LEGACY)
    const contextFilePath = this.getContextFilePath(templatePath);
    if (contextFilePath) {
      await this.writeContextFile(contextFilePath, JSON.stringify(contextData, null, 2));
      this.contextCache.set(contextFilePath, contextData);
    }
  }

  setPreviewProvider(previewProvider: IPreviewProvider): void {
    this.previewProvider = previewProvider;
  }

  setVelocityServer(server: VelocityServerClient): void {
    this.velocityServer = server;
  }

  private async loadEnvironmentContextPath(): Promise<void> {
    const savedPath = this.context.globalState.get<string>(
      "environmentContextPath",
    );
    if (savedPath && fs.existsSync(savedPath)) {
      try {
        const content = await fs.promises.readFile(savedPath, "utf8");
        const parsed = JSON.parse(content);

        this.environmentContext = {
          filePath: savedPath,
          messagesPropertiesPath: parsed.messagesPropertiesPath || undefined,
          messagesPropertiesPaths: parsed.messagesPropertiesPaths || undefined,
          language: parsed.language || undefined,
          headers: parsed.headers || {},
          cspDirectives: parsed.cspDirectives || {},
          mockFunctions: parsed.mockFunctions || {},
          data: parsed.context || parsed.data || {},
          templates: parsed.templates || {},
        };

        // Validate for duplicate variable names
        const duplicateVars = this.findDuplicateVariableNames(
          this.environmentContext.data,
        );
        if (duplicateVars.length > 0) {
          vscode.window
            .showErrorMessage(
              `Environment context contains duplicate variable names: ${duplicateVars.join(", ")}. Please edit the file to resolve duplicates.`,
              "Open File",
            )
            .then((selection) => {
              if (selection === "Open File") {
                vscode.workspace.openTextDocument(savedPath).then((doc) => {
                  vscode.window.showTextDocument(doc);
                });
              }
            });
        }

        // Validate for duplicate mock function names
        const duplicateMocks = this.findDuplicateMockFunctionNames(
          this.environmentContext.mockFunctions || {},
        );
        if (duplicateMocks.length > 0) {
          vscode.window
            .showErrorMessage(
              `Environment context contains duplicate mock function names: ${duplicateMocks.join(", ")}. Please edit the file to resolve duplicates.`,
              "Open File",
            )
            .then((selection) => {
              if (selection === "Open File") {
                vscode.workspace.openTextDocument(savedPath).then((doc) => {
                  vscode.window.showTextDocument(doc);
                });
              }
            });
        }

        this.environmentContextLoaded = true;
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        vscode.window
          .showErrorMessage(
            `Failed to load environment context file: ${errorMsg}`,
            "Open File",
          )
          .then((selection) => {
            if (selection === "Open File") {
              vscode.workspace.openTextDocument(savedPath).then((doc) => {
                vscode.window.showTextDocument(doc);
              });
            }
          });
      }
    }
  }

  public async saveEnvironmentContext(): Promise<void> {
    if (!this.environmentContext.filePath) {
      return;
    }
    try {
      const dataToSave: Record<string, unknown> = {
        messagesPropertiesPath: this.environmentContext.messagesPropertiesPath || undefined,
        messagesPropertiesPaths: this.environmentContext.messagesPropertiesPaths || undefined,
        language: this.environmentContext.language || undefined,
        headers: this.environmentContext.headers || "",
        cspDirectives: this.environmentContext.cspDirectives || {},
        context: this.environmentContext.data,
        mockFunctions: this.environmentContext.mockFunctions || {},
        templates: this.environmentContext.templates || {},
      };
      const content = JSON.stringify(dataToSave, null, 2);
      await fs.promises.writeFile(this.environmentContext.filePath, content, "utf8");

      // Trigger preview refresh for current template if preview is open
      if (this.templateFilePath) {
        this.refreshPreviewIfOpen(this.templateFilePath);
      }
    } catch (e) {
      vscode.window.showErrorMessage(
        `Failed to save environment context: ${e}`,
      );
    }
  }

  public refreshPreviewIfOpen(templatePath: string): void {
    if (this.previewProvider?.previewFilePath) {
      // Find the document for this template
      const doc = vscode.workspace.textDocuments.find(
        (d) =>
          d.uri.fsPath === templatePath ||
          d.uri.fsPath.toLowerCase() === templatePath.toLowerCase(),
      );
      if (doc) {
        this.previewProvider?.refresh(doc);
      }
    }
  }

  public async ensureEnvironmentContextFile(): Promise<boolean> {
    if (this.environmentContext.filePath) {
      return true;
    }

    const saveFile = await vscode.window.showSaveDialog({
      filters: { JSON: ["json"] },
      title: "Save Environment Context File",
      saveLabel: "Create Environment Context",
    });

    if (saveFile) {
      this.environmentContext.filePath = saveFile.fsPath;
      await this.context.globalState.update(
        "environmentContextPath",
        saveFile.fsPath,
      );
      return true;
    }

    return false;
  }

  private getEnvironmentValue(name: string): unknown {
    return this.environmentContext.data[name];
  }

  public async getContextForTemplate(templatePath: string): Promise<ContextData> {
    
    // Ensure mappings are detected and saved
    await this.ensureTemplateMappingsDetected(templatePath);
    
    const templateContextData = await this.getTemplateContextFileData(templatePath);

    // Get scenario variables and methods
    const scenarioVariables = this.getScenarioVariables(templateContextData);
    
    const templateMethods = templateContextData.methods || {};

    // Build merged context
    const mergedContext = this.buildMergedContext(
      templateMethods,
      scenarioVariables,
    );

    // Add HttpServletRequest if configured
    await this.addHttpServletRequestIfNeeded(
      mergedContext,
      templatePath,
      templateContextData,
    );

    return mergedContext;
  }

  /**
   * Returns the merged context for a specific scenario without changing activeScenario state.
   * Used by the screenshot runner to render every scenario independently.
   */
  public async getContextForSpecificScenario(templatePath: string, scenarioName: string): Promise<ContextData> {
    await this.ensureTemplateMappingsDetected(templatePath);

    const templateContextData = await this.getTemplateContextFileData(templatePath);

    // Temporarily override active scenario for variable resolution
    const originalActive = templateContextData.activeScenario;
    templateContextData.activeScenario = scenarioName;

    const scenarioVariables = this.getScenarioVariables(templateContextData);

    // Restore original active scenario
    templateContextData.activeScenario = originalActive;

    const templateMethods = templateContextData.methods || {};
    const mergedContext = this.buildMergedContext(templateMethods, scenarioVariables);
    await this.addHttpServletRequestIfNeeded(mergedContext, templatePath, templateContextData);
    return mergedContext;
  }

  public async getScenarioInfo(templatePath: string): Promise<{ scenarios: ScenariosData, activeScenario: string }> {
    
    const templateContextData = await this.getTemplateContextFileData(templatePath);

    return {
      scenarios: templateContextData.scenarios || {},
      activeScenario: templateContextData.activeScenario || 'Default'
    };
  }

  public async switchScenario(templatePath: string, scenarioName: string): Promise<void> {
    
    const fileData = await this.getTemplateContextFileData(templatePath);
    
    // Check if scenario exists
    if (!fileData.scenarios || !fileData.scenarios[scenarioName]) {
      return;
    }
    
    // Update active scenario
    fileData.activeScenario = scenarioName;
    
    // Save the context (this will update environment context or local file)
    await this.saveTemplateContext(templatePath, fileData);
    
    // Clear cache to force reload with new active scenario
    const contextFilePath = this.getContextFilePath(templatePath);
    if (contextFilePath) { this.contextCache.delete(contextFilePath); }
    
    // Update Context Manager webview if it's open for this template
    if (this.panel && this.templateFilePath === templatePath) {
      void this.updateWebview(templatePath);
    }
    
  }

  public getEnvironmentContext(): EnvironmentContextConfig {
    return this.environmentContext;
  }

  public setEnvironmentContext(config: EnvironmentContextConfig): void {
    this.environmentContext = config;
  }

  public setEnvironmentContextLoaded(loaded: boolean): void {
    this.environmentContextLoaded = loaded;
  }

  public postWebviewMessage(message: unknown): void {
    this.panel?.webview.postMessage(message);
  }

  /**
   * Called when the user switches to a different Velocity template in the editor.
   * Updates the active template path and refreshes the context manager webview if open.
   */
  public switchActiveTemplate(templatePath: string): void {
    if (this.templateFilePath === templatePath) {
      return; // Already active
    }
    this.templateFilePath = templatePath;
    if (this.panel) {
      void this.updateWebview(templatePath);
    }
  }

  /**
   * Ensures template variable mappings are auto-detected and saved.
   * This runs automatically when a template is accessed (preview, context manager, etc.)
   */
  private async ensureTemplateMappingsDetected(templatePath: string): Promise<void> {
    
    const templateData = await this.getTemplateContextFileData(templatePath);
    
    // If all mappings are already set, no need to detect
    if (templateData.localeVar && templateData.templateMessagesVar && 
        templateData.escapeToolVar && templateData.httpServletRequestVar !== undefined) {
      return;
    }
    

    // Read template content and parse to get items
    let templateContent = '';
    try {
      templateContent = await fs.promises.readFile(templatePath, 'utf-8');
    } catch (e) {
      this.outputChannel.appendLine(`[Context] Failed to read template "${templatePath}": ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const items = Array.from(TemplateParser.analyzeContext(templateContent).values());
    
    // Detect HttpServletRequest variable
    const httpServletVar = templateData.httpServletRequestVar !== "" 
      ? await this.detectHttpServletRequestVariable(templatePath) 
      : undefined;
    const effectiveVar = httpServletVar || 
      (templateData.httpServletRequestVar && templateData.httpServletRequestVar !== "" 
        ? templateData.httpServletRequestVar : undefined);
    
    // Detect locale variable
    const localeObjects = items.filter(
      (item) => item.type === "object" && this.isLocaleObject(item),
    );
    const localeVar = templateData.localeVar || 
      (localeObjects.length > 0 ? localeObjects[0].name : undefined);
    
    // Detect template messages variable
    const messagesObjects = items.filter(
      (item) => item.type === "object" && this.isTemplateMessagesObject(item),
    );
    const messagesVar = templateData.templateMessagesVar || 
      (messagesObjects.length > 0 ? messagesObjects[0].name : undefined);
    
    // Detect escape tool variable
    const escapeObjects = items.filter(
      (item) => item.type === "object" && this.isEscapeToolObject(item),
    );
    const escapeVar = templateData.escapeToolVar || 
      (escapeObjects.length > 0 ? escapeObjects[0].name : undefined);
    
    // Check if any new mappings were detected
    const needsSave = 
      (!templateData.localeVar && localeVar) ||
      (!templateData.templateMessagesVar && messagesVar) ||
      (!templateData.escapeToolVar && escapeVar) ||
      (templateData.httpServletRequestVar === undefined && effectiveVar);
    
    if (needsSave) {
      
      // Update context data with auto-detected mappings
      if (!templateData.localeVar && localeVar) {
        templateData.localeVar = localeVar;
      }
      if (!templateData.templateMessagesVar && messagesVar) {
        templateData.templateMessagesVar = messagesVar;
      }
      if (!templateData.escapeToolVar && escapeVar) {
        templateData.escapeToolVar = escapeVar;
      }
      if (templateData.httpServletRequestVar === undefined && effectiveVar) {
        templateData.httpServletRequestVar = effectiveVar;
      }
      
      // Save to environment context
      this.saveTemplateContextToEnvironment(templatePath, templateData);
    } else {
    }
  }

  public async getTemplateMappings(templatePath: string): Promise<{ localeVar?: string, templateMessagesVar?: string, escapeToolVar?: string }> {
    
    // Ensure mappings are detected and saved before returning
    await this.ensureTemplateMappingsDetected(templatePath);
    
    const templateContextData = await this.getTemplateContextFileData(templatePath);
    return {
      localeVar: templateContextData.localeVar,
      templateMessagesVar: templateContextData.templateMessagesVar,
      escapeToolVar: templateContextData.escapeToolVar
    };
  }

  private async loadTemplateContextData(contextFilePath: string): Promise<ContextFileData> {
    if (this.contextCache.has(contextFilePath)) {
      return this.contextCache.get(contextFilePath) as any;
    }

    const templateContextData = await this.loadContextDataFromFile(contextFilePath);
    this.contextCache.set(contextFilePath, templateContextData as any);
    return templateContextData;
  }

  private async loadContextDataFromFile(contextFilePath: string): Promise<ContextFileData> {
    if (!fs.existsSync(contextFilePath)) {
      return this.getEmptyContextData();
    }

    try {
      const content = await fs.promises.readFile(contextFilePath, "utf8");
      const parsed = JSON.parse(content);
      
      
      if (!parsed.scenarios) {
        const emptyData = this.getEmptyContextData();
        vscode.window.showErrorMessage(
          "Context file is in old format. Please run convert-context-files.js to migrate it, or delete the file to create a new one.",
          "Show File"
        ).then(selection => {
          if (selection === "Show File") {
            vscode.workspace.openTextDocument(contextFilePath).then(doc => {
              vscode.window.showTextDocument(doc);
            });
          }
        });
        return emptyData;
      }
      
      // Ensure activeScenario is set
      if (!parsed.activeScenario) {
        parsed.activeScenario = "Default";
      }
      
      // Ensure scenarios has at least Default
      if (!parsed.scenarios.Default) {
        parsed.scenarios.Default = { variables: {} };
      }
      

      return parsed as ContextFileData;
    } catch (e) {
      vscode.window.showErrorMessage(
        `Failed to parse context file: ${e instanceof Error ? e.message : String(e)}`,
        "Show File"
      ).then(selection => {
        if (selection === "Show File") {
          vscode.workspace.openTextDocument(contextFilePath).then(doc => {
            vscode.window.showTextDocument(doc);
          });
        }
      });
      return this.getEmptyContextData();
    }
  }

  private buildMergedContext(
    templateMethods: MethodsRecord,
    scenarioVariables: ContextData,
  ): ContextData {
    const mergedContext: ContextData = { ...this.environmentContext.data };

    this.mergeMethodsIntoContext(mergedContext, templateMethods);
    this.mergeScenarioVariables(mergedContext, scenarioVariables);

    return mergedContext;
  }

  private mergeMethodsIntoContext(
    mergedContext: ContextData,
    templateMethods: MethodsRecord,
  ): void {
    // Merge Environment methods with template methods
    for (const [key, value] of Object.entries(mergedContext)) {
      if (this.isMethodsObject(value) && templateMethods[key]) {
        mergedContext[key] = { ...(value as Record<string, unknown>), ...templateMethods[key] };
      }
    }

    // Add template-only methods
    for (const [key, value] of Object.entries(templateMethods)) {
      if (!mergedContext[key]) {
        mergedContext[key] = value;
      }
    }
  }

  private mergeScenarioVariables(
    mergedContext: ContextData,
    scenarioVariables: ContextData,
  ): void {
    for (const [key, value] of Object.entries(scenarioVariables)) {
      if (this.shouldMergeObjects(value, mergedContext[key])) {
        mergedContext[key] = { ...(mergedContext[key] as Record<string, unknown>), ...(value as Record<string, unknown>) };
      } else {
        mergedContext[key] = value;
      }
    }
  }

  private shouldMergeObjects(value: unknown, existingValue: unknown): boolean {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      typeof existingValue === "object" &&
      existingValue !== null &&
      !Array.isArray(existingValue) &&
      !this.isMethodsObject(value)
    );
  }

  private async addHttpServletRequestIfNeeded(
    mergedContext: ContextData,
    templatePath: string,
    templateContextData: ContextFileData,
  ): Promise<void> {
    const httpServletVarName = await this.getHttpServletRequestVarName(
      templatePath,
      templateContextData,
    );

    if (httpServletVarName && templateContextData.url) {
      const mergedHeaders = this.mergeHeaders(
        this.environmentContext.headers,
        templateContextData.headers,
      );
      mergedContext[httpServletVarName] = {
        _httpServletRequest: true,
        url: templateContextData.url,
        headers: mergedHeaders,
      };
    }
  }

  private async getHttpServletRequestVarName(
    templatePath: string,
    templateContextData: ContextFileData,
  ): Promise<string | undefined> {
    let httpServletVarName =
      await this.detectHttpServletRequestVariable(templatePath);

    if (!httpServletVarName && templateContextData.httpServletRequestVar) {
      httpServletVarName = templateContextData.httpServletRequestVar;
    }

    return httpServletVarName;
  }

  public getEmptyContextData(): ContextFileData {
    return {
      methods: {},
      scenarios: { Default: { variables: {} } },
      activeScenario: "Default",
    };
  }

  private isMethodsObject(value: unknown): boolean {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }
    // Check if object contains methods with _implementation
    return Object.values(value).some(
      (v: unknown) => v && typeof v === "object" && "_implementation" in v,
    );
  }

  private getScenarioVariables(contextData: ContextFileData): ContextData {
    if (!contextData.scenarios) {
      return {};
    }

    const activeScenarioName = contextData.activeScenario || 'Default';
    const scenarios = contextData.scenarios;
    const activeScenario: ScenarioData = scenarios[activeScenarioName] ?? { variables: {} };
    const variableSources = activeScenario.variableSources ?? {};
    const ownVars = activeScenario.variables ?? {};


    // Collect all variable names visible to this scenario
    const allVarNames = new Set<string>();
    Object.keys(ownVars).forEach(n => allVarNames.add(n));
    Object.entries(variableSources).forEach(([n, src]) => {
      if (src !== 'self') allVarNames.add(n);
    });


    const merged: Record<string, unknown> = {};
    for (const name of allVarNames) {
      const source = variableSources[name] || 'self';
      let rawValue: unknown;
      let isJson: boolean;

      if (source === 'self') {
        rawValue = ownVars[name];
        isJson = (activeScenario.variableJsonFlags ?? {})[name] === true;
      } else if (scenarios[source]) {
        // Inherited: resolve from source scenario
        const srcScenario = scenarios[source];
        rawValue = (srcScenario.variables ?? {})[name];
        isJson = (srcScenario.variableJsonFlags ?? {})[name] === true;
      } else {
        continue;
      }

      if (rawValue !== undefined) {
        if (isJson && typeof rawValue === 'string') {
          try {
            merged[name] = JSON.parse(rawValue);
          } catch (e) {
            merged[name] = rawValue;
          }
        } else {
          merged[name] = rawValue;
        }
      }
    }

    return merged;
  }

  private mergeHeaders(
    environmentHeaders?: string | Record<string, string>,
    templateHeaders?: string | Record<string, string>,
  ): string {
    // Convert objects to string format
    const envHeaderStr =
      typeof environmentHeaders === "object"
        ? Object.entries(environmentHeaders)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n")
        : environmentHeaders || "";
    const tplHeaderStr =
      typeof templateHeaders === "object"
        ? Object.entries(templateHeaders)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n")
        : templateHeaders || "";

    if (!envHeaderStr && !tplHeaderStr) {
      return "";
    }
    if (!envHeaderStr) {
      return tplHeaderStr;
    }
    if (!tplHeaderStr) {
      return envHeaderStr;
    }

    // Parse headers into map
    const headerMap = new Map<string, string>();

    // Add Environment headers first
    envHeaderStr.split("\n").forEach((line) => {
      const colonIndex = line.indexOf(":");
      if (colonIndex > 0) {
        const name = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        if (name) {
          headerMap.set(name.toLowerCase(), `${name}: ${value}`);
        }
      }
    });

    // Override with template headers
    tplHeaderStr.split("\n").forEach((line) => {
      const colonIndex = line.indexOf(":");
      if (colonIndex > 0) {
        const name = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        if (name) {
          headerMap.set(name.toLowerCase(), `${name}: ${value}`);
        }
      }
    });

    return Array.from(headerMap.values()).join("\n");
  }

  private isPrintableAscii(value: string): boolean {
    return /^[\x20-\x7E]*$/.test(value);
  }

  private normalizeHeaderName(name: string): string {
    return name.toLowerCase();
  }

  private findHeaderKey(
    headers: { [key: string]: string },
    name: string,
  ): string | undefined {
    const target = name.toLowerCase();
    return Object.keys(headers).find((key) => key.toLowerCase() === target);
  }

  private async detectHttpServletRequestVariable(
    templatePath: string,
  ): Promise<string | undefined> {
    try {

      // Validate that the path looks like a file path (not a title or other string)
      if (
        !templatePath ||
        (!templatePath.includes("\\") && !templatePath.includes("/"))
      ) {
        return undefined;
      }

      let content: string | undefined;

      // First try to get content from open text documents (handles files outside workspace)
      const openDoc = vscode.workspace.textDocuments.find(
        (doc) =>
          doc.uri.fsPath === templatePath ||
          doc.uri.fsPath.toLowerCase() === templatePath.toLowerCase(),
      );

      if (openDoc) {
        content = openDoc.getText();
      } else {
        // Fall back to file system read
        try {
          content = await fs.promises.readFile(templatePath, "utf8");
        } catch (e) {
          this.outputChannel.appendLine(`[Context] Failed to read template "${templatePath}": ${e instanceof Error ? e.message : String(e)}`);
          return undefined;
        }
      }


      // Look for patterns like $HttpServletRequest, $request, $servletRequest
      const regex = /\$(\w*[Ss]ervlet[Rr]equest\w*)/;
      const match = regex.exec(content);
      if (match) {
        return match[1];
      }
      // Also check for common patterns like $request
      if (
        content.includes("$request.getParameter") ||
        content.includes("$request.getHeader")
      ) {
        return "request";
      }

    } catch (e) {
      this.outputChannel.appendLine(`[Context] Unexpected error detecting HttpServletRequest variable: ${e instanceof Error ? e.message : String(e)}`);
    }
    return undefined;
  }

  public async getTemplateOnlyContext(templatePath: string): Promise<ContextData> {
    const contextFilePath = this.getContextFilePath(templatePath);

    // Check cache first
    let contextFileData: ContextFileData;
    if (this.contextCache.has(contextFilePath!)) {
      contextFileData = this.contextCache.get(contextFilePath!) as ContextFileData;
    } else {
      // Load from file if exists
      if (contextFilePath && fs.existsSync(contextFilePath)) {
        try {
          const content = await fs.promises.readFile(contextFilePath, "utf8");
          const parsed = JSON.parse(content);
          // Expect new format only - no migration
          if (!parsed.scenarios) {
            throw new Error(
              "Context file is in old format. Please run convert-context-files.js to migrate it.",
            );
          }
          contextFileData = parsed as ContextFileData;
        } catch (e) {
          this.outputChannel.appendLine(`[Context] Failed to parse context file "${contextFilePath}": ${e instanceof Error ? e.message : String(e)}`);
          contextFileData = this.getEmptyContextData();
        }
      } else {
        contextFileData = this.getEmptyContextData();
      }
      this.contextCache.set(contextFilePath!, contextFileData);
    }

    // Get scenario variables (for rendering, use active scenario merged with Default)
    const scenarioVars = this.getScenarioVariables(contextFileData);
    const methods = contextFileData.methods || {};

    // Merge methods + scenario variables
    const result: ContextData = { ...methods, ...scenarioVars };

    // Exclude HttpServletRequest variable if manually selected
    if (contextFileData.httpServletRequestVar) {
      const filtered = { ...result };
      delete filtered[contextFileData.httpServletRequestVar];
      return filtered;
    }

    return result;
  }

  // Get template context from environment (NEW: scenarios moved to environment)
  private getTemplateContextFromEnvironment(templatePath: string): ContextFileData | null {
    
    if (!this.environmentContext.templates) {
      return null;
    }

    const normalizedPath = this.normalizeTemplatePath(templatePath);
    
    const templateConfig = this.environmentContext.templates[normalizedPath];
    
    if (!templateConfig) {
      return null;
    }


    // Ensure Default scenario exists and is loaded
    if (!templateConfig.scenarios) {
      templateConfig.scenarios = {
        Default: { variables: {} }
      };
    }
    if (!templateConfig.scenarios.Default) {
      templateConfig.scenarios.Default = { variables: {} };
    }
    if (!templateConfig.activeScenario) {
      templateConfig.activeScenario = "Default";
    }

    // Convert to ContextFileData format
    return {
      scenarios: templateConfig.scenarios,
      activeScenario: templateConfig.activeScenario,
      httpServletRequestVar: templateConfig.mappedVariables?.httpServletRequestVar,
      localeVar: templateConfig.mappedVariables?.localeVar,
      templateMessagesVar: templateConfig.mappedVariables?.templateMessagesVar,
      escapeToolVar: templateConfig.mappedVariables?.escapeToolVar,
      methodMappings: templateConfig.mappedMethods,
      methods: {},
    };
  }

  // Save template context to environment
  private saveTemplateContextToEnvironment(templatePath: string, contextData: ContextFileData): void {
    if (!this.environmentContext.templates) {
      this.environmentContext.templates = {};
    }

    const normalizedPath = this.normalizeTemplatePath(templatePath);
    
    // Ensure Default scenario exists
    if (!contextData.scenarios) {
      contextData.scenarios = { Default: { variables: {} } };
    }
    if (!contextData.scenarios.Default) {
      contextData.scenarios.Default = { variables: {} };
    }
    if (!contextData.activeScenario) {
      contextData.activeScenario = "Default";
    }

    this.environmentContext.templates[normalizedPath] = {
      mappedVariables: {
        httpServletRequestVar: contextData.httpServletRequestVar,
        localeVar: contextData.localeVar,
        templateMessagesVar: contextData.templateMessagesVar,
        escapeToolVar: contextData.escapeToolVar,
      },
      mappedMethods: contextData.methodMappings || {},
      scenarios: contextData.scenarios,
      activeScenario: contextData.activeScenario,
    };

    this.saveEnvironmentContext();
  }

  // Normalize template path for consistent lookup
  public normalizeTemplatePath(templatePath: string): string {
    // Use relative path from workspace root if possible
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      const workspaceRoot = workspaceFolders[0].uri.fsPath;
      if (templatePath.startsWith(workspaceRoot)) {
        return path.relative(workspaceRoot, templatePath).replace(/\\/g, '/');
      }
    }
    return templatePath.replace(/\\/g, '/');
  }

  // New method to get just the raw file data (for UI editing)
  public async getTemplateContextFileData(templatePath: string): Promise<ContextFileData> {
    // PRIORITY 1: Check environment context first (NEW ARCHITECTURE)
    const envContext = this.getTemplateContextFromEnvironment(templatePath);
    if (envContext) {
      return envContext;
    }

    // PRIORITY 2: Check cache
    const contextFilePath = this.getContextFilePath(templatePath);
    if (contextFilePath && this.contextCache.has(contextFilePath)) {
      return this.contextCache.get(contextFilePath)!;
    }

    // PRIORITY 3: Load from .context.json file (LEGACY)
    if (contextFilePath && fs.existsSync(contextFilePath)) {
      try {
        const content = await fs.promises.readFile(contextFilePath, "utf8");
        const parsed = JSON.parse(content);
        // Expect new format only - no migration
        if (!parsed.scenarios) {
          throw new Error(
            "Context file is in old format. Please run convert-context-files.js to migrate it.",
          );
        }
        const migrated = parsed as ContextFileData;

        // Ensure activeScenario is set to 'Default' if not set or invalid
        if (
          !migrated.activeScenario ||
          !migrated.scenarios[migrated.activeScenario]
        ) {
          migrated.activeScenario = "Default";
        }

        this.contextCache.set(contextFilePath!, migrated);
        return migrated;
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        vscode.window
          .showErrorMessage(
            `Failed to load template context file: ${errorMsg}`,
            "Open File",
          )
          .then((selection) => {
            if (selection === "Open File" && contextFilePath) {
              vscode.workspace.openTextDocument(contextFilePath).then((doc) => {
                vscode.window.showTextDocument(doc);
              });
            }
          });
      }
    }

    // PRIORITY 4: Create empty with Default scenario
    const empty = this.getEmptyContextData();
    if (contextFilePath) { this.contextCache.set(contextFilePath, empty); }
    return empty;
  }

  public async saveContext(
    templatePath: string,
    contextData: ContextData,
  ): Promise<void> {
    const contextFilePath = this.getContextFilePath(templatePath);

    // Load existing file to preserve structure
    let existingData: ContextFileData =
      await this.getTemplateContextFileData(templatePath);

    // Update only the active scenario's variables
    const activeScenario = existingData.activeScenario || "Default";
    if (!existingData.scenarios) {
      existingData.scenarios = {
        Default: {
          variables: {},
        },
      };
    }
    if (!existingData.scenarios[activeScenario]) {
      existingData.scenarios[activeScenario] = {
        variables: {},
      };
    }

    // Separate methods from variables in the incoming contextData
    const updatedMethods: MethodsRecord = {};
    const updatedVariables: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(contextData)) {
      if (this.isMethodsObject(value)) {
        updatedMethods[key] = value as Record<string, MethodImpl>;
      } else {
        updatedVariables[key] = value;
      }
    }

    // Update methods and scenario variables
    existingData.methods = updatedMethods;
    existingData.scenarios[activeScenario] = { variables: updatedVariables };

    try {
      const content = JSON.stringify(existingData, null, 2);
      if (contextFilePath) { await this.writeContextFile(contextFilePath, content); }
      if (contextFilePath) { this.contextCache.set(contextFilePath, existingData); }

      // Trigger preview refresh if preview is open
      this.refreshPreviewIfOpen(templatePath);
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to save context: ${e}`);
    }
  }

  async manageContext(): Promise<void> {

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage("Please open a file");
      return;
    }

    const templatePath = editor.document.uri.fsPath;

    // Check if file contains Velocity syntax (more lenient than language ID check)
    const content = editor.document.getText();
    const hasVelocitySyntax =
      /\$[a-zA-Z_]|#(set|if|foreach|macro|parse|include|define|evaluate)/.test(
        content,
      );

    if (!hasVelocitySyntax && editor.document.languageId !== "velocity") {
      const result = await vscode.window.showWarningMessage(
        "This file does not appear to be a Velocity template. Continue anyway?",
        "Yes",
        "No",
      );
      if (result !== "Yes") {
        return;
      }
    } else if (hasVelocitySyntax && editor.document.languageId !== "velocity") {
      // Show auto-closing notification when Velocity syntax is detected
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "✓ Velocity template detected",
          cancellable: false,
        },
        async (progress) => {
          return new Promise((resolve) => setTimeout(resolve, 3000));
        },
      );
    }

    await this.showContextWebview(templatePath);
  }

  /**
   * Ensures an environment context file is loaded.
   * Returns false (caller should abort) if the user cancelled all prompts.
   */
  private async ensureEnvironmentContextLoaded(templatePath: string): Promise<boolean> {
    if (this.environmentContext.filePath) { return true; }

    const action = await vscode.window.showInformationMessage(
      'No environment context file is loaded. An environment context is required to manage template data.',
      'Open Existing Context',
      'Create New Context',
      'Cancel'
    );

    if (action === 'Open Existing Context') {
      const openUri = await vscode.window.showOpenDialog({
        defaultUri: vscode.Uri.file(path.dirname(templatePath)),
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { 'JSON Files': ['json'] },
        title: 'Open Environment Context File',
      });
      if (!openUri || openUri.length === 0) { return false; }
      const contextFilePath = openUri[0].fsPath;
      await this.context.globalState.update('environmentContextPath', contextFilePath);
      await this.loadEnvironmentContextPath();
      vscode.window.showInformationMessage(`Loaded environment context: ${path.basename(contextFilePath)}`);
      return true;
    } else if (action === 'Create New Context') {
      const saveUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(path.dirname(templatePath), 'environment-context.json')),
        filters: { 'JSON Files': ['json'] },
        title: 'Create Environment Context File',
        saveLabel: 'Create',
      });
      if (!saveUri) { return false; }
      const contextFilePath = saveUri.fsPath;
      this.environmentContext = { filePath: contextFilePath, data: {}, templates: {} };
      await this.context.globalState.update('environmentContextPath', contextFilePath);
      const emptyContext = this.getEmptyContextData();
      this.saveTemplateContextToEnvironment(templatePath, emptyContext);
      vscode.window.showInformationMessage(`Created environment context with template: ${path.basename(contextFilePath)}`);
      return true;
    } else {
      return false;
    }
  }

  /**
   * Ensures the current template is registered in the loaded environment context.
   * Prompts the user if it is not present. Returns false if the user cancelled
   * a dialog that should abort opening the context manager.
   */
  private async ensureTemplateInEnvironmentContext(templatePath: string): Promise<boolean> {
    if (!this.environmentContext.filePath) { return true; }
    const normalizedPath = this.normalizeTemplatePath(templatePath);
    if (this.environmentContext.templates?.[normalizedPath]) { return true; }

    const action = await vscode.window.showInformationMessage(
      `This template is not defined in the environment context at ${path.basename(this.environmentContext.filePath)}. Would you like to add it?`,
      'Add to Current Context',
      'Open Different Context',
      'Create New Context',
      'Skip'
    );

    if (action === 'Add to Current Context') {
      const emptyContext = this.getEmptyContextData();
      this.saveTemplateContextToEnvironment(templatePath, emptyContext);
      vscode.window.showInformationMessage(`Added template to environment context with Default scenario`);
    } else if (action === 'Open Different Context') {
      const openUri = await vscode.window.showOpenDialog({
        defaultUri: vscode.Uri.file(path.dirname(this.environmentContext.filePath)),
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { 'JSON Files': ['json'] },
        title: 'Open Environment Context File',
      });
      if (!openUri || openUri.length === 0) { return false; }
      const contextFilePath = openUri[0].fsPath;
      await this.context.globalState.update('environmentContextPath', contextFilePath);
      await this.loadEnvironmentContextPath();
      const newNormalizedPath = this.normalizeTemplatePath(templatePath);
      if (!this.environmentContext.templates?.[newNormalizedPath]) {
        const addResult = await vscode.window.showInformationMessage(
          'Template is not defined in this context either. Add it?',
          'Yes', 'No'
        );
        if (addResult === 'Yes') {
          const emptyContext = this.getEmptyContextData();
          this.saveTemplateContextToEnvironment(templatePath, emptyContext);
          vscode.window.showInformationMessage(`Added template to environment context`);
        }
      } else {
        vscode.window.showInformationMessage(`Switched to environment context: ${path.basename(contextFilePath)}`);
      }
    } else if (action === 'Create New Context') {
      const saveUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(path.dirname(templatePath), 'environment-context.json')),
        filters: { 'JSON Files': ['json'] },
        title: 'Create Environment Context File',
        saveLabel: 'Create',
      });
      if (!saveUri) { return false; }
      const contextFilePath = saveUri.fsPath;
      this.environmentContext = { filePath: contextFilePath, data: {}, templates: {} };
      const emptyContext = this.getEmptyContextData();
      this.saveTemplateContextToEnvironment(templatePath, emptyContext);
      await this.context.globalState.update('environmentContextPath', contextFilePath);
      vscode.window.showInformationMessage(`Created environment context: ${path.basename(contextFilePath)}`);
    }
    // 'Skip' or no action: continue without registering the template
    return true;
  }

  private async showContextWebview(templatePath: string): Promise<void> {
    this.templateFilePath = templatePath;

    // Reload environment context from file to pick up any external changes
    await this.loadEnvironmentContextPath();

    if (!(await this.ensureEnvironmentContextLoaded(templatePath))) { return; }
    if (!(await this.ensureTemplateInEnvironmentContext(templatePath))) { return; }

    if (this.panel) {
      this.panel.dispose();
      this.panel = undefined;
    }

    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "velocityContext",
        "Velocity Context Manager",
        vscode.ViewColumn.Two,
        {
          enableScripts: true,
          localResourceRoots: [
            vscode.Uri.joinPath(
              this.context.extensionUri,
              "node_modules",
              "@vscode/codicons",
              "dist",
            ),
          ],
        },
      );

      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });

      // Automatically open DevTools for debugging
      vscode.commands.executeCommand(
        "workbench.action.webview.openDeveloperTools",
      );

      this.panel.webview.onDidReceiveMessage(
        async (message) => {
          await this.handleWebviewMessage(message, templatePath);
        },
        undefined,
        this.context.subscriptions,
      );

      // Set HTML AFTER all event handlers are registered
      void this.updateWebview(templatePath);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildEnvironmentHandlers(
    msg: any,
    currentTemplatePath: string,
  ): Record<string, () => Promise<void>> {
    return {
      test: () => this.handleTestCommand(msg),
      openDevTools: () => this.handleOpenDevTools(),
      loadEnvironmentContext: () => this.envService.handleloadEnvironmentContext(currentTemplatePath),
      reloadEnvironmentContext: () => this.envService.handleReloadEnvironmentContext(currentTemplatePath),
      saveEnvironmentContext: () => this.envService.handlesaveEnvironmentContext(currentTemplatePath),
      changeTemplateContextFile: () => this.envService.handleChangeTemplateContextFile(currentTemplatePath),
      reloadTemplateContext: () => this.envService.handleReloadTemplateContext(currentTemplatePath),
      saveEnvironmentVariable: () => this.envService.handleSaveEnvironmentVariable(msg, currentTemplatePath),
      saveEnvironmentProperty: () => this.envService.handleSaveEnvironmentProperty(msg, currentTemplatePath),
      saveEnvironmentMethod: () => this.envService.handleSaveEnvironmentMethod(msg, currentTemplatePath),
      saveEnvironmentLanguage: () => this.envService.handleSaveEnvironmentLanguage(msg, currentTemplatePath),
      saveEnvironmentHeaders: () => this.envService.handleSaveEnvironmentHeaders(msg, currentTemplatePath),
      saveEnvironmentHeaderRow: () => this.envService.handleSaveEnvironmentHeaderRow(msg, currentTemplatePath),
      saveNewEnvironmentHeader: () => this.envService.handleSaveNewEnvironmentHeader(msg, currentTemplatePath),
      deleteEnvironmentHeader: () => this.envService.handleDeleteEnvironmentHeader(msg, currentTemplatePath),
      saveEnvironmentCspDirectiveRow: () => this.envService.handleSaveEnvironmentCspDirectiveRow(msg, currentTemplatePath),
      saveNewEnvironmentCspDirective: () => this.envService.handleSaveNewEnvironmentCspDirective(msg, currentTemplatePath),
      deleteEnvironmentCspDirective: () => this.envService.handleDeleteEnvironmentCspDirective(msg, currentTemplatePath),
      saveEnvironmentVariableRow: () => this.envService.handleSaveEnvironmentVariableRow(msg, currentTemplatePath),
      saveNewEnvironmentVariable: () => this.envService.handleSaveNewEnvironmentVariable(msg, currentTemplatePath),
      deleteEnvironmentVariable: () => this.envService.handleDeleteEnvironmentVariable(msg, currentTemplatePath),
      saveNewEnvironmentMockFunction: () => this.envService.handleSaveNewEnvironmentMockFunction(msg, currentTemplatePath),
      saveEnvironmentMockFunctionRow: () => this.envService.handleSaveEnvironmentMockFunctionRow(msg, currentTemplatePath),
      deleteEnvironmentMockFunction: () => this.envService.handleDeleteEnvironmentMockFunction(msg, currentTemplatePath),
      saveMessagesFilePath: () => this.envService.handleSaveMessagesFilePath(msg, currentTemplatePath),
      browseMessagesFile: () => this.envService.handleBrowseMessagesFile(currentTemplatePath),
      deleteMessagesFile: () => this.envService.handleDeleteMessagesFile(msg, currentTemplatePath),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildTemplateDataHandlers(
    msg: any,
    contextData: ContextData,
    currentTemplatePath: string,
  ): Record<string, () => Promise<void>> {
    return {
      promoteToEnvironment: () => this.templateDataService.handlePromoteToEnvironment(msg, contextData, currentTemplatePath),
      setVariableSource: () => this.templateDataService.handleSetVariableSource(msg, contextData, currentTemplatePath),
      setPropertySource: () => this.templateDataService.handleSetPropertySource(msg, contextData, currentTemplatePath),
      setMethodSource: () => this.templateDataService.handleSetMethodSource(msg, contextData, currentTemplatePath),
      setSourceEnvironment: () => this.templateDataService.handleSetSourceEnvironment(msg, contextData, currentTemplatePath),
      setSourceTemplate: () => this.templateDataService.handleSetSourceTemplate(msg, contextData, currentTemplatePath),
      saveVariable: () => this.templateDataService.handleSaveVariable(msg, contextData, currentTemplatePath),
      saveProperty: () => this.templateDataService.handleSaveProperty(msg, contextData, currentTemplatePath),
      saveMethod: () => this.templateDataService.handleSaveMethod(msg, contextData, currentTemplatePath),
      saveTemplateUrl: () => this.templateDataService.handleSaveTemplateUrl(msg, currentTemplatePath),
      saveTemplateHeaders: () => this.templateDataService.handleSaveTemplateHeaders(msg, currentTemplatePath),
      saveHttpServletRequestVar: () => this.templateDataService.handleSaveHttpServletRequestVar(msg, currentTemplatePath),
      clearHttpServletRequestVar: () => this.templateDataService.handleClearHttpServletRequestVar(currentTemplatePath),
      setLocaleMapping: () => this.templateDataService.handleSaveLocaleVar(msg, currentTemplatePath),
      setMessagesMapping: () => this.templateDataService.handleSaveTemplateMessagesVar(msg, currentTemplatePath),
      setEscapeMapping: () => this.templateDataService.handleSaveEscapeToolVar(msg, currentTemplatePath),
      addVariableToConfig: () => this.templateDataService.handleAddVariableToConfig(msg, contextData, currentTemplatePath),
      requestVariableInput: () => this.inputDialogService.handleRequestVariableInput(msg, contextData, currentTemplatePath),
      requestPropertyInput: () => this.inputDialogService.handleRequestPropertyInput(msg, contextData, currentTemplatePath),
      requestMethodInput: () => this.inputDialogService.handleRequestMethodInput(msg, contextData, currentTemplatePath),
      requestDeleteConfirm: () => this.inputDialogService.handleRequestDeleteConfirm(msg, contextData, currentTemplatePath),
      saveMethodMapping: () => this.scenarioService.handleSaveMethodMapping(msg, contextData, currentTemplatePath),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildScenarioHandlers(
    msg: any,
    currentTemplatePath: string,
  ): Record<string, () => Promise<void>> {
    return {
      switchScenario: () => this.scenarioService.handleSwitchScenario(msg, currentTemplatePath),
      createScenario: () => this.scenarioService.handleCreateScenario(currentTemplatePath),
      saveNewScenario: () => this.scenarioService.handleSaveNewScenario(msg, currentTemplatePath),
      deleteScenario: () => this.scenarioService.handleDeleteScenario(msg, currentTemplatePath),
      saveScenarioHeaderValue: () => this.scenarioService.handleSaveScenarioHeaderValue(msg, currentTemplatePath),
      saveNewScenarioHeader: () => this.scenarioService.handleSaveNewScenarioHeader(msg, currentTemplatePath),
      deleteScenarioHeader: () => this.scenarioService.handleDeleteScenarioHeader(msg, currentTemplatePath),
      saveNewScenarioVariable: () => this.scenarioService.handleSaveNewScenarioVariable(msg, currentTemplatePath),
      saveScenarioVariableValue: () => this.scenarioService.handleSaveScenarioVariableValue(msg, currentTemplatePath),
      toggleScenarioVariableJson: () => this.scenarioService.handleToggleScenarioVariableJson(msg, currentTemplatePath),
      changeScenarioVariableSource: () => this.scenarioService.handleChangeScenarioVariableSource(msg, currentTemplatePath),
      getAvailableScenarioVariables: () => this.scenarioService.handleGetAvailableScenarioVariables(currentTemplatePath),
      changeUrlSource: () => this.templateDataService.handleChangeUrlSource(msg, currentTemplatePath),
      renameScenario: () => this.scenarioService.handleRenameScenario(msg, currentTemplatePath),
      runScreenshots: () => this.handleRunScreenshots(),
    };
  }

  private async handleWebviewMessage(
    message: unknown,
    templatePath: string,
  ): Promise<void> {
    if (!isWebviewMessage(message)) {
      this.outputChannel.appendLine(
        `[Webview] Rejected malformed message: ${JSON.stringify(message)}`
      );
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = message as any;

    if (msg.command === "switchScenario") {
    }

    const currentTemplatePath = this.templateFilePath;
    const contextData = await this.getTemplateOnlyContext(currentTemplatePath);

    const handlers: Record<string, () => Promise<void>> = {
      ...this.buildEnvironmentHandlers(msg, currentTemplatePath),
      ...this.buildTemplateDataHandlers(msg, contextData, currentTemplatePath),
      ...this.buildScenarioHandlers(msg, currentTemplatePath),
    };

    const handler = handlers[msg.command];
    if (handler) {
      await handler();
    }
  }

  private async handleTestCommand(message: TestCommand): Promise<void> {
    vscode.window.setStatusBarMessage("$(check) Webview button clicked!", 3000);
  }

  private async handleOpenDevTools(): Promise<void> {
    await vscode.commands.executeCommand(
      "workbench.action.webview.openDeveloperTools",
    );
  }

  public async handleRunScreenshots(): Promise<void> {
    if (!this.velocityServer) {
      vscode.window.showErrorMessage('Velocity server is not available. Cannot run screenshot tests.');
      return;
    }

    const templateRootResult = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: 'Select template root folder (templates are resolved relative to this)',
    });
    if (!templateRootResult?.[0]) {
      return;
    }
    const templateRoot = templateRootResult[0].fsPath;

    const folderResult = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: 'Select output folder to save screenshots',
    });
    if (!folderResult?.[0]) {
      return;
    }
    const outputDir = folderResult[0].fsPath;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Running Screenshot Tests',
        cancellable: false,
      },
      async (progress) => {
        const result = await runScreenshots(
          this,
          this.velocityServer!,
          outputDir,
          templateRoot,
          ({ current, total, label }) => {
            progress.report({
              message: `${current}/${total}: ${label}`,
              increment: (1 / total) * 100,
            });
          }
        );

        if (result.failed === 0) {
          vscode.window.showInformationMessage(
            `Screenshot tests complete: ${result.succeeded} screenshots saved to ${outputDir}`
          );
        } else {
          const errors = result.results
            .filter(r => !r.success)
            .map(r => `${r.template}/${r.scenario}: ${r.error}`)
            .join('\n');
          vscode.window.showWarningMessage(
            `Screenshot tests: ${result.succeeded} succeeded, ${result.failed} failed.\n${errors}`
          );
        }
      }
    );
  }

  public async updateWebview(templatePath: string): Promise<void> {
    if (!this.panel) {
      return;
    }

    const contextData = await this.getTemplateOnlyContext(templatePath);

    // Extract context structure from template
    let contextItems: Map<string, ContextItem> = new Map();
    let parseError: string | undefined;
    try {
      const templateContent = await fs.promises.readFile(templatePath, "utf8");
      contextItems = TemplateParser.analyzeContext(templateContent);

      // Debug logging
      contextItems.forEach((item, key) => {
      });
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }

    const html = await this.getWebviewHtml(
      contextData,
      contextItems,
      path.basename(templatePath),
      parseError,
    );

    // Write HTML to temp file for inspection
    const tempPath = path.join(os.tmpdir(), "velocity-context-debug.html");
    await fs.promises.writeFile(tempPath, html, "utf8");


    this.panel.webview.html = html;

  }

  private async loadTemplate(filename: string): Promise<string> {
    const templatePath = path.join(__dirname, "webview-ui", filename);
    return await fs.promises.readFile(templatePath, "utf8");
  }

  private async getWebviewHtml(
    contextData: ContextData,
    contextItems: Map<string, ContextItem>,
    templateName: string,
    parseError?: string,
  ): Promise<string> {

    const items = Array.from(contextItems.values());
    const nonce = this.getNonce();
    const environmentFilePath = this.environmentContext.filePath || "";

    // Get URIs for CSP and codicon
    const cspSource = this.panel?.webview.cspSource || "'none'";
    const codiconUri = this.panel?.webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "node_modules",
        "@vscode/codicons",
        "dist",
        "codicon.css",
      ),
    );

    // Load external template files
    const templateHtml = await this.loadTemplate("webview.html");
    const stylesContent = await this.loadTemplate("styles.css");
    const scriptsContent = await this.loadTemplate("scripts.js");

    // Generate dynamic tab content
    const templateTabContent = await this.generateTemplateTabHtml(items, contextData);
    const environmentTabContent = this.generateEnvironmentTabHtml();

    // Replace placeholders in template
    // Note: Use split().join() instead of replaceAll() for content with $ characters
    // to avoid $ being interpreted as special replacement patterns
    let html = templateHtml
      .split("{{nonce}}")
      .join(nonce)
      .split("{{cspSource}}")
      .join(cspSource)
      .split("{{codiconUri}}")
      .join(codiconUri?.toString() || "")
      .split("{{templateName}}")
      .join(this.escapeHtml(templateName))
      .split("{{environmentFilePath}}")
      .join(this.escapeHtml(environmentFilePath))
      .split("{{templateTabContent}}")
      .join(templateTabContent)
      .split("{{environmentTabContent}}")
      .join(environmentTabContent);

    // Replace styles and scripts separately to preserve $ characters in JavaScript
    html = html
      .split("{{styles}}")
      .join(`<style nonce="${nonce}">\n${stylesContent}\n</style>`);
    html = html
      .split("{{scripts}}")
      .join(`<script nonce="${nonce}">\n${scriptsContent}\n</script>`);

    return html;
  }

  private getUrlWithSource(
    scenarioName: string,
    fileData: ContextFileData,
  ): { url: string; urlSource: string } {
    const scenarios = fileData.scenarios || {};
    const scenario = scenarios[scenarioName];

    // Check if scenario has its own URL
    if (scenario?.url) {
      return { url: scenario.url, urlSource: "Self" };
    }

    // Check if scenario has a urlSource field (inheriting from specific scenario)
    if (scenario?.urlSource) {
      const sourceScenario = scenarios[scenario.urlSource];
      if (sourceScenario?.url) {
        return { url: sourceScenario.url, urlSource: scenario.urlSource };
      }
    }

    // Don't auto-inherit from Default - scenarios must explicitly set urlSource
    // Check if there's a top-level URL (legacy fallback for backward compatibility)
    if (fileData.url && scenarioName === "Default") {
      return { url: fileData.url, urlSource: "Self" };
    }

    return { url: "", urlSource: "Self" };
  }

  private getUrlSourceOptionsData(
    currentScenario: string,
    scenarios: ScenariosData,
    fileData: ContextFileData,
  ): UrlSourceOption[] {
    let { urlSource } = this.getUrlWithSource(currentScenario, fileData);
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
        opts.push({ value: scenarioName, label: scenarioName, selected: urlSource === scenarioName });
      }
    }
    return opts;
  }

  private generateUrlSourceOptions(
    currentScenario: string,
    scenarios: ScenariosData,
    fileData: ContextFileData,
  ): string {
    return this.getUrlSourceOptionsData(currentScenario, scenarios, fileData)
      .map(o =>
        `<option value="${this.escapeHtml(o.value)}" ${o.selected ? "selected" : ""}>${this.escapeHtml(o.label)}</option>`
      )
      .join("");
  }

  private getScenarioHeadersData(
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

  private generateScenarioHeadersRows(
    scenario: ScenarioData,
    legacyHeaders: string,
  ): string {
    const headers = this.getScenarioHeadersData(scenario, legacyHeaders);

    let rowsHtml = headers
      .map(({ name, value, source }) => {
        const isSelf = source === "self";
        const sourceDisplay =
          source === "self"
            ? "Self"
            : source === "environment"
              ? "Environment"
              : source;
        const editableClass = isSelf ? 'data-action="editHeaderCell"' : "";
        const valueDisplay = isSelf
          ? `<span class="header-cell-value">${this.escapeHtml(value) || "(empty)"}</span>`
          : this.escapeHtml(value);
        return `
            <tr>
                <td>${this.escapeHtml(name)}</td>
                <td ${editableClass}>
                    ${valueDisplay}
                    ${isSelf ? `<input type="text" value="${this.escapeHtml(value)}" data-action="editScenarioHeader" data-field="value" data-name="${this.escapeHtml(name)}" class="header-cell-input" />` : ""}
                </td>
                <td style="font-size: 0.9em; color: var(--vscode-descriptionForeground);">${this.escapeHtml(sourceDisplay)}</td>
                <td>
                    ${
                      isSelf
                        ? `<button class="icon-button" data-action="deleteScenarioHeader" data-name="${this.escapeHtml(name)}" title="Delete">
                        <span class="codicon codicon-trash"></span>
                    </button>`
                        : ""
                    }
                </td>
            </tr>
        `;
      })
      .join("");

    rowsHtml += `
            <tr class="add-row">
                <td colspan="4">
                    <button class="add-table-row-button" data-action="addScenarioHeader">Add Header</button>
                </td>
            </tr>
        `;

    return rowsHtml;
  }

  private getScenarioVariablesData(
    scenario: ScenarioData,
    contextData: ContextData,
    allScenarios: ScenariosData = {},
    activeScenarioName: string = "Default",
  ): ScenarioVariableItem[] {
    const variableSources: Record<string, string> = scenario.variableSources || {};
    const variableJsonFlags: Record<string, boolean> = scenario.variableJsonFlags || {};
    const ownVars: Record<string, unknown> = scenario.variables || {};

    const allVarNames = new Set<string>();
    Object.keys(ownVars).forEach(n => allVarNames.add(n));
    Object.entries(variableSources).forEach(([n, src]) => {
      if (src !== "self") allVarNames.add(n);
    });
    if (allVarNames.size === 0) {
      Object.keys(contextData).forEach(name => {
        if (!["url", "headers", "scenarios", "activeScenario", "httpServletRequestVar", "localeVar", "templateMessagesVar", "escapeToolVar"].includes(name)) {
          allVarNames.add(name);
        }
      });
    }

    return Array.from(allVarNames).map(name => {
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
      const valueStr = typeof value === "string" ? value : (value !== undefined ? JSON.stringify(value) : "");

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

  private generateScenarioVariablesRows(
    scenario: ScenarioData,
    contextData: ContextData,
    allScenarios: ScenariosData = {},
    activeScenarioName: string = 'Default',
  ): string {
    const items = this.getScenarioVariablesData(scenario, contextData, allScenarios, activeScenarioName);

    const rows = items.map(({ name, value: valueStr, isJson, source, inheritableFrom }) => {
      const isSelf = source === "self";

      const sourceOptions = [
        `<option value="self" ${source === "self" ? "selected" : ""}>Self</option>`,
        ...inheritableFrom.map(sn =>
          `<option value="${this.escapeHtml(sn)}" ${source === sn ? "selected" : ""}>${this.escapeHtml(sn)}</option>`
        ),
      ].join("");

      const valueDisplay = isSelf
        ? `<span class="header-cell-value">${this.escapeHtml(valueStr) || "(empty)"}</span>`
        : `<span class="header-cell-value" style="color:var(--vscode-descriptionForeground);font-style:italic;">${this.escapeHtml(valueStr) || "(empty)"}</span>`;

      return `
        <tr data-variable-name="${this.escapeHtml(name)}">
            <td>${this.escapeHtml(name)}</td>
            <td ${isSelf ? 'data-action="editVariableCell"' : ''}>
                ${valueDisplay}
                ${isSelf ? `<input type="text" value="${this.escapeHtml(valueStr)}" data-action="editScenarioVariable" data-field="value" data-name="${this.escapeHtml(name)}" class="header-cell-input" />` : ""}
            </td>
            <td style="text-align:center;">
                <input type="checkbox" title="${isSelf ? "Parse value as JSON array/object" : "JSON parsing (inherited, read-only)"}" ${isJson ? "checked" : ""} ${isSelf ? `data-action="toggleScenarioVariableJson" data-name="${this.escapeHtml(name)}"` : "disabled"} />
            </td>
            <td ${inheritableFrom.length > 0 ? 'data-action="editSourceCell"' : ''} style="cursor:${inheritableFrom.length > 0 ? "pointer" : "default"};">
                <span class="header-cell-value" style="${!isSelf ? "color:var(--vscode-descriptionForeground);font-style:italic;" : ""}">${source === "self" ? "Self" : this.escapeHtml(source)}</span>
                ${inheritableFrom.length > 0 ? `<select class="header-cell-input scenario-source-select" data-action="changeScenarioVariableSource" data-name="${this.escapeHtml(name)}">${sourceOptions}</select>` : ""}
            </td>
            <td>
                ${isSelf
                  ? `<button class="icon-button" data-action="deleteScenarioVariable" data-name="${this.escapeHtml(name)}" title="Delete"><span class="codicon codicon-trash"></span></button>`
                  : ""}
            </td>
        </tr>
      `;
    });

    let rowsHtml = rows.join("");
    rowsHtml += `
      <tr class="add-row">
          <td colspan="5">
              <button class="add-table-row-button" data-action="addScenarioVariable">Add Variable</button>
          </td>
      </tr>
    `;
    return rowsHtml;
  }

  private async resolveTemplateMappings(
    items: ContextItem[],
    fullPath: string,
    templateData: ContextFileData,
  ): Promise<{
    effectiveVar: string | undefined;
    localeVar: string | undefined;
    messagesVar: string | undefined;
    escapeVar: string | undefined;
  }> {
    const httpServletVar =
      templateData.httpServletRequestVar !== ""
        ? await this.detectHttpServletRequestVariable(fullPath)
        : undefined;
    const manualVar =
      templateData.httpServletRequestVar &&
      templateData.httpServletRequestVar !== ""
        ? templateData.httpServletRequestVar
        : undefined;
    const effectiveVar = httpServletVar || manualVar;

    const localeObjects = items.filter(
      (item) => item.type === "object" && this.isLocaleObject(item),
    );
    const localeVar =
      templateData.localeVar ||
      (localeObjects.length > 0 ? localeObjects[0].name : undefined);

    const messagesObjects = items.filter(
      (item) => item.type === "object" && this.isTemplateMessagesObject(item),
    );
    const messagesVar =
      templateData.templateMessagesVar ||
      (messagesObjects.length > 0 ? messagesObjects[0].name : undefined);

    const escapeObjects = items.filter(
      (item) => item.type === "object" && this.isEscapeToolObject(item),
    );
    const escapeVar =
      templateData.escapeToolVar ||
      (escapeObjects.length > 0 ? escapeObjects[0].name : undefined);

    return { effectiveVar, localeVar, messagesVar, escapeVar };
  }

  private generateMappedVariablesConfigSection(
    mappings: {
      effectiveVar: string | undefined;
      localeVar: string | undefined;
      messagesVar: string | undefined;
      escapeVar: string | undefined;
    },
    items: ContextItem[],
    contextData: ContextData,
  ): string {
    const { effectiveVar, localeVar, messagesVar, escapeVar } = mappings;
    return `
            <div class="config-section">
                <div class="label-with-info">
                    <div class="section-label">Mapped Variables</div>
                    <button class="codicon codicon-info info-icon" title="Auto-detected template variables mapped to standard Velocity tools and utilities"></button>
                </div>
                <table class="headers-table mapped-vars-table">
                    <thead>
                        <tr>
                            <th width="200">Name</th>
                            <th>Value</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>HTTP Servlet Request</td>
                            <td>${effectiveVar ? "$" + this.escapeHtml(effectiveVar) + " (auto-detected)" : "Not detected"}</td>
                        </tr>
                        <tr>
                            <td>Locale Provider</td>
                            <td>${localeVar ? "$" + this.escapeHtml(localeVar) + " (auto-detected)" : "Not detected"}</td>
                        </tr>
                        <tr>
                            <td>Message Provider</td>
                            <td>${messagesVar ? "$" + this.escapeHtml(messagesVar) + " (auto-detected)" : "Not detected"}</td>
                        </tr>
                        <tr>
                            <td>Escape Tool</td>
                            <td>${escapeVar ? "$" + this.escapeHtml(escapeVar) + " (auto-detected)" : "Not detected"}</td>
                        </tr>
                    </tbody>
                </table>

                <div class="separator"></div>

                <div class="label-with-info">
                    <div class="section-label">Template Methods</div>
                    <button class="codicon codicon-info info-icon" title="Map template methods to environment mock functions that will be inherited by all scenarios"></button>
                </div>
                <div id="template-methods-table">
                    ${this.generateTemplateMethodsTable(items, contextData)}
                </div>
            </div>`;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private generateScenariosTableBodyHtml(
    scenarios: Record<string, any>,
    activeScenario: string,
  ): string {
    return Object.keys(scenarios)
      .map(
        (name) => `
                            <tr>
                                <td style="text-align: center;">
                                    <input type="radio" name="active-scenario" value="${this.escapeHtml(name)}"
                                           ${name === activeScenario ? "checked" : ""}
                                           data-action="changeScenario" />
                                </td>
                                <td data-action="editScenarioName" data-old-name="${this.escapeHtml(name)}">
                                    <span class="header-cell-value">${this.escapeHtml(name)}</span>
                                    <input type="text" value="${this.escapeHtml(name)}" data-action="saveScenarioName" data-old-name="${this.escapeHtml(name)}" class="header-cell-input" style="display: none;" />
                                </td>
                                <td style="text-align: center;">
                                    ${
                                      name !== "Default"
                                        ? `
                                        <button class="icon-button" data-action="deleteScenario" data-name="${this.escapeHtml(name)}" title="Delete scenario">
                                            <span class="codicon codicon-trash"></span>
                                        </button>
                                    `
                                        : ""
                                    }
                                </td>
                            </tr>`,
      )
      .join("");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private generateScenarioUrlTableHtml(
    activeScenario: string,
    scenarios: Record<string, any>,
    templateData: ContextFileData,
  ): string {
    const urlInfo = this.getUrlWithSource(activeScenario, templateData);
    return `
                <div class="label-with-info">
                    <div class="section-label">Scenario URL</div>
                    <button class="codicon codicon-info info-icon" title="Request URL for HttpServletRequest simulation"></button>
                </div>
                <table class="headers-table scenario-url-table" style="margin-bottom: 16px;">
                    <thead>
                        <tr>
                            <th>URL</th>
                            <th>Source</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td data-action="editUrlCell" data-url-editable="${urlInfo.urlSource === "Self" ? "true" : "false"}">
                                <span class="header-cell-value">${this.escapeHtml(urlInfo.url) || '<span style="opacity: 0.5;">Not set</span>'}</span>
                                <input type="text" id="template-url" value="${this.escapeHtml(urlInfo.url)}"
                                       data-action="saveTemplateUrl" placeholder="https://example.com/path?param=value"
                                       class="header-cell-input" style="display: none;"
                                       ${urlInfo.urlSource === "Self" ? "" : "disabled"} />
                            </td>
                            <td data-action="editSourceCell">
                                <span class="header-cell-value">${this.escapeHtml(urlInfo.urlSource || "Self")}</span>
                                <select id="url-source" data-action="changeUrlSource" class="header-cell-input" style="display: none;">
                                    ${this.generateUrlSourceOptions(activeScenario, scenarios, templateData)}
                                </select>
                            </td>
                        </tr>
                    </tbody>
                </table>`;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private generateScenariosConfigSection(
    activeScenario: string,
    scenarios: Record<string, any>,
    templateData: ContextFileData,
    contextData: ContextData,
  ): string {
    return `
            <div class="config-section">
                <div class="label-with-info">
                    <div class="section-label">Scenarios</div>
                    <button class="codicon codicon-info info-icon" title="Manage test scenarios to simulate different runtime conditions with unique URL, headers, and variables"></button>
                </div>
                <table class="headers-table scenarios-table">
                    <thead>
                        <tr>
                            <th width="100" style="text-align: center;">Active</th>
                            <th>Name</th>
                            <th width="60"></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.generateScenariosTableBodyHtml(scenarios, activeScenario)}
                        <tr class="add-row">
                            <td colspan="3">
                                <button class="add-table-row-button" data-action="addScenario">Add Scenario</button>
                            </td>
                        </tr>
                    </tbody>
                </table>

                <div class="separator"></div>

                <div class="scenario-title">${this.escapeHtml(activeScenario)}</div>

                ${this.generateScenarioUrlTableHtml(activeScenario, scenarios, templateData)}

                <div class="separator"></div>

                <div class="label-with-info">
                    <div class="section-label">Scenario Headers</div>
                    <button class="codicon codicon-info info-icon" title="HTTP headers for this test scenario"></button>
                </div>
                <table class="headers-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Value</th>
                            <th>Source</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody id="scenario-headers-tbody">
                        ${this.generateScenarioHeadersRows(scenarios[activeScenario] || {}, templateData.headers || "")}
                    </tbody>
                </table>

                <div class="separator"></div>

                <div class="label-with-info">
                    <div class="section-label">Scenario Variables</div>
                    <button class="codicon codicon-info info-icon" title="Variable values for this test scenario"></button>
                </div>
                <table class="headers-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Value</th>
                            <th style="text-align:center;" title="Check to parse this value as a JSON array or object">JSON</th>
                            <th>Source</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody id="scenario-variables-tbody">
                        ${this.generateScenarioVariablesRows(scenarios[activeScenario] || {}, contextData, scenarios, activeScenario)}
                    </tbody>
                </table>
            </div>`;
  }

  private async generateTemplateTabHtml(
    items: ContextItem[],
    contextData: ContextData,
  ): Promise<string> {
    try {

      // Get template file data
      const fullPath = this.templateFilePath;

      if (!fullPath) {
        return '<div class="error-banner">Error: Template file path is not set</div>';
      }

      const templateData: ContextFileData =
        await this.getTemplateContextFileData(fullPath);
      const activeScenario = templateData.activeScenario || "Default";
      const scenarios = templateData.scenarios || { Default: {} };
      const scenarioNames = Object.keys(scenarios);

      this.outputChannel.appendLine("[Context Load] Template data loaded");
      this.outputChannel.appendLine(
        `[Context Load] Active scenario: ${activeScenario}`,
      );
      this.outputChannel.appendLine(
        `[Context Load] Available scenarios: ${scenarioNames.join(", ")}`,
      );

      // Debug URL loading
      const urlInfo = this.getUrlWithSource(activeScenario, templateData);
      this.outputChannel.appendLine(
        `[URL Debug] Active scenario (${activeScenario}) URL info:`,
      );
      this.outputChannel.appendLine(`  - url: "${urlInfo.url}"`);
      this.outputChannel.appendLine(`  - urlSource: "${urlInfo.urlSource}"`);
      this.outputChannel.appendLine(`[URL Debug] Scenario data from JSON:`);
      this.outputChannel.appendLine(
        `  ${JSON.stringify(scenarios[activeScenario], null, 2)}`,
      );

      const mappings = await this.resolveTemplateMappings(items, fullPath, templateData);
      const { effectiveVar, localeVar, messagesVar, escapeVar } = mappings;

      // Get template filename for header
      const templateFileName = path.basename(fullPath);

      const html = `
            <div class="template-header">
                <h2 class="template-name">${this.escapeHtml(templateFileName)}</h2>
                <div class="template-path" title="${this.escapeHtml(fullPath)}">${this.escapeHtml(this.normalizeTemplatePath(fullPath))}</div>
            </div>
            ${this.generateMappedVariablesConfigSection(mappings, items, contextData)}
            ${this.generateScenariosConfigSection(activeScenario, scenarios, templateData, contextData)}
        `;

      return html;
    } catch (error) {
      return `<div class="error-banner">Error generating template tab: ${error instanceof Error ? error.message : String(error)}</div>`;
    }
  }

  private generateTemplateVariableHtml(
    item: ContextItem,
    contextData: ContextData,
  ): string {
    const hasLocalValue = contextData[item.name] !== undefined;
    const environmentValue = this.environmentContext.data[item.name];
    const hasEnvironmentValue = environmentValue !== undefined;

    // If has local value, source is template
    // If no local but has environment, source is environment
    // If neither, default to template (needs configuration)
    const source = hasLocalValue
      ? "template"
      : hasEnvironmentValue
        ? "environment"
        : "template";
    const displayValue = hasLocalValue
      ? contextData[item.name]
      : environmentValue;
    const valueStr =
      displayValue !== undefined
        ? typeof displayValue === "string"
          ? displayValue
          : JSON.stringify(displayValue)
        : "";

    return `
            <div class="context-item">
                <div class="item-header">
                    <div class="item-name">\$${this.escapeHtml(item.name)}</div>
                    <div class="item-controls">
                        <select class="source-select" data-action="setVariableSource" data-name="${this.escapeHtml(item.name)}">
                            <option value="template" ${source === "template" ? "selected" : ""}>Template</option>
                            <option value="environment" ${source === "environment" ? "selected" : ""}>Environment</option>
                        </select>
                        <button class="delete" data-action="deleteItem" data-type="variable" data-name="${this.escapeHtml(item.name)}" title="Delete">🗑</button>
                    </div>
                </div>
                ${
                  source === "template" || !hasEnvironmentValue
                    ? `
                    <input id="input-${this.escapeHtml(item.name)}" value="${this.escapeHtml(valueStr)}" placeholder="Enter value (JSON format)" data-action="saveValue" data-name="${this.escapeHtml(item.name)}" data-object="" data-prop="" />
                `
                    : `
                    <div class="value-display readonly">${this.escapeHtml(valueStr)}</div>
                `
                }
            </div>
        `;
  }

  private generateObjectPropertiesHtml(
    item: ContextItem,
    objectData: Record<string, any>,
    environmentData: Record<string, any>,
  ): string {
    if (!item.properties || item.properties.size === 0) { return ""; }
    let html = "";
    item.properties.forEach((propData, propName) => {
      const hasLocal = objectData[propName] !== undefined;
      const environmentVal = environmentData[propName];
      const hasEnvironment = environmentVal !== undefined;
      const source = hasLocal ? "template" : hasEnvironment ? "environment" : "template";
      const val = hasLocal ? objectData[propName] : environmentVal;
      const valStr = val !== undefined ? (typeof val === "string" ? val : JSON.stringify(val)) : "";

      html += `
                    <div class="nested-item">
                        <div class="nested-header">
                            <div class="nested-name">.${this.escapeHtml(propName)}</div>
                            <div class="item-controls">
                                <select class="source-select" data-action="setPropertySource" data-object="${this.escapeHtml(item.name)}" data-prop="${this.escapeHtml(propName)}">
                                    <option value="template" ${source === "template" ? "selected" : ""}>Template</option>
                                    <option value="environment" ${source === "environment" ? "selected" : ""}>Environment</option>
                                </select>
                                <button class="delete" data-action="deleteItem" data-type="property" data-object="${this.escapeHtml(item.name)}" data-prop="${this.escapeHtml(propName)}" title="Delete">🗑</button>
                            </div>
                        </div>
                        ${source === "template" || !hasEnvironment
                          ? `<input id="input-${this.escapeHtml(item.name)}-${this.escapeHtml(propName)}" value="${this.escapeHtml(valStr)}" placeholder="Enter value" data-action="saveValue" data-name="" data-object="${this.escapeHtml(item.name)}" data-prop="${this.escapeHtml(propName)}" />`
                          : `<div class="value-display readonly">${this.escapeHtml(valStr)}</div>`
                        }
                    </div>
                `;
    });
    return html;
  }

  private generateObjectMethodsHtml(
    item: ContextItem,
    objectData: Record<string, any>,
    environmentData: Record<string, any>,
  ): string {
    if (!item.methods || item.methods.size === 0) { return ""; }
    let html = "";
    item.methods.forEach((methodData, methodName) => {
      const localMethod = objectData[methodName];
      const hasLocal = localMethod && localMethod._implementation;
      const environmentMethod = environmentData[methodName];
      const hasEnvironment = environmentMethod && environmentMethod._implementation;
      const source = hasLocal ? "template" : hasEnvironment ? "environment" : "template";
      const impl = hasLocal ? localMethod._implementation : hasEnvironment ? environmentMethod._implementation : "";

      html += `
                    <div class="nested-item">
                        <div class="nested-header">
                            <div class="nested-name">.${this.escapeHtml(methodName)}()</div>
                            <div class="item-controls">
                                <select class="source-select" data-action="setMethodSource" data-object="${this.escapeHtml(item.name)}" data-method="${this.escapeHtml(methodName)}">
                                    <option value="template" ${source === "template" ? "selected" : ""}>Template</option>
                                    <option value="environment" ${source === "environment" ? "selected" : ""}>Environment</option>
                                </select>
                                <button class="delete" data-action="deleteItem" data-type="method" data-object="${this.escapeHtml(item.name)}" data-method="${this.escapeHtml(methodName)}" title="Delete">🗑</button>
                            </div>
                        </div>
                        ${source === "template" || !hasEnvironment
                          ? `<textarea id="method-${this.escapeHtml(item.name)}-${this.escapeHtml(methodName)}" placeholder="Enter implementation (use args[0], args[1], etc.)" data-action="saveMethod" data-object="${this.escapeHtml(item.name)}" data-method="${this.escapeHtml(methodName)}">${this.escapeHtml(impl)}</textarea>`
                          : `<div class="value-display readonly">${this.escapeHtml(impl)}</div>`
                        }
                    </div>
                `;
    });
    return html;
  }

  private generateTemplateObjectHtml(
    item: ContextItem,
    contextData: ContextData,
  ): string {
    const objectData = ((contextData as Record<string, any>)[item.name] || {}) as Record<string, any>;
    const environmentData = (this.environmentContext.data[item.name] as Record<string, any>) || {};

    let html = `<div class="context-item"><div class="item-header"><div class="item-name">\$${this.escapeHtml(item.name)}</div></div>`;
    html += this.generateObjectPropertiesHtml(item, objectData, environmentData);
    html += this.generateObjectMethodsHtml(item, objectData, environmentData);
    html += `</div>`;
    return html;
  }

  private generateEnvironmentConfigSectionHtml(): string {
    return `
            <div class="config-section">
                <div class="label-with-info">
                    <div class="section-label">Messages Properties Files</div>
                    <button class="codicon codicon-info info-icon" title="Load .properties files for internationalization messages. Files are loaded in order, with later files overriding earlier ones."></button>
                </div>
                <div id="messages-files-table">
                    ${this.generateMessagesFilesTable()}
                </div>
                
                <div class="label-with-info">
                    <label for="environment-language" class="section-label">Default Language Code</label>
                    <button class="codicon codicon-info info-icon" title="Specify the default language/locale code (e.g., 'en' for English, 'fr' for French, 'es' for Spanish)"></button>
                </div>
                <div class="form-field">
                    <input type="text" id="environment-language" value="${this.escapeHtml(this.environmentContext.language || "en")}" 
                           data-action="saveEnvironmentLanguage" placeholder="en" maxlength="5" />
                </div>
                
                <div class="separator"></div>
                
                <div class="label-with-info">
                    <div class="section-label">Environment headers</div>
                    <button class="codicon codicon-info info-icon" title="These headers can be inherited by scenario headers for testing purposes."></button>
                </div>
                <div id="environment-headers-table">
                    ${this.generateenvironmentHeadersTable()}
                </div>
                
                <div class="separator"></div>
                
                <div class="label-with-info">
                    <div class="section-label">CSP Directives for Preview</div>
                    <button class="codicon codicon-info info-icon" title="Content Security Policy directives applied when previewing templates. These control what resources the browser can load (e.g., scripts, styles, images)."></button>
                </div>
                <div id="environment-csp-directives-table">
                    ${this.generateEnvironmentCspDirectivesTable()}
                </div>
                
                <div class="separator"></div>
                
                <div class="label-with-info">
                    <div class="section-label">Environment variables</div>
                    <button class="codicon codicon-info info-icon" title="These variables can be inherited by template scenarios for testing purposes."></button>
                </div>
                <div id="environment-variables-table">
                    ${this.generateEnvironmentVariablesTable()}
                </div>
                
                <div class="separator"></div>
                
                <div class="label-with-info">
                    <div class="section-label">Mock Functions</div>
                    <button class="codicon codicon-info info-icon" title="JavaScript mock implementations for methods that can be inherited by template scenarios."></button>
                </div>
                <div id="environment-mock-functions-table">
                    ${this.generateEnvironmentMockFunctionsTable()}
                </div>
            </div>
        `;
  }

  private generateEnvironmentObjectsSectionHtml(): string {
    const data = this.environmentContext.data;
    let html = "";
    Object.keys(data)
      .sort()
      .forEach((key) => {
        const value = data[key] as Record<string, any>;
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          html += `<div class="context-item"><div class="item-header"><div class="item-name">$${this.escapeHtml(key)}</div></div>`;
          Object.keys(value)
            .sort()
            .forEach((subKey) => {
              const subValue = value[subKey];
              const isMethod = subValue && typeof subValue === "object" && subValue._implementation;
              if (isMethod) {
                html += `
                            <div class="nested-item">
                                <div class="nested-name">.${this.escapeHtml(subKey)}()</div>
                                <textarea id="gmethod-${this.escapeHtml(key)}-${this.escapeHtml(subKey)}" data-action="saveEnvironmentMethod" data-object="${this.escapeHtml(key)}" data-method="${this.escapeHtml(subKey)}">${this.escapeHtml(subValue._implementation)}</textarea>
                            </div>
                        `;
              } else {
                const valStr = typeof subValue === "string" ? subValue : JSON.stringify(subValue);
                html += `
                            <div class="nested-item">
                                <div class="nested-name">.${this.escapeHtml(subKey)}</div>
                                <input id="ginput-${this.escapeHtml(key)}-${this.escapeHtml(subKey)}" value="${this.escapeHtml(valStr)}" data-action="saveEnvironmentValue" data-name="" data-object="${this.escapeHtml(key)}" data-prop="${this.escapeHtml(subKey)}" />
                            </div>
                        `;
              }
            });
          html += `</div>`;
        }
      });
    return html;
  }

  private generateEnvironmentTabHtml(): string {
    return this.generateEnvironmentConfigSectionHtml() + this.generateEnvironmentObjectsSectionHtml();
  }

  private generateEnvironmentVariablesTable(): string {
    const data = this.environmentContext.data;
    const variables: Array<{ name: string; value: string }> = [];

    // Extract simple variables (not objects)
    Object.keys(data).forEach((key) => {
      const value = data[key];
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        const valStr =
          typeof value === "string" ? value : JSON.stringify(value);
        variables.push({ name: key, value: valStr });
      }
    });

    // Only render saved variables (no temp rows)
    const regularVars = variables.filter((v) => v.name);
    regularVars.sort((a, b) => a.name.localeCompare(b.name));

    let tableHtml =
      '<table class="headers-table"><thead><tr><th>Name</th><th>Value</th><th></th></tr></thead><tbody>';

    regularVars.forEach((variable, index) => {
      tableHtml += `
                <tr class="variable-row" data-variable-index="${index}" data-variable-name="${this.escapeHtml(variable.name)}">
                    <td data-action="editVariableCell" data-variable-index="${index}" data-variable-part="name">
                        <span class="header-cell-value">${this.escapeHtml(variable.name)}</span>
                        <input type="text" class="header-cell-input" value="${this.escapeHtml(variable.name)}" data-variable-index="${index}" data-variable-part="name" data-action="saveEnvironmentVariableRow" />
                    </td>
                    <td data-action="editVariableCell" data-variable-index="${index}" data-variable-part="value">
                        <span class="header-cell-value">${this.escapeHtml(variable.value)}</span>
                        <input type="text" class="header-cell-input" value="${this.escapeHtml(variable.value)}" data-variable-index="${index}" data-variable-part="value" data-action="saveEnvironmentVariableRow" />
                    </td>
                    <td><button class="delete" data-action="deleteEnvironmentVariable" data-variable-name="${this.escapeHtml(variable.name)}" title="Delete">🗑</button></td>
                </tr>
            `;
    });

    tableHtml += `
            <tr class="add-row">
                <td colspan="3">
                    <button id="add-environment-variable-btn" class="add-table-row-button" data-action="addEnvironmentVariable">Add Variable</button>
                </td>
            </tr>
        `;

    tableHtml += "</tbody></table>";
    return tableHtml;
  }

  private generateenvironmentHeadersTable(): string {
    const headers = this.environmentContext.headers || {};

    let tableHtml =
      '<table class="headers-table"><thead><tr><th>Name</th><th>Value</th><th></th></tr></thead><tbody>';

    // Only render saved headers (no temp rows)
    const headerKeys = Object.keys(headers)
      .filter((name) => name)
      .sort();

    headerKeys.forEach((name) => {
      const value = headers[name];

      tableHtml += `
                <tr class="header-row" data-header-name="${this.escapeHtml(name)}">
                    <td data-action="editHeaderCell" data-header-name="${this.escapeHtml(name)}" data-header-part="name">
                        <span class="header-cell-value">${this.escapeHtml(name)}</span>
                        <input type="text" class="header-cell-input" value="${this.escapeHtml(name)}" data-old-name="${this.escapeHtml(name)}" data-header-part="name" data-action="saveEnvironmentHeaderRow" />
                    </td>
                    <td data-action="editHeaderCell" data-header-name="${this.escapeHtml(name)}" data-header-part="value">
                        <span class="header-cell-value">${this.escapeHtml(value)}</span>
                        <input type="text" class="header-cell-input" value="${this.escapeHtml(value)}" data-old-name="${this.escapeHtml(name)}" data-header-part="value" data-action="saveEnvironmentHeaderRow" />
                    </td>
                    <td><button class="delete" data-action="deleteEnvironmentHeader" data-name="${this.escapeHtml(name)}" title="Delete">🗑</button></td>
                </tr>
            `;
    });

    tableHtml += `
            <tr class="add-row">
                <td colspan="3">
                    <button id="add-environment-header-btn" class="add-table-row-button" data-action="addEnvironmentHeader">Add Header</button>
                </td>
            </tr>
        `;

    tableHtml += "</tbody></table>";
    return tableHtml;
  }

  private generateMessagesFilesTable(): string {
    // Migrate old single path to array if needed
    if (this.environmentContext.messagesPropertiesPath && !this.environmentContext.messagesPropertiesPaths) {
      this.environmentContext.messagesPropertiesPaths = [this.environmentContext.messagesPropertiesPath];
      delete this.environmentContext.messagesPropertiesPath;
    }
    
    const files = this.environmentContext.messagesPropertiesPaths || [];
    
    let tableHtml = '<table class="headers-table messages-files-table"><thead><tr><th>File Name</th><th></th></tr></thead><tbody>';
    
    files.forEach((filePath, index) => {
      const fileName = filePath.split(/[\\\\/]/).pop() || filePath;
      tableHtml += `
        <tr class="message-file-row" data-file-index="${index}">
          <td class="file-path-cell" title="${this.escapeHtml(filePath)}">
            ${this.escapeHtml(filePath)}
          </td>
          <td style="width: 60px; text-align: center;">
            <button class="delete" data-action="deleteMessagesFile" data-file-index="${index}" title="Remove file">🗑</button>
          </td>
        </tr>
      `;
    });
    
    tableHtml += `
      <tr class="add-row">
        <td colspan="2">
          <button class="add-table-row-button" data-action="browseMessagesFile">
            Add File
          </button>
        </td>
      </tr>
    `;
    
    tableHtml += '</tbody></table>';
    return tableHtml;
  }

  private generateEnvironmentCspDirectivesTable(): string {
    const cspDirectives = this.environmentContext.cspDirectives || {};

    let tableHtml =
      '<table class="headers-table"><thead><tr><th>Directive</th><th>Value</th><th></th></tr></thead><tbody>';

    // Only render saved directives (no temp rows)
    const directiveNames = Object.keys(cspDirectives)
      .filter((name) => name)
      .sort();

    directiveNames.forEach((directive) => {
      const value = cspDirectives[directive];

      tableHtml += `
                <tr class="header-row" data-csp-directive="${this.escapeHtml(directive)}">
                    <td data-action="editCspDirectiveCell" data-directive-name="${this.escapeHtml(directive)}" data-directive-part="name">
                        <span class="header-cell-value">${this.escapeHtml(directive)}</span>
                        <input type="text" class="header-cell-input" value="${this.escapeHtml(directive)}" data-old-name="${this.escapeHtml(directive)}" data-directive-part="name" data-action="saveEnvironmentCspDirectiveRow" placeholder="e.g., default-src, script-src" />
                    </td>
                    <td data-action="editCspDirectiveCell" data-directive-name="${this.escapeHtml(directive)}" data-directive-part="value">
                        <span class="header-cell-value">${this.escapeHtml(value)}</span>
                        <input type="text" class="header-cell-input" value="${this.escapeHtml(value)}" data-old-name="${this.escapeHtml(directive)}" data-directive-part="value" data-action="saveEnvironmentCspDirectiveRow" placeholder="e.g., 'self' 'unsafe-inline'" />
                    </td>
                    <td><button class="delete" data-action="deleteEnvironmentCspDirective" data-name="${this.escapeHtml(directive)}" title="Delete">🗑</button></td>
                </tr>
            `;
    });

    tableHtml += `
            <tr class="add-row">
                <td colspan="3">
                    <button id="add-environment-csp-directive-btn" class="add-table-row-button" data-action="addEnvironmentCspDirective">Add CSP Directive</button>
                </td>
            </tr>
        `;

    tableHtml += "</tbody></table>";
    return tableHtml;
  }

  private generateEnvironmentMockFunctionsTable(): string {
    const mockFunctions = this.environmentContext.mockFunctions || {};
    const names = Object.keys(mockFunctions).sort((a, b) => a.localeCompare(b));

    let tableHtml =
      '<table class="headers-table mock-functions-table"><thead><tr><th>Implementation</th><th width="60"></th></tr></thead><tbody>';

    names.forEach((name) => {
      const implementation = mockFunctions[name] || "";
      const escapedName = this.escapeHtml(name);
      const escapedImpl = this.escapeHtml(implementation);
      const implDisplay = escapedImpl.replace(/\n/g, "<br>");

      tableHtml += `
                <tr class="header-row" data-mock-name="${escapedName}">
                    <td data-action="editMockFunctionCell">
                        <span class="header-cell-value mock-implementation-value">${implDisplay || "(empty)"}</span>
                        <textarea class="mock-implementation-input" data-action="saveEnvironmentMockFunctionRow" data-old-name="${escapedName}" placeholder="function myFunction(args) {&#10;  return args[0];&#10;}">${escapedImpl}</textarea>
                    </td>
                    <td style="text-align: center;">
                        <button class="icon-button" data-action="deleteEnvironmentMockFunction" data-name="${escapedName}" title="Delete">
                            <span class="codicon codicon-trash"></span>
                        </button>
                    </td>
                </tr>
            `;
    });

    tableHtml += `
            <tr class="add-row">
                <td colspan="2">
                    <button id="add-environment-mock-function-btn" class="add-table-row-button" data-action="addEnvironmentMockFunction">Add Mock Function</button>
                </td>
            </tr>
        `;

    tableHtml += "</tbody></table>";
    return tableHtml;
  }

  public getContextFilePath(templatePath: string): string | undefined {
    // Check if there's a stored association
    const storedPath = this.context.workspaceState.get<string>(
      `contextFile:${templatePath}`,
    );
    if (storedPath && fs.existsSync(storedPath)) {
      return storedPath;
    }

    // No fallback - user must explicitly select a context file
    return undefined;
  }

  private getNonce(): string {
    let text = "";
    const possible =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  private escapeHtml(text: string): string {
    const map: { [key: string]: string } = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  private extractFunctionName(implementation: string): string | null {
    const lines = implementation.split("\n");

    // Find first non-empty line
    const firstLine = lines.find((line) => line.trim() !== "");
    if (!firstLine) {
      return null;
    }

    // Match: function functionName(...) {
    const match = /^\s*function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/.exec(
      firstLine,
    );
    return match ? match[1] : null;
  }

  private isValidJavaScript(code: string): { valid: boolean; error?: string } {
    try {
      // Note: This only checks syntax; it does not execute the code.
      new Function(code);
      return { valid: true };
    } catch (e) {
      return {
        valid: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  private findDuplicateVariableNames(data: Record<string, unknown>): string[] {
    const names: string[] = [];
    const duplicates = new Set<string>();

    Object.keys(data).forEach((key) => {
      const value = data[key];
      // Only count simple variables, not objects with methods
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        if (names.includes(key)) {
          duplicates.add(key);
        } else {
          names.push(key);
        }
      }
    });

    return Array.from(duplicates);
  }

  private findDuplicateMockFunctionNames(mockFunctions: {
    [name: string]: string;
  }): string[] {
    const duplicates = new Set<string>();
    const seen = new Set<string>();

    Object.keys(mockFunctions || {}).forEach((name) => {
      const normalized = name.toLowerCase();
      if (seen.has(normalized)) {
        duplicates.add(name);
      } else {
        seen.add(normalized);
      }
    });

    return Array.from(duplicates);
  }

  private escapeJs(text: string): string {
    return text
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r");
  }

  private isLocaleObject(item: ContextItem): boolean {
    return this.canMapEnvironmentObject(item, ["getLanguage"]);
  }

  private isTemplateMessagesObject(item: ContextItem): boolean {
    return this.canMapEnvironmentObject(item, ["getMessage"]);
  }

  private isEscapeToolObject(item: ContextItem): boolean {
    return this.canMapEnvironmentObject(item, ["escape"]);
  }

  private isHttpServletRequestObject(item: ContextItem): boolean {
    return this.canMapEnvironmentObject(item, [
      "getHeader",
      "getParameter",
      "getParameterMap",
    ]);
  }

  private canMapEnvironmentObject(
    item: ContextItem,
    expectedMethods: string[],
  ): boolean {
    if (item.type !== "object" || !item.methods) {
      return false;
    }

    const methods = new Set(item.methods.keys());
    return expectedMethods.some((m) => methods.has(m));
  }

  /**
   * Get all available environment mock functions as an array of "objectName.methodName"
   */
  private getAvailableEnvironmentMockFunctions(): string[] {
    const mockFunctions: string[] = [];

    if (!this.environmentContext || !this.environmentContext.mockFunctions) {
      return mockFunctions;
    }

    for (const name of Object.keys(this.environmentContext.mockFunctions)) {
      mockFunctions.push(name);
    }

    return mockFunctions.sort();
  }

  /**
   * Generate the Template Methods table showing detected methods and their mappings to environment mocks
   */
  private generateTemplateMethodsTable(
    items: ContextItem[],
    contextData: ContextData,
  ): string {
    const availableEnvironmentMocks =
      this.getAvailableEnvironmentMockFunctions();
    const methodMappings: Record<string, string> = (contextData.methodMappings as Record<string, string>) || {};

    // Extract all methods from items, excluding special objects
    const templateMethods = new Map<
      string,
      { objectName: string; methodName: string; lineNumber: number }
    >();

    for (const item of items) {
      // Skip special objects
      if (
        this.isLocaleObject(item) ||
        this.isTemplateMessagesObject(item) ||
        this.isEscapeToolObject(item) ||
        this.isHttpServletRequestObject(item)
      ) {
        continue;
      }

      // Extract methods from this object
      if (item.type === "object" && item.methods) {
        for (const [methodName, methodData] of item.methods.entries()) {
          const fullMethodName = `${item.name}.${methodName}`;
          if (!templateMethods.has(fullMethodName)) {
            templateMethods.set(fullMethodName, {
              objectName: item.name,
              methodName: methodName,
              lineNumber: methodData.lineNumber,
            });
          }
        }
      }
    }

    // Generate table rows
    let rowsHtml = "";

    if (templateMethods.size === 0) {
      rowsHtml = `
                <tr>
                    <td colspan="2" style="text-align: center; color: var(--vscode-descriptionForeground); font-style: italic;">
                        No template methods detected
                    </td>
                </tr>
            `;
    } else {
      const sortedMethods = Array.from(templateMethods.entries()).sort((a, b) =>
        a[0].localeCompare(b[0]),
      );

      for (const [fullMethodName, methodData] of sortedMethods) {
        const currentMapping = methodMappings[fullMethodName] || "";
        const displayValue = currentMapping || "-- Not Mapped --";

        // Generate dropdown options
        let optionsHtml = '<option value="">-- Not Mapped --</option>';
        for (const mockFunction of availableEnvironmentMocks) {
          const selected = currentMapping === mockFunction ? "selected" : "";
          optionsHtml += `<option value="${this.escapeHtml(mockFunction)}" ${selected}>${this.escapeHtml(mockFunction)}</option>`;
        }

        rowsHtml += `
                    <tr>
                        <td style="width: 200px;">
                            <span style="font-family: var(--vscode-editor-font-family), monospace;">${this.escapeHtml(fullMethodName)}</span>
                        </td>
                        <td data-action="editMethodMapping">
                            <span class="method-mapping-value">${this.escapeHtml(displayValue)}</span>
                            <select class="method-mapping-input" 
                                    data-method="${this.escapeHtml(fullMethodName)}"
                                    data-action="saveMethodMapping">
                                ${optionsHtml}
                            </select>
                        </td>
                    </tr>
                `;
      }
    }

    return `
            <table class="headers-table template-methods-table">
                <thead>
                    <tr>
                        <th>Template Method</th>
                        <th>Mapped Environment Mock</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
        `;
  }
}
