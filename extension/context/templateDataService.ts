import * as fs from "node:fs";
import * as vscode from "vscode";
import { IContextServices, getUrlWithSource } from "./contextManagerServices";
import { ContextData } from "./contextManager";
import {
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
  ChangeUrlSourceCommand,
  SaveTemplateHeadersCommand,
  SaveHttpServletRequestVarCommand,
  SaveLocaleVarCommand,
  SaveTemplateMessagesVarCommand,
  SaveEscapeToolVarCommand,
  AddVariableToConfigCommand,
} from "../shared/messageTypes";

export class TemplateDataService {
  constructor(private readonly deps: IContextServices) {}

  // ---------------------------------------------------------------------------
  // Source management
  // ---------------------------------------------------------------------------

  async handlePromoteToEnvironment(
    message: PromoteToEnvironmentCommand,
    contextData: ContextData,
    currentTemplatePath: string,
  ): Promise<void> {
    if (!(await this.deps.ensureEnvironmentContextFile())) {
      return;
    }
    const ctx = this.deps.getEnvironmentContext();
    if (message.itemType === "variable") {
      ctx.data[message.name] = contextData[message.name];
    } else if (message.itemType === "property") {
      if (!ctx.data[message.objectName]) {
        ctx.data[message.objectName] = {};
      }
      (ctx.data[message.objectName] as Record<string, unknown>)[message.propertyName] =
        (contextData[message.objectName] as Record<string, unknown>)[message.propertyName];
    } else if (message.itemType === "method") {
      if (!ctx.data[message.objectName]) {
        ctx.data[message.objectName] = {};
      }
      (ctx.data[message.objectName] as Record<string, unknown>)[message.methodName] =
        (contextData[message.objectName] as Record<string, unknown>)[message.methodName];
    }
    await this.deps.saveEnvironmentContext();
    void this.deps.updateWebview(currentTemplatePath);
    vscode.window.setStatusBarMessage("$(check) Promoted to environment context", 3000);
  }

  async handleSetVariableSource(
    message: SetVariableSourceCommand,
    contextData: ContextData,
    currentTemplatePath: string,
  ): Promise<void> {
    const ctx = this.deps.getEnvironmentContext();
    if (message.source === "environment") {
      if (!(await this.deps.ensureEnvironmentContextFile())) {
        return;
      }
      if (contextData[message.name] !== undefined) {
        ctx.data[message.name] = contextData[message.name];
        delete contextData[message.name];
        await this.deps.saveEnvironmentContext();
      }
    } else if (ctx.data[message.name] === undefined) {
      contextData[message.name] = "";
    } else {
      contextData[message.name] = ctx.data[message.name];
    }
    await this.deps.saveContext(currentTemplatePath, contextData);
    void this.deps.updateWebview(currentTemplatePath);
  }

  async handleSetPropertySource(
    message: SetPropertySourceCommand,
    contextData: ContextData,
    currentTemplatePath: string,
  ): Promise<void> {
    const ctx = this.deps.getEnvironmentContext();
    if (message.source === "environment") {
      if (!(await this.deps.ensureEnvironmentContextFile())) {
        return;
      }
      if (!ctx.data[message.objectName]) {
        ctx.data[message.objectName] = {};
      }
      const ctxObj = contextData[message.objectName] as
        | Record<string, unknown>
        | undefined;
      if (ctxObj?.[message.propertyName] !== undefined) {
        (ctx.data[message.objectName] as Record<string, unknown>)[
          message.propertyName
        ] = ctxObj[message.propertyName];
        delete ctxObj[message.propertyName];
        if (Object.keys(ctxObj).length === 0) {
          delete contextData[message.objectName];
        }
        await this.deps.saveEnvironmentContext();
      }
    } else {
      if (!contextData[message.objectName]) {
        contextData[message.objectName] = {};
      }
      const ctxObj = contextData[message.objectName] as Record<string, unknown>;
      const envObj = ctx.data[message.objectName] as
        | Record<string, unknown>
        | undefined;
      if (envObj?.[message.propertyName] === undefined) {
        ctxObj[message.propertyName] = "";
      } else {
        ctxObj[message.propertyName] = envObj[message.propertyName];
      }
    }
    await this.deps.saveContext(currentTemplatePath, contextData);
    void this.deps.updateWebview(currentTemplatePath);
  }

  async handleSetMethodSource(
    message: SetMethodSourceCommand,
    contextData: ContextData,
    currentTemplatePath: string,
  ): Promise<void> {
    const ctx = this.deps.getEnvironmentContext();
    if (message.source === "environment") {
      if (!(await this.deps.ensureEnvironmentContextFile())) {
        return;
      }
      if (!ctx.data[message.objectName]) {
        ctx.data[message.objectName] = {};
      }
      const ctxObj = contextData[message.objectName] as
        | Record<string, unknown>
        | undefined;
      if (ctxObj?.[message.methodName] !== undefined) {
        (ctx.data[message.objectName] as Record<string, unknown>)[message.methodName] =
          ctxObj[message.methodName];
        delete ctxObj[message.methodName];
        if (Object.keys(ctxObj).length === 0) {
          delete contextData[message.objectName];
        }
        await this.deps.saveEnvironmentContext();
      }
    } else {
      if (!contextData[message.objectName]) {
        contextData[message.objectName] = {};
      }
      const ctxObj = contextData[message.objectName] as Record<string, unknown>;
      const envObj = ctx.data[message.objectName] as
        | Record<string, unknown>
        | undefined;
      if (envObj?.[message.methodName] === undefined) {
        ctxObj[message.methodName] = { _implementation: 'return ""' };
      } else {
        ctxObj[message.methodName] = envObj[message.methodName];
      }
    }
    await this.deps.saveContext(currentTemplatePath, contextData);
    void this.deps.updateWebview(currentTemplatePath);
  }

  async handleSetSourceEnvironment(
    message: SetSourceEnvironmentCommand,
    contextData: ContextData,
    currentTemplatePath: string,
  ): Promise<void> {
    if (message.itemType === "variable") {
      delete contextData[message.name];
    } else if (message.itemType === "property") {
      if (contextData[message.objectName]) {
        const obj = contextData[message.objectName] as Record<string, unknown>;
        delete obj[message.propertyName];
        if (Object.keys(obj).length === 0) {
          delete contextData[message.objectName];
        }
      }
    } else if (message.itemType === "method") {
      if (contextData[message.objectName]) {
        const obj = contextData[message.objectName] as Record<string, unknown>;
        delete obj[message.methodName];
        if (Object.keys(obj).length === 0) {
          delete contextData[message.objectName];
        }
      }
    }
    await this.deps.saveContext(currentTemplatePath, contextData);
    void this.deps.updateWebview(currentTemplatePath);
  }

  async handleSetSourceTemplate(
    message: SetSourceTemplateCommand,
    contextData: ContextData,
    currentTemplatePath: string,
  ): Promise<void> {
    if (message.itemType === "variable") {
      if (!contextData[message.name]) {
        contextData[message.name] = "";
      }
    } else if (message.itemType === "property") {
      if (!contextData[message.objectName]) {
        contextData[message.objectName] = {};
      }
      const ctxObj = contextData[message.objectName] as Record<string, unknown>;
      if (!ctxObj[message.propertyName]) {
        ctxObj[message.propertyName] = "";
      }
    } else if (message.itemType === "method") {
      if (!contextData[message.objectName]) {
        contextData[message.objectName] = {};
      }
      const ctxObj = contextData[message.objectName] as Record<string, unknown>;
      if (!ctxObj[message.methodName]) {
        ctxObj[message.methodName] = { _implementation: 'return ""' };
      }
    }
    await this.deps.saveContext(currentTemplatePath, contextData);
    void this.deps.updateWebview(currentTemplatePath);
  }

  // ---------------------------------------------------------------------------
  // Template variable / property / method
  // ---------------------------------------------------------------------------

  async handleSaveVariable(
    message: SaveVariableCommand,
    contextData: ContextData,
    currentTemplatePath: string,
  ): Promise<void> {
    contextData[message.name] = message.value;
    await this.deps.saveContext(currentTemplatePath, contextData);
    void this.deps.updateWebview(currentTemplatePath);
    vscode.window.setStatusBarMessage(
      "$(check) Variable $" + message.name + " saved",
      3000,
    );
  }

  async handleSaveProperty(
    message: SavePropertyCommand,
    contextData: ContextData,
    currentTemplatePath: string,
  ): Promise<void> {
    if (!contextData[message.objectName]) {
      contextData[message.objectName] = {};
    }
    (contextData[message.objectName] as Record<string, unknown>)[
      message.propertyName
    ] = message.value;
    await this.deps.saveContext(currentTemplatePath, contextData);
    void this.deps.updateWebview(currentTemplatePath);
    vscode.window.setStatusBarMessage(
      "$(check) Property $" +
        message.objectName +
        "." +
        message.propertyName +
        " saved",
      3000,
    );
  }

  async handleSaveMethod(
    message: SaveMethodCommand,
    contextData: ContextData,
    currentTemplatePath: string,
  ): Promise<void> {
    if (!contextData[message.objectName]) {
      contextData[message.objectName] = {};
    }
    (contextData[message.objectName] as Record<string, unknown>)[message.methodName] = {
      _implementation: message.implementation,
    };
    await this.deps.saveContext(currentTemplatePath, contextData);
    void this.deps.updateWebview(currentTemplatePath);
    vscode.window.setStatusBarMessage(
      "$(check) Method $" +
        message.objectName +
        "." +
        message.methodName +
        "() saved",
      3000,
    );
  }

  // ---------------------------------------------------------------------------
  // Template URL / headers / mappings
  // ---------------------------------------------------------------------------

  async handleSaveTemplateUrl(
    message: SaveTemplateUrlCommand,
    currentTemplatePath: string,
  ): Promise<void> {
    const contextFilePath = this.deps.getContextFilePath(currentTemplatePath);
    let existingData = this.deps.getEmptyContextData();
    if (contextFilePath && fs.existsSync(contextFilePath)) {
      try {
        const content = await fs.promises.readFile(contextFilePath, "utf8");
        existingData = JSON.parse(content);
      } catch (e) {
        this.deps.outputChannel.appendLine(
          `[Context] Failed to read context file "${contextFilePath}": ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    const activeScenario = existingData.activeScenario || "Default";
    if (!existingData.scenarios) {
      existingData.scenarios = { Default: { variables: {} } };
    }
    if (!existingData.scenarios[activeScenario]) {
      existingData.scenarios[activeScenario] = { variables: {} };
    }
    existingData.scenarios[activeScenario].url = message.url;

    await this.deps.saveTemplateContext(currentTemplatePath, existingData);
    void this.deps.updateWebview(currentTemplatePath);
    vscode.window.setStatusBarMessage("$(check) Scenario URL saved", 3000);
  }

  async handleChangeUrlSource(
    message: ChangeUrlSourceCommand,
    currentTemplatePath: string,
  ): Promise<void> {
    const fileData = await this.deps.getTemplateContextFileData(currentTemplatePath);
    const activeScenario = fileData.activeScenario || "Default";

    if (!fileData.scenarios) {
      fileData.scenarios = { Default: { variables: {} } };
    }
    if (!fileData.scenarios[activeScenario]) {
      fileData.scenarios[activeScenario] = { variables: {} };
    }

    if (message.source === "self") {
      delete fileData.scenarios[activeScenario].urlSource;
      if (!fileData.scenarios[activeScenario].url) {
        fileData.scenarios[activeScenario].url = "";
      }
    } else {
      delete fileData.scenarios[activeScenario].url;
      fileData.scenarios[activeScenario].urlSource = message.source;
    }

    await this.deps.saveTemplateContext(currentTemplatePath, fileData);

    const { url, urlSource } = getUrlWithSource(activeScenario, fileData);
    this.deps.postWebviewMessage({
      command: "updateUrl",
      url: url,
      urlSource: urlSource,
    });

    vscode.window.setStatusBarMessage(
      `$(check) URL source changed to ${message.source === "self" ? "Self" : message.source}`,
      3000,
    );
  }

  async handleSaveTemplateHeaders(
    message: SaveTemplateHeadersCommand,
    currentTemplatePath: string,
  ): Promise<void> {
    const contextFilePath = this.deps.getContextFilePath(currentTemplatePath);
    let existingData = this.deps.getEmptyContextData();
    if (contextFilePath && fs.existsSync(contextFilePath)) {
      try {
        const content = await fs.promises.readFile(contextFilePath, "utf8");
        existingData = JSON.parse(content);
      } catch (e) {
        this.deps.outputChannel.appendLine(
          `[Context] Failed to read context file "${contextFilePath}": ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    existingData.headers = message.headers;
    await this.deps.saveTemplateContext(currentTemplatePath, existingData);
    void this.deps.updateWebview(currentTemplatePath);
    vscode.window.setStatusBarMessage("$(check) Template headers saved", 3000);
  }

  async handleSaveHttpServletRequestVar(
    message: SaveHttpServletRequestVarCommand,
    currentTemplatePath: string,
  ): Promise<void> {
    const contextFilePath = this.deps.getContextFilePath(currentTemplatePath);
    let existingData = this.deps.getEmptyContextData();
    if (contextFilePath && fs.existsSync(contextFilePath)) {
      try {
        const content = await fs.promises.readFile(contextFilePath, "utf8");
        existingData = JSON.parse(content);
      } catch (e) {
        this.deps.outputChannel.appendLine(
          `[Context] Failed to read context file "${contextFilePath}": ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    existingData.httpServletRequestVar = message.variable || undefined;
    await this.deps.saveTemplateContext(currentTemplatePath, existingData);
    void this.deps.updateWebview(currentTemplatePath);
    vscode.window.setStatusBarMessage(
      "$(check) HttpServletRequest variable mapped",
      3000,
    );
  }

  async handleClearHttpServletRequestVar(currentTemplatePath: string): Promise<void> {
    const contextFilePath = this.deps.getContextFilePath(currentTemplatePath);
    let existingData = this.deps.getEmptyContextData();
    if (contextFilePath && fs.existsSync(contextFilePath)) {
      try {
        const content = await fs.promises.readFile(contextFilePath, "utf8");
        existingData = JSON.parse(content);
      } catch (e) {
        this.deps.outputChannel.appendLine(
          `[Context] Failed to read context file "${contextFilePath}": ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    existingData.httpServletRequestVar = "";
    await this.deps.saveTemplateContext(currentTemplatePath, existingData);
    void this.deps.updateWebview(currentTemplatePath);
    vscode.window.setStatusBarMessage(
      "$(check) HttpServletRequest mapping cleared",
      3000,
    );
  }

  async handleSaveLocaleVar(
    message: SaveLocaleVarCommand,
    currentTemplatePath: string,
  ): Promise<void> {
    const contextFilePath = this.deps.getContextFilePath(currentTemplatePath);
    let existingData = this.deps.getEmptyContextData();
    if (contextFilePath && fs.existsSync(contextFilePath)) {
      const content = await fs.promises.readFile(contextFilePath, "utf8");
      existingData = JSON.parse(content);
    }
    existingData.localeVar = message.variable || undefined;
    await this.deps.saveTemplateContext(currentTemplatePath, existingData);
    void this.deps.updateWebview(currentTemplatePath);
    vscode.window.setStatusBarMessage(
      "$(check) Locale variable mapping saved",
      3000,
    );
  }

  async handleSaveTemplateMessagesVar(
    message: SaveTemplateMessagesVarCommand,
    currentTemplatePath: string,
  ): Promise<void> {
    const contextFilePath = this.deps.getContextFilePath(currentTemplatePath);
    let existingData = this.deps.getEmptyContextData();
    if (contextFilePath && fs.existsSync(contextFilePath)) {
      const content = await fs.promises.readFile(contextFilePath, "utf8");
      existingData = JSON.parse(content);
    }
    existingData.templateMessagesVar = message.variable || undefined;
    await this.deps.saveTemplateContext(currentTemplatePath, existingData);
    void this.deps.updateWebview(currentTemplatePath);
    vscode.window.setStatusBarMessage(
      "$(check) Template messages variable mapping saved",
      3000,
    );
  }

  async handleSaveEscapeToolVar(
    message: SaveEscapeToolVarCommand,
    currentTemplatePath: string,
  ): Promise<void> {
    const contextFilePath = this.deps.getContextFilePath(currentTemplatePath);
    let existingData = this.deps.getEmptyContextData();
    if (contextFilePath && fs.existsSync(contextFilePath)) {
      const content = await fs.promises.readFile(contextFilePath, "utf8");
      existingData = JSON.parse(content);
    }
    existingData.escapeToolVar = message.variable || undefined;
    await this.deps.saveTemplateContext(currentTemplatePath, existingData);
    void this.deps.updateWebview(currentTemplatePath);
    vscode.window.setStatusBarMessage(
      "$(check) Escape tool variable mapping saved",
      3000,
    );
  }

  async handleAddVariableToConfig(
    message: AddVariableToConfigCommand,
    contextData: ContextData,
    currentTemplatePath: string,
  ): Promise<void> {
    if (message.type === "variable") {
      contextData[message.name] = "";
    } else if (message.type === "object") {
      contextData[message.name] = {};
    }
    await this.deps.saveContext(currentTemplatePath, contextData);
    void this.deps.updateWebview(currentTemplatePath);
    vscode.window.setStatusBarMessage(
      "$(check) Variable $" + message.name + " added to configuration",
      3000,
    );
  }
}
