import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs";
import type { ContextItem } from "../shared/templateParser";
import { TemplateParser } from "../shared/templateParser";
import type { ScenariosData, ScenarioData } from "../shared/types";
import type { ContextData, ContextFileData } from "./contextManager";
import {
  IContextServices,
  isSameTemplatePath,
  resolveTemplatePath,
  getUrlWithSource,
  getUrlSourceOptionsData,
  getScenarioHeadersData,
  getScenarioVariablesData,
} from "./contextManagerServices";

export class ContextWebviewRenderer {
  private readonly fileCache = new Map<string, string>();

  constructor(private readonly deps: IContextServices) {}

  // -------------------------------------------------------------------------
  // Public entry point: build and return the full webview HTML string.
  // Called by ContextManager.updateWebview().
  // -------------------------------------------------------------------------

  public async getWebviewHtml(
    contextData: ContextData,
    contextItems: Map<string, ContextItem>,
    templateName: string,
  ): Promise<string> {
    const items = Array.from(contextItems.values());
    const nonce = this.getNonce();
    const environmentFilePath = this.deps.getEnvironmentContext().filePath || "";

    const cspSource = this.deps.view?.webview.cspSource || "'none'";
    const codiconUri = this.deps.view?.webview.asWebviewUri(
      vscode.Uri.joinPath(this.deps.context.extensionUri, "out", "codicons", "codicon.css"),
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
      .split("{{groupsTabContent}}")
      .join(this.generateTemplateGroupsTabHtml())
      .split("{{environmentIndex}}")
      .join(this.generateEnvironmentIndexHtml())
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
    if (this.fileCache.has(filename)) {
      return this.fileCache.get(filename)!;
    }
    const templatePath = path.join(__dirname, "webview-ui", filename);
    const content = await fs.promises.readFile(templatePath, "utf8");
    this.fileCache.set(filename, content);
    return content;
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

      const mappings= await this.resolveTemplateMappings(items, fullPath, templateData);
      const templateFileName = path.basename(fullPath);

      let foreachLoopVars: Set<string> = new Set();
      let templateContent: string | undefined;
      try {
        templateContent = await fs.promises.readFile(fullPath, 'utf-8');
        foreachLoopVars = TemplateParser.extractForeachLoopVariables(templateContent);
      } catch { /* template unreadable */ }
      const detected = this.generateDetectedPanelHtml(templateContent, mappings.effectiveVar);

      return `
            <div class="template-header">
                <div class="template-title-row">
                    <span class="codicon codicon-file-code template-icon"></span>
                    <h2 class="template-name" title="${this.escapeHtml(fullPath)}">${this.escapeHtml(templateFileName)}</h2>
                    ${this.generateContextGroupChip(fullPath)}
                    <div class="header-actions">
                        <button class="icon-button" data-action="showTemplateGroup" data-group="${this.escapeHtml(this.deps.findTemplateGroupName(fullPath) || "")}" title="Show in Template Groups"><span class="codicon codicon-link"></span></button>
                        <button class="icon-button" data-action="reloadTemplateContext" title="Reload template context"><span class="codicon codicon-refresh"></span></button>
                    </div>
                </div>
                <div class="template-path" title="${this.escapeHtml(fullPath)}">${this.escapeHtml(this.deps.normalizeTemplatePath(fullPath))}</div>
            </div>
            ${this.generateMappedVariablesConfigSection(mappings, items, contextData)}
            ${this.generateScenariosConfigSection(activeScenario, scenarios, templateData, contextData, items, mappings, foreachLoopVars, detected)}
        `;
    } catch (error) {
      return `<div class="error-banner">Error generating template tab: ${error instanceof Error ? error.message : String(error)}</div>`;
    }
  }

  private generateContextGroupChip(fullPath: string): string {
    const groupName = this.deps.findTemplateGroupName(fullPath);
    const group = groupName
      ? this.deps.getEnvironmentContext().templateGroups?.[groupName]
      : undefined;
    if (!groupName || !group) {
      return `<button class="group-chip group-chip-empty" data-action="showTemplateGroup" data-group=""
                    title="Not in a context group - group it with customized copies of it so they share the same scenarios">
                    <span class="codicon codicon-link"></span>No group</button>`;
    }
    const others = group.templates.length - 1;
    const title = `Context group "${groupName}" - scenarios shared with ${ContextWebviewRenderer.plural(others, "other template")}. Click to open in Template Groups.`;
    return `<button class="group-chip" data-action="showTemplateGroup" data-group="${this.escapeHtml(groupName)}" title="${this.escapeHtml(title)}">
                    <span class="codicon codicon-link"></span>${this.escapeHtml(groupName)}<span class="chip-count">+${others}</span></button>`;
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
      (item) => item.type === "object" && ContextWebviewRenderer.isLocaleObject(item),
    );
    const localeVar =
      templateData.localeVar ||
      (localeObjects.length > 0 ? localeObjects[0].name : undefined);

    const messagesObjects = items.filter(
      (item) => item.type === "object" && ContextWebviewRenderer.isTemplateMessagesObject(item),
    );
    const messagesVar =
      templateData.templateMessagesVar ||
      (messagesObjects.length > 0 ? messagesObjects[0].name : undefined);

    const escapeObjects = items.filter(
      (item) => item.type === "object" && ContextWebviewRenderer.isEscapeToolObject(item),
    );
    const escapeVar =
      templateData.escapeToolVar ||
      (escapeObjects.length > 0 ? escapeObjects[0].name : undefined);

    return { effectiveVar, localeVar, messagesVar, escapeVar };
  }

  private async detectHttpServletRequestVariable(
    templatePath: string,
  ): Promise<string | undefined> {
    return this.deps.detectHttpServletRequestVariable(templatePath);
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
    const detectedCount = [effectiveVar, localeVar, messagesVar, escapeVar].filter(Boolean).length;
    const methodNames = this.collectTemplateMethodNames(items);
    const methodMappings = (contextData.methodMappings as Record<string, string>) || {};
    const unmappedCount = methodNames.filter((name) => !methodMappings[name]).length;
    const summaryParts = [`${detectedCount}/4 tools detected`];
    const methodsLabel = ContextWebviewRenderer.plural(methodNames.length, "method");
    if (unmappedCount > 0) {
      summaryParts.push(`<span class="summary-warning">${unmappedCount} of ${methodsLabel} not mapped</span>`);
    } else if (methodNames.length > 0) {
      summaryParts.push(`${methodsLabel} mapped`);
    }
    return `
            <details class="config-section bindings-section" id="template-bindings" data-needs-attention="${unmappedCount > 0}">
                <summary>
                    <span class="codicon codicon-chevron-right bindings-chevron"></span>
                    <span class="section-label">Template Bindings</span>
                    <span class="bindings-summary">${summaryParts.join(" &middot; ")}</span>
                </summary>
                <div class="bindings-body">
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
                </div>
            </details>`;
  }

  /**
   * Groups scenario names by the prefix before " - " (e.g. "Post-authn - Single
   * device" → "Post-authn") when at least two scenarios share it. Order follows
   * first appearance; ungrouped scenarios get an empty group name.
   */
  static groupScenarioNames(names: string[]): { group: string; items: { name: string; label: string }[] }[] {
    const prefixOf = (name: string) => {
      const index = name.indexOf(" - ");
      return index > 0 ? name.slice(0, index) : "";
    };
    const prefixCounts = new Map<string, number>();
    for (const name of names) {
      const prefix = prefixOf(name);
      if (prefix) {
        prefixCounts.set(prefix, (prefixCounts.get(prefix) || 0) + 1);
      }
    }
    const groups: { group: string; items: { name: string; label: string }[] }[] = [];
    const byGroup = new Map<string, { name: string; label: string }[]>();
    for (const name of names) {
      const prefix = prefixOf(name);
      const grouped = !!prefix && (prefixCounts.get(prefix) || 0) > 1;
      const group = grouped ? prefix : "";
      if (!byGroup.has(group)) {
        byGroup.set(group, []);
        groups.push({ group, items: byGroup.get(group)! });
      }
      byGroup.get(group)!.push({ name, label: grouped ? name.slice(prefix.length + 3) : name });
    }
    return groups;
  }

  private generateScenarioListHtml(scenarioNames: string[], activeScenario: string): string {
    const itemHtml = (name: string, label: string) => {
      const escapedName = this.escapeHtml(name);
      const actions = name === "Default"
        ? ""
        : `<button class="icon-button scenario-action" data-action="startScenarioRename" data-name="${escapedName}" title="Rename"><span class="codicon codicon-edit"></span></button>
           <button class="icon-button scenario-action" data-action="deleteScenario" data-name="${escapedName}" title="Delete scenario"><span class="codicon codicon-trash"></span></button>`;
      return `
                    <div class="scenario-item rename-scope${name === activeScenario ? " active" : ""}" data-scenario-name="${escapedName}">
                        <button class="scenario-select rename-label" data-action="selectScenario" data-name="${escapedName}" title="${escapedName}">
                            <span class="scenario-dot"></span><span class="scenario-label">${this.escapeHtml(label)}</span>
                        </button>
                        <input type="text" class="scenario-rename-input" value="${escapedName}" data-old-name="${escapedName}" hidden />
                        ${actions}
                    </div>`;
    };

    return ContextWebviewRenderer.groupScenarioNames(scenarioNames)
      .map(({ group, items }) => {
        const itemsHtml = items.map(({ name, label }) => itemHtml(name, label)).join("");
        if (!group) {
          return itemsHtml;
        }
        const escapedGroup = this.escapeHtml(group);
        return `
                    <div class="scenario-group" data-group="${escapedGroup}">
                        <button class="scenario-group-header" data-action="toggleScenarioGroup" data-group="${escapedGroup}">
                            <span class="codicon codicon-chevron-down"></span>
                            <span class="scenario-group-name">${escapedGroup}</span>
                            <span class="count-badge">${items.length}</span>
                        </button>
                        <div class="scenario-group-items">${itemsHtml}</div>
                    </div>`;
      })
      .join("");
  }

  /**
   * Read-only analysis of the template for the "Detected" tab: request parameters
   * read via $<request>.getParameter(...)/.getParameterValues(...) and the
   * #if/#elseif/#else decision points. Informational only - a checklist for building
   * scenarios that cover each parameter and branch; nothing is saved from here.
   */
  private generateDetectedPanelHtml(
    content: string | undefined,
    httpServletRequestVar: string | undefined,
  ): { html: string; count: number } {
    if (content === undefined) {
      return { html: '<div class="empty-state-cell">The template could not be read</div>', count: 0 };
    }

    const requestParams = httpServletRequestVar
      ? TemplateParser.extractHttpRequestParameters(content, httpServletRequestVar)
      : [];
    const branches = TemplateParser.extractConditionalBranches(content);

    const requestVarLabel = httpServletRequestVar ? `$${this.escapeHtml(httpServletRequestVar)}` : "";
    const noParamsMessage = httpServletRequestVar
      ? `No ${requestVarLabel}.getParameter(...) calls with a literal name were found`
      : "No HTTP Servlet Request variable detected for this template";
    const paramsHtml = requestParams.length
      ? requestParams
          .map(
            (p) => `
                        <tr>
                            <td class="var-name-cell">${this.escapeHtml(p.name)}</td>
                            <td>${p.lineNumber}</td>
                            <td class="detected-context-cell" title="${this.escapeHtml(p.context)}">${this.escapeHtml(p.context)}</td>
                        </tr>`,
          )
          .join("")
      : `<tr><td colspan="3" class="empty-state-cell">${noParamsMessage}</td></tr>`;

    const branchesHtml = branches.length
      ? branches
          .map(
            (block, idx) => `
                    <div class="detected-branch-block">
                        <div class="detected-branch-block-header">Decision point ${idx + 1} <span class="detected-branch-line">line ${block.startLine}</span></div>
                        <ul class="detected-branch-list">
                            ${block.branches
                              .map(
                                (b) => `
                            <li>
                                <span class="detected-branch-type detected-branch-type-${b.type}">${b.type}</span>
                                ${b.expression ? `<code>${this.escapeHtml(b.expression)}</code>` : "<em>(otherwise)</em>"}
                                <span class="detected-branch-line">line ${b.lineNumber}</span>
                            </li>`,
                              )
                              .join("")}
                        </ul>
                    </div>`,
          )
          .join("")
      : `<div class="empty-state-cell">No #if/#elseif branches detected in this template</div>`;

    const html = `
                        <div class="label-with-info">
                            <div class="detected-subsection-label">Request Parameters <span class="count-badge">${requestParams.length || ""}</span></div>
                            ${requestVarLabel ? `<code class="detected-source">${requestVarLabel}.getParameter(...)</code>` : ""}
                            <button class="codicon codicon-info info-icon" title="Read-only static analysis of the template. Use it as a checklist when building scenarios - nothing here is saved automatically."></button>
                        </div>
                        <table class="headers-table detected-params-table">
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Line</th>
                                    <th>Context</th>
                                </tr>
                            </thead>
                            <tbody>${paramsHtml}</tbody>
                        </table>

                        <div class="label-with-info">
                            <div class="detected-subsection-label">Conditional Branches <span class="count-badge">${branches.length || ""}</span></div>
                            <code class="detected-source">#if / #elseif / #else</code>
                        </div>
                        <div class="detected-branches">${branchesHtml}</div>`;

    return { html, count: requestParams.length + branches.length };
  }

  /** Compact dropdown used instead of the list when the panel is narrow. */
  private generateScenarioPickerHtml(scenarioNames: string[], activeScenario: string): string {
    const option = (name: string, label: string) =>
      `<option value="${this.escapeHtml(name)}"${name === activeScenario ? " selected" : ""}>${this.escapeHtml(label)}</option>`;
    return ContextWebviewRenderer.groupScenarioNames(scenarioNames)
      .map(({ group, items }) => {
        const options = items.map(({ name, label }) => option(name, label)).join("");
        return group ? `<optgroup label="${this.escapeHtml(group)}">${options}</optgroup>` : options;
      })
      .join("");
  }

  private generateScenarioUrlTableHtml(
    activeScenario: string,
    scenarios: ScenariosData,
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

  private generateScenariosConfigSection(
    activeScenario: string,
    scenarios: ScenariosData,
    templateData: ContextFileData,
    contextData: ContextData,
    items: ContextItem[],
    mappings: { effectiveVar?: string; localeVar?: string; messagesVar?: string; escapeVar?: string },
    foreachLoopVars: Set<string> = new Set(),
    detected: { html: string; count: number } = { html: "", count: 0 },
  ): string {
    const scenarioNames = Object.keys(scenarios);
    return `
            <div class="scenario-layout">
                <aside class="scenario-sidebar">
                    <div class="scenario-sidebar-header">
                        <span class="section-label">Scenarios</span>
                        <span class="count-badge">${scenarioNames.length}</span>
                        <button class="codicon codicon-info info-icon" title="Test scenarios simulate different runtime conditions with their own URL, headers and variables. The selected scenario is the one rendered in the preview."></button>
                        <button class="icon-button scenario-add-button" data-action="addScenario" title="Add scenario"><span class="codicon codicon-add"></span></button>
                    </div>
                    <div class="scenario-new-form" hidden>
                        <input type="text" class="scenario-new-input" data-scenario-part="name" placeholder="New scenario name" />
                        <button class="icon-button save-new-row" data-action="saveNewScenario" title="Save"><span class="codicon codicon-check"></span></button>
                        <button class="icon-button" data-action="cancelNewScenario" title="Cancel"><span class="codicon codicon-close"></span></button>
                    </div>
                    <input type="search" id="scenario-filter" class="filter-input" placeholder="Filter scenarios" />
                    <select id="scenario-picker" class="scenario-picker" title="Scenario">
                        ${this.generateScenarioPickerHtml(scenarioNames, activeScenario)}
                    </select>
                    <div class="scenario-list" role="listbox">
                        ${this.generateScenarioListHtml(scenarioNames, activeScenario)}
                        <div class="scenario-filter-empty" hidden>No scenarios match</div>
                    </div>
                </aside>

                <section class="scenario-detail">
                    <div class="scenario-detail-header rename-scope">
                        <div class="scenario-title rename-label">${this.escapeHtml(activeScenario)}</div>
                        <input type="text" class="scenario-rename-input" value="${this.escapeHtml(activeScenario)}" data-old-name="${this.escapeHtml(activeScenario)}" hidden />
                        <span class="scenario-detail-hint">Shown in preview</span>
                        <div class="scenario-detail-actions"${activeScenario === "Default" ? " hidden" : ""}>
                            <button class="icon-button" data-action="startScenarioRename" data-name="${this.escapeHtml(activeScenario)}" data-scope="detail" title="Rename scenario"><span class="codicon codicon-edit"></span></button>
                            <button class="icon-button" data-action="deleteScenario" data-name="${this.escapeHtml(activeScenario)}" title="Delete scenario"><span class="codicon codicon-trash"></span></button>
                        </div>
                    </div>
                    <div class="detail-tabs" role="tablist">
                        <button class="detail-tab active" data-action="switchDetailTab" data-panel="variables">Variables <span class="count-badge" id="scenario-variables-count"></span></button>
                        <button class="detail-tab" data-action="switchDetailTab" data-panel="request">Request <span class="detail-tab-hint">URL &amp; headers</span></button>
                        <button class="detail-tab" data-action="switchDetailTab" data-panel="detected" title="Request parameters and #if/#elseif branches found in the template">Detected <span class="count-badge">${detected.count || ""}</span></button>
                    </div>

                    <div class="detail-panel" data-panel="detected">
                        ${detected.html}
                    </div>

                    <div class="detail-panel" data-panel="request">
                        ${this.generateScenarioUrlTableHtml(activeScenario, scenarios, templateData)}

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
                    </div>

                    <div class="detail-panel active" data-panel="variables">
                    <div class="var-toolbar">
                        <input type="search" id="variable-filter" class="filter-input" placeholder="Filter variables" />
                        <label class="var-toolbar-toggle" title="Only show variables this scenario overrides">
                            <input type="checkbox" id="variable-overridden-only" /> Overridden only
                        </label>
                        <button class="codicon codicon-info info-icon" title="All variables detected in the template. JSON = parse the value as JSON. Override = use this scenario's own value instead of the inherited one."></button>
                    </div>
                <div class="var-scroll-wrapper">
                <table class="headers-table var-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Value</th>
                            <th class="var-th-center var-col-json" title="Parse as JSON">JSON</th>
                            <th class="var-th-center var-col-check" title="Override parent value">Override</th>
                            <th style="width:32px"></th>
                        </tr>
                    </thead>
                    <tbody id="scenario-variables-tbody">
                        ${this.generateScenarioVariablesRows(scenarios[activeScenario] || {}, scenarios, activeScenario, items, mappings, foreachLoopVars)}
                    </tbody>
                </table>
                <div class="var-filter-empty" hidden>No variables match the filter</div>
                </div>
                    </div>
                </section>
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
        const sourceDisplay = this.getSourceDisplay(source);
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

  private getSourceDisplay(
    source: string | undefined,
  ): string {
    if (!source || source === "self") {
      return "Self";
    }
    if (source === "environment") {
      return "Environment";
    }
    return source;
  }

  private generateScenarioVariablesRows(
    scenario: ScenarioData,
    allScenarios: ScenariosData,
    activeScenarioName: string,
    templateItems: ContextItem[],
    mappings: { effectiveVar?: string; localeVar?: string; messagesVar?: string; escapeVar?: string },
    foreachLoopVars: Set<string> = new Set(),
  ): string {
    const excludeNames = new Set<string>(
      [mappings.effectiveVar, mappings.localeVar, mappings.messagesVar, mappings.escapeVar,
       ...foreachLoopVars]
        .filter((v): v is string => !!v),
    );
    const envData = this.deps.getEnvironmentContext().data as Record<string, unknown>;
    const items = getScenarioVariablesData(scenario, allScenarios, activeScenarioName, envData, templateItems, excludeNames);

    if (items.length === 0) {
      return `<tr><td colspan="5" class="empty-state-cell var-th-center var-empty-msg">No variables detected</td></tr>`;
    }

    return items.map(({ name, ownValue, parentValue, isJson, isOverride, hasParent, isJsonEditable }) => {
      const escapedName = this.escapeHtml(name);
      const escapedOwnValue = this.escapeHtml(ownValue);
      const escapedParentValue = this.escapeHtml(parentValue);
      // No parent → always editable (nothing to inherit from, Override concept doesn't apply)
      const alwaysEditable = !hasParent;
      const showEditable = isOverride || alwaysEditable;
      const displayValue = this.getDisplayValue(isOverride, escapedOwnValue, hasParent, escapedParentValue);
      const valueCell = this.getValueCellHtml(isJson, showEditable, escapedName, displayValue, escapedParentValue);

      return `
        <tr data-variable-name="${escapedName}">
            <td class="var-name-cell">$${escapedName}</td>
            ${valueCell}
            <td class="var-th-center">
                <input type="checkbox" title="${isJsonEditable ? 'Parse as JSON object/array' : 'Inherited from Default (read-only)'}"
                       ${isJson ? 'checked' : ''}
                       ${isJsonEditable ? `data-action="toggleScenarioVariableJson" data-name="${escapedName}"` : 'disabled'}/>
            </td>
            <td class="var-th-center">
                <input type="checkbox" title="${hasParent ? 'Override parent value' : 'No parent to inherit from (always own value)'}"
                       ${isOverride ? 'checked' : ''}
                       ${hasParent ? `data-action="toggleScenarioVariableOverride" data-name="${escapedName}"` : 'disabled'}/>
            </td>
            <td>
                ${showEditable && isOverride && ownValue ? `<button class="icon-button" data-action="deleteScenarioVariable" data-name="${escapedName}" title="Clear (unset)"><span class="codicon codicon-trash"></span></button>` : ''}
            </td>
        </tr>`;
    }).join('');
  }

  private getDisplayValue(
    isOverride: boolean,
    escapedOwnValue: string,
    hasParent: boolean,
    escapedParentValue: string,
  ): string {
    if (isOverride) {
      return escapedOwnValue;
    } else {
      return hasParent ? escapedParentValue : '';
    }
  }

  private getValueCellHtml(
    isJson: boolean,
    showEditable: boolean,
    escapedName: string,
    displayValue: string,
    escapedParentValue: string | undefined,
  ): string {
    if (showEditable) {
        if (isJson) {
          return `<td data-action="editVariableCell">
              <textarea data-action="editScenarioVariable" data-name="${escapedName}" class="var-json-textarea" rows="3">${displayValue}</textarea>
              <button type="button" class="icon-button var-json-edit-btn" data-action="editScenarioVariableInEditor" data-name="${escapedName}" title="Edit in VS Code editor">
                  <span class="codicon codicon-go-to-file"></span> Edit in Editor
              </button>
              <span class="var-json-err-msg" id="json-err-${escapedName}"></span>
            </td>`;
        } else {
          return `<td data-action="editVariableCell">
              <span class="header-cell-value">${displayValue || '<span class="var-value-empty">(not set)</span>'}</span>
              <input type="text" value="${displayValue}" data-action="editScenarioVariable" data-name="${escapedName}" class="header-cell-input"/>
            </td>`
        }
      } else {
        return `<td><span class="var-value-inherited">${escapedParentValue || '(empty)'}</span></td>`;
      }
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

  // -------------------------------------------------------------------------
  // Template Groups tab
  // -------------------------------------------------------------------------

  /** Pseudo-group listing templates that have their own scenarios. */
  static readonly UNGROUPED = "__ungrouped__";

  private generateTemplateGroupsTabHtml(): string {
    const envCtx = this.deps.getEnvironmentContext();
    if (!envCtx.filePath) {
      return '<div class="empty-state-cell">Load an environment context file to manage template groups.</div>';
    }
    const groups = envCtx.templateGroups || {};
    const groupNames = Object.keys(groups);
    const currentPath = this.deps.templateFilePath
      ? this.deps.normalizeTemplatePath(this.deps.templateFilePath)
      : "";
    const currentGroup = currentPath ? this.deps.findTemplateGroupName(currentPath) : undefined;
    const currentUngrouped = !!currentPath && !currentGroup;

    // Templates with their own entry (not in a group), plus the open template if it has neither
    const ungrouped = Object.keys(envCtx.templates || {}).filter((p) => !this.deps.findTemplateGroupName(p));
    if (currentUngrouped && !ungrouped.some((p) => isSameTemplatePath(p, currentPath))) {
      ungrouped.unshift(currentPath);
    }

    const openTag = '<span class="current-tag" title="Contains the template open in Template Context">open</span>';
    const listItems = groupNames
      .map((name) => {
        const members = groups[name].templates || [];
        const search = [name, ...members].join(" ").toLowerCase();
        const isCurrent = name === currentGroup;
        return `
                    <div class="scenario-item group-item${isCurrent ? " is-current" : ""}" data-group-name="${this.escapeHtml(name)}" data-search="${this.escapeHtml(search)}">
                        <button class="scenario-select" data-action="selectGroup" data-name="${this.escapeHtml(name)}" title="${this.escapeHtml(name)}">
                            <span class="codicon codicon-link group-item-icon"></span>
                            <span class="scenario-label">${this.escapeHtml(name)}</span>
                            ${isCurrent ? openTag : ""}
                            <span class="count-badge">${members.length}</span>
                        </button>
                    </div>`;
      })
      .join("");

    const ungroupedSearch = ["ungrouped", ...ungrouped].join(" ").toLowerCase();
    const ungroupedItem = `
                    <div class="group-list-divider"></div>
                    <div class="scenario-item group-item group-item-ungrouped${currentUngrouped ? " is-current" : ""}" data-group-name="${ContextWebviewRenderer.UNGROUPED}" data-search="${this.escapeHtml(ungroupedSearch)}">
                        <button class="scenario-select" data-action="selectGroup" data-name="${ContextWebviewRenderer.UNGROUPED}">
                            <span class="codicon codicon-circle-slash group-item-icon"></span>
                            <span class="scenario-label">Ungrouped</span>
                            ${currentUngrouped ? openTag : ""}
                            <span class="count-badge">${ungrouped.length}</span>
                        </button>
                    </div>`;

    const pickerOptions = [
      ...groupNames.map((name) => `<option value="${this.escapeHtml(name)}">${this.escapeHtml(name)} (${groups[name].templates.length})</option>`),
      `<option value="${ContextWebviewRenderer.UNGROUPED}">Ungrouped (${ungrouped.length})</option>`,
    ].join("");

    const details = [
      ...groupNames.map((name) => this.generateGroupDetailHtml(name, groups[name], currentPath)),
      this.generateUngroupedDetailHtml(ungrouped, groupNames, currentPath),
    ].join("");

    let defaultGroup = currentGroup;
    if (!defaultGroup) {
      defaultGroup = currentUngrouped || groupNames.length === 0 ? ContextWebviewRenderer.UNGROUPED : groupNames[0];
    }

    return `
            <div class="scenario-layout groups-layout" data-default-group="${this.escapeHtml(defaultGroup)}">
                <aside class="scenario-sidebar">
                    <div class="scenario-sidebar-header">
                        <span class="section-label">Groups</span>
                        <span class="count-badge">${groupNames.length}</span>
                        <button class="codicon codicon-info info-icon" title="Templates in a group share one set of scenarios and mappings - use this for customized copies of a default template."></button>
                        <button class="icon-button scenario-add-button" data-action="addTemplateGroup" title="New group"><span class="codicon codicon-add"></span></button>
                    </div>
                    <div class="scenario-new-form group-new-form" hidden>
                        <input type="text" class="group-new-input" placeholder="New group name" />
                        <button class="icon-button save-new-row" data-action="saveNewTemplateGroup" title="Choose templates"><span class="codicon codicon-check"></span></button>
                        <button class="icon-button" data-action="cancelNewTemplateGroup" title="Cancel"><span class="codicon codicon-close"></span></button>
                    </div>
                    <input type="search" id="group-filter" class="filter-input" placeholder="Filter groups or templates" />
                    <select id="group-picker" class="scenario-picker" title="Group">${pickerOptions}</select>
                    <div class="scenario-list group-list" role="listbox">
                        ${listItems}
                        ${ungroupedItem}
                        <div class="group-filter-empty" hidden>No groups match</div>
                    </div>
                </aside>
                <section class="scenario-detail group-details">
                    ${details}
                </section>
            </div>`;
  }

  private generateGroupDetailHtml(
    name: string,
    group: { templates: string[]; scenarios?: ScenariosData; activeScenario?: string; mappedMethods?: Record<string, string> },
    currentPath: string,
  ): string {
    const escapedName = this.escapeHtml(name);
    const members = group.templates || [];
    const scenarioCount = Object.keys(group.scenarios || {}).length;
    const mappingCount = Object.values(group.mappedMethods || {}).filter(Boolean).length;
    const rows = members
      .map((member) => this.generateGroupMemberRowHtml(member, currentPath, `
                                <button class="icon-button" data-action="openTemplate" data-template="${this.escapeHtml(member)}" title="Open template"><span class="codicon codicon-go-to-file"></span></button>
                                <button class="icon-button" data-action="removeTemplateFromGroup" data-name="${escapedName}" data-template="${this.escapeHtml(member)}" title="Remove from group (keeps a copy of the scenarios)"><span class="codicon codicon-debug-disconnect"></span></button>`))
      .join("");
    const mappingsText = mappingCount ? ` &middot; ${ContextWebviewRenderer.plural(mappingCount, "method mapping")}` : "";
    return `
                    <div class="group-detail" data-group-name="${escapedName}" hidden>
                        <div class="scenario-detail-header rename-scope" data-rename-command="renameTemplateGroup">
                            <span class="codicon codicon-link"></span>
                            <div class="scenario-title rename-label">${escapedName}</div>
                            <input type="text" class="scenario-rename-input" value="${escapedName}" data-old-name="${escapedName}" hidden />
                            <div class="scenario-detail-actions">
                                <button class="icon-button" data-action="startGroupRename" data-name="${escapedName}" title="Rename group"><span class="codicon codicon-edit"></span></button>
                                <button class="icon-button" data-action="deleteTemplateGroup" data-name="${escapedName}" title="Delete group (members keep a copy of the scenarios)"><span class="codicon codicon-trash"></span></button>
                            </div>
                        </div>
                        <div class="group-summary">
                            Shares <strong>${ContextWebviewRenderer.plural(scenarioCount, "scenario")}</strong>
                            &middot; active: <strong>${this.escapeHtml(group.activeScenario || "Default")}</strong>${mappingsText}
                        </div>
                        <div class="label-with-info group-members-header">
                            <div class="section-label">Templates</div>
                            <span class="count-badge">${members.length}</span>
                            <button class="add-table-row-button group-add-templates" data-action="addTemplatesToGroup" data-name="${escapedName}">Add templates...</button>
                        </div>
                        <table class="headers-table group-members-table">
                            <thead><tr><th>Template</th><th></th></tr></thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>`;
  }

  private generateUngroupedDetailHtml(ungrouped: string[], groupNames: string[], currentPath: string): string {
    const groupOptions = groupNames
      .map((name) => `<option value="${this.escapeHtml(name)}">${this.escapeHtml(name)}</option>`)
      .join("");
    const scenarioCount = (p: string) =>
      Object.keys(this.deps.getEnvironmentContext().templates?.[p]?.scenarios || {}).length;
    const addToGroupSelect = (template: string) =>
      groupNames.length
        ? `<select class="add-to-group-select" data-template="${this.escapeHtml(template)}" title="Add to an existing group (its scenarios replace this template's)">
                                    <option value="">Add to group...</option>${groupOptions}
                                </select>`
        : "";
    const rows = ungrouped.length
      ? ungrouped
          .map((template) => this.generateGroupMemberRowHtml(template, currentPath, `
                                ${addToGroupSelect(template)}
                                <button class="icon-button" data-action="createGroupFromTemplate" data-template="${this.escapeHtml(template)}" title="New group sharing this template's scenarios"><span class="codicon codicon-new-folder"></span></button>
                                <button class="icon-button" data-action="openTemplate" data-template="${this.escapeHtml(template)}" title="Open template"><span class="codicon codicon-go-to-file"></span></button>`,
            scenarioCount(template)))
          .join("")
      : '<tr><td colspan="2" class="empty-state-cell">Every template with scenarios is in a group</td></tr>';
    return `
                    <div class="group-detail" data-group-name="${ContextWebviewRenderer.UNGROUPED}" hidden>
                        <div class="scenario-detail-header">
                            <span class="codicon codicon-circle-slash"></span>
                            <div class="scenario-title">Ungrouped templates</div>
                        </div>
                        <div class="group-summary">Templates with their own scenarios. Add one to a group to share that group's scenarios, or start a new group from it.</div>
                        <table class="headers-table group-members-table">
                            <thead><tr><th>Template</th><th></th></tr></thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>`;
  }

  private generateGroupMemberRowHtml(
    template: string,
    currentPath: string,
    actionsHtml: string,
    scenarioCount?: number,
  ): string {
    const isCurrent = !!currentPath && isSameTemplatePath(template, currentPath);
    const exists = fs.existsSync(resolveTemplatePath(template));
    const directory = path.dirname(template);
    const meta = scenarioCount === undefined ? "" : `<span class="member-meta">${ContextWebviewRenderer.plural(scenarioCount, "scenario")}</span>`;
    return `
                            <tr class="group-member-row${isCurrent ? " is-current" : ""}${exists ? "" : " is-missing"}" data-template="${this.escapeHtml(template)}">
                                <td class="file-path-cell" title="${this.escapeHtml(template)}">
                                    <span class="file-name">
                                        ${this.escapeHtml(path.basename(template))}
                                        ${isCurrent ? '<span class="current-tag">open</span>' : ""}
                                        ${exists ? "" : '<span class="missing-tag" title="File not found in the workspace">missing</span>'}
                                        ${meta}
                                    </span>
                                    <span class="file-dir">${this.escapeHtml(directory === "." ? "" : directory)}</span>
                                </td>
                                <td class="group-member-actions">${actionsHtml}</td>
                            </tr>`;
  }

  /** Jump links to each Environment tab section, with item counts. */
  private generateEnvironmentIndexHtml(): string {
    const envCtx = this.deps.getEnvironmentContext();
    const count = (value: object | undefined) => Object.keys(value || {}).length;
    const scalarVariableCount = Object.values(envCtx.data || {}).filter(
      (v) => typeof v !== "object" || v === null || Array.isArray(v),
    ).length;
    const sections: { id: string; label: string; count?: number }[] = [
      { id: "env-file", label: "Context file" },
      { id: "env-messages", label: "Messages", count: (envCtx.messagesPropertiesPaths || []).length },
      { id: "env-headers", label: "Headers", count: count(envCtx.headers) },
      { id: "env-csp", label: "CSP", count: count(envCtx.cspDirectives) },
      { id: "env-variables", label: "Variables", count: scalarVariableCount },
      { id: "env-mocks", label: "Mock functions", count: count(envCtx.mockFunctions) },
    ];
    const index = sections
      .map((section) => `<button class="section-index-link" data-action="scrollToSection" data-target="${section.id}">${section.label}${section.count === undefined ? "" : ` <span class="count-badge">${section.count}</span>`}</button>`)
      .join("");

    return `<nav class="section-index">${index}</nav>`;
  }

  private generateEnvironmentConfigSectionHtml(): string {
    const envCtx = this.deps.getEnvironmentContext();
    return `
            <section class="config-section" id="env-messages">
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
                    <input type="text" id="environment-language" class="language-input" value="${this.escapeHtml(envCtx.language || "en")}" 
                           data-action="saveEnvironmentLanguage" placeholder="en" maxlength="5" />
                </div>
            </section>

            <section class="config-section" id="env-headers">
                <div class="label-with-info">
                    <div class="section-label">Environment Headers</div>
                    <button class="codicon codicon-info info-icon" title="These headers can be inherited by scenario headers for testing purposes."></button>
                </div>
                <div id="environment-headers-table">
                    ${this.generateenvironmentHeadersTable()}
                </div>
            </section>

            <section class="config-section" id="env-csp">
                <div class="label-with-info">
                    <div class="section-label">CSP Directives for Preview</div>
                    <button class="codicon codicon-info info-icon" title="Content Security Policy directives applied when previewing templates. These control what resources the browser can load (e.g., scripts, styles, images)."></button>
                </div>
                <div id="environment-csp-directives-table">
                    ${this.generateEnvironmentCspDirectivesTable()}
                </div>
            </section>

            <section class="config-section" id="env-variables">
                <div class="label-with-info">
                    <div class="section-label">Environment Variables</div>
                    <button class="codicon codicon-info info-icon" title="These variables can be inherited by template scenarios for testing purposes."></button>
                </div>
                <div id="environment-variables-table">
                    ${this.generateEnvironmentVariablesTable()}
                </div>
            </section>

            <section class="config-section" id="env-mocks">
                <div class="label-with-info">
                    <div class="section-label">Mock Functions</div>
                    <button class="codicon codicon-info info-icon" title="JavaScript mock implementations for methods that can be inherited by template scenarios."></button>
                </div>
                <div id="environment-mock-functions-table">
                    ${this.generateEnvironmentMockFunctionsTable()}
                </div>
            </section>
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

    const headerKeys = Object.keys(headers).filter(String).sort();

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
            <span class="file-name">${this.escapeHtml(path.basename(filePath))}</span>
            <span class="file-dir">${this.escapeHtml(path.dirname(filePath))}</span>
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

    const directiveNames = Object.keys(cspDirectives).filter(String).sort();

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
    const methodNames = this.collectTemplateMethodNames(items);

    let rowsHtml = "";
    if (methodNames.length === 0) {
      rowsHtml = `
                <tr>
                    <td colspan="2" style="text-align: center; color: var(--vscode-descriptionForeground); font-style: italic;">
                        No template methods detected
                    </td>
                </tr>
            `;
    } else {
      for (const fullMethodName of methodNames) {
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

  /** Sorted "object.method" names used by the template, excluding mapped tool objects. */
  private collectTemplateMethodNames(items: ContextItem[]): string[] {
    const names = new Set<string>();
    for (const item of items) {
      if (
        ContextWebviewRenderer.isLocaleObject(item) ||
        ContextWebviewRenderer.isTemplateMessagesObject(item) ||
        ContextWebviewRenderer.isEscapeToolObject(item) ||
        ContextWebviewRenderer.isHttpServletRequestObject(item)
      ) {
        continue;
      }
      if (item.type === "object" && item.methods) {
        for (const methodName of item.methods.keys()) {
          names.add(`${item.name}.${methodName}`);
        }
      }
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }

  private static plural(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
  }

  // -------------------------------------------------------------------------
  // Object classifier helpers
  // -------------------------------------------------------------------------

  static isLocaleObject(item: ContextItem): boolean {
    return ContextWebviewRenderer.canMapEnvironmentObject(item, ["getLanguage"]);
  }

  static isTemplateMessagesObject(item: ContextItem): boolean {
    return ContextWebviewRenderer.canMapEnvironmentObject(item, ["getMessage"]);
  }

  static isEscapeToolObject(item: ContextItem): boolean {
    return ContextWebviewRenderer.canMapEnvironmentObject(item, ["escape"]);
  }

  private static isHttpServletRequestObject(item: ContextItem): boolean {
    return ContextWebviewRenderer.canMapEnvironmentObject(item, [
      "getHeader",
      "getParameter",
      "getParameterMap",
    ]);
  }

  static canMapEnvironmentObject(
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

}
