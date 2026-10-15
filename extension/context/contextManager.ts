import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { runScreenshots } from "../server/screenshotRunner";
import { isDebugLogging } from "../shared/debugLogging";
import { VelocityServerClient } from "../server/velocityServerClient";
import { TestCommand, isWebviewMessage } from "../shared/messageTypes";
import { ContextItem, TemplateParser } from "../shared/templateParser";
import {
  EnvironmentContextConfig,
  IPreviewProvider,
  MethodImpl,
  MethodsRecord,
  ScenariosData,
  TemplateContextInEnvironment,
} from "../shared/types";
import { IContextServices, applyMethodMappings, getUrlWithSource, isSameTemplatePath, resolveScenarioValues, resolveTemplatePath } from "./contextManagerServices";
import { ContextWebviewRenderer } from "./contextWebviewRenderer";
import { EnvironmentContextService } from "./environmentContextService";
import { InputDialogService } from "./inputDialogService";
import { ScenarioService } from "./scenarioService";
import { TemplateDataService } from "./templateDataService";
import { TemplateGroupService } from "./templateGroupService";

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
  autoScaffoldedVariables?: string[]; // Names ever auto-seeded into Default; see ensureTemplateVariablesScaffolded
  autoScaffoldedRequestParams?: string[]; // Same, for URL query params
}

export interface ContextItemWithSource {
  value: unknown;
  source: "environment" | "template";
}

export class ContextManager implements IContextServices, vscode.WebviewViewProvider {
  /** The Context Manager view in the Velocity container on the Activity Bar (see package.json). */
  public static readonly viewId = "velocity.contextManager";

  public readonly context: vscode.ExtensionContext;
  public readonly contextCache: Map<string, ContextFileData> = new Map();
  public view: vscode.WebviewView | undefined;
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
  private readonly templateGroupService: TemplateGroupService;
  private readonly renderer: ContextWebviewRenderer;

  constructor(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel,
  ) {
    this.context = context;
    this.outputChannel = outputChannel;
    this.envService = new EnvironmentContextService(this);
    this.templateDataService = new TemplateDataService(this);
    this.inputDialogService = new InputDialogService(this);
    this.scenarioService = new ScenarioService(this);
    this.templateGroupService = new TemplateGroupService(this);
    this.renderer = new ContextWebviewRenderer(this);
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
          contextFilePath &&
          (uri.fsPath === contextFilePath ||
            uri.fsPath.toLowerCase() === contextFilePath.toLowerCase())
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
  public async writeContextFile(
    filePath: string,
    content: string,
  ): Promise<void> {
    this.suppressFileWatcherCount++;
    try {
      await fs.promises.writeFile(filePath, content, "utf8");
    } finally {
      // Decrement counter after delay to cover async FS event delivery
      setTimeout(() => {
        this.suppressFileWatcherCount = Math.max(
          0,
          this.suppressFileWatcherCount - 1,
        );
      }, 100);
    }
  }

  /**
   * Save template context - decides whether to save to environment or local file
   * NEW ARCHITECTURE: Prioritizes environment context storage
   */
  public async saveTemplateContext(
    templatePath: string,
    contextData: ContextFileData,
  ): Promise<void> {
    // If environment context is loaded, ALWAYS save to environment
    if (this.environmentContext.filePath && this.environmentContextLoaded) {
      this.saveTemplateContextToEnvironment(templatePath, contextData);

      // Clear cache to ensure fresh data is loaded on next read
      const contextFilePath = this.getContextFilePath(templatePath);
      if (contextFilePath) {
        this.contextCache.delete(contextFilePath);
      }
      return;
    }

    // Fallback: Save to local .context.json file (LEGACY)
    const contextFilePath = this.getContextFilePath(templatePath);
    if (contextFilePath) {
      await this.writeContextFile(
        contextFilePath,
        JSON.stringify(contextData, null, 2),
      );
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
          templateGroups: parsed.templateGroups || {},
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
        messagesPropertiesPath:
          this.environmentContext.messagesPropertiesPath || undefined,
        messagesPropertiesPaths:
          this.environmentContext.messagesPropertiesPaths || undefined,
        language: this.environmentContext.language || undefined,
        headers: this.environmentContext.headers || "",
        cspDirectives: this.environmentContext.cspDirectives || {},
        context: this.environmentContext.data,
        mockFunctions: this.environmentContext.mockFunctions || {},
        templates: this.environmentContext.templates || {},
        templateGroups: this.environmentContext.templateGroups || {},
      };
      const content = JSON.stringify(dataToSave, null, 2);
      await fs.promises.writeFile(
        this.environmentContext.filePath,
        content,
        "utf8",
      );

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

  public async getContextForTemplate(
    templatePath: string,
  ): Promise<ContextData> {
    // Ensure mappings are detected and saved
    await this.ensureTemplateMappingsDetected(templatePath);

    const templateContextData =
      await this.getTemplateContextFileData(templatePath);

    // Get scenario variables and methods
    const templateItems = await this.getTemplateItems(templatePath);
    const scenarioVariables = this.getScenarioVariables(templateContextData, templateItems);

    const templateMethods = templateContextData.methods || {};

    // Build merged context
    const mergedContext = this.buildMergedContext(
      templateMethods,
      scenarioVariables,
      templateContextData.methodMappings,
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
  public async getContextForSpecificScenario(
    templatePath: string,
    scenarioName: string,
  ): Promise<ContextData> {
    await this.ensureTemplateMappingsDetected(templatePath);

    const templateContextData =
      await this.getTemplateContextFileData(templatePath);

    // Temporarily override active scenario for variable resolution
    const originalActive = templateContextData.activeScenario;
    templateContextData.activeScenario = scenarioName;

    const templateItems = await this.getTemplateItems(templatePath);
    const scenarioVariables = this.getScenarioVariables(templateContextData, templateItems);

    // Restore original active scenario
    templateContextData.activeScenario = originalActive;

    const templateMethods = templateContextData.methods || {};
    const mergedContext = this.buildMergedContext(
      templateMethods,
      scenarioVariables,
      templateContextData.methodMappings,
    );
    await this.addHttpServletRequestIfNeeded(
      mergedContext,
      templatePath,
      templateContextData,
    );
    return mergedContext;
  }

  public async getScenarioInfo(
    templatePath: string,
  ): Promise<{ scenarios: ScenariosData; activeScenario: string }> {
    const templateContextData =
      await this.getTemplateContextFileData(templatePath);

    return {
      scenarios: templateContextData.scenarios || {},
      activeScenario: templateContextData.activeScenario || "Default",
    };
  }

  public async switchScenario(
    templatePath: string,
    scenarioName: string,
  ): Promise<void> {
    const fileData = await this.getTemplateContextFileData(templatePath);

    // Check if scenario exists
    if (!fileData.scenarios?.[scenarioName]) {
      return;
    }

    // Update active scenario
    fileData.activeScenario = scenarioName;

    // Save the context (this will update environment context or local file)
    await this.saveTemplateContext(templatePath, fileData);

    // Clear cache to force reload with new active scenario
    const contextFilePath = this.getContextFilePath(templatePath);
    if (contextFilePath) {
      this.contextCache.delete(contextFilePath);
    }

    // Update Context Manager webview if it's open for this template
    if (this.view && this.templateFilePath === templatePath) {
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
    this.view?.webview.postMessage(message);
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
    if (this.view) {
      void this.updateWebview(templatePath);
    }
  }

  /**
   * Ensures template variable mappings are auto-detected and saved.
   * This runs automatically when a template is accessed (preview, context manager, etc.)
   */
  private async ensureTemplateMappingsDetected(
    templatePath: string,
  ): Promise<void> {
    const templateData = await this.getTemplateContextFileData(templatePath);

    // If all mappings are already set, no need to detect
    if (
      templateData.localeVar &&
      templateData.templateMessagesVar &&
      templateData.escapeToolVar &&
      templateData.httpServletRequestVar !== undefined
    ) {
      return;
    }

    // Read template content and parse to get items
    let templateContent = "";
    try {
      templateContent = await fs.promises.readFile(templatePath, "utf-8");
    } catch (e) {
      this.outputChannel.appendLine(
        `[Context] Failed to read template "${templatePath}": ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }
    const items = Array.from(
      TemplateParser.analyzeContext(templateContent).values(),
    );

    // Detect HttpServletRequest variable
    const httpServletVar =
      templateData.httpServletRequestVar !== ""
        ? await this.detectHttpServletRequestVariable(templatePath)
        : undefined;
    const effectiveVar =
      httpServletVar ||
      (templateData.httpServletRequestVar &&
      templateData.httpServletRequestVar !== ""
        ? templateData.httpServletRequestVar
        : undefined);

    // Detect locale variable
    const localeObjects = items.filter(
      (item) => item.type === "object" && ContextWebviewRenderer.isLocaleObject(item),
    );
    const localeVar =
      templateData.localeVar ||
      (localeObjects.length > 0 ? localeObjects[0].name : undefined);

    // Detect template messages variable
    const messagesObjects = items.filter(
      (item) => item.type === "object" && ContextWebviewRenderer.isTemplateMessagesObject(item),
    );
    const messagesVar =
      templateData.templateMessagesVar ||
      (messagesObjects.length > 0 ? messagesObjects[0].name : undefined);

    // Detect escape tool variable
    const escapeObjects = items.filter(
      (item) => item.type === "object" && ContextWebviewRenderer.isEscapeToolObject(item),
    );
    const escapeVar =
      templateData.escapeToolVar ||
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
    }
  }

  public async getTemplateMappings(
    templatePath: string,
  ): Promise<{
    localeVar?: string;
    templateMessagesVar?: string;
    escapeToolVar?: string;
  }> {
    // Ensure mappings are detected and saved before returning
    await this.ensureTemplateMappingsDetected(templatePath);

    const templateContextData =
      await this.getTemplateContextFileData(templatePath);
    return {
      localeVar: templateContextData.localeVar,
      templateMessagesVar: templateContextData.templateMessagesVar,
      escapeToolVar: templateContextData.escapeToolVar,
    };
  }

  private async loadContextDataFromFile(
    contextFilePath: string,
  ): Promise<ContextFileData> {
    if (!fs.existsSync(contextFilePath)) {
      return this.getEmptyContextData();
    }

    try {
      const content = await fs.promises.readFile(contextFilePath, "utf8");
      const parsed = JSON.parse(content);

      if (!parsed.scenarios) {
        const emptyData = this.getEmptyContextData();
        vscode.window
          .showErrorMessage(
            "Context file is in old format. Please run convert-context-files.js to migrate it, or delete the file to create a new one.",
            "Show File",
          )
          .then((selection) => {
            if (selection === "Show File") {
              vscode.workspace.openTextDocument(contextFilePath).then((doc) => {
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
      vscode.window
        .showErrorMessage(
          `Failed to parse context file: ${e instanceof Error ? e.message : String(e)}`,
          "Show File",
        )
        .then((selection) => {
          if (selection === "Show File") {
            vscode.workspace.openTextDocument(contextFilePath).then((doc) => {
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
    methodMappings?: Record<string, string>,
  ): ContextData {
    const mergedContext: ContextData = { ...this.environmentContext.data };

    this.mergeMethodsIntoContext(mergedContext, templateMethods);
    this.mergeScenarioVariables(mergedContext, scenarioVariables);
    // Mapped template methods call the environment's mock functions
    applyMethodMappings(mergedContext, methodMappings, this.environmentContext.mockFunctions);

    return mergedContext;
  }

  /**
   * The template's variables, objects and methods by static analysis. Uses the open
   * editor's text when there is one, so unsaved edits count.
   */
  private async getTemplateItems(templatePath: string): Promise<ContextItem[]> {
    const openDocument = vscode.workspace.textDocuments.find(
      (d) => !d.isClosed && d.uri.fsPath.toLowerCase() === templatePath.toLowerCase(),
    );
    try {
      const content = openDocument?.getText() ?? (await fs.promises.readFile(templatePath, "utf-8"));
      return Array.from(TemplateParser.analyzeContext(content).values());
    } catch {
      return [];
    }
  }

  private mergeMethodsIntoContext(
    mergedContext: ContextData,
    templateMethods: MethodsRecord,
  ): void {
    // Merge Environment methods with template methods
    for (const [key, value] of Object.entries(mergedContext)) {
      if (this.isMethodsObject(value) && templateMethods[key]) {
        mergedContext[key] = {
          ...(value as Record<string, unknown>),
          ...templateMethods[key],
        };
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
        mergedContext[key] = {
          ...(mergedContext[key] as Record<string, unknown>),
          ...(value as Record<string, unknown>),
        };
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

    // The request URL comes from the active scenario (its own URL or the scenario it
    // takes the URL from), falling back to the legacy top-level url.
    const activeScenarioName = templateContextData.activeScenario || "Default";
    const url = getUrlWithSource(activeScenarioName, templateContextData).url || templateContextData.url;

    if (httpServletVarName && url) {
      const mergedHeaders = this.mergeHeaders(
        this.environmentContext.headers,
        templateContextData.scenarios?.[activeScenarioName]?.headers ?? templateContextData.headers,
      );
      mergedContext[httpServletVarName] = {
        _httpServletRequest: true,
        url,
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

  /** The active scenario's values, resolved the way the Context Manager shows them. */
  private getScenarioVariables(contextData: ContextFileData, templateItems: ContextItem[] = []): ContextData {
    if (!contextData.scenarios) {
      return {};
    }
    return resolveScenarioValues(
      contextData.scenarios,
      contextData.activeScenario || "Default",
      templateItems,
    ) as ContextData;
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

  public async detectHttpServletRequestVariable(
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
          this.outputChannel.appendLine(
            `[Context] Failed to read template "${templatePath}": ${e instanceof Error ? e.message : String(e)}`,
          );
          return undefined;
        }
      }

      // Look for patterns like $HttpServletRequest, $request, $servletRequest
      const regex = /\$(\w*[Ss]ervlet[Rr]equest\w*)/;
      const match = regex.exec(content!);
      if (match) {
        return match[1];
      }
      if (
        content!.includes("$request.getParameter") ||
        content!.includes("$request.getHeader")
      ) {
        return "request";
      }
    } catch (e) {
      this.outputChannel.appendLine(
        `[Context] Unexpected error detecting HttpServletRequest variable: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return undefined;
  }

  public async getTemplateOnlyContext(
    templatePath: string,
  ): Promise<ContextData> {
    const contextFilePath = this.getContextFilePath(templatePath);

    // Check cache first
    let contextFileData: ContextFileData;
    if (this.contextCache.has(contextFilePath!)) {
      contextFileData = this.contextCache.get(
        contextFilePath!,
      ) as ContextFileData;
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
          this.outputChannel.appendLine(
            `[Context] Failed to parse context file "${contextFilePath}": ${e instanceof Error ? e.message : String(e)}`,
          );
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
  private getTemplateContextFromEnvironment(
    templatePath: string,
  ): ContextFileData | null {
    // A group's shared context takes precedence over a per-template entry
    const groupName = this.findTemplateGroupName(templatePath);
    const templateConfig = groupName
      ? this.environmentContext.templateGroups![groupName]
      : this.environmentContext.templates?.[
          this.normalizeTemplatePath(templatePath)
        ];

    if (!templateConfig) {
      return null;
    }

    // Ensure Default scenario exists and is loaded
    if (!templateConfig.scenarios) {
      templateConfig.scenarios = {
        Default: { variables: {} },
      };
    }
    if (!templateConfig.scenarios.Default) {
      templateConfig.scenarios.Default = { variables: {} };
    }
    if (
      !templateConfig.activeScenario ||
      !templateConfig.scenarios[templateConfig.activeScenario]
    ) {
      templateConfig.activeScenario = "Default";
    }

    // Convert to ContextFileData format
    return {
      scenarios: templateConfig.scenarios,
      activeScenario: templateConfig.activeScenario,
      httpServletRequestVar:
        templateConfig.mappedVariables?.httpServletRequestVar,
      localeVar: templateConfig.mappedVariables?.localeVar,
      templateMessagesVar: templateConfig.mappedVariables?.templateMessagesVar,
      escapeToolVar: templateConfig.mappedVariables?.escapeToolVar,
      methodMappings: templateConfig.mappedMethods,
      methods: {},
      autoScaffoldedVariables: templateConfig.autoScaffoldedVariables,
      autoScaffoldedRequestParams: templateConfig.autoScaffoldedRequestParams,
    };
  }

  // Save template context to environment
  private saveTemplateContextToEnvironment(
    templatePath: string,
    contextData: ContextFileData,
  ): void {
    this.environmentContext.templates ??= {};

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

    const templateConfig: TemplateContextInEnvironment = {
      mappedVariables: {
        httpServletRequestVar: contextData.httpServletRequestVar,
        localeVar: contextData.localeVar,
        templateMessagesVar: contextData.templateMessagesVar,
        escapeToolVar: contextData.escapeToolVar,
      },
      mappedMethods: contextData.methodMappings || {},
      scenarios: contextData.scenarios,
      activeScenario: contextData.activeScenario,
      autoScaffoldedVariables: contextData.autoScaffoldedVariables,
      autoScaffoldedRequestParams: contextData.autoScaffoldedRequestParams,
    };

    const groupName = this.findTemplateGroupName(templatePath);
    if (groupName) {
      const groups = this.environmentContext.templateGroups!;
      groups[groupName] = {
        templates: groups[groupName].templates,
        ...templateConfig,
      };
    } else {
      this.environmentContext.templates[
        this.normalizeTemplatePath(templatePath)
      ] = templateConfig;
    }

    this.saveEnvironmentContext();
  }

  /**
   * Returns the name of the context group the template belongs to, if any.
   * Paths are compared after normalization; case-insensitively on Windows.
   */
  public findTemplateGroupName(templatePath: string): string | undefined {
    const groups = this.environmentContext.templateGroups;
    if (!groups) {
      return undefined;
    }
    const normalizedPath = this.normalizeTemplatePath(templatePath);
    for (const [name, group] of Object.entries(groups)) {
      if (
        (group.templates || []).some((member) =>
          isSameTemplatePath(member, normalizedPath),
        )
      ) {
        return name;
      }
    }
    return undefined;
  }

  /** The template's context group and its members as absolute paths, if it's in one. */
  public getTemplateGroupMembers(
    templatePath: string,
  ): { name: string; members: string[] } | undefined {
    const name = this.findTemplateGroupName(templatePath);
    const group = name ? this.environmentContext.templateGroups?.[name] : undefined;
    if (!name || !group) {
      return undefined;
    }
    return { name, members: (group.templates || []).map(resolveTemplatePath) };
  }

  /** True when the template has its own context entry or belongs to a group. */
  private hasTemplateContextInEnvironment(templatePath: string): boolean {
    return (
      !!this.findTemplateGroupName(templatePath) ||
      !!this.environmentContext.templates?.[
        this.normalizeTemplatePath(templatePath)
      ]
    );
  }

  // Normalize template path for consistent lookup
  public normalizeTemplatePath(templatePath: string): string {
    // Use relative path from workspace root if possible
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      const workspaceRoot = workspaceFolders[0].uri.fsPath;
      if (templatePath.startsWith(workspaceRoot)) {
        return path.relative(workspaceRoot, templatePath).replace(/\\/g, "/");
      }
    }
    return templatePath.replace(/\\/g, "/");
  }

  // New method to get just the raw file data (for UI editing)
  public async getTemplateContextFileData(
    templatePath: string,
  ): Promise<ContextFileData> {
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
            if (selection === "Open File") {
              vscode.workspace
                .openTextDocument(contextFilePath!)
                .then((doc) => {
                  vscode.window.showTextDocument(doc);
                });
            }
          });
      }
    }

    // PRIORITY 4: Create empty with Default scenario
    const empty = this.getEmptyContextData();
    if (contextFilePath) {
      this.contextCache.set(contextFilePath, empty);
    }
    return empty;
  }

  public async saveContext(
    templatePath: string,
    contextData: ContextData,
  ): Promise<void> {
    const contextFilePath = this.getContextFilePath(templatePath);

    // Load existing file to preserve structure
    const existingData: ContextFileData =
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
      if (contextFilePath) {
        await this.writeContextFile(contextFilePath, content);
      }
      if (contextFilePath) {
        this.contextCache.set(contextFilePath, existingData);
      }

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
        async () => {
          return new Promise((resolve) => setTimeout(resolve, 3000));
        },
      );
    }

    await this.showContextWebview(templatePath);
  }

  /**
   * If the given environment context file path doesn't exist on disk yet
   * (e.g. the user typed a new filename in the file picker instead of
   * selecting an existing file), asks the user to confirm and, if
   * confirmed, creates it as a fresh, empty environment context
   * registered against the current template. Returns false if the file
   * still doesn't exist afterward (the user declined to create it).
   */
  private async createContextFileIfMissing(
    contextFilePath: string,
    templatePath: string,
  ): Promise<boolean> {
    if (fs.existsSync(contextFilePath)) {
      return true;
    }
    const confirmation = await vscode.window.showWarningMessage(
      `"${path.basename(contextFilePath)}" does not exist. Create it as a new environment context file?`,
      { modal: true },
      "Create File",
    );
    if (confirmation !== "Create File") {
      return false;
    }
    this.environmentContext = {
      filePath: contextFilePath,
      data: {},
      templates: {},
    };
    const emptyContext = this.getEmptyContextData();
    this.saveTemplateContextToEnvironment(templatePath, emptyContext);
    vscode.window.showInformationMessage(
      `Created new environment context: ${path.basename(contextFilePath)}`,
    );
    return true;
  }

  /**
   * Prompts the user to specify an environment context file path, either by
   * browsing to an existing file or by typing a path directly. Native OS
   * "Open" dialogs refuse to return a path that doesn't exist, so typing is
   * offered as a separate option to support creating a new context file
   * from a typed filename.
   */
  private async promptForContextFilePath(
    defaultDir: string,
    dialogTitle: string,
  ): Promise<string | undefined> {
    const choice = await vscode.window.showQuickPick(
      [
        {
          label: "$(folder-opened) Browse for existing file...",
          action: "browse" as const,
        },
        { label: "$(edit) Type a file path...", action: "type" as const },
      ],
      {
        title: dialogTitle,
        placeHolder: "Choose how to specify the environment context file",
        ignoreFocusOut: true,
      },
    );
    if (!choice) {
      return undefined;
    }

    if (choice.action === "browse") {
      const openUri = await vscode.window.showOpenDialog({
        defaultUri: vscode.Uri.file(defaultDir),
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { "JSON Files": ["json"] },
        title: dialogTitle,
      });
      return openUri?.[0]?.fsPath;
    }

    const typed = await vscode.window.showInputBox({
      title: dialogTitle,
      prompt:
        "Enter the path to an environment context file (it will be created if it does not exist)",
      value: path.join(defaultDir, "environment-context.json"),
      ignoreFocusOut: true,
    });
    return typed?.trim() || undefined;
  }

  /**
   * Ensures an environment context file is loaded.
   * Returns false (caller should abort) if the user cancelled all prompts.
   */
  private async ensureEnvironmentContextLoaded(
    templatePath: string,
  ): Promise<boolean> {
    if (this.environmentContext.filePath) {
      return true;
    }

    const action = await vscode.window.showInformationMessage(
      "No environment context file is loaded. An environment context is required to manage template data.",
      "Open Existing Context",
      "Create New Context",
      "Cancel",
    );

    if (action === "Open Existing Context") {
      const contextFilePath = await this.promptForContextFilePath(
        path.dirname(templatePath),
        "Open Environment Context File",
      );
      if (!contextFilePath) {
        return false;
      }
      await this.context.globalState.update(
        "environmentContextPath",
        contextFilePath,
      );
      if (!fs.existsSync(contextFilePath)) {
        return await this.createContextFileIfMissing(
          contextFilePath,
          templatePath,
        );
      }
      await this.loadEnvironmentContextPath();
      vscode.window.showInformationMessage(
        `Loaded environment context: ${path.basename(contextFilePath)}`,
      );
      return true;
    } else if (action === "Create New Context") {
      const saveUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(
          path.join(path.dirname(templatePath), "environment-context.json"),
        ),
        filters: { "JSON Files": ["json"] },
        title: "Create Environment Context File",
        saveLabel: "Create",
      });
      if (!saveUri) {
        return false;
      }
      const contextFilePath = saveUri.fsPath;
      this.environmentContext = {
        filePath: contextFilePath,
        data: {},
        templates: {},
      };
      await this.context.globalState.update(
        "environmentContextPath",
        contextFilePath,
      );
      const emptyContext = this.getEmptyContextData();
      this.saveTemplateContextToEnvironment(templatePath, emptyContext);
      vscode.window.showInformationMessage(
        `Created environment context with template: ${path.basename(contextFilePath)}`,
      );
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
  private async ensureTemplateInEnvironmentContext(
    templatePath: string,
  ): Promise<boolean> {
    if (!this.environmentContext.filePath) {
      return true;
    }
    if (this.hasTemplateContextInEnvironment(templatePath)) {
      return true;
    }

    const action = await vscode.window.showInformationMessage(
      `This template is not defined in the environment context at ${path.basename(this.environmentContext.filePath)}. Would you like to add it?`,
      "Add to Current Context",
      "Open Different Context",
      "Create New Context",
      "Skip",
    );

    if (action === "Add to Current Context") {
      const emptyContext = this.getEmptyContextData();
      this.saveTemplateContextToEnvironment(templatePath, emptyContext);
      vscode.window.showInformationMessage(
        `Added template to environment context with Default scenario`,
      );
    } else if (action === "Open Different Context") {
      const contextFilePath = await this.promptForContextFilePath(
        path.dirname(this.environmentContext.filePath),
        "Open Environment Context File",
      );
      if (!contextFilePath) {
        return false;
      }
      await this.context.globalState.update(
        "environmentContextPath",
        contextFilePath,
      );
      if (!fs.existsSync(contextFilePath)) {
        return await this.createContextFileIfMissing(
          contextFilePath,
          templatePath,
        );
      }
      await this.loadEnvironmentContextPath();
      if (!this.hasTemplateContextInEnvironment(templatePath)) {
        const addResult = await vscode.window.showInformationMessage(
          "Template is not defined in this context either. Add it?",
          "Yes",
          "No",
        );
        if (addResult === "Yes") {
          const emptyContext = this.getEmptyContextData();
          this.saveTemplateContextToEnvironment(templatePath, emptyContext);
          vscode.window.showInformationMessage(
            `Added template to environment context`,
          );
        }
      } else {
        vscode.window.showInformationMessage(
          `Switched to environment context: ${path.basename(contextFilePath)}`,
        );
      }
    } else if (action === "Create New Context") {
      const saveUri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(
          path.join(path.dirname(templatePath), "environment-context.json"),
        ),
        filters: { "JSON Files": ["json"] },
        title: "Create Environment Context File",
        saveLabel: "Create",
      });
      if (!saveUri) {
        return false;
      }
      const contextFilePath = saveUri.fsPath;
      this.environmentContext = {
        filePath: contextFilePath,
        data: {},
        templates: {},
      };
      const emptyContext = this.getEmptyContextData();
      this.saveTemplateContextToEnvironment(templatePath, emptyContext);
      await this.context.globalState.update(
        "environmentContextPath",
        contextFilePath,
      );
      vscode.window.showInformationMessage(
        `Created environment context: ${path.basename(contextFilePath)}`,
      );
    }
    // 'Skip' or no action: continue without registering the template
    return true;
  }

  private async showContextWebview(templatePath: string): Promise<void> {
    this.templateFilePath = templatePath;

    // Reload environment context from file to pick up any external changes
    await this.loadEnvironmentContextPath();

    if (!(await this.ensureEnvironmentContextLoaded(templatePath))) {
      return;
    }
    if (!(await this.ensureTemplateInEnvironmentContext(templatePath))) {
      return;
    }

    if (this.view) {
      this.view.show(false);
      await this.updateWebview(templatePath);
    } else {
      // Opens the view; resolveWebviewView() then renders this template
      await vscode.commands.executeCommand(`${ContextManager.viewId}.focus`);
    }
  }

  /**
   * Called by VS Code when the Context Manager view is first shown, from the
   * Activity Bar icon or from Manage Context. Never prompts: the view may be
   * restored when VS Code starts, so setup is left to Manage Context.
   */
  public async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      // For the "Set up context" link in the placeholder
      enableCommandUris: [ "velocity.manageContext" ],
      localResourceRoots: [
        // Copied there by esbuild.js (node_modules isn't packaged)
        vscode.Uri.joinPath(this.context.extensionUri, "out", "codicons"),
      ],
    };

    webviewView.onDidDispose(() => {
      this.view = undefined;
    });

    webviewView.webview.onDidReceiveMessage(
      async (message) => {
        await this.handleWebviewMessage(message);
      },
      undefined,
      this.context.subscriptions,
    );

    // Opened from the Activity Bar: show the template being edited
    const editor = vscode.window.activeTextEditor;
    if (!this.templateFilePath && editor?.document.languageId === "velocity") {
      this.templateFilePath = editor.document.uri.fsPath;
    }
    if (this.templateFilePath && !this.environmentContext.filePath) {
      await this.loadEnvironmentContextPath();
    }
    await this.updateWebview(this.templateFilePath);
  }

  /** What the view shows when there's no template, or no environment context yet. */
  private showViewPlaceholder(message: string, setUp: boolean): void {
    if (!this.view) {
      return;
    }
    const escapeHtml = (text: string) =>
      text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    this.view.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <style>
    body { padding: 8px 20px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); line-height: 1.5; }
    p { color: var(--vscode-descriptionForeground); }
    a { color: var(--vscode-textLink-foreground); }
  </style>
</head>
<body>
  <p>${escapeHtml(message)}</p>${setUp ? `
  <p><a href="command:velocity.manageContext">Set up context</a></p>` : ""}
</body>
</html>`;
  }

  private buildEnvironmentHandlers(
    // Each handler gets the payload for its own command; isWebviewMessage has checked `command`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    msg: any,
    currentTemplatePath: string,
  ): Record<string, () => Promise<void>> {
    return {
      test: () => this.handleTestCommand(msg),
      openDevTools: () => this.handleOpenDevTools(),
      loadEnvironmentContext: () =>
        this.envService.handleloadEnvironmentContext(currentTemplatePath),
      reloadEnvironmentContext: () =>
        this.envService.handleReloadEnvironmentContext(currentTemplatePath),
      saveEnvironmentContext: () =>
        this.envService.handlesaveEnvironmentContext(currentTemplatePath),
      changeTemplateContextFile: () =>
        this.envService.handleChangeTemplateContextFile(),
      reloadTemplateContext: () =>
        this.envService.handleReloadTemplateContext(currentTemplatePath),
      createTemplateGroup: () =>
        this.templateGroupService.handleCreateTemplateGroup(msg, currentTemplatePath),
      renameTemplateGroup: () =>
        this.templateGroupService.handleRenameTemplateGroup(msg, currentTemplatePath),
      deleteTemplateGroup: () =>
        this.templateGroupService.handleDeleteTemplateGroup(msg, currentTemplatePath),
      addTemplatesToGroup: () =>
        this.templateGroupService.handleAddTemplatesToGroup(msg, currentTemplatePath),
      addTemplateToGroup: () =>
        this.templateGroupService.handleAddTemplateToGroup(msg, currentTemplatePath),
      removeTemplateFromGroup: () =>
        this.templateGroupService.handleRemoveTemplateFromGroup(msg, currentTemplatePath),
      openTemplate: () => this.templateGroupService.handleOpenTemplate(msg),
      saveEnvironmentVariable: () =>
        this.envService.handleSaveEnvironmentVariable(msg, currentTemplatePath),
      saveEnvironmentProperty: () =>
        this.envService.handleSaveEnvironmentProperty(msg, currentTemplatePath),
      saveEnvironmentMethod: () =>
        this.envService.handleSaveEnvironmentMethod(msg, currentTemplatePath),
      saveEnvironmentLanguage: () =>
        this.envService.handleSaveEnvironmentLanguage(msg, currentTemplatePath),
      saveEnvironmentHeaders: () =>
        this.envService.handleSaveEnvironmentHeaders(msg, currentTemplatePath),
      saveEnvironmentHeaderRow: () =>
        this.envService.handleSaveEnvironmentHeaderRow(msg),
      saveNewEnvironmentHeader: () =>
        this.envService.handleSaveNewEnvironmentHeader(msg),
      deleteEnvironmentHeader: () =>
        this.envService.handleDeleteEnvironmentHeader(msg),
      saveEnvironmentCspDirectiveRow: () =>
        this.envService.handleSaveEnvironmentCspDirectiveRow(msg),
      saveNewEnvironmentCspDirective: () =>
        this.envService.handleSaveNewEnvironmentCspDirective(msg),
      deleteEnvironmentCspDirective: () =>
        this.envService.handleDeleteEnvironmentCspDirective(msg),
      saveEnvironmentVariableRow: () =>
        this.envService.handleSaveEnvironmentVariableRow(msg),
      saveNewEnvironmentVariable: () =>
        this.envService.handleSaveNewEnvironmentVariable(msg),
      deleteEnvironmentVariable: () =>
        this.envService.handleDeleteEnvironmentVariable(msg),
      saveNewEnvironmentMockFunction: () =>
        this.envService.handleSaveNewEnvironmentMockFunction(msg),
      saveEnvironmentMockFunctionRow: () =>
        this.envService.handleSaveEnvironmentMockFunctionRow(msg),
      deleteEnvironmentMockFunction: () =>
        this.envService.handleDeleteEnvironmentMockFunction(msg),
      saveMessagesFilePath: () =>
        this.envService.handleSaveMessagesFilePath(msg, currentTemplatePath),
      browseMessagesFile: () =>
        this.envService.handleBrowseMessagesFile(currentTemplatePath),
      deleteMessagesFile: () =>
        this.envService.handleDeleteMessagesFile(msg, currentTemplatePath),
    };
  }

  private buildTemplateDataHandlers(
    // Each handler gets the payload for its own command; isWebviewMessage has checked `command`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    msg: any,
    contextData: ContextData,
    currentTemplatePath: string,
  ): Record<string, () => Promise<void>> {
    return {
      promoteToEnvironment: () =>
        this.templateDataService.handlePromoteToEnvironment(
          msg,
          contextData,
          currentTemplatePath,
        ),
      setVariableSource: () =>
        this.templateDataService.handleSetVariableSource(
          msg,
          contextData,
          currentTemplatePath,
        ),
      setPropertySource: () =>
        this.templateDataService.handleSetPropertySource(
          msg,
          contextData,
          currentTemplatePath,
        ),
      setMethodSource: () =>
        this.templateDataService.handleSetMethodSource(
          msg,
          contextData,
          currentTemplatePath,
        ),
      setSourceEnvironment: () =>
        this.templateDataService.handleSetSourceEnvironment(
          msg,
          contextData,
          currentTemplatePath,
        ),
      setSourceTemplate: () =>
        this.templateDataService.handleSetSourceTemplate(
          msg,
          contextData,
          currentTemplatePath,
        ),
      saveVariable: () =>
        this.templateDataService.handleSaveVariable(
          msg,
          contextData,
          currentTemplatePath,
        ),
      saveProperty: () =>
        this.templateDataService.handleSaveProperty(
          msg,
          contextData,
          currentTemplatePath,
        ),
      saveMethod: () =>
        this.templateDataService.handleSaveMethod(
          msg,
          contextData,
          currentTemplatePath,
        ),
      saveTemplateUrl: () =>
        this.templateDataService.handleSaveTemplateUrl(
          msg,
          currentTemplatePath,
        ),
      saveTemplateHeaders: () =>
        this.templateDataService.handleSaveTemplateHeaders(
          msg,
          currentTemplatePath,
        ),
      saveHttpServletRequestVar: () =>
        this.templateDataService.handleSaveHttpServletRequestVar(
          msg,
          currentTemplatePath,
        ),
      clearHttpServletRequestVar: () =>
        this.templateDataService.handleClearHttpServletRequestVar(
          currentTemplatePath,
        ),
      setLocaleMapping: () =>
        this.templateDataService.handleSaveLocaleVar(msg, currentTemplatePath),
      setMessagesMapping: () =>
        this.templateDataService.handleSaveTemplateMessagesVar(
          msg,
          currentTemplatePath,
        ),
      setEscapeMapping: () =>
        this.templateDataService.handleSaveEscapeToolVar(
          msg,
          currentTemplatePath,
        ),
      addVariableToConfig: () =>
        this.templateDataService.handleAddVariableToConfig(
          msg,
          contextData,
          currentTemplatePath,
        ),
      requestVariableInput: () =>
        this.inputDialogService.handleRequestVariableInput(
          msg,
          contextData,
          currentTemplatePath,
        ),
      requestPropertyInput: () =>
        this.inputDialogService.handleRequestPropertyInput(
          msg,
          contextData,
          currentTemplatePath,
        ),
      requestMethodInput: () =>
        this.inputDialogService.handleRequestMethodInput(
          msg,
          contextData,
          currentTemplatePath,
        ),
      requestDeleteConfirm: () =>
        this.inputDialogService.handleRequestDeleteConfirm(
          msg,
          contextData,
          currentTemplatePath,
        ),
      saveMethodMapping: () =>
        this.scenarioService.handleSaveMethodMapping(
          msg,
          contextData,
          currentTemplatePath,
        ),
    };
  }

  private buildScenarioHandlers(
    // Each handler gets the payload for its own command; isWebviewMessage has checked `command`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    msg: any,
    currentTemplatePath: string,
  ): Record<string, () => Promise<void>> {
    return {
      switchScenario: () =>
        this.scenarioService.handleSwitchScenario(msg, currentTemplatePath),
      createScenario: () =>
        this.scenarioService.handleCreateScenario(currentTemplatePath),
      saveNewScenario: () =>
        this.scenarioService.handleSaveNewScenario(msg, currentTemplatePath),
      deleteScenario: () =>
        this.scenarioService.handleDeleteScenario(msg, currentTemplatePath),
      saveScenarioHeaderValue: () =>
        this.scenarioService.handleSaveScenarioHeaderValue(
          msg,
          currentTemplatePath,
        ),
      saveNewScenarioHeader: () =>
        this.scenarioService.handleSaveNewScenarioHeader(
          msg,
          currentTemplatePath,
        ),
      deleteScenarioHeader: () =>
        this.scenarioService.handleDeleteScenarioHeader(
          msg,
          currentTemplatePath,
        ),
      deleteScenarioVariable: () =>
        this.scenarioService.handleDeleteScenarioVariable(
          msg,
          currentTemplatePath,
        ),
      saveNewScenarioVariable: () =>
        this.scenarioService.handleSaveNewScenarioVariable(
          msg,
          currentTemplatePath,
        ),
      saveScenarioVariableValue: () =>
        this.scenarioService.handleSaveScenarioVariableValue(
          msg,
          currentTemplatePath,
        ),
      toggleScenarioVariableJson: () =>
        this.scenarioService.handleToggleScenarioVariableJson(
          msg,
          currentTemplatePath,
        ),
      toggleScenarioVariableOverride: () =>
        this.scenarioService.handleToggleScenarioVariableOverride(
          msg,
          currentTemplatePath,
        ),
      changeScenarioVariableSource: () =>
        this.scenarioService.handleChangeScenarioVariableSource(
          msg,
          currentTemplatePath,
        ),
      getAvailableScenarioVariables: () =>
        this.scenarioService.handleGetAvailableScenarioVariables(
          currentTemplatePath,
        ),
      editScenarioVariableInEditor: () =>
        this.scenarioService.handleEditScenarioVariableInEditor(
          msg,
          currentTemplatePath,
        ),
      changeUrlSource: () =>
        this.templateDataService.handleChangeUrlSource(
          msg,
          currentTemplatePath,
        ),
      renameScenario: () =>
        this.scenarioService.handleRenameScenario(msg, currentTemplatePath),
      runScreenshots: () => this.handleRunScreenshots(),
    };
  }

  private async handleWebviewMessage(message: unknown): Promise<void> {
    if (!isWebviewMessage(message)) {
      this.outputChannel.appendLine(
        `[Webview] Rejected malformed message: ${JSON.stringify(message)}`,
      );
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = message as any;

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

  private async handleTestCommand(_message: TestCommand): Promise<void> {
    vscode.window.setStatusBarMessage("$(check) Webview button clicked!", 3000);
  }

  private async handleOpenDevTools(): Promise<void> {
    await vscode.commands.executeCommand(
      "workbench.action.webview.openDeveloperTools",
    );
  }

  public async handleRunScreenshots(): Promise<void> {
    if (!this.velocityServer) {
      vscode.window.showErrorMessage(
        "Velocity server is not available. Cannot run screenshot tests.",
      );
      return;
    }

    const templateRootResult = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title:
        "Select template root folder (templates are resolved relative to this)",
    });
    if (!templateRootResult?.[0]) {
      return;
    }
    const templateRoot = templateRootResult[0].fsPath;

    const folderResult = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: "Select output folder to save screenshots",
    });
    if (!folderResult?.[0]) {
      return;
    }
    const outputDir = folderResult[0].fsPath;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Running Screenshot Tests",
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
          },
        );

        if (result.failed === 0) {
          vscode.window.showInformationMessage(
            `Screenshot tests complete: ${result.succeeded} screenshots saved to ${outputDir}`,
          );
        } else {
          const errors = result.results
            .filter((r) => !r.success)
            .map((r) => `${r.template}/${r.scenario}: ${r.error}`)
            .join("\n");
          vscode.window.showWarningMessage(
            `Screenshot tests: ${result.succeeded} succeeded, ${result.failed} failed.\n${errors}`,
          );
        }
      },
    );
  }

  public async updateWebview(templatePath: string): Promise<void> {
    if (!this.view) {
      return;
    }
    if (!templatePath) {
      this.showViewPlaceholder("Open a Velocity template to see and edit its context.", false);
      return;
    }
    if (!this.environmentContext.filePath) {
      this.showViewPlaceholder(
        `${path.basename(templatePath)} needs an environment context before its variables and mocks can be managed.`,
        true,
      );
      return;
    }

    // Scaffold starter values for anything newly detected in the template before
    // building the panel, so the freshly-added placeholders show up immediately.
    // Deliberately only runs here (Context Manager open/refresh) rather than on
    // every preview render, to avoid seeding a placeholder for every partial
    // variable name typed mid-edit.
    // await this.ensureTemplateVariablesScaffolded(templatePath);  // removed: auto-scaffolding is disabled

    const contextData = await this.getTemplateOnlyContext(templatePath);

    // Extract context structure from template
    let contextItems: Map<string, ContextItem> = new Map();
    let parseError: string | undefined;
    try {
      const templateContent = await fs.promises.readFile(templatePath, "utf8");
      contextItems = TemplateParser.analyzeContext(templateContent);
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }

    if (parseError) {
      this.outputChannel.appendLine(`[Context] Failed to analyze template "${templatePath}": ${parseError}`);
    }

    const html = await this.renderer.getWebviewHtml(
      contextData,
      contextItems,
      path.basename(templatePath),
    );

    // A copy of the view's HTML for inspection, when debugging
    if (isDebugLogging()) {
      await fs.promises.writeFile(path.join(os.tmpdir(), "velocity-context-debug.html"), html, "utf8");
    }

    this.view.webview.html = html;
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

  private findDuplicateVariableNames(data: Record<string, unknown>): string[] {
    const names: string[] = [];
    const duplicates = new Set<string>();
    Object.keys(data).forEach((key) => {
      const value = data[key];
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        if (names.includes(key)) { duplicates.add(key); } else { names.push(key); }
      }
    });
    return Array.from(duplicates);
  }

  private findDuplicateMockFunctionNames(mockFunctions: { [name: string]: string }): string[] {
    const duplicates = new Set<string>();
    const seen = new Set<string>();
    Object.keys(mockFunctions || {}).forEach((name) => {
      const normalized = name.toLowerCase();
      if (seen.has(normalized)) { duplicates.add(name); } else { seen.add(normalized); }
    });
    return Array.from(duplicates);
  }
}
