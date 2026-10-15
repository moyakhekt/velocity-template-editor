import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { IContextServices } from "./contextManagerServices";
import {
  SaveEnvironmentVariableCommand,
  SaveEnvironmentPropertyCommand,
  SaveEnvironmentMethodCommand,
  SaveMessagesFilePathCommand,
  DeleteMessagesFileCommand,
  SaveEnvironmentLanguageCommand,
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
} from "../shared/messageTypes";

export class EnvironmentContextService {
  constructor(private readonly deps: IContextServices) {}

  // ---------------------------------------------------------------------------
  // Load / save the environment context file
  // ---------------------------------------------------------------------------

  async handleloadEnvironmentContext(currentTemplatePath: string): Promise<void> {
    const contextFilePath = await this.promptForContextFilePath(
      path.dirname(currentTemplatePath),
      "Load Environment Context File",
    );
    if (!contextFilePath) { return; }
    try {
      if (!fs.existsSync(contextFilePath)) {
        // User typed a context file path that doesn't exist yet. Confirm
        // before creating it as a fresh, empty environment context.
        const confirmation = await vscode.window.showWarningMessage(
          `"${path.basename(contextFilePath)}" does not exist. Create it as a new environment context file?`,
          { modal: true },
          "Create File",
        );
        if (confirmation !== "Create File") {
          return;
        }
        await fs.promises.mkdir(path.dirname(contextFilePath), { recursive: true });
        const defaultContext = {
          headers: {},
          cspDirectives: {},
          context: {},
          mockFunctions: {},
          templates: {},
        };
        await fs.promises.writeFile(
          contextFilePath,
          JSON.stringify(defaultContext, null, 2),
          "utf8",
        );
        vscode.window.showInformationMessage(
          `Created new environment context: ${path.basename(contextFilePath)}`,
        );
      }
      const content = await fs.promises.readFile(contextFilePath, "utf8");
      const parsed = JSON.parse(content);
      this.deps.setEnvironmentContext({
        filePath: contextFilePath,
        messagesPropertiesPath: parsed.messagesPropertiesPath || undefined,
        messagesPropertiesPaths: parsed.messagesPropertiesPaths || undefined,
        language: parsed.language || undefined,
        headers: parsed.headers || {},
        cspDirectives: parsed.cspDirectives || {},
        mockFunctions: parsed.mockFunctions || {},
        data: parsed.context || parsed.data || {},
        templates: parsed.templates || {},
        templateGroups: parsed.templateGroups || {},
      });

      const duplicateVars = this.findDuplicateVariableNames(
        this.deps.getEnvironmentContext().data,
      );
      if (duplicateVars.length > 0) {
        vscode.window
          .showErrorMessage(
            `Environment context contains duplicate variable names: ${duplicateVars.join(", ")}. Please edit the file to resolve duplicates.`,
            "Open File",
          )
          .then((selection) => {
            if (selection === "Open File") {
              vscode.workspace
                .openTextDocument(contextFilePath)
                .then((doc) => { vscode.window.showTextDocument(doc); });
            }
          });
      }

      const duplicateMocks = this.findDuplicateMockFunctionNames(
        this.deps.getEnvironmentContext().mockFunctions || {},
      );
      if (duplicateMocks.length > 0) {
        vscode.window
          .showErrorMessage(
            `Environment context contains duplicate mock function names: ${duplicateMocks.join(", ")}. Please edit the file to resolve duplicates.`,
            "Open File",
          )
          .then((selection) => {
            if (selection === "Open File") {
              vscode.workspace
                .openTextDocument(contextFilePath)
                .then((doc) => { vscode.window.showTextDocument(doc); });
            }
          });
      }

      this.deps.setEnvironmentContextLoaded(true);
      await this.deps.context.globalState.update(
        "environmentContextPath",
        contextFilePath,
      );
      void this.deps.updateWebview(currentTemplatePath);
      vscode.window.setStatusBarMessage("$(check) Environment context loaded", 3000);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      vscode.window
        .showErrorMessage(
          `Failed to Load Environment Context File: ${errorMsg}`,
          "Open File",
        )
        .then((selection) => {
          if (selection === "Open File") {
            vscode.workspace
              .openTextDocument(contextFilePath)
              .then((doc) => { vscode.window.showTextDocument(doc); });
          }
        });
    }
  }

  /**
   * Prompts the user to specify an environment context file path, either by
   * browsing to an existing file or by typing a path directly. Native OS
   * "Open" dialogs refuse to return a path that doesn't exist, so typing is
   * offered as a separate option to support creating a new context file
   * from a typed filename.
   */
  private async promptForContextFilePath(defaultDir: string, dialogTitle: string): Promise<string | undefined> {
    const choice = await vscode.window.showQuickPick(
      [
        { label: "$(folder-opened) Browse for existing file...", action: "browse" as const },
        { label: "$(edit) Type a file path...", action: "type" as const },
      ],
      { title: dialogTitle, placeHolder: "Choose how to specify the environment context file", ignoreFocusOut: true },
    );
    if (!choice) { return undefined; }

    if (choice.action === "browse") {
      const openUri = await vscode.window.showOpenDialog({
        defaultUri: vscode.Uri.file(defaultDir),
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { JSON: ["json"] },
        title: dialogTitle,
      });
      return openUri?.[0]?.fsPath;
    }

    const typed = await vscode.window.showInputBox({
      title: dialogTitle,
      prompt: "Enter the path to an environment context file (it will be created if it does not exist)",
      value: path.join(defaultDir, "environment-context.json"),
      ignoreFocusOut: true,
    });
    return typed?.trim() || undefined;
  }

  async parseAndAssignEnvironmentContext(filePath: string): Promise<void> {
    const content = await fs.promises.readFile(filePath, "utf8");
    const parsed = JSON.parse(content);
    this.deps.setEnvironmentContext({
      filePath,
      headers: parsed.headers || {},
      cspDirectives: parsed.cspDirectives || {},
      mockFunctions: parsed.mockFunctions || {},
      data: parsed.context || parsed.data || {},
      templates: parsed.templates || {},
      templateGroups: parsed.templateGroups || {},
    });

    const duplicateVars = this.findDuplicateVariableNames(
      this.deps.getEnvironmentContext().data,
    );
    if (duplicateVars.length > 0) {
      vscode.window
        .showErrorMessage(
          `Environment context contains duplicate variable names: ${duplicateVars.join(", ")}. Please edit the file to resolve duplicates.`,
          "Open File",
        )
        .then((selection) => {
          if (selection === "Open File") {
            vscode.workspace
              .openTextDocument(this.deps.getEnvironmentContext().filePath!)
              .then((doc) => { vscode.window.showTextDocument(doc); });
          }
        });
    }

    const duplicateMocks = this.findDuplicateMockFunctionNames(
      this.deps.getEnvironmentContext().mockFunctions || {},
    );
    if (duplicateMocks.length > 0) {
      vscode.window
        .showErrorMessage(
          `Environment context contains duplicate mock function names: ${duplicateMocks.join(", ")}. Please edit the file to resolve duplicates.`,
          "Open File",
        )
        .then((selection) => {
          if (selection === "Open File") {
            vscode.workspace
              .openTextDocument(this.deps.getEnvironmentContext().filePath!)
              .then((doc) => { vscode.window.showTextDocument(doc); });
          }
        });
    }
  }

  async handleReloadEnvironmentContext(currentTemplatePath: string): Promise<void> {
    if (!this.deps.getEnvironmentContext().filePath) {
      vscode.window.showWarningMessage(
        "No environment context file loaded. Please load a file first.",
      );
      return;
    }

    if (!fs.existsSync(this.deps.getEnvironmentContext().filePath!)) {
      vscode.window
        .showErrorMessage(
          `Environment context file not found: ${this.deps.getEnvironmentContext().filePath}`,
          "Load Different File",
        )
        .then((selection) => {
          if (selection === "Load Different File") {
            this.handleloadEnvironmentContext(currentTemplatePath);
          }
        });
      return;
    }

    try {
      await this.parseAndAssignEnvironmentContext(
        this.deps.getEnvironmentContext().filePath!,
      );
      this.deps.setEnvironmentContextLoaded(true);
      void this.deps.updateWebview(currentTemplatePath);
      vscode.window.setStatusBarMessage("$(check) Environment context reloaded", 3000);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      vscode.window
        .showErrorMessage(
          `Failed to reLoad Environment Context File: ${errorMsg}`,
          "Open File",
        )
        .then((selection) => {
          if (selection === "Open File" && this.deps.getEnvironmentContext().filePath) {
            vscode.workspace
              .openTextDocument(this.deps.getEnvironmentContext().filePath!)
              .then((doc) => { vscode.window.showTextDocument(doc); });
          }
        });
    }
  }

  async handleChangeTemplateContextFile(): Promise<void> {
    vscode.window.showInformationMessage(
      "Template context is now managed through the Environment Context file. Use the Environment Context tab to manage settings.",
    );
  }

  async handleReloadTemplateContext(currentTemplatePath: string): Promise<void> {
    this.deps.contextCache.delete(currentTemplatePath);
    void this.deps.updateWebview(currentTemplatePath);
    vscode.window.setStatusBarMessage(
      "$(check) Template context reloaded from environment",
      3000,
    );
  }

  async handlesaveEnvironmentContext(currentTemplatePath: string): Promise<void> {
    const saveFile = await vscode.window.showSaveDialog({
      filters: { JSON: ["json"] },
      defaultUri: this.deps.getEnvironmentContext().filePath
        ? vscode.Uri.file(this.deps.getEnvironmentContext().filePath!)
        : undefined,
      title: "Save Environment Context File",
    });
    if (saveFile) {
      this.deps.getEnvironmentContext().filePath = saveFile.fsPath;
      await this.deps.context.globalState.update(
        "environmentContextPath",
        saveFile.fsPath,
      );
      await this.deps.saveEnvironmentContext();
      void this.deps.updateWebview(currentTemplatePath);
      vscode.window.setStatusBarMessage("$(check) Environment context saved", 3000);
    }
  }

  // ---------------------------------------------------------------------------
  // Environment variable / property / method
  // ---------------------------------------------------------------------------

  async handleSaveEnvironmentVariable(
    message: SaveEnvironmentVariableCommand,
    currentTemplatePath: string,
  ): Promise<void> {
    if (!(await this.deps.ensureEnvironmentContextFile())) {
      return;
    }
    this.deps.getEnvironmentContext().data[message.name] = message.value;
    await this.deps.saveEnvironmentContext();
    void this.deps.updateWebview(currentTemplatePath);
    vscode.window.setStatusBarMessage(
      "$(check) Environment variable $" + message.name + " saved",
      3000,
    );
  }

  async handleSaveEnvironmentProperty(
    message: SaveEnvironmentPropertyCommand,
    currentTemplatePath: string,
  ): Promise<void> {
    if (!(await this.deps.ensureEnvironmentContextFile())) {
      return;
    }
    const ctx = this.deps.getEnvironmentContext();
    if (!ctx.data[message.objectName]) {
      ctx.data[message.objectName] = {};
    }
    (ctx.data[message.objectName] as Record<string, unknown>)[message.propertyName] =
      message.value;
    await this.deps.saveEnvironmentContext();
    void this.deps.updateWebview(currentTemplatePath);
    vscode.window.setStatusBarMessage("$(check) Environment property saved", 3000);
  }

  async handleSaveEnvironmentMethod(
    message: SaveEnvironmentMethodCommand,
    currentTemplatePath: string,
  ): Promise<void> {
    if (!(await this.deps.ensureEnvironmentContextFile())) {
      return;
    }
    const ctx = this.deps.getEnvironmentContext();
    if (!ctx.data[message.objectName]) {
      ctx.data[message.objectName] = {};
    }
    (ctx.data[message.objectName] as Record<string, unknown>)[message.methodName] = {
      _implementation: message.implementation,
    };
    await this.deps.saveEnvironmentContext();
    void this.deps.updateWebview(currentTemplatePath);
    vscode.window.setStatusBarMessage("$(check) Environment method saved", 3000);
  }

  // ---------------------------------------------------------------------------
  // Messages / language
  // ---------------------------------------------------------------------------

  async handleSaveMessagesFilePath(
    message: SaveMessagesFilePathCommand,
    currentTemplatePath: string,
  ): Promise<void> {
    this.deps.getEnvironmentContext().messagesPropertiesPath =
      message.filePath || undefined;
    await this.deps.saveEnvironmentContext();
    void this.deps.updateWebview(currentTemplatePath);
    vscode.window.setStatusBarMessage("$(check) Messages file path saved", 3000);
  }

  async handleBrowseMessagesFile(currentTemplatePath: string): Promise<void> {
    const fileUri = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      filters: { "Properties Files": ["properties"], "All Files": ["*"] },
      title: "Select Messages Properties Files",
    });
    if (fileUri && fileUri.length > 0) {
      const ctx = this.deps.getEnvironmentContext();
      if (!ctx.messagesPropertiesPaths) {
        ctx.messagesPropertiesPaths = [];
      }
      for (const uri of fileUri) {
        const filePath = uri.fsPath;
        if (!ctx.messagesPropertiesPaths.includes(filePath)) {
          ctx.messagesPropertiesPaths.push(filePath);
        }
      }
      await this.deps.saveEnvironmentContext();
      void this.deps.updateWebview(currentTemplatePath);
      this.deps.refreshPreviewIfOpen(currentTemplatePath);
      vscode.window.setStatusBarMessage(
        `$(check) ${fileUri.length} message file(s) added`,
        3000,
      );
    }
  }

  async handleDeleteMessagesFile(
    message: DeleteMessagesFileCommand,
    currentTemplatePath: string,
  ): Promise<void> {
    const fileIndex = parseInt(message.fileIndex, 10);
    const ctx = this.deps.getEnvironmentContext();
    if (
      !ctx.messagesPropertiesPaths ||
      fileIndex < 0 ||
      fileIndex >= ctx.messagesPropertiesPaths.length
    ) {
      return;
    }
    ctx.messagesPropertiesPaths.splice(fileIndex, 1);
    await this.deps.saveEnvironmentContext();
    void this.deps.updateWebview(currentTemplatePath);
    this.deps.refreshPreviewIfOpen(currentTemplatePath);
    vscode.window.setStatusBarMessage("$(check) Message file removed", 3000);
  }

  async handleSaveEnvironmentLanguage(
    message: SaveEnvironmentLanguageCommand,
    currentTemplatePath: string,
  ): Promise<void> {
    this.deps.getEnvironmentContext().language = message.language || "en";
    await this.deps.saveEnvironmentContext();
    void this.deps.updateWebview(currentTemplatePath);
    vscode.window.setStatusBarMessage("$(check) Environment language saved", 3000);
  }

  // ---------------------------------------------------------------------------
  // Environment headers
  // ---------------------------------------------------------------------------

  async handleSaveEnvironmentHeaders(
    message: SaveEnvironmentHeadersCommand,
    currentTemplatePath: string,
  ): Promise<void> {
    if (!(await this.deps.ensureEnvironmentContextFile())) {
      return;
    }
    this.deps.getEnvironmentContext().headers = message.headers;
    await this.deps.saveEnvironmentContext();
    void this.deps.updateWebview(currentTemplatePath);
    vscode.window.setStatusBarMessage("$(check) Environment headers saved", 3000);
  }

  async handleSaveEnvironmentHeaderRow(
    message: SaveEnvironmentHeaderRowCommand,
  ): Promise<void> {
    if (!(await this.deps.ensureEnvironmentContextFile())) {
      return;
    }
    const ctx = this.deps.getEnvironmentContext();
    ctx.headers ??= {};

    const oldName = (message.oldName || "").trim();
    const part = message.part;
    const value = (message.value || "").trim();
    const existingKey = oldName
      ? this.findHeaderKey(ctx.headers, oldName)
      : undefined;
    if (!existingKey) {
      return;
    }

    let updatedName = existingKey;
    if (part === "name") {
      if (value === "") {
        vscode.window.showErrorMessage("Header name is required.");
        return;
      }
      if (!this.isPrintableAscii(value)) {
        vscode.window.showErrorMessage(
          "Header names must use printable ASCII characters.",
        );
        return;
      }
      const normalizedName = this.normalizeHeaderName(value);
      const duplicateKey = this.findHeaderKey(ctx.headers, normalizedName);
      if (duplicateKey && duplicateKey !== existingKey) {
        vscode.window.showErrorMessage(`Header name "${value}" already exists.`);
        return;
      }
      const oldValue = ctx.headers[existingKey];
      delete ctx.headers[existingKey];
      ctx.headers[normalizedName] = oldValue;
      updatedName = normalizedName;
    } else if (part === "value") {
      if (value === "") {
        vscode.window.showErrorMessage("Header value is required.");
        return;
      }
      if (!this.isPrintableAscii(value)) {
        vscode.window.showErrorMessage(
          "Header values must use printable ASCII characters.",
        );
        return;
      }
      ctx.headers[existingKey] = value;
    }

    await this.deps.saveEnvironmentContext();
    this.deps.postWebviewMessage({
      command: "upsertEnvironmentHeaderRow",
      oldName: existingKey === updatedName ? undefined : existingKey,
      name: updatedName,
      value: ctx.headers[updatedName],
    });
    vscode.window.setStatusBarMessage("$(check) Header updated", 3000);
  }

  async handleSaveNewEnvironmentHeader(
    message: SaveNewEnvironmentHeaderCommand,
  ): Promise<void> {
    if (!(await this.deps.ensureEnvironmentContextFile())) {
      return;
    }
    const ctx = this.deps.getEnvironmentContext();
    if (!ctx.headers) {
      ctx.headers = {};
    }

    const name = (message.name || "").trim();
    const value = (message.value || "").trim();

    if (name === "" || value === "") {
      vscode.window.showErrorMessage("Both header name and value are required.");
      return;
    }
    if (!this.isPrintableAscii(name)) {
      vscode.window.showErrorMessage(
        "Header names must use printable ASCII characters.",
      );
      return;
    }
    if (!this.isPrintableAscii(value)) {
      vscode.window.showErrorMessage(
        "Header values must use printable ASCII characters.",
      );
      return;
    }

    const normalizedName = this.normalizeHeaderName(name);
    if (this.findHeaderKey(ctx.headers, normalizedName)) {
      vscode.window.showErrorMessage(`Header name "${name}" already exists.`);
      return;
    }

    ctx.headers[normalizedName] = value;
    await this.deps.saveEnvironmentContext();
    this.deps.postWebviewMessage({
      command: "upsertEnvironmentHeaderRow",
      name: normalizedName,
      value: ctx.headers[normalizedName],
    });
    vscode.window.setStatusBarMessage("$(check) Header added", 3000);
  }

  async handleDeleteEnvironmentHeader(
    message: DeleteEnvironmentHeaderCommand,
  ): Promise<void> {
    if (!(await this.deps.ensureEnvironmentContextFile())) {
      return;
    }
    const ctx = this.deps.getEnvironmentContext();
    if (!ctx.headers) {
      return;
    }

    const headerName = message.name;
    if (
      headerName !== undefined &&
      Object.prototype.hasOwnProperty.call(ctx.headers, headerName)
    ) {
      delete ctx.headers[headerName];
      await this.deps.saveEnvironmentContext();
      this.deps.postWebviewMessage({
        command: "deleteEnvironmentHeaderRow",
        name: headerName,
      });
      vscode.window.setStatusBarMessage("$(check) Header deleted", 3000);
    }
  }

  // ---------------------------------------------------------------------------
  // CSP directives
  // ---------------------------------------------------------------------------

  async handleSaveNewEnvironmentCspDirective(
    message: SaveNewEnvironmentCspDirectiveCommand,
  ): Promise<void> {
    if (!(await this.deps.ensureEnvironmentContextFile())) {
      return;
    }
    const ctx = this.deps.getEnvironmentContext();
    if (!ctx.cspDirectives) {
      ctx.cspDirectives = {};
    }

    const directive = (message.name || "").trim();
    const value = (message.value || "").trim();

    if (directive === "" || value === "") {
      vscode.window.showErrorMessage("Both CSP directive and value are required.");
      return;
    }
    if (Object.prototype.hasOwnProperty.call(ctx.cspDirectives, directive)) {
      vscode.window.showErrorMessage(`CSP directive "${directive}" already exists.`);
      return;
    }

    ctx.cspDirectives[directive] = value;
    await this.deps.saveEnvironmentContext();
    this.deps.postWebviewMessage({
      command: "upsertEnvironmentCspDirectiveRow",
      name: directive,
      value: ctx.cspDirectives[directive],
    });
    vscode.window.setStatusBarMessage("$(check) CSP directive added", 3000);
  }

  async handleSaveEnvironmentCspDirectiveRow(
    message: SaveEnvironmentCspDirectiveRowCommand,
  ): Promise<void> {
    if (!(await this.deps.ensureEnvironmentContextFile())) {
      return;
    }
    const ctx = this.deps.getEnvironmentContext();
    if (!ctx.cspDirectives) {
      ctx.cspDirectives = {};
    }

    const existingDirective = message.oldName;
    const part = message.part;
    const value = (message.value || "").trim();

    if (!existingDirective) {
      vscode.window.showErrorMessage(
        "Cannot update: original directive name is missing.",
      );
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(ctx.cspDirectives, existingDirective)) {
      vscode.window.showErrorMessage(
        `CSP directive "${existingDirective}" does not exist.`,
      );
      return;
    }

    let updatedDirective = existingDirective;
    if (part === "name") {
      if (value === "") {
        vscode.window.showErrorMessage("CSP directive name is required.");
        return;
      }
      if (
        value !== existingDirective &&
        Object.prototype.hasOwnProperty.call(ctx.cspDirectives, value)
      ) {
        vscode.window.showErrorMessage(`CSP directive "${value}" already exists.`);
        return;
      }
      const oldValue = ctx.cspDirectives[existingDirective];
      delete ctx.cspDirectives[existingDirective];
      ctx.cspDirectives[value] = oldValue;
      updatedDirective = value;
    } else if (part === "value") {
      if (value === "") {
        vscode.window.showErrorMessage("CSP directive value is required.");
        return;
      }
      ctx.cspDirectives[existingDirective] = value;
    }

    await this.deps.saveEnvironmentContext();
    this.deps.postWebviewMessage({
      command: "upsertEnvironmentCspDirectiveRow",
      oldName: existingDirective !== updatedDirective ? existingDirective : undefined,
      name: updatedDirective,
      value: ctx.cspDirectives[updatedDirective],
    });
    vscode.window.setStatusBarMessage("$(check) CSP directive updated", 3000);
  }

  async handleDeleteEnvironmentCspDirective(
    message: DeleteEnvironmentCspDirectiveCommand,
  ): Promise<void> {
    if (!(await this.deps.ensureEnvironmentContextFile())) {
      return;
    }
    const ctx = this.deps.getEnvironmentContext();
    if (!ctx.cspDirectives) {
      return;
    }

    const directive = message.name;
    if (
      directive !== undefined &&
      Object.prototype.hasOwnProperty.call(ctx.cspDirectives, directive)
    ) {
      delete ctx.cspDirectives[directive];
      await this.deps.saveEnvironmentContext();
      this.deps.postWebviewMessage({
        command: "deleteEnvironmentCspDirectiveRow",
        name: directive,
      });
      vscode.window.setStatusBarMessage("$(check) CSP directive deleted", 3000);
    }
  }

  // ---------------------------------------------------------------------------
  // Environment variables
  // ---------------------------------------------------------------------------

  async handleSaveNewEnvironmentVariable(
    message: SaveNewEnvironmentVariableCommand,
  ): Promise<void> {
    if (!(await this.deps.ensureEnvironmentContextFile())) {
      return;
    }
    const ctx = this.deps.getEnvironmentContext();
    const name = (message.name || "").trim();
    const value = (message.value || "").trim();

    if (name === "" || value === "") {
      vscode.window.showErrorMessage("Both variable name and value are required.");
      return;
    }
    if (Object.prototype.hasOwnProperty.call(ctx.data, name)) {
      const existingValue = ctx.data[name];
      if (typeof existingValue !== "object" || existingValue === null) {
        vscode.window.showErrorMessage(`Variable name "${name}" already exists.`);
        return;
      }
    }
    if (
      ctx.mockFunctions &&
      Object.prototype.hasOwnProperty.call(ctx.mockFunctions, name)
    ) {
      vscode.window.showErrorMessage(
        `Variable name "${name}" already exists as a mock function.`,
      );
      return;
    }

    ctx.data[name] = value;
    await this.deps.saveEnvironmentContext();
    this.deps.postWebviewMessage({
      command: "upsertEnvironmentVariableRow",
      name: name,
      value: ctx.data[name],
    });
    vscode.window.setStatusBarMessage("$(check) Variable added", 3000);
  }

  async handleDeleteEnvironmentVariable(
    message: DeleteEnvironmentVariableCommand,
  ): Promise<void> {
    if (!(await this.deps.ensureEnvironmentContextFile())) {
      return;
    }
    const ctx = this.deps.getEnvironmentContext();
    const varName = message.name;
    if (
      varName !== undefined &&
      Object.prototype.hasOwnProperty.call(ctx.data, varName)
    ) {
      delete ctx.data[varName];
      await this.deps.saveEnvironmentContext();
      this.deps.postWebviewMessage({
        command: "deleteEnvironmentVariableRow",
        name: varName,
      });
      vscode.window.setStatusBarMessage("$(check) Variable deleted", 3000);
    }
  }

  async handleSaveEnvironmentVariableRow(
    message: SaveEnvironmentVariableRowCommand,
  ): Promise<void> {
    if (!(await this.deps.ensureEnvironmentContextFile())) {
      return;
    }
    const ctx = this.deps.getEnvironmentContext();
    const oldName = message.oldName;
    const part = message.part;
    const value = message.value;
    let updatedName = oldName;

    if (part === "name" && oldName) {
      if (oldName !== value) {
        if (Object.prototype.hasOwnProperty.call(ctx.data, value)) {
          const existingValue = ctx.data[value];
          if (typeof existingValue !== "object" || existingValue === null) {
            vscode.window
              .showErrorMessage(
                `Variable name "${value}" already exists. Please choose a different name.`,
                "Open File",
              )
              .then((selection) => {
                if (selection === "Open File" && ctx.filePath) {
                  vscode.workspace
                    .openTextDocument(ctx.filePath)
                    .then((doc) => { vscode.window.showTextDocument(doc); });
                }
              });
            return;
          }
        }
        if (
          ctx.mockFunctions &&
          Object.prototype.hasOwnProperty.call(ctx.mockFunctions, value)
        ) {
          vscode.window
            .showErrorMessage(
              `Variable name "${value}" already exists as a mock function. Please choose a different name.`,
              "Open File",
            )
            .then((selection) => {
              if (selection === "Open File" && ctx.filePath) {
                vscode.workspace
                  .openTextDocument(ctx.filePath)
                  .then((doc) => { vscode.window.showTextDocument(doc); });
              }
            });
          return;
        }
        const oldValue = ctx.data[oldName];
        delete ctx.data[oldName];
        ctx.data[value] = oldValue;
        updatedName = value;
      }
    } else if (part === "value" && oldName) {
      ctx.data[oldName] = value;
    }

    await this.deps.saveEnvironmentContext();
    if (updatedName) {
      this.deps.postWebviewMessage({
        command: "upsertEnvironmentVariableRow",
        oldName: oldName !== updatedName ? oldName : undefined,
        name: updatedName,
        value: ctx.data[updatedName],
      });
    }
    vscode.window.setStatusBarMessage("$(check) Variable updated", 3000);
  }

  // ---------------------------------------------------------------------------
  // Mock functions
  // ---------------------------------------------------------------------------

  async handleSaveNewEnvironmentMockFunction(
    message: SaveNewEnvironmentMockFunctionCommand,
  ): Promise<void> {
    if (!(await this.deps.ensureEnvironmentContextFile())) {
      return;
    }
    const ctx = this.deps.getEnvironmentContext();
    if (!ctx.mockFunctions) {
      ctx.mockFunctions = {};
    }

    const implementation = (message.implementation || "").trim();
    if (implementation === "") {
      vscode.window.showErrorMessage("Mock function implementation is required.");
      return;
    }

    const validation = this.isValidJavaScript(implementation);
    if (!validation.valid) {
      vscode.window.showErrorMessage(
        `Invalid JavaScript syntax: ${validation.error}`,
      );
      return;
    }

    const name = this.extractFunctionName(implementation);
    if (!name) {
      vscode.window.showErrorMessage(
        "Invalid function declaration. First non-empty line must be: function functionName(...) {",
      );
      return;
    }

    if (Object.prototype.hasOwnProperty.call(ctx.mockFunctions, name)) {
      vscode.window.showErrorMessage(`Mock function "${name}" already exists.`);
      return;
    }

    ctx.mockFunctions[name] = implementation;
    await this.deps.saveEnvironmentContext();
    this.deps.postWebviewMessage({
      command: "upsertEnvironmentMockFunctionRow",
      name: name,
      implementation: ctx.mockFunctions[name],
    });
    vscode.window.setStatusBarMessage("$(check) Mock function added", 3000);
  }

  async handleSaveEnvironmentMockFunctionRow(
    message: SaveEnvironmentMockFunctionRowCommand,
  ): Promise<void> {
    if (!(await this.deps.ensureEnvironmentContextFile())) {
      return;
    }
    const ctx = this.deps.getEnvironmentContext();
    if (!ctx.mockFunctions) {
      ctx.mockFunctions = {};
    }

    const oldName = (message.oldName || "").trim();
    const implementation = (message.value || "").trim();

    if (!oldName || !Object.prototype.hasOwnProperty.call(ctx.mockFunctions, oldName)) {
      return;
    }
    if (implementation === "") {
      vscode.window.showErrorMessage("Mock function implementation is required.");
      return;
    }

    const validation = this.isValidJavaScript(implementation);
    if (!validation.valid) {
      vscode.window.showErrorMessage(
        `Invalid JavaScript syntax: ${validation.error}`,
      );
      return;
    }

    const extractedName = this.extractFunctionName(implementation);
    if (!extractedName) {
      vscode.window.showErrorMessage(
        "Invalid function declaration. First non-empty line must be: function functionName(...) {",
      );
      return;
    }

    if (
      extractedName !== oldName &&
      Object.prototype.hasOwnProperty.call(ctx.mockFunctions, extractedName)
    ) {
      vscode.window.showErrorMessage(
        `Mock function "${extractedName}" already exists.`,
      );
      return;
    }

    if (oldName && oldName !== extractedName) {
      delete ctx.mockFunctions[oldName];
    }
    ctx.mockFunctions[extractedName] = implementation;
    await this.deps.saveEnvironmentContext();
    this.deps.postWebviewMessage({
      command: "upsertEnvironmentMockFunctionRow",
      oldName: oldName !== extractedName ? oldName : undefined,
      name: extractedName,
      implementation: ctx.mockFunctions[extractedName],
    });
    vscode.window.setStatusBarMessage("$(check) Mock function updated", 3000);
  }

  async handleDeleteEnvironmentMockFunction(
    message: DeleteEnvironmentMockFunctionCommand,
  ): Promise<void> {
    if (!(await this.deps.ensureEnvironmentContextFile())) {
      return;
    }
    const ctx = this.deps.getEnvironmentContext();
    if (!ctx.mockFunctions) {
      ctx.mockFunctions = {};
    }

    const name = (message.name || "").trim();
    if (!name) {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(ctx.mockFunctions, name)) {
      delete ctx.mockFunctions[name];
      await this.deps.saveEnvironmentContext();
      this.deps.postWebviewMessage({
        command: "deleteEnvironmentMockFunctionRow",
        name: name,
      });
      vscode.window.setStatusBarMessage("$(check) Mock function deleted", 3000);
    }
  }

  // ---------------------------------------------------------------------------
  // Private utility helpers
  // ---------------------------------------------------------------------------

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

  private extractFunctionName(implementation: string): string | null {
    const lines = implementation.split("\n");
    const firstLine = lines.find((line) => line.trim() !== "");
    if (!firstLine) {
      return null;
    }
    const match = /^\s*function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/.exec(firstLine);
    return match ? match[1] : null;
  }

  private isValidJavaScript(code: string): { valid: boolean; error?: string } {
    try {
      // Checks syntax only; does not execute the code.
  new Function(code);
      return { valid: true };
    } catch (e) {
      return { valid: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  private findDuplicateVariableNames(data: Record<string, unknown>): string[] {
    const names: string[] = [];
    const duplicates = new Set<string>();
    Object.keys(data).forEach((key) => {
      const value = data[key];
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
}
