import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import type { ContextItem } from "../shared/templateParser";
import type { ScenariosData, ScenarioData } from "../shared/types";
import type { ContextData, ContextFileData } from "./contextManager";
import {
  IContextServices,
  getUrlWithSource,
  getUrlSourceOptionsData,
  getScenarioHeadersData,
  getScenarioVariablesData,
} from "./contextManagerServices";
import type { UrlSourceOption } from "../shared/messageTypes";

export class ContextWebviewRenderer {
  constructor(private readonly deps: IContextServices) {}

  // -------------------------------------------------------------------------
  // Public entry point: build and return the full webview HTML string.
  // Called by ContextManager.updateWebview().
  // -------------------------------------------------------------------------

  public async getWebviewHtml(
    contextData: ContextData,
    contextItems: Map<string, ContextItem>,
    templateName: string,
    parseError?: string,
  ): Promise<string> {
    const items = Array.from(contextItems.values());
    const nonce = this.getNonce();
    const environmentFilePath = this.deps.getEnvironmentContext().filePath || "";

    const cspSource = this.deps.panel?.webview.cspSource || "'none'";
    const codiconUri = this.deps.panel?.webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.deps.context.extensionUri,
        "node_modules",
        "@vscode/codicons",
        "dist",
        "codicon.css",
      ),
    );

    const templateHtml = await this.loadTemplate("webview.html");
    const stylesContent = await this.loadTemplate("styles.css");
    const scriptsContent = await this.loadTemplate("scripts.js");

    const templateTabContent = await this.generateTemplateTabHtml(items, contextData);
    const environmentTabContent = this.generateEnvironmentTabHtml();

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

    html = html
      .split("{{styles}}")
      .join(`<style nonce="${nonce}">\n${stylesContent}\n</style>`);
    html = html
      .split("{{scripts}}")
      .join(`<script nonce="${nonce}">\n${scriptsContent}\n</script>`);

    return html;
  }

  // -------------------------------------------------------------------------
  // Template file loader
  // -------------------------------------------------------------------------

  private async loadTemplate(filename: string): Promise<string> {
    const templatePath = path.join(__dirname, "webview-ui", filename);
    return await fs.promises.readFile(templatePath, "utf8");
  }

  // -------------------------------------------------------------------------
  // Template tab HTML
  // -------------------------------------------------------------------------

  private async generateTemplateTabHtml(
    items: ContextItem[],
    contextData: ContextData,
  ): Promise<string> {
    try {
      const fullPath = this.deps.templateFilePath;
      if (!fullPath) {
        return '<div class="error-banner">Error: Template file path is not set</div>';
      }

      const templateData: ContextFileData =
        await this.deps.getTemplateContextFileData(fullPath);
      const activeScenario = templateData.activeScenario || "Default";
      const scenarios = templateData.scenarios || { Default: {} };

      this.deps.outputChannel.appendLine("[Context Load] Template data loaded");
      this.deps.outputChannel.appendLine(
        `[Context Load] Active scenario: ${activeScenario}`,
      );
      this.deps.outputChannel.appendLine(
        `[Context Load] Available scenarios: ${Object.keys(scenarios).join(", ")}`,
      );

      const urlInfo = getUrlWithSource(activeScenario, templateData);
      this.deps.outputChannel.appendLine(
        `[URL Debug] Active scenario (${activeScenario}) URL info:`,
      );
      this.deps.outputChannel.appendLine(`  - url: "${urlInfo.url}"`);
      this.deps.outputChannel.appendLine(`  - urlSource: "${urlInfo.urlSource}"`);
      this.deps.outputChannel.appendLine(`[URL Debug] Scenario data from JSON:`);
      this.deps.outputChannel.appendLine(
        `  ${JSON.stringify(scenarios[activeScenario], null, 2)}`,
      );

      const mappings = await this.resolveTemplateMappings(items, fullPath, templateData);
      const templateFileName = path.basename(fullPath);

      return `
            <div class="template-header">
                <h2 class="template-name">${this.escapeHtml(templateFileName)}</h2>
                <div class="template-path" title="${this.escapeHtml(fullPath)}">${this.escapeHtml(this.deps.normalizeTemplatePath(fullPath))}</div>
            </div>
            ${this.generateMappedVariablesConfigSection(mappings, items, contextData)}
            ${this.generateScenariosConfigSection(activeScenario, scenarios, templateData, contextData)}
        `;
    } catch (error) {
      return `<div class="error-banner">Error generating template tab: ${error instanceof Error ? error.message : String(error)}</div>`;
    }
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

  private async detectHttpServletRequestVariable(
    templatePath: string,
  ): Promise<string | undefined> {
    // Delegated to ContextManager via the original implementation.
    // The renderer doesn't duplicate this – it reads the already-resolved value
    // from templateData.httpServletRequestVar which is set by ContextManager.
    return undefined;
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
    const urlInfo = getUrlWithSource(activeScenario, templateData);
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

  private generateUrlSourceOptions(
    currentScenario: string,
    scenarios: ScenariosData,
    fileData: ContextFileData,
  ): string {
    return getUrlSourceOptionsData(currentScenario, scenarios, fileData)
      .map(
        (o) =>
          `<option value="${this.escapeHtml(o.value)}" ${o.selected ? "selected" : ""}>${this.escapeHtml(o.label)}</option>`,
      )
      .join("");
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

  private generateScenarioHeadersRows(
    scenario: ScenarioData,
    legacyHeaders: string,
  ): string {
    const headers = getScenarioHeadersData(scenario, legacyHeaders);

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

  private generateScenarioVariablesRows(
    scenario: ScenarioData,
    contextData: ContextData,
    allScenarios: ScenariosData = {},
    activeScenarioName: string = "Default",
  ): string {
    const items = getScenarioVariablesData(scenario, contextData, allScenarios, activeScenarioName);

    const rows = items.map(({ name, value: valueStr, isJson, source, inheritableFrom }) => {
      const isSelf = source === "self";

      const sourceOptions = [
        `<option value="self" ${source === "self" ? "selected" : ""}>Self</option>`,
        ...inheritableFrom.map(
          (sn) =>
            `<option value="${this.escapeHtml(sn)}" ${source === sn ? "selected" : ""}>${this.escapeHtml(sn)}</option>`,
        ),
      ].join("");

      const valueDisplay = isSelf
        ? `<span class="header-cell-value">${this.escapeHtml(valueStr) || "(empty)"}</span>`
        : `<span class="header-cell-value" style="color:var(--vscode-descriptionForeground);font-style:italic;">${this.escapeHtml(valueStr) || "(empty)"}</span>`;

      return `
        <tr data-variable-name="${this.escapeHtml(name)}">
            <td>${this.escapeHtml(name)}</td>
            <td ${isSelf ? 'data-action="editVariableCell"' : ""}>
                ${valueDisplay}
                ${isSelf ? `<input type="text" value="${this.escapeHtml(valueStr)}" data-action="editScenarioVariable" data-field="value" data-name="${this.escapeHtml(name)}" class="header-cell-input" />` : ""}
            </td>
            <td style="text-align:center;">
                <input type="checkbox" title="${isSelf ? "Parse value as JSON array/object" : "JSON parsing (inherited, read-only)"}" ${isJson ? "checked" : ""} ${isSelf ? `data-action="toggleScenarioVariableJson" data-name="${this.escapeHtml(name)}"` : "disabled"} />
            </td>
            <td ${inheritableFrom.length > 0 ? 'data-action="editSourceCell"' : ""} style="cursor:${inheritableFrom.length > 0 ? "pointer" : "default"};">
                <span class="header-cell-value" style="${!isSelf ? "color:var(--vscode-descriptionForeground);font-style:italic;" : ""}">${source === "self" ? "Self" : this.escapeHtml(source)}</span>
                ${inheritableFrom.length > 0 ? `<select class="header-cell-input scenario-source-select" data-action="changeScenarioVariableSource" data-name="${this.escapeHtml(name)}">${sourceOptions}</select>` : ""}
            </td>
            <td>
                ${
                  isSelf
                    ? `<button class="icon-button" data-action="deleteScenarioVariable" data-name="${this.escapeHtml(name)}" title="Delete"><span class="codicon codicon-trash"></span></button>`
                    : ""
                }
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

  private generateTemplateVariableHtml(
    item: ContextItem,
    contextData: ContextData,
  ): string {
    const hasLocalValue = contextData[item.name] !== undefined;
    const environmentValue = this.deps.getEnvironmentContext().data[item.name];
    const hasEnvironmentValue = environmentValue !== undefined;

    const source = hasLocalValue
      ? "template"
      : hasEnvironmentValue
        ? "environment"
        : "template";
    const displayValue = hasLocalValue ? contextData[item.name] : environmentValue;
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private generateObjectPropertiesHtml(
    item: ContextItem,
    objectData: Record<string, any>,
    environmentData: Record<string, any>,
  ): string {
    if (!item.properties || item.properties.size === 0) {
      return "";
    }
    let html = "";
    item.properties.forEach((propData, propName) => {
      const hasLocal = objectData[propName] !== undefined;
      const environmentVal = environmentData[propName];
      const hasEnvironment = environmentVal !== undefined;
      const source = hasLocal ? "template" : hasEnvironment ? "environment" : "template";
      const val = hasLocal ? objectData[propName] : environmentVal;
      const valStr =
        val !== undefined ? (typeof val === "string" ? val : JSON.stringify(val)) : "";

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
                        ${
                          source === "template" || !hasEnvironment
                            ? `<input id="input-${this.escapeHtml(item.name)}-${this.escapeHtml(propName)}" value="${this.escapeHtml(valStr)}" placeholder="Enter value" data-action="saveValue" data-name="" data-object="${this.escapeHtml(item.name)}" data-prop="${this.escapeHtml(propName)}" />`
                            : `<div class="value-display readonly">${this.escapeHtml(valStr)}</div>`
                        }
                    </div>
                `;
    });
    return html;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private generateObjectMethodsHtml(
    item: ContextItem,
    objectData: Record<string, any>,
    environmentData: Record<string, any>,
  ): string {
    if (!item.methods || item.methods.size === 0) {
      return "";
    }
    let html = "";
    item.methods.forEach((methodData, methodName) => {
      const localMethod = objectData[methodName];
      const hasLocal = localMethod && localMethod._implementation;
      const environmentMethod = environmentData[methodName];
      const hasEnvironment = environmentMethod && environmentMethod._implementation;
      const source = hasLocal ? "template" : hasEnvironment ? "environment" : "template";
      const impl = hasLocal
        ? localMethod._implementation
        : hasEnvironment
          ? environmentMethod._implementation
          : "";

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
                        ${
                          source === "template" || !hasEnvironment
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const objectData = ((contextData as Record<string, any>)[item.name] || {}) as Record<string, any>;
    const environmentData =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.deps.getEnvironmentContext().data[item.name] as Record<string, any>) || {};

    let html = `<div class="context-item"><div class="item-header"><div class="item-name">\$${this.escapeHtml(item.name)}</div></div>`;
    html += this.generateObjectPropertiesHtml(item, objectData, environmentData);
    html += this.generateObjectMethodsHtml(item, objectData, environmentData);
    html += `</div>`;
    return html;
  }

  // -------------------------------------------------------------------------
  // Environment tab HTML
  // -------------------------------------------------------------------------

  private generateEnvironmentTabHtml(): string {
    return (
      this.generateEnvironmentConfigSectionHtml() +
      this.generateEnvironmentObjectsSectionHtml()
    );
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
                    <input type="text" id="environment-language" value="${this.escapeHtml(this.deps.getEnvironmentContext().language || "en")}" 
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
    const data = this.deps.getEnvironmentContext().data;
    let html = "";
    Object.keys(data)
      .sort()
      .forEach((key) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const value = data[key] as Record<string, any>;
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          html += `<div class="context-item"><div class="item-header"><div class="item-name">$${this.escapeHtml(key)}</div></div>`;
          Object.keys(value)
            .sort()
            .forEach((subKey) => {
              const subValue = value[subKey];
              const isMethod =
                subValue && typeof subValue === "object" && subValue._implementation;
              if (isMethod) {
                html += `
                            <div class="nested-item">
                                <div class="nested-name">.${this.escapeHtml(subKey)}()</div>
                                <textarea id="gmethod-${this.escapeHtml(key)}-${this.escapeHtml(subKey)}" data-action="saveEnvironmentMethod" data-object="${this.escapeHtml(key)}" data-method="${this.escapeHtml(subKey)}">${this.escapeHtml(subValue._implementation)}</textarea>
                            </div>
                        `;
              } else {
                const valStr =
                  typeof subValue === "string" ? subValue : JSON.stringify(subValue);
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

  private generateEnvironmentVariablesTable(): string {
    const data = this.deps.getEnvironmentContext().data;
    const variables: Array<{ name: string; value: string }> = [];

    Object.keys(data).forEach((key) => {
      const value = data[key];
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        const valStr = typeof value === "string" ? value : JSON.stringify(value);
        variables.push({ name: key, value: valStr });
      }
    });

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
    const headers = this.deps.getEnvironmentContext().headers || {};
    let tableHtml =
      '<table class="headers-table"><thead><tr><th>Name</th><th>Value</th><th></th></tr></thead><tbody>';

    const headerKeys = Object.keys(headers).filter((name) => name).sort();

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
    const envCtx = this.deps.getEnvironmentContext();
    if (envCtx.messagesPropertiesPath && !envCtx.messagesPropertiesPaths) {
      envCtx.messagesPropertiesPaths = [envCtx.messagesPropertiesPath];
      delete envCtx.messagesPropertiesPath;
    }
    const files = envCtx.messagesPropertiesPaths || [];

    let tableHtml =
      '<table class="headers-table messages-files-table"><thead><tr><th>File Name</th><th></th></tr></thead><tbody>';

    files.forEach((filePath, index) => {
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
    tableHtml += "</tbody></table>";
    return tableHtml;
  }

  private generateEnvironmentCspDirectivesTable(): string {
    const cspDirectives = this.deps.getEnvironmentContext().cspDirectives || {};
    let tableHtml =
      '<table class="headers-table"><thead><tr><th>Directive</th><th>Value</th><th></th></tr></thead><tbody>';

    const directiveNames = Object.keys(cspDirectives).filter((name) => name).sort();

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
    const mockFunctions = this.deps.getEnvironmentContext().mockFunctions || {};
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

  // -------------------------------------------------------------------------
  // Template methods table
  // -------------------------------------------------------------------------

  private getAvailableEnvironmentMockFunctions(): string[] {
    const mockFunctions: string[] = [];
    const envMocks = this.deps.getEnvironmentContext().mockFunctions;
    if (!envMocks) {
      return mockFunctions;
    }
    for (const name of Object.keys(envMocks)) {
      mockFunctions.push(name);
    }
    return mockFunctions.sort();
  }

  private generateTemplateMethodsTable(
    items: ContextItem[],
    contextData: ContextData,
  ): string {
    const availableEnvironmentMocks = this.getAvailableEnvironmentMockFunctions();
    const methodMappings: Record<string, string> =
      (contextData.methodMappings as Record<string, string>) || {};

    const templateMethods = new Map<
      string,
      { objectName: string; methodName: string; lineNumber: number }
    >();

    for (const item of items) {
      if (
        this.isLocaleObject(item) ||
        this.isTemplateMessagesObject(item) ||
        this.isEscapeToolObject(item) ||
        this.isHttpServletRequestObject(item)
      ) {
        continue;
      }
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

  // -------------------------------------------------------------------------
  // Object classifier helpers
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Pure utility helpers
  // -------------------------------------------------------------------------

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

  private escapeJs(text: string): string {
    return text
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r");
  }
}
