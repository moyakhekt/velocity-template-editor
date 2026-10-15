import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { ContextManager } from './context/contextManager';
import { VelocityServerClient } from './server/velocityServerClient';
import { ScenariosData } from './shared/types';
import { resolveTemplatePath } from './context/contextManagerServices';
import { isDebugLogging } from './shared/debugLogging';

export class VelocityPreviewProvider {
    private context: vscode.ExtensionContext;
    private contextManager: ContextManager;
    private refreshTimeout: ReturnType<typeof setTimeout> | undefined;
    private velocityServer: VelocityServerClient | undefined;
    previewFilePath: string | undefined;
    private previewServer: http.Server | undefined;
    private serverPort: number = 0;
    private templateDir: string | undefined;
    // Template currently shown in the preview (not necessarily the active editor)
    private previewTemplatePath: string | undefined;
    // Second template from the same context group shown for comparison (same scenario)
    private compareTemplatePath: string | undefined;
    // Bumped on every write so the browser can tell what changed; pushed to open tabs via /__events
    private contentVersion: number = 0;
    private mainVersion: number = 0;
    private compareVersion: number = 0;
    private lastMainHtml: string | undefined;
    private logoSvg: string | undefined;
    // Open browser tabs, each holding a /__events connection; used to reuse and close the tab
    private eventClients = new Set<http.ServerResponse>();
    private lastClientGoneAt = 0;
    private readonly SAFE_PORT_RANGE = { min: 8100, max: 8200 };

    constructor(
        context: vscode.ExtensionContext,
        contextManager: ContextManager,
        velocityServer?: VelocityServerClient
    ) {
        this.context = context;
        this.contextManager = contextManager;
        this.velocityServer = velocityServer;
    }

    async showPreview(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'velocity') {
            vscode.window.showErrorMessage('Please open a Velocity template file');
            return;
        }

        const templatePath = editor.document.uri.fsPath;
        this.previewTemplatePath = templatePath;

        // Set active template in context manager before rendering
        this.contextManager.templateFilePath = templatePath;

        // Start HTTP server first if not already running
        const tempDir = this.context.globalStorageUri.fsPath;
        await fs.promises.mkdir(tempDir, { recursive: true });

        if (!this.previewServer) {
            await this.startPreviewServer(tempDir);
        }

        // Checked before rendering, since rendering makes an open tab reload (and briefly disconnect)
        const hasOpenTab = await this.hasOpenTab();

        this.previewFilePath = path.join(tempDir, 'velocity-preview.html');
        // Always rewrite the main page on an explicit preview; an open tab reloads to show it
        await this.renderAndWrite(true);
        if (hasOpenTab) {
            vscode.window.setStatusBarMessage('$(globe) Velocity preview updated in the open browser tab', 4000);
            return;
        }

        // Open in default browser (more reliable than Simple Browser)
        const { activeScenario } = await this.contextManager.getScenarioInfo(templatePath);
        const url = `http://localhost:${this.serverPort}/velocity-preview.html${this.getPreviewQuery(templatePath, activeScenario, this.compareTemplatePath)}`;
        await vscode.env.openExternal(vscode.Uri.parse(url));
    }

    /** Whether a browser tab is showing the preview. A tab reloading after a change reconnects within moments. */
    private async hasOpenTab(): Promise<boolean> {
        const deadline = this.lastClientGoneAt + 2000;
        while (this.eventClients.size === 0 && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return this.eventClients.size > 0;
    }

    /** Tells every open tab which parts of the preview changed (see /__events). */
    private notifyClients(): void {
        const message = `data: ${this.getVersionJson()}\n\n`;
        this.eventClients.forEach(client => client.write(message));
    }

    private getVersionJson(): string {
        return JSON.stringify({ main: this.mainVersion, content: this.contentVersion, compare: this.compareVersion });
    }

    refresh(document: vscode.TextDocument): void {
        // Only the previewed and compared templates drive the preview; edits to
        // other templates must not replace what the browser is showing.
        if (!this.isPreviewedTemplate(document.uri.fsPath) && !this.isComparedTemplate(document.uri.fsPath)) {
            return;
        }
        this.scheduleRender();
    }

    /**
     * Re-renders when a messages .properties file used by the preview changes. The
     * server reads these from disk on every render, so only saved changes show.
     */
    refreshIfMessagesFile(filePath: string): void {
        if (!this.previewTemplatePath) {
            return;
        }
        const env = this.contextManager.getEnvironmentContext();
        const paths = env.messagesPropertiesPaths
            ?? (env.messagesPropertiesPath ? [env.messagesPropertiesPath] : []);
        if (paths.some(p => this.isSameFile(path.resolve(p), path.resolve(filePath)))) {
            this.scheduleRender();
        }
    }

    private scheduleRender(): void {
        const config = vscode.workspace.getConfiguration('velocity.preview');
        if (!config.get<boolean>('autoRefresh', true)) {
            return;
        }
        const delay = config.get<number>('refreshDelay', 500);
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
        }
        this.refreshTimeout = setTimeout(() => {
            void this.renderAndWrite();
        }, delay);
    }

    private isPreviewedTemplate(templatePath: string): boolean {
        return !!this.previewTemplatePath && this.isSameFile(templatePath, this.previewTemplatePath);
    }

    private isComparedTemplate(templatePath: string): boolean {
        return !!this.compareTemplatePath && this.isSameFile(templatePath, this.compareTemplatePath);
    }

    private isSameFile(a: string, b: string): boolean {
        return a === b || a.toLowerCase() === b.toLowerCase();
    }

    /**
     * The folder a template's relative URLs (assets/...) resolve against. PingFederate
     * serves every template's assets from conf/template, whichever subfolder the
     * template is in (brand-a/, brand-b/, ...), so use that folder when the
     * template is inside one; otherwise the template's own folder.
     */
    private static assetRootFor(templatePath: string): string {
        let dir = path.dirname(templatePath);
        for (;;) {
            if (path.basename(dir).toLowerCase() === 'template' && path.basename(path.dirname(dir)).toLowerCase() === 'conf') {
                return dir;
            }
            const parent = path.dirname(dir);
            if (parent === dir) {
                return path.dirname(templatePath);
            }
            dir = parent;
        }
    }

    /** Deepest directory containing both a and b (asset requests resolve against it). */
    private static commonDirectory(a: string, b: string): string {
        let dir = a;
        while (path.relative(dir, b).startsWith('..')) {
            const parent = path.dirname(dir);
            if (parent === dir) {
                break;
            }
            dir = parent;
        }
        return dir;
    }

    /**
     * Renders the previewed template (and the comparison template, if any) and
     * writes the preview files. The main page (toolbar) is rewritten only when it
     * changed; the browser reloads the whole page for that and just the frames
     * otherwise.
     */
    private async renderAndWrite(forceMain: boolean = false): Promise<void> {
        const primaryPath = this.previewTemplatePath;
        if (!this.previewFilePath || !primaryPath) {
            return;
        }
        try {
            // A comparison only makes sense within the previewed template's group
            const group = this.contextManager.getTemplateGroupMembers(primaryPath);
            const compare = this.compareTemplatePath;
            if (compare && (!group || this.isSameFile(compare, primaryPath) || !group.members.some(m => this.isSameFile(m, compare)))) {
                this.compareTemplatePath = undefined;
            }
            const comparePath = this.compareTemplatePath;
            const primaryRoot = VelocityPreviewProvider.assetRootFor(primaryPath);
            this.templateDir = comparePath
                ? VelocityPreviewProvider.commonDirectory(primaryRoot, VelocityPreviewProvider.assetRootFor(comparePath))
                : primaryRoot;

            const primary = await this.renderContent(await vscode.workspace.openTextDocument(primaryPath));
            const compared = comparePath
                ? await this.renderContent(await vscode.workspace.openTextDocument(comparePath))
                : undefined;
            const scenarioInfo = await this.contextManager.getScenarioInfo(primaryPath);

            const mainHtml = this.buildMainHtml({
                primaryPath,
                comparePath,
                groupName: group?.name,
                groupMembers: group?.members ?? [],
                scenarioInfo,
                isError: primary.isError,
            });

            const dir = path.dirname(this.previewFilePath);
            await fs.promises.writeFile(path.join(dir, 'velocity-preview-content.html'), primary.html, 'utf-8');
            this.contentVersion++;
            if (compared) {
                await fs.promises.writeFile(path.join(dir, 'velocity-preview-compare.html'), compared.html, 'utf-8');
                this.compareVersion++;
            }
            if (forceMain || mainHtml !== this.lastMainHtml) {
                await fs.promises.writeFile(this.previewFilePath, mainHtml, 'utf-8');
                this.lastMainHtml = mainHtml;
                this.mainVersion++;
            }
            this.notifyClients();
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to update preview: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    /** Renders one template with its (possibly group-shared) context into a preview document. */
    private async renderContent(document: vscode.TextDocument): Promise<{ html: string, isError: boolean }> {
        const templatePath = document.uri.fsPath;
        const templateContent = document.getText();

        const contextData = await this.contextManager.getContextForTemplate(templatePath);

        // Separate variables from method mocks
        const variables: Record<string, any> = {};
        const mocks: Record<string, Record<string, any>> = {};

        for (const [key, value] of Object.entries(contextData)) {
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                // Check if this object has methods with _implementation
                const hasMethods = Object.values(value).some(
                    (v: any) => v && typeof v === 'object' && '_implementation' in v
                );

                if (hasMethods) {
                    // This is an object with method mocks
                    mocks[key] = {};
                    for (const [methodName, methodData] of Object.entries(value)) {
                        if (methodData && typeof methodData === 'object' && '_implementation' in (methodData as any)) {
                            mocks[key][methodName] = {
                                name: methodName,
                                implementation: (methodData as any)._implementation
                            };
                        } else {
                            // Regular property, add to variables
                            if (!variables[key]) {
                                variables[key] = {};
                            }
                            variables[key][methodName] = methodData;
                        }
                    }
                    // Keep the object in variables only if it has non-method properties
                    if (!variables[key] || Object.keys(variables[key]).length === 0) {
                        delete variables[key];
                    }
                } else {
                    // Regular variable
                    variables[key] = value;
                }
            } else {
                // Primitive value
                variables[key] = value;
            }
        }

        try {
            if (!this.velocityServer) {
                throw new Error('Apache Velocity server is not running. Please check the Output panel for details.');
            }

            if (!await this.velocityServer.isRunning()) {
                // Server was running at activation but died — try to restart it
                try {
                    await this.velocityServer.start();
                } catch (startError) {
                    const msg = startError instanceof Error ? startError.message : String(startError);
                    throw new Error(`Apache Velocity server failed to restart: ${msg}`);
                }
                if (!await this.velocityServer.isRunning()) {
                    throw new Error('Apache Velocity server is not running. Please check the Output panel for details.');
                }
            }

            // Get environment context for $templateMessages and $locale
            const environmentContext = this.contextManager.getEnvironmentContext();

            // Migrate old single path to array if needed
            let messagesPropertiesPaths: string[] = [];
            if (environmentContext.messagesPropertiesPaths) {
                messagesPropertiesPaths = environmentContext.messagesPropertiesPaths;
            } else if (environmentContext.messagesPropertiesPath) {
                messagesPropertiesPaths = [environmentContext.messagesPropertiesPath];
            }

            const language = environmentContext.language || 'en';

            // Get template variable mappings
            const templateMappings = await this.contextManager.getTemplateMappings(templatePath);

            const rendered = await this.velocityServer.render(templateContent, variables, mocks, messagesPropertiesPaths, language, templateMappings);
            return { html: this.buildContentHtml(rendered, false, templatePath), isError: false };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return { html: this.buildContentHtml(errorMessage, true, templatePath), isError: true };
        }
    }

    private buildCspMetaTag(): string {
        const environmentContext = this.contextManager.getEnvironmentContext();
        const cspDirectives = environmentContext.cspDirectives;
        
        if (!cspDirectives || Object.keys(cspDirectives).length === 0) {
            return ''; // No CSP directives configured
        }
        
        // Build CSP header string from directives
        const cspParts: string[] = [];
        for (const [directive, value] of Object.entries(cspDirectives)) {
            if (value && value.trim()) {
                // Ensure script-src allows inline scripts for our intercept functionality
                if (directive === 'script-src' && value.trim()) {
                    const scriptSrc = value.trim();
                    // Add 'unsafe-inline' if not already present
                    if (!scriptSrc.includes("'unsafe-inline'")) {
                        cspParts.push(`${directive} ${scriptSrc} 'unsafe-inline'`);
                    } else {
                        cspParts.push(`${directive} ${scriptSrc}`);
                    }
                } else {
                    cspParts.push(`${directive} ${value.trim()}`);
                }
            }
        }
        
        if (cspParts.length === 0) {
            return '';
        }
        
        const cspHeader = cspParts.join('; ');
        return `<meta http-equiv="Content-Security-Policy" content="${this.escapeHtml(cspHeader)}">`;
    }

    /** The document shown inside a preview frame: the rendered template or an error. */
    private buildContentHtml(content: string, isError: boolean, templatePath: string): string {
        const cspMetaTag = this.buildCspMetaTag();

        if (isError) {
            const errorStyles = `
                body {
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                    color: var(--vscode-errorForeground);
                    background-color: var(--vscode-inputValidation-errorBackground);
                    padding: 20px;
                }
                .error {
                    border: 1px solid var(--vscode-inputValidation-errorBorder);
                    padding: 15px;
                    border-radius: 4px;
                    white-space: pre-wrap;
                    font-family: var(--vscode-editor-font-family);
                }
            `;
            return `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    ${cspMetaTag}
                    <title>Velocity Preview Error</title>
                    <style>${errorStyles}</style>
                </head>
                <body>
                    <h2>Template Rendering Error</h2>
                    <p>${this.escapeHtml(path.basename(templatePath))}</p>
                    <div class="error">${this.escapeHtml(content)}</div>
                </body>
                </html>
            `;
        }

        // Check if content is already a full HTML document
        const isFullHtml = /^\s*<!DOCTYPE/i.test(content) || /^\s*<html/i.test(content);

        // Always use our preview server as base so relative assets resolve to localhost, not
        // whatever URL a Velocity variable like $CurrentPingFedBaseURL resolves to.
        const relPath = path.relative(this.templateDir || '', VelocityPreviewProvider.assetRootFor(templatePath)).replace(/\\/g, '/');
        const previewBaseHref = `http://localhost:${this.serverPort}/${relPath ? relPath + '/' : ''}`;
        const baseTag = `<base href="${previewBaseHref}">`;

        // JavaScript to intercept navigation and forms
        const interceptScript = this.getInterceptScript();

        if (isFullHtml) {
            let htmlWithTags = content;

            // Insert CSP before any other meta tags
            if (cspMetaTag) {
                htmlWithTags = htmlWithTags.replace(/(<head[^>]*>)/i, `$1\n    ${cspMetaTag}`);
            }

            // Replace any existing <base href> (which may contain an unresolved or external URL)
            // then insert our preview server base tag so all relative assets resolve correctly.
            htmlWithTags = htmlWithTags.replace(/<base\s[^>]*>/gi, '');
            htmlWithTags = htmlWithTags.replace(/(<head[^>]*>)/i, `$1\n    ${baseTag}`);

            // Inject intercept script IMMEDIATELY after opening <body> tag for early execution
            return htmlWithTags.replace(/(<body[^>]*>)/i, `$1\n${interceptScript}`);
        }

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                ${cspMetaTag}
                ${baseTag}
                <title>Velocity Template Output</title>
            </head>
            <body>
                ${interceptScript}
                ${content}
            </body>
            </html>
        `;
    }

    /**
     * Short labels for group members: paths relative to the members' common
     * directory, e.g. "login.template.html", "brand-a/login.template.html".
     */
    private getMemberLabels(members: string[]): Map<string, string> {
        const stored = members.map(m => this.contextManager.normalizeTemplatePath(m));
        let common = stored.length ? stored[0].split('/').slice(0, -1) : [];
        for (const member of stored.slice(1)) {
            const dirs = member.split('/').slice(0, -1);
            let i = 0;
            while (i < common.length && i < dirs.length && common[i].toLowerCase() === dirs[i].toLowerCase()) {
                i++;
            }
            common = common.slice(0, i);
        }
        const labels = new Map<string, string>();
        members.forEach((member, index) => {
            labels.set(member.toLowerCase(), stored[index].split('/').slice(common.length).join('/'));
        });
        return labels;
    }

    /**
     * Query string identifying the previewed template (workspace-relative, slashes
     * kept readable), scenario and comparison, e.g. ?template=a/b/login.html&scenario=Default
     */
    private getPreviewQuery(templatePath: string | undefined, scenario?: string, comparePath?: string): string {
        if (!templatePath) {
            return '';
        }
        const encode = (value: string) =>
            encodeURIComponent(value).replace(/%2F/gi, '/');
        const templateParam = encode(this.contextManager.normalizeTemplatePath(templatePath));
        const scenarioPart = scenario ? `&scenario=${encode(scenario)}` : '';
        const comparePart = comparePath ? `&compare=${encode(this.contextManager.normalizeTemplatePath(comparePath))}` : '';
        return `?template=${templateParam}${scenarioPart}${comparePart}`;
    }

    /** Resolves a ?template= value to a template file the preview may render. */
    private resolveTemplateParam(templateParam: string): string | undefined {
        const workspaceFolders = vscode.workspace.workspaceFolders || [];
        const candidate = path.isAbsolute(templateParam)
            ? path.normalize(templateParam)
            : path.join(workspaceFolders[0]?.uri.fsPath || '', templateParam);

        const isInWorkspace = workspaceFolders.some(folder => {
            const relative = path.relative(folder.uri.fsPath, candidate);
            return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
        });
        const isOpenTemplate = vscode.workspace.textDocuments.some(
            d => d.languageId === 'velocity' && this.isSameFile(d.uri.fsPath, candidate)
        );
        if (!isInWorkspace && !isOpenTemplate && !this.isPreviewedTemplate(candidate)) {
            return undefined;
        }
        return fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : undefined;
    }

    /** Every template known to the environment context, grouped by context group, for the Template menu. */
    private getTemplateChoices(primaryPath: string): { group: string; items: { value: string; label: string; exists: boolean; selected: boolean }[] }[] {
        const environmentContext = this.contextManager.getEnvironmentContext();
        const sections: { group: string; items: { value: string; label: string; exists: boolean; selected: boolean }[] }[] = [];
        const listed = new Set<string>();
        const toItems = (members: string[]) => {
            const labels = this.getMemberLabels(members);
            return members.map(member => {
                listed.add(member.toLowerCase());
                return {
                    value: this.contextManager.normalizeTemplatePath(member),
                    label: labels.get(member.toLowerCase()) || path.basename(member),
                    exists: fs.existsSync(member),
                    selected: this.isSameFile(member, primaryPath),
                };
            });
        };

        for (const [name, group] of Object.entries(environmentContext.templateGroups || {})) {
            sections.push({ group: name, items: toItems((group.templates || []).map(resolveTemplatePath)) });
        }
        const ungrouped = Object.keys(environmentContext.templates || {})
            .map(resolveTemplatePath)
            .filter(p => !listed.has(p.toLowerCase()));
        if (!listed.has(primaryPath.toLowerCase()) && !ungrouped.some(p => this.isSameFile(p, primaryPath))) {
            ungrouped.unshift(primaryPath);
        }
        // Groups alphabetically, templates alphabetically within each, Ungrouped last
        const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
        sections.sort((a, b) => byName(a.group, b.group));
        sections.forEach(section => section.items.sort((a, b) => byName(a.label, b.label)));
        if (ungrouped.length) {
            const items = toItems(ungrouped).sort((a, b) => byName(a.label, b.label));
            sections.push({ group: 'Ungrouped', items });
        }
        return sections;
    }

    /** A searchable dropdown for the menu bar; its behaviour is wired up by createPicker() in the page script. */
    private buildPicker(id: string, label: string, options: {
        title: string;
        placeholder: string;
        emptyText: string;
        disabled?: boolean;
        sections: {
            group?: string;
            items: { value: string; label: string; title?: string; selected: boolean; disabled?: boolean; note?: string; search: string }[];
        }[];
    }): string {
        const esc = (text: string) => this.escapeHtml(text);
        let index = 0;
        const sections = options.sections.filter(section => section.items.length).map(section => `
                            <div class="picker-group" role="group"${section.group ? ` aria-label="${esc(section.group)}"` : ''}>${section.group ? `
                                <div class="picker-group-label">${esc(section.group)}</div>` : ''}${section.items.map(item => `
                                <div class="picker-option${item.selected ? ' selected' : ''}" role="option" id="${id}-option-${index++}"
                                     data-value="${esc(item.value)}" data-search="${esc(item.search.toLowerCase())}"
                                     aria-selected="${item.selected}"${item.disabled ? ' aria-disabled="true"' : ''}${item.title ? ` title="${esc(item.title)}"` : ''}>${esc(item.label)}${item.note ? ` <span class="picker-missing">${esc(item.note)}</span>` : ''}</div>`).join('')}
                            </div>`).join('');
        const selectedLabel = options.sections.flatMap(section => section.items).find(item => item.selected)?.label ?? '';

        return `
                    <div class="menu-field"><span id="${id}-label">${esc(label)}</span>
                        <div class="picker" id="${id}">
                            <button type="button" class="picker-button" id="${id}-button" aria-haspopup="listbox" aria-expanded="false"
                                    aria-labelledby="${id}-label ${id}-button" title="${esc(options.title)}"${options.disabled ? ' disabled' : ''}>
                                <span class="picker-button-text">${esc(selectedLabel)}</span><span class="picker-caret" aria-hidden="true"></span>
                            </button>
                            <div class="picker-panel" hidden>
                                <input type="search" class="picker-search" placeholder="${esc(options.placeholder)}" autocomplete="off"
                                       role="combobox" aria-expanded="true" aria-controls="${id}-list" aria-autocomplete="list">
                                <div class="picker-list" id="${id}-list" role="listbox" aria-label="${esc(label)}">${sections}
                                    <div class="picker-empty" hidden>${esc(options.emptyText)}</div>
                                </div>
                            </div>
                        </div>
                    </div>`;
    }

    /** The {V} logo from the extension root, inlined for the menu bar and favicon. */
    private getLogoSvg(): string {
        if (this.logoSvg === undefined) {
            try {
                this.logoSvg = fs.readFileSync(path.join(this.context.extensionPath, 'media', 'logo.svg'), 'utf8');
            } catch {
                this.logoSvg = '';
            }
        }
        return this.logoSvg;
    }

    /** The browser page: a menu bar (template, scenario, comparison, view) above one or two frames. */
    private buildMainHtml(options: {
        primaryPath: string;
        comparePath?: string;
        groupName?: string;
        groupMembers: string[];
        scenarioInfo: { scenarios: ScenariosData, activeScenario: string };
        isError: boolean;
    }): string {
        const { primaryPath, comparePath, groupName, groupMembers, scenarioInfo, isError } = options;
        const labels = this.getMemberLabels(groupMembers.length ? groupMembers : [primaryPath]);
        const labelFor = (p: string) => labels.get(p.toLowerCase()) || path.basename(p);
        const primaryLabel = labelFor(primaryPath);
        const compareLabel = comparePath ? labelFor(comparePath) : '';

        const titleParts = [path.basename(primaryPath)];
        if (comparePath) {
            titleParts[0] += ` vs ${compareLabel}`;
        }
        titleParts.push(scenarioInfo.activeScenario, isError ? 'Velocity Preview Error' : 'Velocity Preview');
        const pageTitle = titleParts.join(' · ');
        const pageScript = this.getMainPageScript(
            '/velocity-preview.html' + this.getPreviewQuery(primaryPath, scenarioInfo.activeScenario, comparePath),
            !!comparePath,
        );

        // Searchable pickers (a native <select> can't be filtered or styled)
        const templateSections = this.getTemplateChoices(primaryPath);
        const templatePicker = this.buildPicker('template-picker', 'Template', {
            title: this.contextManager.normalizeTemplatePath(primaryPath),
            placeholder: 'Search templates or groups',
            emptyText: 'No templates match',
            sections: templateSections.map(section => ({
                group: section.group,
                items: section.items.map(item => ({
                    value: item.value,
                    label: item.label,
                    title: item.value,
                    selected: item.selected,
                    disabled: !item.exists,
                    note: item.exists ? undefined : '(missing)',
                    search: `${section.group} ${item.value}`,
                })),
            })),
        });

        const scenarioPicker = this.buildPicker('scenario-picker', 'Scenario', {
            title: `Scenario${groupName ? ` (shared by group "${groupName}")` : ''}`,
            placeholder: 'Search scenarios',
            emptyText: 'No scenarios match',
            sections: [{
                items: Object.keys(scenarioInfo.scenarios).map(name => ({
                    value: name,
                    label: name,
                    selected: name === scenarioInfo.activeScenario,
                    search: name,
                })),
            }],
        });

        const others = groupMembers.filter(m => !this.isSameFile(m, primaryPath));
        let compareTitle = `Show another template from group "${groupName}" beside this one (same scenario)`;
        if (!groupName) {
            compareTitle = 'Add this template to a context group to compare it with the group\'s other templates';
        } else if (others.length === 0) {
            compareTitle = `"${groupName}" has no other templates to compare with`;
        }
        const comparePicker = this.buildPicker('compare-picker', 'Compare', {
            title: compareTitle,
            placeholder: 'Search templates',
            emptyText: 'No templates match',
            disabled: others.length === 0,
            sections: [
                { items: [{ value: '', label: comparePath ? 'Stop comparing' : 'None', selected: !comparePath, search: 'none stop comparing' }] },
                {
                    group: groupName,
                    items: others.map(member => {
                        const value = this.contextManager.normalizeTemplatePath(member);
                        return {
                            value,
                            label: labelFor(member),
                            title: value,
                            selected: !!comparePath && this.isSameFile(member, comparePath),
                            search: `${labelFor(member)} ${value}`,
                        };
                    }).sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true })),
                },
            ],
        });

        const logo = this.getLogoSvg();
        const favicon = logo ? `<link rel="icon" href="data:image/svg+xml;base64,${Buffer.from(logo).toString('base64')}">` : '';
        const menuLogo = logo
            ? logo.replace(/<svg\b/, '<svg class="menu-logo" aria-hidden="true"').replace(/\swidth="\d+"\sheight="\d+"/, '')
            : '';
        const restoreLogo = logo
            ? logo.replace(/<svg\b/, '<svg class="restore-logo" aria-hidden="true"').replace(/\swidth="\d+"\sheight="\d+"/, '')
            : 'VTL';

        const styles = `
            * { box-sizing: border-box; }
            html, body { height: 100%; }
            body {
                margin: 0;
                display: flex;
                flex-direction: column;
                font-family: var(--vscode-font-family, "Segoe UI", system-ui, sans-serif);
                font-size: 13px;
                background-color: #1e1e1e;
                color: #cccccc;
                overflow: hidden;
            }

            .menu-bar {
                flex: none;
                display: flex;
                align-items: center;
                flex-wrap: wrap;
                gap: 6px 12px;
                padding: 6px 12px;
                background: #252526;
                border-bottom: 1px solid #3c3c3c;
                box-shadow: 0 1px 6px rgba(0, 0, 0, 0.35);
                z-index: 10;
            }
            .menu-brand {
                display: flex;
                align-items: center;
                gap: 8px;
                font-weight: 600;
                color: #e0e0e0;
                white-space: nowrap;
            }
            .menu-logo {
                width: 22px;
                height: 22px;
                flex: none;
            }
            .menu-field {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                min-width: 0;
            }
            .menu-field > span {
                color: #9d9d9d;
                font-size: 12px;
            }
            .menu-divider {
                width: 1px;
                align-self: stretch;
                background: #3c3c3c;
            }
            .menu-spacer {
                flex: 1;
            }
            .menu-bar button:focus-visible {
                outline: 1px solid #007fd4;
                outline-offset: 1px;
            }
            .picker {
                position: relative;
            }
            .picker-button {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                width: 180px;
                background: #3c3c3c;
                color: #cccccc;
                border: 1px solid #5a5a5a;
                border-radius: 4px;
                padding: 3px 6px;
                font: inherit;
                text-align: left;
                cursor: pointer;
            }
            #template-picker .picker-button {
                width: 240px;
            }
            .picker-button:hover:not(:disabled) {
                filter: brightness(1.1);
            }
            .picker-button:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            .picker-button-text {
                flex: 1;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .picker-caret {
                flex: none;
                width: 0;
                height: 0;
                border-left: 4px solid transparent;
                border-right: 4px solid transparent;
                border-top: 5px solid currentColor;
            }
            .picker-panel {
                position: absolute;
                top: calc(100% + 4px);
                left: 0;
                z-index: 100;
                width: min(320px, calc(100vw - 24px));
                display: flex;
                flex-direction: column;
                background: #252526;
                border: 1px solid #454545;
                border-radius: 6px;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
            }
            #template-picker .picker-panel {
                width: min(480px, calc(100vw - 24px));
            }
            .picker-panel[hidden] {
                display: none;
            }
            .picker-search {
                margin: 8px;
                padding: 5px 8px;
                background: #3c3c3c;
                color: #cccccc;
                border: 1px solid #5a5a5a;
                border-radius: 4px;
                font: inherit;
                outline: none;
            }
            .picker-search:focus {
                border-color: #007fd4;
            }
            .picker-list {
                position: relative;
                max-height: min(420px, calc(100vh - 140px));
                overflow-y: auto;
                padding: 0 4px 6px;
            }
            .picker-group[hidden],
            .picker-option[hidden],
            .picker-empty[hidden] {
                display: none;
            }
            .picker-group-label {
                padding: 8px 8px 2px;
                color: #e0e0e0;
                font-size: 12px;
                font-weight: 600;
            }
            .picker-option {
                padding: 4px 8px 4px 20px;
                border-radius: 3px;
                cursor: pointer;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .picker-option.active {
                background: #04395e;
                color: #ffffff;
            }
            .picker-option.selected {
                font-weight: 600;
            }
            .picker-option.selected::before {
                content: "\\2713";
                display: inline-block;
                width: 14px;
                margin-left: -14px;
            }
            .picker-option[aria-disabled="true"] {
                color: #777777;
                cursor: default;
            }
            .picker-missing {
                font-style: italic;
            }
            .picker-empty {
                padding: 10px 8px;
                color: #9d9d9d;
                font-style: italic;
            }
            .view-switch {
                display: inline-flex;
                border: 1px solid #5a5a5a;
                border-radius: 4px;
                overflow: hidden;
            }
            .view-switch[hidden] {
                display: none;
            }
            .view-switch button,
            .menu-button {
                background: transparent;
                color: inherit;
                border: none;
                padding: 3px 10px;
                font: inherit;
                cursor: pointer;
            }
            .view-switch button + button {
                border-left: 1px solid #5a5a5a;
            }
            .view-switch button:hover,
            .menu-button:hover {
                background: rgba(255, 255, 255, 0.08);
            }
            .view-switch button[aria-pressed="true"] {
                background: #0e639c;
                color: #ffffff;
            }
            .menu-button {
                border: 1px solid #5a5a5a;
                border-radius: 4px;
                white-space: nowrap;
            }
            .hide-toolbar-button {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                padding: 3px 6px;
            }
            .hide-toolbar-button svg {
                width: 14px;
                height: 14px;
            }

            /* Toolbar hidden: only a small logo tab in the top-left corner remains */
            body[data-toolbar="hidden"] .menu-bar {
                display: none;
            }
            .restore-toolbar {
                display: none;
                position: fixed;
                top: 0;
                left: 0;
                z-index: 20;
                align-items: center;
                justify-content: center;
                padding: 4px 6px;
                background: #252526;
                color: #e0e0e0;
                border: 1px solid #3c3c3c;
                border-top: none;
                border-left: none;
                border-bottom-right-radius: 6px;
                box-shadow: 0 1px 6px rgba(0, 0, 0, 0.35);
                font: inherit;
                font-weight: 600;
                cursor: pointer;
                opacity: 0.8;
            }
            .restore-toolbar:hover,
            .restore-toolbar:focus-visible {
                opacity: 1;
                background: #2d2d30;
            }
            .restore-toolbar:focus-visible {
                outline: 1px solid #007fd4;
                outline-offset: 1px;
            }
            body[data-toolbar="hidden"] .restore-toolbar {
                display: inline-flex;
            }
            .restore-logo {
                width: 18px;
                height: 18px;
                display: block;
            }
            /* Keep the left frame's label clear of the logo tab */
            body[data-toolbar="hidden"] .frame-pane:first-child .frame-label {
                left: 40px;
                max-width: calc(100% - 46px);
            }

            .frames {
                position: relative;
                flex: 1;
                min-height: 0;
                display: flex;
            }
            .frame-pane {
                position: relative;
                flex: 1 1 0;
                min-width: 0;
                display: none;
            }
            body[data-view="primary"] .frame-pane[data-pane="primary"],
            body[data-view="compare"] .frame-pane[data-pane="compare"],
            body[data-view="split"] .frame-pane {
                display: block;
            }
            body[data-view="split"] .frame-pane[data-pane="compare"] {
                border-left: 2px solid #007fd4;
            }
            .preview-frame {
                width: 100%;
                height: 100%;
                border: none;
                display: block;
                background: #ffffff;
            }
            .frame-label {
                display: none;
                position: absolute;
                top: 6px;
                left: 6px;
                z-index: 5;
                max-width: calc(100% - 12px);
                padding: 2px 8px;
                border: none;
                border-radius: 10px;
                background: rgba(30, 30, 30, 0.85);
                color: #e0e0e0;
                font: inherit;
                font-size: 11px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                cursor: pointer;
            }
            .frame-label:hover {
                background: rgba(14, 99, 156, 0.95);
            }
            body[data-view="split"] .frame-label {
                display: block;
            }
            .preview-ended {
                display: none;
                position: fixed;
                inset: 0;
                z-index: 50;
                align-items: center;
                justify-content: center;
                background: rgba(30, 30, 30, 0.9);
                color: #e0e0e0;
                font-size: 15px;
            }
            body[data-ended] .preview-ended {
                display: flex;
            }
        `;

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${this.escapeHtml(pageTitle)}</title>
                ${favicon}
                <style>${styles}</style>
            </head>
            <body data-view="primary">
                <script>
                    // Apply the remembered toolbar state before first paint, so reloads don't flash it
                    try { if (localStorage.getItem('vtlPreview.toolbar') === 'hidden') document.body.setAttribute('data-toolbar', 'hidden'); } catch (e) { /* unavailable */ }
                </script>
                <button type="button" class="restore-toolbar" id="restore-toolbar" title="Show toolbar" aria-label="Show toolbar">${restoreLogo}</button>
                <header class="menu-bar" role="toolbar" aria-label="Preview">
                    <div class="menu-brand" title="Velocity Preview">${menuLogo}</div>
                    ${templatePicker}
                    ${scenarioPicker}
                    <span class="menu-divider"></span>
                    ${comparePicker}
                    <div class="view-switch" id="view-switch" role="group" aria-label="Visible frame" ${comparePath ? '' : 'hidden'}>
                        <button type="button" data-view="primary" title="Show ${this.escapeHtml(primaryLabel)}">Primary</button>
                        <button type="button" data-view="compare" title="Show ${this.escapeHtml(compareLabel)}">Compare</button>
                        <button type="button" data-view="split" title="Side by side">Both</button>
                    </div>
                    <span class="menu-spacer"></span>
                    <button type="button" class="menu-button" data-open="primary" title="Open ${this.escapeHtml(primaryLabel)} in VS Code">Open in VS Code</button>
                    <button type="button" class="menu-button hide-toolbar-button" id="hide-toolbar" title="Hide toolbar" aria-label="Hide toolbar">
                        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 10.5 8 6l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                </header>
                <main class="frames">
                    <div class="frame-pane" data-pane="primary">
                        <button type="button" class="frame-label" data-open="primary" title="Open ${this.escapeHtml(primaryLabel)} in VS Code">${this.escapeHtml(primaryLabel)}</button>
                        <iframe id="frame-primary" class="preview-frame" src="/velocity-preview-content.html" title="${this.escapeHtml(primaryLabel)}"></iframe>
                    </div>
                    ${comparePath ? `
                    <div class="frame-pane" data-pane="compare">
                        <button type="button" class="frame-label" data-open="compare" title="Open ${this.escapeHtml(compareLabel)} in VS Code">${this.escapeHtml(compareLabel)}</button>
                        <iframe id="frame-compare" class="preview-frame" src="/velocity-preview-compare.html" title="${this.escapeHtml(compareLabel)}"></iframe>
                    </div>` : ''}
                </main>
                <div class="preview-ended" role="status">VS Code stopped this preview. You can close this tab.</div>
                ${pageScript}
            </body>
            </html>
        `;
    }

    private getMainPageScript(canonicalUrl: string, hasCompare: boolean): string {
        // Escape '<' so the URL can't close the script element
        const canonicalUrlJson = JSON.stringify(canonicalUrl).replace(/</g, '\\u003c');
        return `
                <script>
                    (function () {
                        const VIEW_KEY = 'vtlPreview.view';
                        const TOOLBAR_KEY = 'vtlPreview.toolbar';
                        const hasCompare = ${hasCompare ? 'true' : 'false'};
                        const storage = {
                            get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
                            set(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* unavailable */ } }
                        };

                        // Show the template, scenario and comparison being previewed. The URL
                        // always matches the current state, so a browser refresh changes nothing.
                        history.replaceState(null, '', ${canonicalUrlJson});

                        let unloading = false;
                        window.addEventListener('beforeunload', () => { unloading = true; });

                        function navigate(changes) {
                            const url = new URL(window.location.href);
                            for (const [key, value] of Object.entries(changes)) {
                                if (value === null) url.searchParams.delete(key); else url.searchParams.set(key, value);
                            }
                            // replace() keeps the tab at one history entry, so it can close itself later
                            unloading = true;
                            window.location.replace(url.toString());
                        }

                        // ---- Pickers: searchable, keyboard-friendly dropdowns ----
                        const pickers = [];
                        function createPicker(root, onChoose) {
                            if (!root) return;
                            const button = root.querySelector('.picker-button');
                            const panel = root.querySelector('.picker-panel');
                            const search = root.querySelector('.picker-search');
                            const list = root.querySelector('.picker-list');
                            const visibleOptions = () => [...list.querySelectorAll('.picker-option')]
                                .filter(o => !o.hidden && o.getAttribute('aria-disabled') !== 'true');

                            // Scroll the list (never the page) to an option, with its group heading if it's first
                            function reveal(option, center) {
                                const heading = option.previousElementSibling;
                                const top = heading && heading.classList.contains('picker-group-label') ? heading.offsetTop : option.offsetTop;
                                const bottom = option.offsetTop + option.offsetHeight;
                                if (center) list.scrollTop = top - (list.clientHeight - (bottom - top)) / 2;
                                else if (top < list.scrollTop) list.scrollTop = top;
                                else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
                            }
                            function setActive(option, center) {
                                list.querySelectorAll('.picker-option.active').forEach(o => o.classList.remove('active'));
                                if (option) {
                                    option.classList.add('active');
                                    reveal(option, center);
                                    search.setAttribute('aria-activedescendant', option.id);
                                } else {
                                    search.removeAttribute('aria-activedescendant');
                                }
                            }
                            function filter() {
                                const terms = search.value.trim().toLowerCase().split(/\\s+/).filter(Boolean);
                                let shown = 0;
                                list.querySelectorAll('.picker-group').forEach(group => {
                                    let groupShown = 0;
                                    group.querySelectorAll('.picker-option').forEach(option => {
                                        const text = option.getAttribute('data-search');
                                        const match = terms.every(t => text.includes(t));
                                        option.hidden = !match;
                                        if (match) groupShown++;
                                    });
                                    group.hidden = groupShown === 0;
                                    shown += groupShown;
                                });
                                list.querySelector('.picker-empty').hidden = shown > 0;
                                if (terms.length) {
                                    list.scrollTop = 0;
                                    setActive(visibleOptions()[0], false);
                                } else {
                                    // No search: centre the current choice in the list
                                    setActive(list.querySelector('.picker-option.selected'), true);
                                }
                            }
                            function open() {
                                pickers.forEach(p => p.close(false));
                                panel.hidden = false;
                                button.setAttribute('aria-expanded', 'true');
                                // Keep the panel inside the window
                                panel.style.left = '0px';
                                const overflow = panel.getBoundingClientRect().right - (window.innerWidth - 8);
                                if (overflow > 0) panel.style.left = -overflow + 'px';
                                search.value = '';
                                filter();
                                search.focus({ preventScroll: true });
                            }
                            function close(focusButton) {
                                if (panel.hidden) return;
                                panel.hidden = true;
                                button.setAttribute('aria-expanded', 'false');
                                if (focusButton) button.focus();
                            }
                            function choose(option) {
                                if (!option || option.getAttribute('aria-disabled') === 'true') return;
                                const unchanged = option.classList.contains('selected');
                                close(unchanged);
                                if (!unchanged) onChoose(option.getAttribute('data-value'));
                            }
                            button.addEventListener('click', () => panel.hidden ? open() : close(true));
                            button.addEventListener('keydown', (e) => {
                                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); }
                            });
                            search.addEventListener('input', filter);
                            search.addEventListener('keydown', (e) => {
                                const options = visibleOptions();
                                const current = list.querySelector('.picker-option.active');
                                const index = options.indexOf(current);
                                if (e.key === 'ArrowDown') { e.preventDefault(); setActive(options[Math.min(index + 1, options.length - 1)] || options[0], false); }
                                else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(options[Math.max(index - 1, 0)] || options[0], false); }
                                else if (e.key === 'Enter') { e.preventDefault(); choose(current || options[0]); }
                                else if (e.key === 'Escape') { e.preventDefault(); close(true); }
                                else if (e.key === 'Tab') { close(false); }
                            });
                            list.addEventListener('mousemove', (e) => {
                                const option = e.target.closest('.picker-option');
                                if (option && option.getAttribute('aria-disabled') !== 'true' && !option.classList.contains('active')) setActive(option, false);
                            });
                            list.addEventListener('click', (e) => choose(e.target.closest('.picker-option')));
                            document.addEventListener('mousedown', (e) => {
                                if (!root.contains(e.target)) close(false);
                            });
                            pickers.push({ close });
                        }
                        const closeAllPickers = () => pickers.forEach(p => p.close(false));
                        window.addEventListener('blur', closeAllPickers); // clicks inside a frame

                        createPicker(document.getElementById('template-picker'), (value) => {
                            // A different template has its own scenarios; a comparison is kept
                            // only if it's in the new template's group (checked by the extension)
                            navigate({ template: value, scenario: null });
                        });
                        createPicker(document.getElementById('scenario-picker'), (value) => navigate({ scenario: value }));
                        createPicker(document.getElementById('compare-picker'), (value) => {
                            // Picking a template shows both side by side unless a view was chosen before
                            if (value && !storage.get(VIEW_KEY)) storage.set(VIEW_KEY, 'split');
                            navigate({ compare: value });
                        });

                        // Open the previewed (or compared) template in VS Code
                        document.addEventListener('click', (e) => {
                            const button = e.target.closest('[data-open]');
                            if (button) fetch('/__open-template?which=' + encodeURIComponent(button.getAttribute('data-open')), { cache: 'no-store' });
                        });

                        // ---- Hide / restore the toolbar ----
                        function setToolbarHidden(hidden) {
                            closeAllPickers();
                            if (hidden) document.body.setAttribute('data-toolbar', 'hidden');
                            else document.body.removeAttribute('data-toolbar');
                            storage.set(TOOLBAR_KEY, hidden ? 'hidden' : 'shown');
                            document.getElementById(hidden ? 'restore-toolbar' : 'hide-toolbar')?.focus();
                        }
                        document.getElementById('hide-toolbar')?.addEventListener('click', () => setToolbarHidden(true));
                        document.getElementById('restore-toolbar')?.addEventListener('click', () => setToolbarHidden(false));

                        // ---- Which frame is visible ----
                        function setView(view, remember) {
                            if (!hasCompare || !['primary', 'compare', 'split'].includes(view)) view = 'primary';
                            document.body.setAttribute('data-view', view);
                            document.querySelectorAll('#view-switch button').forEach(button => {
                                button.setAttribute('aria-pressed', String(button.getAttribute('data-view') === view));
                            });
                            if (remember) storage.set(VIEW_KEY, view);
                        }
                        document.getElementById('view-switch')?.addEventListener('click', (e) => {
                            const button = e.target.closest('button[data-view]');
                            if (button) setView(button.getAttribute('data-view'), true);
                        });
                        setView(storage.get(VIEW_KEY) || 'split', false);

                        // ---- Live updates ----
                        // VS Code pushes version numbers over /__events. Reload the whole page when
                        // the menu (template, scenarios, comparison) changes, otherwise just the frame
                        // whose content changed. The open connection also tells VS Code this tab
                        // exists, so a new preview reuses it rather than opening another tab.
                        let known = null;
                        function reloadFrame(id, src) {
                            const frame = document.getElementById(id);
                            if (!frame) return;
                            const url = src + '?_=' + Date.now();
                            // replace() avoids adding to the tab's history (see navigate)
                            try { frame.contentWindow.location.replace(url); } catch (e) { frame.src = url; }
                        }
                        const events = new EventSource('/__events');
                        // Browsers only let a page close a tab with a single history entry (or one it
                        // opened itself); if closing is refused, say the preview has ended instead
                        function closeTab() {
                            events.close();
                            window.close();
                            setTimeout(() => document.body.setAttribute('data-ended', 'true'), 300);
                        }
                        let failures = 0;
                        events.addEventListener('open', () => { failures = 0; });
                        events.addEventListener('message', (e) => {
                            const version = JSON.parse(e.data);
                            if (known && version.main !== known.main) {
                                unloading = true;
                                window.location.replace('/velocity-preview.html');
                                return;
                            }
                            if (known && version.content !== known.content) {
                                reloadFrame('frame-primary', '/velocity-preview-content.html');
                            }
                            if (known && version.compare !== known.compare) {
                                reloadFrame('frame-compare', '/velocity-preview-compare.html');
                            }
                            known = version;
                        });
                        // The extension is stopping (VS Code closed or reloaded, or the extension disabled)
                        events.addEventListener('close', closeTab);
                        // Lost the connection without notice (e.g. VS Code crashed): give up once reconnecting fails
                        events.addEventListener('error', () => {
                            if (unloading) return;
                            if (++failures >= 2 || events.readyState === EventSource.CLOSED) closeTab();
                        });
                    })();
                </script>`;
    }

    private async startPreviewServer(tempDir: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.previewServer = http.createServer(async (req, res) => {
                let filePath: string;
                
                // Parse URL and query parameters
                const url = new URL(req.url || '', `http://localhost:${this.serverPort}`);
                const pathname = url.pathname;
                const scenarioParam = url.searchParams.get('scenario');
                const templateParam = url.searchParams.get('template');
                const compareParam = url.searchParams.get('compare'); // '' clears the comparison

                if (!this.isAllowedRequest(req)) {
                    res.writeHead(403, { 'Content-Type': 'text/plain' });
                    res.end('Forbidden');
                    return;
                }

                if (pathname === '/__open-template') {
                    const which = url.searchParams.get('which') === 'compare' ? this.compareTemplatePath : this.previewTemplatePath;
                    if (which) {
                        void vscode.workspace.openTextDocument(which).then(
                            doc => vscode.window.showTextDocument(doc, vscode.ViewColumn.One),
                            () => vscode.window.showErrorMessage(`Template not found: ${which}`),
                        );
                    }
                    res.writeHead(204, { 'Cache-Control': 'no-store' });
                    res.end();
                    return;
                }

                if (pathname === '/__events') {
                    // Held open by each preview tab: pushes version changes, shows VS Code the
                    // tab is open, and tells the tab to close when the preview stops
                    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'Connection': 'keep-alive' });
                    res.write(`retry: 1000\ndata: ${this.getVersionJson()}\n\n`);
                    this.eventClients.add(res);
                    req.on('close', () => {
                        this.eventClients.delete(res);
                        if (this.eventClients.size === 0) {
                            this.lastClientGoneAt = Date.now();
                        }
                    });
                    return;
                }

                // Handle ?template= and ?scenario= (a link to a specific preview).
                // Without ?template= the scenario applies to the previewed template,
                // not whichever editor happens to be active.
                if ((scenarioParam || templateParam || compareParam !== null) && pathname === '/velocity-preview.html') {
                    await this.applyPreviewParams(tempDir, templateParam, scenarioParam, compareParam);
                    filePath = path.join(tempDir, 'velocity-preview.html');
                } else if (pathname === '/' || pathname === '/velocity-preview.html') {
                    filePath = path.join(tempDir, 'velocity-preview.html');
                } else if (pathname === '/velocity-preview-content.html') {
                    filePath = path.join(tempDir, 'velocity-preview-content.html');
                } else if (pathname === '/velocity-preview-compare.html') {
                    filePath = path.join(tempDir, 'velocity-preview-compare.html');
                } else {
                    // Assets the template refers to (CSS, images, scripts)
                    let decodedPath: string;
                    try {
                        decodedPath = decodeURIComponent(pathname);
                    } catch {
                        res.writeHead(400, { 'Content-Type': 'text/plain' });
                        res.end('Bad request');
                        return;
                    }
                    const assetPath = await this.resolveAssetPath(decodedPath);
                    if (!assetPath) {
                        res.writeHead(404, { 'Content-Type': 'text/plain' });
                        res.end('File not found: ' + req.url);
                        return;
                    }
                    filePath = assetPath;
                }

                // Read and serve the file
                fs.stat(filePath, (statErr, stats) => {
                    if (statErr) {
                        res.writeHead(404, { 'Content-Type': 'text/plain' });
                        res.end('File not found: ' + req.url);
                        return;
                    }

                    fs.readFile(filePath, (err, data) => {
                        if (err) {
                            res.writeHead(404, { 'Content-Type': 'text/plain' });
                            res.end('File not found: ' + req.url);
                            return;
                        }

                        // Determine content type
                        const ext = path.extname(filePath).toLowerCase();
                        const contentTypes: { [key: string]: string } = {
                            '.html': 'text/html',
                            '.css': 'text/css',
                            '.js': 'application/javascript',
                            '.json': 'application/json',
                            '.png': 'image/png',
                            '.jpg': 'image/jpeg',
                            '.jpeg': 'image/jpeg',
                            '.gif': 'image/gif',
                            '.svg': 'image/svg+xml',
                            '.ico': 'image/x-icon',
                            '.woff': 'font/woff',
                            '.woff2': 'font/woff2',
                            '.ttf': 'font/ttf',
                            '.eot': 'application/vnd.ms-fontobject'
                        };

                        const contentType = contentTypes[ext] || 'application/octet-stream';
                        // No CORS headers: other sites must not be able to read what this server returns
                        res.writeHead(200, {
                            'Content-Type': contentType,
'Last-Modified': stats.mtime.toUTCString(),
                            'Cache-Control': 'no-store, no-cache, must-revalidate',
                            'Pragma': 'no-cache',
                            'Expires': '0'
                        });
                        res.end(data);
                    });
                });
            });

            // Try ports in safe range
            this.tryListenOnSafePort(resolve, reject);
        });
    }

    /**
     * Only requests addressed to this server by name (which blocks DNS rebinding), and
     * coming from the preview itself or a URL opened directly (which blocks other web
     * pages from driving the preview or reading files through it).
     */
    private isAllowedRequest(req: http.IncomingMessage): boolean {
        const host = (req.headers.host || '').toLowerCase();
        const hostAllowed = ['localhost', '127.0.0.1', '[::1]'].some(name => host === `${name}:${this.serverPort}`);
        // Sent by modern browsers; 'none' is a URL opened from VS Code, typed or bookmarked
        const site = req.headers['sec-fetch-site'];
        const siteAllowed = site === undefined || site === 'same-origin' || site === 'none';
        return hostAllowed && siteAllowed;
    }

    /**
     * Maps a request path to an asset under the template root (or, failing that, its
     * parent), refusing anything that resolves outside them, including via symlinks.
     */
    private async resolveAssetPath(requestPath: string): Promise<string | undefined> {
        if (!this.templateDir || requestPath.includes('\0')) {
            return undefined;
        }
        const isInside = (root: string, target: string) => {
            const relative = path.relative(root, target);
            return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
        };
        for (const root of [this.templateDir, path.dirname(this.templateDir)]) {
            const candidate = path.resolve(path.join(root, requestPath));
            if (!isInside(root, candidate)) {
                continue;
            }
            try {
                const [realRoot, realCandidate] = await Promise.all([fs.promises.realpath(root), fs.promises.realpath(candidate)]);
                if (isInside(realRoot, realCandidate) && (await fs.promises.stat(realCandidate)).isFile()) {
                    return realCandidate;
                }
            } catch {
                // Missing: try the next root
            }
        }
        return undefined;
    }

    private async applyPreviewParams(tempDir: string, templateParam: string | null, scenarioParam: string | null, compareParam: string | null): Promise<void> {
        const templatePath = templateParam ? this.resolveTemplateParam(templateParam) : this.previewTemplatePath;
        if (!templatePath) {
            if (templateParam) {
                vscode.window.showWarningMessage(`Preview template not found: ${templateParam}`);
            }
            return;
        }
        try {
            const templateChanged = !this.isPreviewedTemplate(templatePath);
            this.previewTemplatePath = templatePath;

            let scenarioChanged = false;
            if (scenarioParam) {
                const { scenarios, activeScenario } = await this.contextManager.getScenarioInfo(templatePath);
                if (scenarioParam !== activeScenario && scenarios[scenarioParam]) {
                    await this.contextManager.switchScenario(templatePath, scenarioParam);
                    scenarioChanged = true;
                }
            }

            let compareChanged = false;
            if (compareParam !== null) {
                const comparePath = compareParam ? this.resolveTemplateParam(compareParam) : undefined;
                if (compareParam && !comparePath) {
                    vscode.window.showWarningMessage(`Comparison template not found: ${compareParam}`);
                }
                const current = this.compareTemplatePath;
                compareChanged = comparePath && current ? !this.isSameFile(comparePath, current) : comparePath !== current;
                this.compareTemplatePath = comparePath;
            }

            if (!templateChanged && !scenarioChanged && !compareChanged) {
                return;
            }
            this.previewFilePath = path.join(tempDir, 'velocity-preview.html');
            await this.renderAndWrite();
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to update preview: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private tryListenOnSafePort(resolve: () => void, reject: (err: Error) => void, attempt: number = 0): void {
        const port = this.SAFE_PORT_RANGE.min + attempt;
        
        if (port > this.SAFE_PORT_RANGE.max) {
            reject(new Error('No available ports in safe range'));
            return;
        }

        this.previewServer!.listen(port, 'localhost', () => {
            this.serverPort = port;
            resolve();
        }).on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE') {
                // Port in use, try next one
                this.tryListenOnSafePort(resolve, reject, attempt + 1);
            } else {
                reject(err);
            }
        });
    }

    dispose(): void {
        // Ask open tabs to close themselves, then close the HTTP server
        this.eventClients.forEach(client => client.end('event: close\ndata: {}\n\n'));
        this.eventClients.clear();
        if (this.previewServer) {
            this.previewServer.close();
            this.previewServer.closeIdleConnections();
            this.previewServer = undefined;
        }
        
        // Clear preview file path
        this.previewFilePath = undefined;
        this.previewTemplatePath = undefined;
        this.compareTemplatePath = undefined;
        this.lastMainHtml = undefined;
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    private getInterceptScript(): string {
        return `
        <script>
        (function() {
            'use strict';

            // Interception details in the browser console only with velocity.debugLogging
            const debugLog = ${isDebugLogging() ? "console.log.bind(console, '[Velocity Preview]')" : '() => {}'};

            // Ensure body is visible — templates often hide it pending JS initialization
            if (document.body && document.body.style.visibility === 'hidden') {
                document.body.style.visibility = '';
            }
            
            debugLog('Initializing navigation interceptors...');
            
            // CRITICAL: Override HTMLFormElement.prototype.submit to catch programmatic submissions
            // Calling form.submit() bypasses ALL event listeners!
            const originalFormSubmit = HTMLFormElement.prototype.submit;
            HTMLFormElement.prototype.submit = function() {
                debugLog('form.submit() intercepted (programmatic)', this);
                
                const form = this;
                const action = form.action || window.location.href;
                const method = (form.method || 'GET').toUpperCase();
                
                // Collect form data
                const formData = new FormData(form);
                const formFields = [];
                
                for (const [key, value] of formData.entries()) {
                    formFields.push({
                        name: escapeHtml(key),
                        value: escapeHtml(value.toString())
                    });
                }
                
                const formDataTableHtml = formFields.length > 0 ? \`
                    <table class="velocity-form-data-table">
                        <thead>
                            <tr>
                                <th>Field Name</th>
                                <th>Value</th>
                            </tr>
                        </thead>
                        <tbody>
                            \${formFields.map(field => \`
                                <tr>
                                    <td>\${field.name}</td>
                                    <td>\${field.value}</td>
                                </tr>
                            \`).join('')}
                        </tbody>
                    </table>
                \` : '<em style="color: #858585;">No form data</em>';
                
                // Call showDialog (defined below)
                setTimeout(() => {
                    showDialog(
                        'Form Submission Captured (Programmatic)',
                        '📤',
                        [
                            { label: 'Target URL', content: escapeHtml(action) },
                            { label: 'HTTP Method', content: escapeHtml(method) },
                            { label: 'Form Data', content: formDataTableHtml }
                        ]
                    );
                }, 0);
                
                // DO NOT call originalFormSubmit - we want to block it
            };
            
            // Styles for the dialog
            const dialogStyles = \`
                .velocity-intercept-dialog {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.7);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 999999;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                }
                .velocity-dialog-content {
                    background: #2d2d2d;
                    color: #cccccc;
                    border: 1px solid #454545;
                    border-radius: 8px;
                    max-width: 90%;
                    max-height: 90%;
                    overflow: auto;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
                    padding: 24px;
                    min-width: 500px;
                }
                .velocity-dialog-header {
                    font-size: 18px;
                    font-weight: 600;
                    margin-bottom: 16px;
                    color: #ffffff;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .velocity-dialog-icon {
                    font-size: 24px;
                }
                .velocity-dialog-section {
                    margin: 16px 0;
                }
                .velocity-dialog-label {
                    font-weight: 600;
                    color: #4EC9B0;
                    margin-bottom: 8px;
                    font-size: 14px;
                }
                .velocity-dialog-value {
                    background: #1e1e1e;
                    border: 1px solid #3c3c3c;
                    border-radius: 4px;
                    padding: 12px;
                    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
                    font-size: 13px;
                    color: #d4d4d4;
                    word-break: break-all;
                    max-height: 400px;
                    overflow: auto;
                }
                .velocity-form-data-table {
                    width: 100%;
                    border-collapse: collapse;
                    background: #1e1e1e;
                    border: 1px solid #3c3c3c;
                    border-radius: 4px;
                    overflow: hidden;
                }
                .velocity-form-data-table th {
                    background: #252526;
                    color: #4EC9B0;
                    padding: 10px;
                    text-align: left;
                    border-bottom: 1px solid #3c3c3c;
                    font-weight: 600;
                }
                .velocity-form-data-table td {
                    padding: 10px;
                    border-bottom: 1px solid #2d2d2d;
                    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
                    font-size: 13px;
                }
                .velocity-form-data-table tr:last-child td {
                    border-bottom: none;
                }
                .velocity-form-data-table td:first-child {
                    color: #9CDCFE;
                    font-weight: 500;
                    width: 30%;
                }
                .velocity-dialog-buttons {
                    margin-top: 20px;
                    display: flex;
                    gap: 12px;
                    justify-content: flex-end;
                }
                .velocity-dialog-btn {
                    padding: 8px 16px;
                    border: none;
                    border-radius: 4px;
                    font-size: 14px;
                    cursor: pointer;
                    font-weight: 500;
                    transition: all 0.2s;
                }
                .velocity-dialog-btn-primary {
                    background: #0E639C;
                    color: #ffffff;
                }
                .velocity-dialog-btn-primary:hover {
                    background: #1177BB;
                }
            \`;
            
            // Add styles to document (also resets visibility that templates hide pending JS init)
            const styleEl = document.createElement('style');
            styleEl.textContent = dialogStyles + ' body { visibility: visible !important; }';
            document.head.appendChild(styleEl);
            
            // Show dialog function
            function showDialog(title, icon, sections) {
                debugLog('Showing dialog:', title);
                const dialog = document.createElement('div');
                dialog.className = 'velocity-intercept-dialog';
                
                const sectionsHtml = sections.map(section => \`
                    <div class="velocity-dialog-section">
                        <div class="velocity-dialog-label">\${section.label}</div>
                        <div class="velocity-dialog-value">\${section.content}</div>
                    </div>
                \`).join('');
                
                dialog.innerHTML = \`
                    <div class="velocity-dialog-content">
                        <div class="velocity-dialog-header">
                            <span class="velocity-dialog-icon">\${icon}</span>
                            <span>\${title}</span>
                        </div>
                        \${sectionsHtml}
                        <div class="velocity-dialog-buttons">
                            <button class="velocity-dialog-btn velocity-dialog-btn-primary" data-action="close">
                                OK (Reload Page)
                            </button>
                        </div>
                    </div>
                \`;
                
                // Close and reload handler
                const closeHandler = function() {
                    debugLog('Closing dialog and reloading...');
                    dialog.remove();
                    window.location.reload();
                };
                
                dialog.querySelector('[data-action="close"]').addEventListener('click', closeHandler);
                
                // Close on background click
                dialog.addEventListener('click', function(e) {
                    if (e.target === dialog) {
                        closeHandler();
                    }
                });
                
                // Close on Escape key
                const escapeHandler = function(e) {
                    if (e.key === 'Escape') {
                        document.removeEventListener('keydown', escapeHandler);
                        closeHandler();
                    }
                };
                document.addEventListener('keydown', escapeHandler);
                
                document.body.appendChild(dialog);
            }
            
            // Escape HTML for display
            function escapeHtml(text) {
                const div = document.createElement('div');
                div.textContent = text;
                return div.innerHTML;
            }
            
            // Intercept form submissions - EARLY, CAPTURE PHASE
            window.addEventListener('submit', function(e) {
                debugLog('Form submission intercepted', e.target);
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                
                const form = e.target;
                const action = form.action || window.location.href;
                const method = (form.method || 'GET').toUpperCase();
                
                // Collect form data
                const formData = new FormData(form);
                const formFields = [];
                
                for (const [key, value] of formData.entries()) {
                    formFields.push({
                        name: escapeHtml(key),
                        value: escapeHtml(value.toString())
                    });
                }
                
                const formDataTableHtml = formFields.length > 0 ? \`
                    <table class="velocity-form-data-table">
                        <thead>
                            <tr>
                                <th>Field Name</th>
                                <th>Value</th>
                            </tr>
                        </thead>
                        <tbody>
                            \${formFields.map(field => \`
                                <tr>
                                    <td>\${field.name}</td>
                                    <td>\${field.value}</td>
                                </tr>
                            \`).join('')}
                        </tbody>
                    </table>
                \` : '<em style="color: #858585;">No form data</em>';
                
                showDialog(
                    'Form Submission Captured',
                    '📤',
                    [
                        { label: 'Target URL', content: escapeHtml(action) },
                        { label: 'HTTP Method', content: escapeHtml(method) },
                        { label: 'Form Data', content: formDataTableHtml }
                    ]
                );
                
                return false;
            }, true); // Use capture phase
            
            // Also intercept via document
            document.addEventListener('submit', function(e) {
                debugLog('Form submission intercepted (document)', e.target);
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                return false;
            }, true);
            
            // Intercept link clicks - CAPTURE PHASE
            window.addEventListener('click', function(e) {
                let target = e.target;
                
                // Find the closest anchor tag
                while (target && target !== document && target.tagName !== 'A') {
                    target = target.parentElement;
                }
                
                if (target && target.tagName === 'A' && target.href) {
                    const href = target.href;
                    
                    // Only intercept if it's not a same-page anchor
                    if (!href.startsWith('#') && !href.startsWith('javascript:')) {
                        debugLog('Link click intercepted:', href);
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        
                        showDialog(
                            'Navigation Captured',
                            '🔗',
                            [
                                { label: 'Target URL', content: escapeHtml(href) },
                                { label: 'Link Text', content: escapeHtml(target.textContent || '(no text)') }
                            ]
                        );
                        
                        return false;
                    }
                }
            }, true); // Use capture phase
            
            // Intercept script navigation (location.href = ..., location = ...,
            // location.assign/replace). These can't be overridden: href, assign and
            // replace are non-configurable own properties of the location object.
            // The Navigation API's navigate event sees them all and can cancel them.
            if (window.navigation) {
                window.navigation.addEventListener('navigate', function(e) {
                    // Reloads (the dialog's OK button), back/forward and #hash changes
                    // are left alone, as is the preview refreshing this frame (same file).
                    if (!e.cancelable || e.hashChange || e.navigationType === 'reload' || e.navigationType === 'traverse') {
                        return;
                    }
                    const destination = new URL(e.destination.url);
                    if (destination.origin === window.location.origin && destination.pathname === window.location.pathname) {
                        return;
                    }
                    e.preventDefault();
                    debugLog('Script navigation intercepted:', destination.href);
                    showDialog(
                        'Navigation Captured',
                        '🔗',
                        [
                            { label: 'Target URL', content: escapeHtml(destination.href) },
                            { label: 'Method', content: e.navigationType === 'replace'
                                ? 'JavaScript (location.replace)'
                                : 'JavaScript (location.href / location.assign)' }
                        ]
                    );
                });
            } else {
                console.warn('[Velocity Preview] Navigation API unavailable; location.href navigation will not be captured');
            }

            // Intercept window.open
            const originalWindowOpen = window.open.bind(window);
            try {
                Object.defineProperty(window, 'open', {
                    value: function(url, target, features) {
                        if (url) {
                            debugLog('window.open intercepted:', url);
                            showDialog(
                                'Navigation Captured',
                                '🔗',
                                [
                                    { label: 'Target URL', content: escapeHtml(url.toString()) },
                                    { label: 'Method', content: 'JavaScript (window.open)' },
                                    { label: 'Target Window', content: escapeHtml(target || '_blank') }
                                ]
                            );
                        }
                        return null; // Prevent actual window opening
                    },
                    writable: false,
                    configurable: true
                });
            } catch (e) {
                console.warn('[Velocity Preview] Could not override window.open:', e);
            }
            
            // Prevent default form submission behavior on all forms
            window.addEventListener('DOMContentLoaded', function() {
                document.querySelectorAll('form').forEach(function(form) {
                    form.addEventListener('submit', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        return false;
                    });
                });
            });
            
            debugLog('Navigation and form submission interceptors active');
        })();
        </script>
        `;
    }
}
