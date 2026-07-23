import * as vscode from "vscode";
import { IContextServices } from "./contextManagerServices";
import { ContextData } from "./contextManager";
import {
  RequestVariableInputCommand,
  RequestPropertyInputCommand,
  RequestMethodInputCommand,
  RequestDeleteConfirmCommand,
} from "../shared/messageTypes";

export class InputDialogService {
  constructor(private readonly deps: IContextServices) {}

  async handleRequestVariableInput(
    message: RequestVariableInputCommand,
    contextData: ContextData,
    currentTemplatePath: string,
  ): Promise<void> {
    const varType = message.inferredType || "string";

    if (varType === "boolean") {
      await this.handleBooleanVariableInput(message, contextData, currentTemplatePath);
    } else if (varType === "number") {
      await this.handleNumberVariableInput(message, contextData, currentTemplatePath);
    } else {
      await this.handleStringVariableInput(message, contextData, currentTemplatePath, varType);
    }
  }

  async handleRequestPropertyInput(
    message: RequestPropertyInputCommand,
    contextData: ContextData,
    currentTemplatePath: string,
  ): Promise<void> {
    const propType = message.inferredType || "string";

    if (propType === "boolean") {
      await this.handleBooleanPropertyInput(message, contextData, currentTemplatePath);
    } else if (propType === "number") {
      await this.handleNumberPropertyInput(message, contextData, currentTemplatePath);
    } else {
      await this.handleStringPropertyInput(message, contextData, currentTemplatePath, propType);
    }
  }

  async handleRequestMethodInput(
    message: RequestMethodInputCommand,
    contextData: ContextData,
    currentTemplatePath: string,
  ): Promise<void> {
    let template: string;
    if (message.paramCount === 0) {
      template = 'return "Mock result"';
    } else if (message.paramCount === 1) {
      template = 'return args[0] + " processed"';
    } else {
      template = 'return args[0] + "-" + args[1]';
    }

    const methodImpl = await vscode.window.showInputBox({
      prompt: `Enter implementation for $${message.objectName}.${message.methodName}() - Parameters available in args array`,
      value: template,
      validateInput: (text) =>
        !text?.trim() ? "Implementation cannot be empty" : null,
    });
    if (methodImpl?.trim()) {
      if (!contextData[message.objectName]) {
        contextData[message.objectName] = {};
      }
      (contextData[message.objectName] as Record<string, unknown>)[message.methodName] = {
        _implementation: methodImpl,
      };
      await this.deps.saveContext(currentTemplatePath, contextData);
      void this.deps.updateWebview(currentTemplatePath);
      vscode.window.setStatusBarMessage(
        `$(check) Method $${message.objectName}.${message.methodName}() configured`,
        3000,
      );
    }
  }

  async handleRequestDeleteConfirm(
    message: RequestDeleteConfirmCommand,
    contextData: ContextData,
    currentTemplatePath: string,
  ): Promise<void> {
    const deleteChoice = await vscode.window.showWarningMessage(
      message.message,
      { modal: true },
      "Delete",
    );
    if (deleteChoice === "Delete") {
      if (message.type === "variable") {
        delete contextData[message.name];
      } else if (message.type === "property") {
        if (contextData[message.objectName]) {
          const obj = contextData[message.objectName] as Record<string, unknown>;
          delete obj[message.propertyName];
          if (Object.keys(obj).length === 0) {
            delete contextData[message.objectName];
          }
        }
      } else if (message.type === "method") {
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
      this.deps.refreshPreviewIfOpen(currentTemplatePath);
      vscode.window.setStatusBarMessage("$(check) Deleted successfully", 3000);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers for variable input
  // ---------------------------------------------------------------------------

  private async handleBooleanVariableInput(
    message: RequestVariableInputCommand,
    contextData: ContextData,
    currentTemplatePath: string,
  ): Promise<void> {
    const boolChoice = await vscode.window.showQuickPick(["true", "false"], {
      placeHolder: `Select value for $${message.name}`,
      title: `Configure $${message.name} (Boolean)`,
    });
    if (boolChoice !== undefined) {
      contextData[message.name] = boolChoice === "true";
      await this.deps.saveContext(currentTemplatePath, contextData);
      void this.deps.updateWebview(currentTemplatePath);
      vscode.window.setStatusBarMessage(
        `$(check) Variable $${message.name} = ${boolChoice}`,
        3000,
      );
    }
  }

  private async handleNumberVariableInput(
    message: RequestVariableInputCommand,
    contextData: ContextData,
    currentTemplatePath: string,
  ): Promise<void> {
    const varValue = await vscode.window.showInputBox({
      prompt: `Enter numeric value for $${message.name}`,
      value: "0",
      validateInput: (text) =>
        Number.isNaN(Number(text)) ? "Please enter a valid number" : null,
    });
    if (varValue !== undefined) {
      contextData[message.name] = Number(varValue);
      await this.deps.saveContext(currentTemplatePath, contextData);
      void this.deps.updateWebview(currentTemplatePath);
      vscode.window.setStatusBarMessage(
        `$(check) Variable $${message.name} = ${varValue}`,
        3000,
      );
    }
  }

  private async handleStringVariableInput(
    message: RequestVariableInputCommand,
    contextData: ContextData,
    currentTemplatePath: string,
    varType: string,
  ): Promise<void> {
    const placeholder = varType === "url" ? "https://example.com" : "Enter text value";
    const varValue = await vscode.window.showInputBox({
      prompt: `Enter ${varType} value for $${message.name}`,
      value: varType === "url" ? "https://" : "",
      placeHolder: placeholder,
    });
    if (varValue !== undefined) {
      contextData[message.name] = varValue;
      await this.deps.saveContext(currentTemplatePath, contextData);
      void this.deps.updateWebview(currentTemplatePath);
      vscode.window.setStatusBarMessage(
        `$(check) Variable $${message.name} configured`,
        3000,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers for property input
  // ---------------------------------------------------------------------------

  private async handleBooleanPropertyInput(
    message: RequestPropertyInputCommand,
    contextData: ContextData,
    currentTemplatePath: string,
  ): Promise<void> {
    const boolChoice = await vscode.window.showQuickPick(["true", "false"], {
      placeHolder: `Select value for $${message.objectName}.${message.propertyName}`,
      title: `Configure $${message.objectName}.${message.propertyName} (Boolean)`,
    });
    if (boolChoice !== undefined) {
      if (!contextData[message.objectName]) {
        contextData[message.objectName] = {};
      }
      (contextData[message.objectName] as Record<string, unknown>)[message.propertyName] =
        boolChoice === "true";
      await this.deps.saveContext(currentTemplatePath, contextData);
      void this.deps.updateWebview(currentTemplatePath);
      vscode.window.setStatusBarMessage(
        `$(check) Property configured = ${boolChoice}`,
        3000,
      );
    }
  }

  private async handleNumberPropertyInput(
    message: RequestPropertyInputCommand,
    contextData: ContextData,
    currentTemplatePath: string,
  ): Promise<void> {
    const propValue = await vscode.window.showInputBox({
      prompt: `Enter numeric value for $${message.objectName}.${message.propertyName}`,
      value: "0",
      validateInput: (text) =>
        Number.isNaN(Number(text)) ? "Please enter a valid number" : null,
    });
    if (propValue !== undefined) {
      if (!contextData[message.objectName]) {
        contextData[message.objectName] = {};
      }
      (contextData[message.objectName] as Record<string, unknown>)[message.propertyName] =
        Number(propValue);
      await this.deps.saveContext(currentTemplatePath, contextData);
      void this.deps.updateWebview(currentTemplatePath);
      vscode.window.setStatusBarMessage(
        `$(check) Property configured = ${propValue}`,
        3000,
      );
    }
  }

  private async handleStringPropertyInput(
    message: RequestPropertyInputCommand,
    contextData: ContextData,
    currentTemplatePath: string,
    propType: string,
  ): Promise<void> {
    const placeholder = propType === "url" ? "https://example.com" : "Enter text value";
    const propValue = await vscode.window.showInputBox({
      prompt: `Enter ${propType} value for $${message.objectName}.${message.propertyName}`,
      value: propType === "url" ? "https://" : "",
      placeHolder: placeholder,
    });
    if (propValue !== undefined) {
      if (!contextData[message.objectName]) {
        contextData[message.objectName] = {};
      }
      (contextData[message.objectName] as Record<string, unknown>)[message.propertyName] =
        propValue;
      await this.deps.saveContext(currentTemplatePath, contextData);
      void this.deps.updateWebview(currentTemplatePath);
      vscode.window.setStatusBarMessage("$(check) Property configured", 3000);
    }
  }
}
