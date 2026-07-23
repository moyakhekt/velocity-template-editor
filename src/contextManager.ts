import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { TemplateParser, ContextItem } from './templateParser';
import { ScenariosData } from './types';

export interface ContextData {
    [key: string]: any;
}

export interface HttpServletRequestConfig {
    url: string;
    headers: string;
}

export interface ContextFileData {
    existingData: any;
    fileData3: any;
    url?: string;
    headers?: string;
    httpServletRequestVar?: string;
    localeVar?: string;
    templateMessagesVar?: string;
    escapeToolVar?: string;
    methods: any; // Shared methods across scenarios
    scenarios: ScenariosData; // Named variable sets
    activeScenario: string; // Currently selected scenario
}

export interface ContextItemWithSource {
    value: any;
    source: 'environment' | 'template';
}

export interface EnvironmentContextConfig {
    filePath?: string;
    headers?: { [key: string]: string };
    messagesPropertiesPath?: string;
    language?: string;
    mockFunctions?: { [name: string]: string };
    data: ContextData;
}

export class ContextManager {
    private readonly context: vscode.ExtensionContext;
    private readonly contextCache: Map<string, ContextData> = new Map();
    private panel: vscode.WebviewPanel | undefined;
    private environmentContext: EnvironmentContextConfig = { data: {}, mockFunctions: {} };
    private environmentContextLoaded: boolean = false;
    private previewProvider: any = undefined;
    templateFilePath: string = '';
    private contextFileWatcher: vscode.FileSystemWatcher | undefined;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.loadEnvironmentContextPath();
        this.setupContextFileWatcher();
    }

    private setupContextFileWatcher(): void {
        // Watch all .context.json files for changes
        this.contextFileWatcher = vscode.workspace.createFileSystemWatcher('**/*.context.json');
        
        // Clear cache when a context file changes
        this.contextFileWatcher.onDidChange(uri => {
            console.log('[FileWatcher] Context file changed:', uri.fsPath);
            this.contextCache.delete(uri.fsPath);
            
            // If this is the active template's context file, refresh the webview
            if (this.templateFilePath) {
                const contextFilePath = this.getContextFilePath(this.templateFilePath);
                if (uri.fsPath === contextFilePath || uri.fsPath.toLowerCase() === contextFilePath.toLowerCase()) {
                    console.log('[FileWatcher] Active template context changed, refreshing webview');
                    this.updateWebview(this.templateFilePath);
                }
            }
        });
        
        // Clear cache when a context file is deleted
        this.contextFileWatcher.onDidDelete(uri => {
            console.log('[FileWatcher] Context file deleted:', uri.fsPath);
            this.contextCache.delete(uri.fsPath);
        });
        
        this.context.subscriptions.push(this.contextFileWatcher);
    }

    setPreviewProvider(previewProvider: any): void {
        this.previewProvider = previewProvider;
    }

    private loadEnvironmentContextPath(): void {
        const savedPath = this.context.globalState.get<string>('environmentContextPath');
        if (savedPath && fs.existsSync(savedPath)) {
            try {
                const content = fs.readFileSync(savedPath, 'utf8');
                const parsed = JSON.parse(content);
                
                this.environmentContext = {
                    filePath: savedPath,
                    headers: parsed.headers || {},
                    mockFunctions: parsed.mockFunctions || {},
                    data: parsed.context || parsed.data || {}
                };
                
                // Validate for duplicate variable names
                const duplicateVars = this.findDuplicateVariableNames(this.environmentContext.data);
                if (duplicateVars.length > 0) {
                    vscode.window.showErrorMessage(
                        `Environment context contains duplicate variable names: ${duplicateVars.join(', ')}. Please edit the file to resolve duplicates.`,
                        'Open File'
                    ).then(selection => {
                        if (selection === 'Open File') {
                            vscode.workspace.openTextDocument(savedPath).then(doc => {
                                vscode.window.showTextDocument(doc);
                            });
                        }
                    });
                }
                
                // Validate for duplicate mock function names
                const duplicateMocks = this.findDuplicateMockFunctionNames(this.environmentContext.mockFunctions || {});
                if (duplicateMocks.length > 0) {
                    vscode.window.showErrorMessage(
                        `Environment context contains duplicate mock function names: ${duplicateMocks.join(', ')}. Please edit the file to resolve duplicates.`,
                        'Open File'
                    ).then(selection => {
                        if (selection === 'Open File') {
                            vscode.workspace.openTextDocument(savedPath).then(doc => {
                                vscode.window.showTextDocument(doc);
                            });
                        }
                    });
                }
                
                this.environmentContextLoaded = true;
            } catch (e) {
                console.error('Error loading environment context:', e);
                const errorMsg = e instanceof Error ? e.message : String(e);
                vscode.window.showErrorMessage(
                    `Failed to load environment context file: ${errorMsg}`,
                    'Open File'
                ).then(selection => {
                    if (selection === 'Open File') {
                        vscode.workspace.openTextDocument(savedPath).then(doc => {
                            vscode.window.showTextDocument(doc);
                        });
                    }
                });
            }
        }
    }

    private async saveEnvironmentContext(): Promise<void> {
        if (!this.environmentContext.filePath) {
            return;
        }
        try {
            const dataToSave: any = {
                headers: this.environmentContext.headers || '',
                context: this.environmentContext.data,
                mockFunctions: this.environmentContext.mockFunctions || {}
            };
            const content = JSON.stringify(dataToSave, null, 2);
            fs.writeFileSync(this.environmentContext.filePath, content, 'utf8');
            
            // Trigger preview refresh for current template if preview is open
            if (this.panel) {
                const templatePath = this.panel.title.replace('Context Manager - ', '');
                this.refreshPreviewIfOpen(templatePath);
            }
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to save environment context: ${e}`);
        }
    }

    private refreshPreviewIfOpen(templatePath: string): void {
        if (this.previewProvider?.previewFilePath) {
            // Find the document for this template
            const doc = vscode.workspace.textDocuments.find(d => 
                d.uri.fsPath === templatePath || d.uri.fsPath.toLowerCase() === templatePath.toLowerCase()
            );
            if (doc) {
                this.previewProvider.refresh(doc);
            }
        }
    }

    private async ensureEnvironmentContextFile(): Promise<boolean> {
        if (this.environmentContext.filePath) {
            return true;
        }
        
        const saveFile = await vscode.window.showSaveDialog({
            filters: { 'JSON': ['json'] },
            title: 'Save Environment Context File',
            saveLabel: 'Create Environment Context'
        });
        
        if (saveFile) {
            this.environmentContext.filePath = saveFile.fsPath;
            await this.context.globalState.update('environmentContextPath', saveFile.fsPath);
            return true;
        }
        
        return false;
    }

    private getEnvironmentValue(name: string): any {
        return this.environmentContext.data[name];
    }

    public getContextForTemplate(templatePath: string): ContextData {
        const contextFilePath = this.getContextFilePath(templatePath);
        const templateContextData = this.loadTemplateContextData(contextFilePath);
        
        // Get scenario variables and methods
        const scenarioVariables = this.getScenarioVariables(templateContextData);
        const templateMethods = templateContextData.methods || {};
        
        // Build merged context
        const mergedContext = this.buildMergedContext(templateMethods, scenarioVariables);
        
        // Add HttpServletRequest if configured
        this.addHttpServletRequestIfNeeded(mergedContext, templatePath, templateContextData);
        
        return mergedContext;
    }

    public getEnvironmentContext(): EnvironmentContextConfig {
        return this.environmentContext;
    }

    private loadTemplateContextData(contextFilePath: string): ContextFileData {
        if (this.contextCache.has(contextFilePath)) {
            return this.contextCache.get(contextFilePath) as any;
        }
        
        const templateContextData = this.loadContextDataFromFile(contextFilePath);
        this.contextCache.set(contextFilePath, templateContextData as any);
        return templateContextData;
    }

    private loadContextDataFromFile(contextFilePath: string): ContextFileData {
        if (!fs.existsSync(contextFilePath)) {
            return this.getEmptyContextData();
        }
        
        try {
            const content = fs.readFileSync(contextFilePath, 'utf8');
            const parsed = JSON.parse(content);
            
            if (!parsed.scenarios) {
                throw new Error('Context file is in old format. Please run convert-context-files.js to migrate it.');
            }
            
            return parsed as ContextFileData;
        } catch (e) {
            console.error('Failed to load context file:', e);
            return this.getEmptyContextData();
        }
    }

    private buildMergedContext(templateMethods: any, scenarioVariables: ContextData): ContextData {
        const mergedContext: ContextData = { ...this.environmentContext.data };
        
        this.mergeMethodsIntoContext(mergedContext, templateMethods);
        this.mergeScenarioVariables(mergedContext, scenarioVariables);
        
        return mergedContext;
    }

    private mergeMethodsIntoContext(mergedContext: ContextData, templateMethods: any): void {
        // Merge Environment methods with template methods
        for (const [key, value] of Object.entries(mergedContext)) {
            if (this.isMethodsObject(value) && templateMethods[key]) {
                mergedContext[key] = { ...value, ...templateMethods[key] };
            }
        }
        
        // Add template-only methods
        for (const [key, value] of Object.entries(templateMethods)) {
            if (!mergedContext[key]) {
                mergedContext[key] = value;
            }
        }
    }

    private mergeScenarioVariables(mergedContext: ContextData, scenarioVariables: ContextData): void {
        for (const [key, value] of Object.entries(scenarioVariables)) {
            if (this.shouldMergeObjects(value, mergedContext[key])) {
                mergedContext[key] = { ...mergedContext[key], ...value };
            } else {
                mergedContext[key] = value;
            }
        }
    }

    private shouldMergeObjects(value: any, existingValue: any): boolean {
        return typeof value === 'object' && value !== null && !Array.isArray(value) &&
               typeof existingValue === 'object' && existingValue !== null && !Array.isArray(existingValue) &&
               !this.isMethodsObject(value);
    }

    private addHttpServletRequestIfNeeded(mergedContext: ContextData, templatePath: string, templateContextData: ContextFileData): void {
        const httpServletVarName = this.getHttpServletRequestVarName(templatePath, templateContextData);
        
        if (httpServletVarName && templateContextData.url) {
            const mergedHeaders = this.mergeHeaders(this.environmentContext.headers, templateContextData.headers);
            mergedContext[httpServletVarName] = {
                _httpServletRequest: true,
                url: templateContextData.url,
                headers: mergedHeaders
            };
        }
    }

    private getHttpServletRequestVarName(templatePath: string, templateContextData: ContextFileData): string | undefined {
        let httpServletVarName = this.detectHttpServletRequestVariable(templatePath);
        
        if (!httpServletVarName && templateContextData.httpServletRequestVar) {
            httpServletVarName = templateContextData.httpServletRequestVar;
        }
        
        return httpServletVarName;
    }

    private getEmptyContextData(): ContextFileData {
        return {
            existingData: {},
            fileData3: {},
            methods: {},
            scenarios: { Default: { variables: {} } },
            activeScenario: 'Default'
        };
    }

    private isMethodsObject(value: any): boolean {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            return false;
        }
        // Check if object contains methods with _implementation
        return Object.values(value).some(
            (v: any) => v && typeof v === 'object' && '_implementation' in v
        );
    }

    private getScenarioVariables(contextData: ContextFileData): ContextData {
        if (!contextData.scenarios) {
            return {};
        }
        
        const activeScenario = contextData.activeScenario || 'Default';
        const defaultVars = contextData.scenarios.Default || {};
        const scenarioVars = contextData.scenarios[activeScenario] || {};
        
        // Merge Default + active scenario (scenario overrides default)
        return { ...defaultVars, ...scenarioVars };
    }

    private mergeHeaders(environmentHeaders?: string, templateHeaders?: string): string {
        if (!environmentHeaders && !templateHeaders) {
            return '';
        }
        if (!environmentHeaders) {
            return templateHeaders || '';
        }
        if (!templateHeaders) {
            return environmentHeaders;
        }
        
        // Parse headers into map
        const headerMap = new Map<string, string>();
        
        // Add Environment headers first
        environmentHeaders.split('\n').forEach(line => {
            const colonIndex = line.indexOf(':');
            if (colonIndex > 0) {
                const name = line.substring(0, colonIndex).trim();
                const value = line.substring(colonIndex + 1).trim();
                if (name) {
                    headerMap.set(name.toLowerCase(), `${name}: ${value}`);
                }
            }
        });
        
        // Override with template headers
        templateHeaders.split('\n').forEach(line => {
            const colonIndex = line.indexOf(':');
            if (colonIndex > 0) {
                const name = line.substring(0, colonIndex).trim();
                const value = line.substring(colonIndex + 1).trim();
                if (name) {
                    headerMap.set(name.toLowerCase(), `${name}: ${value}`);
                }
            }
        });
        
        return Array.from(headerMap.values()).join('\n');
    }

    private isPrintableAscii(value: string): boolean {
        return /^[\x20-\x7E]*$/.test(value);
    }

    private normalizeHeaderName(name: string): string {
        return name.toLowerCase();
    }

    private findHeaderKey(headers: { [key: string]: string }, name: string): string | undefined {
        const target = name.toLowerCase();
        return Object.keys(headers).find(key => key.toLowerCase() === target);
    }

    private detectHttpServletRequestVariable(templatePath: string): string | undefined {
        try {
            console.log('[HttpServletRequest Detection] Analyzing template:', templatePath);
            
            // Validate that the path looks like a file path (not a title or other string)
            if (!templatePath || !templatePath.includes('\\') && !templatePath.includes('/')) {
                console.log('[HttpServletRequest Detection] Invalid path (not a file path):', templatePath);
                return undefined;
            }
            
            let content: string | undefined;
            
            // First try to get content from open text documents (handles files outside workspace)
            const openDoc = vscode.workspace.textDocuments.find(doc => 
                doc.uri.fsPath === templatePath || doc.uri.fsPath.toLowerCase() === templatePath.toLowerCase()
            );
            
            if (openDoc) {
                console.log('[HttpServletRequest Detection] Found in open documents');
                content = openDoc.getText();
            } else {
                console.log('[HttpServletRequest Detection] Not found in open documents, trying file system');
                // Fall back to file system read
                try {
                    content = fs.readFileSync(templatePath, 'utf8');
                    console.log('[HttpServletRequest Detection] Read from file system successfully');
                } catch (e) {
                    console.error('[HttpServletRequest Detection] Could not read template file:', e);
                    return undefined;
                }
            }
            
            console.log('[HttpServletRequest Detection] Content length:', content?.length || 0);
            
            // Look for patterns like $HttpServletRequest, $request, $servletRequest
            const regex = /\$(\w*[Ss]ervlet[Rr]equest\w*)/;
            const match = regex.exec(content);
            if (match) {
                console.log('[HttpServletRequest Detection] Found variable:', match[1]);
                return match[1];
            }
            // Also check for common patterns like $request
            if (content.includes('$request.getParameter') || content.includes('$request.getHeader')) {
                console.log('[HttpServletRequest Detection] Found $request usage patterns');
                return 'request';
            }
            
            console.log('[HttpServletRequest Detection] No HttpServletRequest variable found');
        } catch (e) {
            console.error('[HttpServletRequest Detection] Error:', e);
        }
        return undefined;
    }

    private getTemplateOnlyContext(templatePath: string): ContextData {
        const contextFilePath = this.getContextFilePath(templatePath);
        
        // Check cache first
        let contextFileData: ContextFileData;
        if (this.contextCache.has(contextFilePath)) {
            contextFileData = this.contextCache.get(contextFilePath) as any;
        } else {
            // Load from file if exists
            if (fs.existsSync(contextFilePath)) {
                try {
                    const content = fs.readFileSync(contextFilePath, 'utf8');
                    const parsed = JSON.parse(content);
                    // Expect new format only - no migration
                    if (!parsed.scenarios) {
                        throw new Error('Context file is in old format. Please run convert-context-files.js to migrate it.');
                    }
                    contextFileData = parsed as ContextFileData;
                } catch (e) {
                    console.error('Failed to load context file:', e);
                    contextFileData = this.getEmptyContextData();
                }
            } else {
                contextFileData = this.getEmptyContextData();
            }
            this.contextCache.set(contextFilePath, contextFileData as any);
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

    // New method to get just the raw file data (for UI editing)
    private getTemplateContextFileData(templatePath: string): ContextFileData {
        const contextFilePath = this.getContextFilePath(templatePath);
        
        if (this.contextCache.has(contextFilePath)) {
            return this.contextCache.get(contextFilePath) as any;
        }
        
        if (fs.existsSync(contextFilePath)) {
            try {
                const content = fs.readFileSync(contextFilePath, 'utf8');
                const parsed = JSON.parse(content);
                // Expect new format only - no migration
                if (!parsed.scenarios) {
                    throw new Error('Context file is in old format. Please run convert-context-files.js to migrate it.');
                }
                const migrated = parsed as ContextFileData;
                
                // Ensure activeScenario is set to 'Default' if not set or invalid
                if (!migrated.activeScenario || !migrated.scenarios[migrated.activeScenario]) {
                    migrated.activeScenario = 'Default';
                }
                
                this.contextCache.set(contextFilePath, migrated as any);
                return migrated;
            } catch (e) {
                console.error('Failed to load context file:', e);
                const errorMsg = e instanceof Error ? e.message : String(e);
                vscode.window.showErrorMessage(
                    `Failed to load template context file: ${errorMsg}`,
                    'Open File'
                ).then(selection => {
                    if (selection === 'Open File') {
                        vscode.workspace.openTextDocument(contextFilePath).then(doc => {
                            vscode.window.showTextDocument(doc);
                        });
                    }
                });
            }
        }
        
        const empty = this.getEmptyContextData();
        this.contextCache.set(contextFilePath, empty as any);
        return empty;
    }

    private async saveContext(templatePath: string, contextData: ContextData): Promise<void> {
        const contextFilePath = this.getContextFilePath(templatePath);
        
        // Load existing file to preserve structure
        let existingData: ContextFileData = this.getTemplateContextFileData(templatePath);
        
        // Update only the active scenario's variables
        const activeScenario = existingData.activeScenario || 'Default';
        if (!existingData.scenarios) {
            existingData.scenarios = { Default: {
                variables: {}
            } };
        }
        if (!existingData.scenarios[activeScenario]) {
            existingData.scenarios[activeScenario] = {
                variables: {}
            };
        }
        
        // Separate methods from variables in the incoming contextData
        const updatedMethods: any = {};
        const updatedVariables: any = {};
        
        for (const [key, value] of Object.entries(contextData)) {
            if (this.isMethodsObject(value)) {
                updatedMethods[key] = value;
            } else {
                updatedVariables[key] = value;
            }
        }
        
        // Update methods and scenario variables
        existingData.methods = updatedMethods;
        existingData.scenarios[activeScenario] = updatedVariables;
        
        try {
            const content = JSON.stringify(existingData, null, 2);
            fs.writeFileSync(contextFilePath, content, 'utf8');
            this.contextCache.set(contextFilePath, existingData);
            
            // Trigger preview refresh if preview is open
            this.refreshPreviewIfOpen(templatePath);
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to save context: ${e}`);
        }
    }

    async manageContext(): Promise<void> {
        console.log('');
        console.log('▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒');
        console.log('▒▒▒ manageContext() CALLED! ▒▒▒');
        console.log('▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒');
        console.log('');
        
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('Please open a file');
            return;
        }

        const templatePath = editor.document.uri.fsPath;
        console.log('Template path:', templatePath);
        
        // Check if file contains Velocity syntax (more lenient than language ID check)
        const content = editor.document.getText();
        const hasVelocitySyntax = /\$[a-zA-Z_]|#(set|if|foreach|macro|parse|include|define|evaluate)/.test(content);
        console.log('Has Velocity syntax:', hasVelocitySyntax, 'Language ID:', editor.document.languageId);
        
        if (!hasVelocitySyntax && editor.document.languageId !== 'velocity') {
            const result = await vscode.window.showWarningMessage(
                'This file does not appear to be a Velocity template. Continue anyway?',
                'Yes',
                'No'
            );
            if (result !== 'Yes') {
                return;
            }
        } else if (hasVelocitySyntax && editor.document.languageId !== 'velocity') {
            // Show auto-closing notification when Velocity syntax is detected
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '✓ Velocity template detected',
                cancellable: false
            }, async (progress) => {
                return new Promise(resolve => setTimeout(resolve, 3000));
            });
        }

        // Check if template context file exists
        const defaultContextPath = `${templatePath}.context.json`;
        const storedContextPath = this.context.workspaceState.get<string>(`contextFile:${templatePath}`);
        const contextFileExists = (storedContextPath && fs.existsSync(storedContextPath)) || fs.existsSync(defaultContextPath);

        if (!contextFileExists) {
            // Prompt user to open or create context file
            const action = await vscode.window.showInformationMessage(
                'Template context file not found. Would you like to create one or open an existing file?',
                'Create New',
                'Open Existing',
                'Cancel'
            );

            if (action === 'Cancel' || !action) {
                return;
            }

            let contextFilePath: string;

            if (action === 'Create New') {
                const saveUri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(defaultContextPath),
                    filters: {
                        'Context Files': ['context.json']
                    },
                    title: 'Create Template Context File',
                    saveLabel: 'Create'
                });

                if (!saveUri) {
                    return;
                }

                contextFilePath = saveUri.fsPath;

                // Validate filename ends with .context.json
                if (!contextFilePath.endsWith('.context.json')) {
                    vscode.window.showErrorMessage('Context file must end with .context.json');
                    return;
                }

                // Create empty context file
                const emptyContext = this.getEmptyContextData();
                fs.writeFileSync(contextFilePath, JSON.stringify(emptyContext, null, 2), 'utf8');
                vscode.window.showInformationMessage(`Created context file: ${path.basename(contextFilePath)}`);

            } else { // Open Existing
                const openUri = await vscode.window.showOpenDialog({
                    defaultUri: vscode.Uri.file(path.dirname(templatePath)),
                    canSelectFiles: true,
                    canSelectFolders: false,
                    canSelectMany: false,
                    filters: {
                        'Context Files': ['context.json']
                    },
                    title: 'Open Template Context File'
                });

                if (!openUri || openUri.length === 0) {
                    return;
                }

                contextFilePath = openUri[0].fsPath;

                // Validate filename ends with .context.json
                if (!contextFilePath.endsWith('.context.json')) {
                    vscode.window.showErrorMessage('Context file must end with .context.json');
                    return;
                }

                // Validate file exists
                if (!fs.existsSync(contextFilePath)) {
                    vscode.window.showErrorMessage('Selected file does not exist');
                    return;
                }
            }

            // Store the association between template and context file
            await this.context.workspaceState.update(`contextFile:${templatePath}`, contextFilePath);
        }

        this.showContextWebview(templatePath);
    }

    private showContextWebview(templatePath: string): void {
        console.log('');
        console.log('██████████████████████████████████████████████████');
        console.log('███ CONTEXT MANAGER OPENING ███');
        console.log('███ Template:', templatePath);
        console.log('██████████████████████████████████████████████████');
        console.log('');
        this.templateFilePath = templatePath;
        
        // Reload environment context from file to pick up any external changes
        this.loadEnvironmentContextPath();
        
        if (this.panel) {
            console.log('Panel already exists, disposing it to force fresh load');
            this.panel.dispose();
            this.panel = undefined;
        }
        
        if (!this.panel) {
            console.log('Creating new webview panel');
            this.panel = vscode.window.createWebviewPanel(
                'velocityContext',
                'Velocity Context Manager',
                vscode.ViewColumn.Two,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [
                        vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode/codicons', 'dist')
                    ]
                }
            );

            this.panel.onDidDispose(() => {
                console.log('Panel disposed');
                this.panel = undefined;
            });

            // Automatically open DevTools for debugging
            vscode.commands.executeCommand('workbench.action.webview.openDeveloperTools');

            this.panel.webview.onDidReceiveMessage(
                async message => {
                    console.log('Received message from webview:', message.command);
                    await this.handleWebviewMessage(message, templatePath);
                },
                undefined,
                this.context.subscriptions
            );
            
            // Set HTML AFTER all event handlers are registered
            this.updateWebview(templatePath);
        }
    }

    private async handleWebviewMessage(message: any, templatePath: string): Promise<void> {
        console.log('=== RECEIVED MESSAGE FROM WEBVIEW ===');
        console.log('Command:', message.command);
        console.log('Full message:', JSON.stringify(message));
        
        const currentTemplatePath = this.templateFilePath;
        const contextData = this.getTemplateOnlyContext(currentTemplatePath);
        
        const handlers: { [key: string]: () => Promise<void> } = {
            'test': () => this.handleTestCommand(message),
            'openDevTools': () => this.handleOpenDevTools(),
            'loadEnvironmentContext': () => this.handleloadEnvironmentContext(currentTemplatePath),
            'reloadEnvironmentContext': () => this.handleReloadEnvironmentContext(currentTemplatePath),
            'saveEnvironmentContext': () => this.handlesaveEnvironmentContext(currentTemplatePath),
            'changeTemplateContextFile': () => this.handleChangeTemplateContextFile(currentTemplatePath),
            'reloadTemplateContext': () => this.handleReloadTemplateContext(currentTemplatePath),
            'saveEnvironmentVariable': () => this.handleSaveEnvironmentVariable(message, currentTemplatePath),
            'saveEnvironmentProperty': () => this.handleSaveEnvironmentProperty(message, currentTemplatePath),
            'saveEnvironmentMethod': () => this.handleSaveEnvironmentMethod(message, currentTemplatePath),
            'promoteToEnvironment': () => this.handlePromoteToEnvironment(message, contextData, currentTemplatePath),
            'setVariableSource': () => this.handleSetVariableSource(message, contextData, currentTemplatePath),
            'setPropertySource': () => this.handleSetPropertySource(message, contextData, currentTemplatePath),
            'setMethodSource': () => this.handleSetMethodSource(message, contextData, currentTemplatePath),
            'setSourceEnvironment': () => this.handleSetSourceEnvironment(message, contextData, currentTemplatePath),
            'setSourceTemplate': () => this.handleSetSourceTemplate(message, contextData, currentTemplatePath),
            'saveVariable': () => this.handleSaveVariable(message, contextData, currentTemplatePath),
            'saveProperty': () => this.handleSaveProperty(message, contextData, currentTemplatePath),
            'saveMethod': () => this.handleSaveMethod(message, contextData, currentTemplatePath),
            'saveTemplateUrl': () => this.handleSaveTemplateUrl(message, currentTemplatePath),
            'saveTemplateHeaders': () => this.handleSaveTemplateHeaders(message, currentTemplatePath),
            'saveHttpServletRequestVar': () => this.handleSaveHttpServletRequestVar(message, currentTemplatePath),
            'clearHttpServletRequestVar': () => this.handleClearHttpServletRequestVar(currentTemplatePath),
            'setLocaleMapping': () => this.handleSaveLocaleVar(message, currentTemplatePath),
            'setMessagesMapping': () => this.handleSaveTemplateMessagesVar(message, currentTemplatePath),
            'setEscapeMapping': () => this.handleSaveEscapeToolVar(message, currentTemplatePath),
            'saveMessagesFilePath': () => this.handleSaveMessagesFilePath(message, currentTemplatePath),
            'browseMessagesFile': () => this.handleBrowseMessagesFile(currentTemplatePath),
            'saveEnvironmentLanguage': () => this.handleSaveEnvironmentLanguage(message, currentTemplatePath),
            'addVariableToConfig': () => this.handleAddVariableToConfig(message, contextData, currentTemplatePath),
            'saveEnvironmentHeaders': () => this.handleSaveEnvironmentHeaders(message, currentTemplatePath),
            'saveEnvironmentHeaderRow': () => this.handleSaveEnvironmentHeaderRow(message, currentTemplatePath),
            'saveNewEnvironmentHeader': () => this.handleSaveNewEnvironmentHeader(message, currentTemplatePath),
            'deleteEnvironmentHeader': () => this.handleDeleteEnvironmentHeader(message, currentTemplatePath),
            'saveEnvironmentVariableRow': () => this.handleSaveEnvironmentVariableRow(message, currentTemplatePath),
            'saveNewEnvironmentVariable': () => this.handleSaveNewEnvironmentVariable(message, currentTemplatePath),
            'deleteEnvironmentVariable': () => this.handleDeleteEnvironmentVariable(message, currentTemplatePath),
            'saveNewEnvironmentMockFunction': () => this.handleSaveNewEnvironmentMockFunction(message, currentTemplatePath),
            'saveEnvironmentMockFunctionRow': () => this.handleSaveEnvironmentMockFunctionRow(message, currentTemplatePath),
            'deleteEnvironmentMockFunction': () => this.handleDeleteEnvironmentMockFunction(message, currentTemplatePath),
            'requestVariableInput': () => this.handleRequestVariableInput(message, contextData, currentTemplatePath),
            'requestPropertyInput': () => this.handleRequestPropertyInput(message, contextData, currentTemplatePath),
            'requestMethodInput': () => this.handleRequestMethodInput(message, contextData, currentTemplatePath),
            'requestDeleteConfirm': () => this.handleRequestDeleteConfirm(message, contextData, currentTemplatePath),
            'switchScenario': () => this.handleSwitchScenario(message, currentTemplatePath),
            'createScenario': () => this.handleCreateScenario(currentTemplatePath),
            'saveNewScenario': () => this.handleSaveNewScenario(message, currentTemplatePath),
            'deleteScenario': () => this.handleDeleteScenario(message, currentTemplatePath),
            'saveMethodMapping': () => this.handleSaveMethodMapping(message, contextData, currentTemplatePath),
            'saveScenarioHeaderValue': () => this.handleSaveScenarioHeaderValue(message, currentTemplatePath),
            'saveScenarioVariableValue': () => this.handleSaveScenarioVariableValue(message, currentTemplatePath),
            'saveNewScenarioHeader': () => this.handleSaveNewScenarioHeader(message, currentTemplatePath),
            'deleteScenarioHeader': () => this.handleDeleteScenarioHeader(message, currentTemplatePath),
            'changeUrlSource': () => this.handleChangeUrlSource(message, currentTemplatePath),
            'renameScenario': () => this.handleRenameScenario(message, currentTemplatePath)
        };

        const handler = handlers[message.command];
        if (handler) {
            await handler();
        }
    }

    private async handleTestCommand(message: any): Promise<void> {
        console.log('Test message received:', message.message);
        vscode.window.setStatusBarMessage('$(check) Webview button clicked!', 3000);
    }

    private async handleOpenDevTools(): Promise<void> {
        await vscode.commands.executeCommand('workbench.action.webview.openDeveloperTools');
    }

    private async handleloadEnvironmentContext(currentTemplatePath: string): Promise<void> {
        const loadFile = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { 'JSON': ['json'] },
            title: 'Load Environment Context File'
        });
        if (loadFile?.[0]) {
            try {
                const content = fs.readFileSync(loadFile[0].fsPath, 'utf8');
                const parsed = JSON.parse(content);
                this.environmentContext = {
                    filePath: loadFile[0].fsPath,
                    headers: parsed.headers || {},
                    mockFunctions: parsed.mockFunctions || {},
                    data: parsed.context || parsed.data || {}
                };
                
                // Validate for duplicate variable names
                const duplicateVars = this.findDuplicateVariableNames(this.environmentContext.data);
                if (duplicateVars.length > 0) {
                    vscode.window.showErrorMessage(
                        `Environment context contains duplicate variable names: ${duplicateVars.join(', ')}. Please edit the file to resolve duplicates.`,
                        'Open File'
                    ).then(selection => {
                        if (selection === 'Open File') {
                            vscode.workspace.openTextDocument(loadFile[0].fsPath).then(doc => {
                                vscode.window.showTextDocument(doc);
                            });
                        }
                    });
                }
                
                // Validate for duplicate mock function names
                const duplicateMocks = this.findDuplicateMockFunctionNames(this.environmentContext.mockFunctions || {});
                if (duplicateMocks.length > 0) {
                    vscode.window.showErrorMessage(
                        `Environment context contains duplicate mock function names: ${duplicateMocks.join(', ')}. Please edit the file to resolve duplicates.`,
                        'Open File'
                    ).then(selection => {
                        if (selection === 'Open File') {
                            vscode.workspace.openTextDocument(loadFile[0].fsPath).then(doc => {
                                vscode.window.showTextDocument(doc);
                            });
                        }
                    });
                }
                
                this.environmentContextLoaded = true;
                await this.context.globalState.update('environmentContextPath', loadFile[0].fsPath);
                this.updateWebview(currentTemplatePath);
                vscode.window.setStatusBarMessage('$(check) Environment context loaded', 3000);
            } catch (e) {
                const errorMsg = e instanceof Error ? e.message : String(e);
                vscode.window.showErrorMessage(
                    `Failed to Load Environment Context File: ${errorMsg}`,
                    'Open File'
                ).then(selection => {
                    if (selection === 'Open File') {
                        vscode.workspace.openTextDocument(loadFile[0].fsPath).then(doc => {
                            vscode.window.showTextDocument(doc);
                        });
                    }
                });
            }
        }
    }

    private async handleReloadEnvironmentContext(currentTemplatePath: string): Promise<void> {
        if (!this.environmentContext.filePath) {
            vscode.window.showWarningMessage('No environment context file loaded. Please load a file first.');
            return;
        }

        if (!fs.existsSync(this.environmentContext.filePath)) {
            vscode.window.showErrorMessage(
                `Environment context file not found: ${this.environmentContext.filePath}`,
                'Load Different File'
            ).then(selection => {
                if (selection === 'Load Different File') {
                    this.handleloadEnvironmentContext(currentTemplatePath);
                }
            });
            return;
        }

        try {
            const content = fs.readFileSync(this.environmentContext.filePath, 'utf8');
            const parsed = JSON.parse(content);
            this.environmentContext = {
                filePath: this.environmentContext.filePath,
                headers: parsed.headers || {},
                mockFunctions: parsed.mockFunctions || {},
                data: parsed.context || parsed.data || {}
            };
            
            // Validate for duplicate variable names
            const duplicateVars = this.findDuplicateVariableNames(this.environmentContext.data);
            if (duplicateVars.length > 0) {
                vscode.window.showErrorMessage(
                    `Environment context contains duplicate variable names: ${duplicateVars.join(', ')}. Please edit the file to resolve duplicates.`,
                    'Open File'
                ).then(selection => {
                    if (selection === 'Open File') {
                        vscode.workspace.openTextDocument(this.environmentContext.filePath!).then(doc => {
                            vscode.window.showTextDocument(doc);
                        });
                    }
                });
            }
            
            // Validate for duplicate mock function names
            const duplicateMocks = this.findDuplicateMockFunctionNames(this.environmentContext.mockFunctions || {});
            if (duplicateMocks.length > 0) {
                vscode.window.showErrorMessage(
                    `Environment context contains duplicate mock function names: ${duplicateMocks.join(', ')}. Please edit the file to resolve duplicates.`,
                    'Open File'
                ).then(selection => {
                    if (selection === 'Open File') {
                        vscode.workspace.openTextDocument(this.environmentContext.filePath!).then(doc => {
                            vscode.window.showTextDocument(doc);
                        });
                    }
                });
            }
            
            this.environmentContextLoaded = true;
            this.updateWebview(currentTemplatePath);
            vscode.window.setStatusBarMessage('$(check) Environment context reloaded', 3000);
        } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            vscode.window.showErrorMessage(
                `Failed to reLoad Environment Context File: ${errorMsg}`,
                'Open File'
            ).then(selection => {
                if (selection === 'Open File' && this.environmentContext.filePath) {
                    vscode.workspace.openTextDocument(this.environmentContext.filePath).then(doc => {
                        vscode.window.showTextDocument(doc);
                    });
                }
            });
        }
    }

    private async handleChangeTemplateContextFile(currentTemplatePath: string): Promise<void> {
        const action = await vscode.window.showInformationMessage(
            'Choose template context file action:',
            'Create New',
            'Open Existing',
            'Cancel'
        );

        if (action === 'Cancel' || !action) {
            return;
        }

        const defaultContextPath = `${currentTemplatePath}.context.json`;
        let contextFilePath: string;

        if (action === 'Create New') {
            const saveUri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(defaultContextPath),
                filters: {
                    'Context Files': ['context.json']
                },
                title: 'Create Template Context File',
                saveLabel: 'Create'
            });

            if (!saveUri) {
                return;
            }

            contextFilePath = saveUri.fsPath;

            // Validate filename ends with .context.json
            if (!contextFilePath.endsWith('.context.json')) {
                vscode.window.showErrorMessage('Context file must end with .context.json');
                return;
            }

            // Create empty context file
            const emptyContext = this.getEmptyContextData();
            fs.writeFileSync(contextFilePath, JSON.stringify(emptyContext, null, 2), 'utf8');
            vscode.window.showInformationMessage(`Created context file: ${path.basename(contextFilePath)}`);

        } else { // Open Existing
            const openUri = await vscode.window.showOpenDialog({
                defaultUri: vscode.Uri.file(path.dirname(currentTemplatePath)),
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                filters: {
                    'Context Files': ['context.json']
                },
                title: 'Open Template Context File'
            });

            if (!openUri || openUri.length === 0) {
                return;
            }

            contextFilePath = openUri[0].fsPath;

            // Validate filename ends with .context.json
            if (!contextFilePath.endsWith('.context.json')) {
                vscode.window.showErrorMessage('Context file must end with .context.json');
                return;
            }

            // Validate file exists
            if (!fs.existsSync(contextFilePath)) {
                vscode.window.showErrorMessage('Selected file does not exist');
                return;
            }
        }

        // Store the association and update
        await this.context.workspaceState.update(`contextFile:${currentTemplatePath}`, contextFilePath);
        this.contextCache.delete(currentTemplatePath); // Clear cache
        this.updateWebview(currentTemplatePath);
        vscode.window.setStatusBarMessage('$(check) Template context file updated', 3000);
    }

    private async handleReloadTemplateContext(currentTemplatePath: string): Promise<void> {
        const contextFilePath = this.getContextFilePath(currentTemplatePath);

        if (!fs.existsSync(contextFilePath)) {
            vscode.window.showErrorMessage(
                `Template context file not found: ${contextFilePath}`,
                'Change File'
            ).then(selection => {
                if (selection === 'Change File') {
                    this.handleChangeTemplateContextFile(currentTemplatePath);
                }
            });
            return;
        }

        try {
            // Clear cache to force reload
            this.contextCache.delete(currentTemplatePath);
            this.updateWebview(currentTemplatePath);
            vscode.window.setStatusBarMessage('$(check) Template context reloaded', 3000);
        } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            vscode.window.showErrorMessage(
                `Failed to reload template context: ${errorMsg}`,
                'Open File'
            ).then(selection => {
                if (selection === 'Open File') {
                    vscode.workspace.openTextDocument(contextFilePath).then(doc => {
                        vscode.window.showTextDocument(doc);
                    });
                }
            });
        }
    }

    private async handlesaveEnvironmentContext(currentTemplatePath: string): Promise<void> {
        const saveFile = await vscode.window.showSaveDialog({
            filters: { 'JSON': ['json'] },
            defaultUri: this.environmentContext.filePath ? vscode.Uri.file(this.environmentContext.filePath) : undefined,
            title: 'Save Environment Context File'
        });
        if (saveFile) {
            this.environmentContext.filePath = saveFile.fsPath;
            await this.context.globalState.update('environmentContextPath', saveFile.fsPath);
            await this.saveEnvironmentContext();
            this.updateWebview(currentTemplatePath);
            vscode.window.setStatusBarMessage('$(check) Environment context saved', 3000);
        }
    }

    private async handleSaveEnvironmentVariable(message: any, currentTemplatePath: string): Promise<void> {
        if (!await this.ensureEnvironmentContextFile()) {
            return;
        }
        this.environmentContext.data[message.name] = message.value;
        await this.saveEnvironmentContext();
        this.updateWebview(currentTemplatePath);
        vscode.window.setStatusBarMessage('$(check) Environment variable $' + message.name + ' saved', 3000);
    }

    private async handleSaveEnvironmentProperty(message: any, currentTemplatePath: string): Promise<void> {
        if (!await this.ensureEnvironmentContextFile()) {
            return;
        }
        if (!this.environmentContext.data[message.objectName]) {
            this.environmentContext.data[message.objectName] = {};
        }
        this.environmentContext.data[message.objectName][message.propertyName] = message.value;
        await this.saveEnvironmentContext();
        this.updateWebview(currentTemplatePath);
        vscode.window.setStatusBarMessage('$(check) Environment property saved', 3000);
    }

    private async handleSaveEnvironmentMethod(message: any, currentTemplatePath: string): Promise<void> {
        if (!await this.ensureEnvironmentContextFile()) {
            return;
        }
        if (!this.environmentContext.data[message.objectName]) {
            this.environmentContext.data[message.objectName] = {};
        }
        this.environmentContext.data[message.objectName][message.methodName] = {
            _implementation: message.implementation
        };
        await this.saveEnvironmentContext();
        this.updateWebview(currentTemplatePath);
        vscode.window.setStatusBarMessage('$(check) Environment method saved', 3000);
    }

    private async handlePromoteToEnvironment(message: any, contextData: ContextData, currentTemplatePath: string): Promise<void> {
        if (!await this.ensureEnvironmentContextFile()) {
            return;
        }
        if (message.itemType === 'variable') {
            this.environmentContext.data[message.name] = contextData[message.name];
        } else if (message.itemType === 'property') {
            if (!this.environmentContext.data[message.objectName]) {
                this.environmentContext.data[message.objectName] = {};
            }
            this.environmentContext.data[message.objectName][message.propertyName] = 
                contextData[message.objectName][message.propertyName];
        } else if (message.itemType === 'method') {
            if (!this.environmentContext.data[message.objectName]) {
                this.environmentContext.data[message.objectName] = {};
            }
            this.environmentContext.data[message.objectName][message.methodName] = 
                contextData[message.objectName][message.methodName];
        }
        await this.saveEnvironmentContext();
        this.updateWebview(currentTemplatePath);
        vscode.window.setStatusBarMessage('$(check) Promoted to environment context', 3000);
    }

    private async handleSetVariableSource(message: any, contextData: ContextData, currentTemplatePath: string): Promise<void> {
        if (message.source === 'environment') {
            if (!await this.ensureEnvironmentContextFile()) {
                return;
            }
            if (contextData[message.name] !== undefined) {
                this.environmentContext.data[message.name] = contextData[message.name];
                delete contextData[message.name];
                await this.saveEnvironmentContext();
            }
        } else {
            if (this.environmentContext.data[message.name] !== undefined) {
                contextData[message.name] = this.environmentContext.data[message.name];
            } else {
                contextData[message.name] = '';
            }
        }
        await this.saveContext(currentTemplatePath, contextData);
        this.updateWebview(currentTemplatePath);
    }

    private async handleSetPropertySource(message: any, contextData: ContextData, currentTemplatePath: string): Promise<void> {
        if (message.source === 'environment') {
            if (!await this.ensureEnvironmentContextFile()) {
                return;
            }
            if (!this.environmentContext.data[message.objectName]) {
                this.environmentContext.data[message.objectName] = {};
            }
            if (contextData[message.objectName]?.[message.propertyName] !== undefined) {
                this.environmentContext.data[message.objectName][message.propertyName] = 
                    contextData[message.objectName][message.propertyName];
                delete contextData[message.objectName][message.propertyName];
                if (Object.keys(contextData[message.objectName]).length === 0) {
                    delete contextData[message.objectName];
                }
                await this.saveEnvironmentContext();
            }
        } else {
            if (!contextData[message.objectName]) {
                contextData[message.objectName] = {};
            }
            if (this.environmentContext.data[message.objectName]?.[message.propertyName] !== undefined) {
                contextData[message.objectName][message.propertyName] = 
                    this.environmentContext.data[message.objectName][message.propertyName];
            } else {
                contextData[message.objectName][message.propertyName] = '';
            }
        }
        await this.saveContext(currentTemplatePath, contextData);
        this.updateWebview(currentTemplatePath);
    }

    private async handleSetMethodSource(message: any, contextData: ContextData, currentTemplatePath: string): Promise<void> {
        if (message.source === 'environment') {
            if (!await this.ensureEnvironmentContextFile()) {
                return;
            }
            if (!this.environmentContext.data[message.objectName]) {
                this.environmentContext.data[message.objectName] = {};
            }
            if (contextData[message.objectName]?.[message.methodName] !== undefined) {
                this.environmentContext.data[message.objectName][message.methodName] = 
                    contextData[message.objectName][message.methodName];
                delete contextData[message.objectName][message.methodName];
                if (Object.keys(contextData[message.objectName]).length === 0) {
                    delete contextData[message.objectName];
                }
                await this.saveEnvironmentContext();
            }
        } else {
            if (!contextData[message.objectName]) {
                contextData[message.objectName] = {};
            }
            if (this.environmentContext.data[message.objectName]?.[message.methodName] !== undefined) {
                contextData[message.objectName][message.methodName] = 
                    this.environmentContext.data[message.objectName][message.methodName];
            } else {
                contextData[message.objectName][message.methodName] = { _implementation: 'return ""' };
            }
        }
        await this.saveContext(currentTemplatePath, contextData);
        this.updateWebview(currentTemplatePath);
    }

    private async handleSetSourceEnvironment(message: any, contextData: ContextData, currentTemplatePath: string): Promise<void> {
        if (message.itemType === 'variable') {
            delete contextData[message.name];
        } else if (message.itemType === 'property') {
            if (contextData[message.objectName]) {
                delete contextData[message.objectName][message.propertyName];
                if (Object.keys(contextData[message.objectName]).length === 0) {
                    delete contextData[message.objectName];
                }
            }
        } else if (message.itemType === 'method') {
            if (contextData[message.objectName]) {
                delete contextData[message.objectName][message.methodName];
                if (Object.keys(contextData[message.objectName]).length === 0) {
                    delete contextData[message.objectName];
                }
            }
        }
        await this.saveContext(currentTemplatePath, contextData);
        this.updateWebview(currentTemplatePath);
    }

    private async handleSetSourceTemplate(message: any, contextData: ContextData, currentTemplatePath: string): Promise<void> {
        if (message.itemType === 'variable') {
            if (!contextData[message.name]) {
                contextData[message.name] = '';
            }
        } else if (message.itemType === 'property') {
            if (!contextData[message.objectName]) {
                contextData[message.objectName] = {};
            }
            if (!contextData[message.objectName][message.propertyName]) {
                contextData[message.objectName][message.propertyName] = '';
            }
        } else if (message.itemType === 'method') {
            if (!contextData[message.objectName]) {
                contextData[message.objectName] = {};
            }
            if (!contextData[message.objectName][message.methodName]) {
                contextData[message.objectName][message.methodName] = { _implementation: 'return ""' };
            }
        }
        await this.saveContext(currentTemplatePath, contextData);
        this.updateWebview(currentTemplatePath);
    }

    private async handleSaveVariable(message: any, contextData: ContextData, currentTemplatePath: string): Promise<void> {
        contextData[message.name] = message.value;
        await this.saveContext(currentTemplatePath, contextData);
        this.updateWebview(currentTemplatePath);
        vscode.window.setStatusBarMessage('$(check) Variable $' + message.name + ' saved', 3000);
    }

    private async handleSaveProperty(message: any, contextData: ContextData, currentTemplatePath: string): Promise<void> {
        if (!contextData[message.objectName]) {
            contextData[message.objectName] = {};
        }
        contextData[message.objectName][message.propertyName] = message.value;
        await this.saveContext(currentTemplatePath, contextData);
        this.updateWebview(currentTemplatePath);
        vscode.window.setStatusBarMessage('$(check) Property $' + message.objectName + '.' + message.propertyName + ' saved', 3000);
    }

    private async handleSaveMethod(message: any, contextData: ContextData, currentTemplatePath: string): Promise<void> {
        if (!contextData[message.objectName]) {
            contextData[message.objectName] = {};
        }
        contextData[message.objectName][message.methodName] = {
            _implementation: message.implementation
        };
        await this.saveContext(currentTemplatePath, contextData);
        this.updateWebview(currentTemplatePath);
        vscode.window.setStatusBarMessage('$(check) Method $' + message.objectName + '.' + message.methodName + '() saved', 3000);
    }

    private async handleSaveTemplateUrl(message: any, currentTemplatePath: string): Promise<void> {
        const contextFilePath = this.getContextFilePath(currentTemplatePath);
        let existingData: ContextFileData = this.getEmptyContextData();
        if (fs.existsSync(contextFilePath)) {
            try {
                const content = fs.readFileSync(contextFilePath, 'utf8');
                const parsed = JSON.parse(content);
                existingData = parsed;
            } catch (e) {
                console.error('Error loading context:', e);
            }
        }
        
        // Use scenario from message (the scenario the input field belonged to) rather than activeScenario from file
        // This prevents race conditions when switching scenarios before blur event fires
        const targetScenario = message.scenario || existingData.activeScenario || 'Default';
        if (!existingData.scenarios) {
            existingData.scenarios = { Default: { variables: {} } };
        }
        if (!existingData.scenarios[targetScenario]) {
            existingData.scenarios[targetScenario] = { variables: {} };
        }
        existingData.scenarios[targetScenario].url = message.url;
        
        fs.writeFileSync(contextFilePath, JSON.stringify(existingData, null, 2), 'utf8');
        // Clear cache to force fresh read on next access
        this.contextCache.delete(contextFilePath);
        vscode.window.setStatusBarMessage(`$(check) Scenario URL saved to ${targetScenario}`, 3000);
    }

    private async handleChangeUrlSource(message: any, currentTemplatePath: string): Promise<void> {
        const contextFilePath = this.getContextFilePath(currentTemplatePath);
        const fileData = this.getTemplateContextFileData(currentTemplatePath);
        const activeScenario = fileData.activeScenario || 'Default';
        
        if (!fileData.scenarios) {
            fileData.scenarios = { Default: { variables: {} } };
        }
        if (!fileData.scenarios[activeScenario]) {
            fileData.scenarios[activeScenario] = { variables: {} };
        }
        
        if (message.source === 'self') {
            // Keep URL in scenario - if it doesn't have one, copy from inherited source
            if (!fileData.scenarios[activeScenario].url) {
                const { url } = this.getUrlWithSource(activeScenario, fileData);
                fileData.scenarios[activeScenario].url = url || '';
            }
            // Remove urlSource field when using Self
            delete fileData.scenarios[activeScenario].urlSource;
        } else {
            // Remove URL from scenario and set urlSource to inherit from specified scenario
            delete fileData.scenarios[activeScenario].url;
            fileData.scenarios[activeScenario].urlSource = message.source;
        }
        
        fs.writeFileSync(contextFilePath, JSON.stringify(fileData, null, 2), 'utf8');
        this.contextCache.set(contextFilePath, fileData);
        
        // Send updated URL info back to webview
        const { url, urlSource } = this.getUrlWithSource(activeScenario, fileData);
        this.panel?.webview.postMessage({
            command: 'updateUrl',
            url: url,
            urlSource: urlSource
        });
        
        vscode.window.setStatusBarMessage(`$(check) URL source changed to ${message.source === 'self' ? 'Self' : message.source}`, 3000);
    }

    private async handleSaveTemplateHeaders(message: any, currentTemplatePath: string): Promise<void> {
        const contextFilePath = this.getContextFilePath(currentTemplatePath);
        let existingData: ContextFileData = this.getEmptyContextData();
        if (fs.existsSync(contextFilePath)) {
            try {
                const content = fs.readFileSync(contextFilePath, 'utf8');
                const parsed = JSON.parse(content);
                existingData = parsed;
            } catch (e) {
                console.error('Error loading context:', e);
            }
        }
        existingData.headers = message.headers;
        fs.writeFileSync(contextFilePath, JSON.stringify(existingData, null, 2), 'utf8');
        this.contextCache.set(contextFilePath, existingData);
        vscode.window.setStatusBarMessage('$(check) Template headers saved', 3000);
    }

    private async handleSaveHttpServletRequestVar(message: any, currentTemplatePath: string): Promise<void> {
        const contextFilePath = this.getContextFilePath(currentTemplatePath);
        let existingData: ContextFileData = this.getEmptyContextData();
        if (fs.existsSync(contextFilePath)) {
            try {
                const content = fs.readFileSync(contextFilePath, 'utf8');
                const parsed = JSON.parse(content);
                existingData = parsed;
            } catch (e) {
                console.error('Error loading context:', e);
            }
        }
        existingData.httpServletRequestVar = message.variable || undefined;
        fs.writeFileSync(contextFilePath, JSON.stringify(existingData, null, 2), 'utf8');
        this.contextCache.set(contextFilePath, existingData);
        this.updateWebview(currentTemplatePath);
        vscode.window.setStatusBarMessage('$(check) HttpServletRequest variable mapped', 3000);
    }

    private async handleClearHttpServletRequestVar(currentTemplatePath: string): Promise<void> {
        console.log('[clearHttpServletRequestVar] Clearing mapping');
        const contextFilePath = this.getContextFilePath(currentTemplatePath);
        console.log('[clearHttpServletRequestVar] Context file path:', contextFilePath);
        let existingData: ContextFileData = this.getEmptyContextData();
        if (fs.existsSync(contextFilePath)) {
            try {
                const content = fs.readFileSync(contextFilePath, 'utf8');
                const parsed = JSON.parse(content);
                existingData = parsed;
                console.log('[clearHttpServletRequestVar] Existing data loaded:', existingData);
            } catch (e) {
                console.error('Error loading context:', e);
            }
        }
        existingData.httpServletRequestVar = '';
        console.log('[clearHttpServletRequestVar] Saving data:', existingData);
        fs.writeFileSync(contextFilePath, JSON.stringify(existingData, null, 2), 'utf8');
        this.contextCache.set(contextFilePath, existingData);
        this.updateWebview(currentTemplatePath);
        vscode.window.setStatusBarMessage('$(check) HttpServletRequest mapping cleared', 3000);
    }

    private async handleSaveLocaleVar(message: any, currentTemplatePath: string): Promise<void> {
        const contextFilePath = this.getContextFilePath(currentTemplatePath);
        let existingData: ContextFileData = this.getEmptyContextData();
        if (fs.existsSync(contextFilePath)) {
            const content = fs.readFileSync(contextFilePath, 'utf8');
            existingData = JSON.parse(content);
        }
        existingData.localeVar = message.variable || undefined;
        fs.writeFileSync(contextFilePath, JSON.stringify(existingData, null, 2), 'utf8');
        this.contextCache.set(contextFilePath, existingData);
        this.updateWebview(currentTemplatePath);
        vscode.window.setStatusBarMessage('$(check) Locale variable mapping saved', 3000);
    }

    private async handleSaveTemplateMessagesVar(message: any, currentTemplatePath: string): Promise<void> {
        const contextFilePath = this.getContextFilePath(currentTemplatePath);
        let existingData: ContextFileData = this.getEmptyContextData();
        if (fs.existsSync(contextFilePath)) {
            const content = fs.readFileSync(contextFilePath, 'utf8');
            existingData = JSON.parse(content);
        }
        existingData.templateMessagesVar = message.variable || undefined;
        fs.writeFileSync(contextFilePath, JSON.stringify(existingData, null, 2), 'utf8');
        this.contextCache.set(contextFilePath, existingData);
        this.updateWebview(currentTemplatePath);
        vscode.window.setStatusBarMessage('$(check) Template messages variable mapping saved', 3000);
    }

    private async handleSaveEscapeToolVar(message: any, currentTemplatePath: string): Promise<void> {
        const contextFilePath = this.getContextFilePath(currentTemplatePath);
        let existingData: ContextFileData = this.getEmptyContextData();
        if (fs.existsSync(contextFilePath)) {
            const content = fs.readFileSync(contextFilePath, 'utf8');
            existingData = JSON.parse(content);
        }
        existingData.escapeToolVar = message.variable || undefined;
        fs.writeFileSync(contextFilePath, JSON.stringify(existingData, null, 2), 'utf8');
        this.contextCache.set(contextFilePath, existingData);
        this.updateWebview(currentTemplatePath);
        vscode.window.setStatusBarMessage('$(check) Escape tool variable mapping saved', 3000);
    }

    private async handleSaveMessagesFilePath(message: any, currentTemplatePath: string): Promise<void> {
        this.environmentContext.messagesPropertiesPath = message.filePath || undefined;
        await this.saveEnvironmentContext();
        this.updateWebview(currentTemplatePath);
        vscode.window.setStatusBarMessage('$(check) Messages file path saved', 3000);
    }

    private async handleBrowseMessagesFile(currentTemplatePath: string): Promise<void> {
        const fileUri = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { 'Properties Files': ['properties'], 'All Files': ['*'] },
            title: 'Select Messages Properties File'
        });
        if (fileUri?.[0]) {
            this.environmentContext.messagesPropertiesPath = fileUri[0].fsPath;
            await this.saveEnvironmentContext();
            this.updateWebview(currentTemplatePath);
            vscode.window.setStatusBarMessage('$(check) Messages file selected', 3000);
        }
    }

    private async handleSaveEnvironmentLanguage(message: any, currentTemplatePath: string): Promise<void> {
        this.environmentContext.language = message.language || 'en';
        await this.saveEnvironmentContext();
        this.updateWebview(currentTemplatePath);
        vscode.window.setStatusBarMessage('$(check) Environment language saved', 3000);
    }

    private async handleAddVariableToConfig(message: any, contextData: ContextData, currentTemplatePath: string): Promise<void> {
        if (message.type === 'variable') {
            contextData[message.name] = '';
        } else if (message.type === 'object') {
            contextData[message.name] = {};
        }
        await this.saveContext(currentTemplatePath, contextData);
        this.updateWebview(currentTemplatePath);
        vscode.window.setStatusBarMessage('$(check) Variable $' + message.name + ' added to configuration', 3000);
    }

    private async handleSaveEnvironmentHeaders(message: any, currentTemplatePath: string): Promise<void> {
        if (!await this.ensureEnvironmentContextFile()) {
            return;
        }
        this.environmentContext.headers = message.headers;
        await this.saveEnvironmentContext();
        this.updateWebview(currentTemplatePath);
        vscode.window.setStatusBarMessage('$(check) Environment headers saved', 3000);
    }

    private async handleSaveEnvironmentHeaderRow(message: any, currentTemplatePath: string): Promise<void> {
        if (!await this.ensureEnvironmentContextFile()) {
            return;
        }
        if (!this.environmentContext.headers) {
            this.environmentContext.headers = {};
        }
        
        const oldName = (message.oldName || '').trim();
        const part = message.part;
        const value = (message.value || '').trim();
        const existingKey = oldName ? this.findHeaderKey(this.environmentContext.headers, oldName) : undefined;
        if (!existingKey) {
            return;
        }
        
        let updatedName = existingKey;
        if (part === 'name') {
            if (value === '') {
                vscode.window.showErrorMessage('Header name is required.');
                return;
            }
            if (!this.isPrintableAscii(value)) {
                vscode.window.showErrorMessage('Header names must use printable ASCII characters.');
                return;
            }
            const normalizedName = this.normalizeHeaderName(value);
            const duplicateKey = this.findHeaderKey(this.environmentContext.headers, normalizedName);
            if (duplicateKey && duplicateKey !== existingKey) {
                vscode.window.showErrorMessage(`Header name "${value}" already exists.`);
                return;
            }
            const oldValue = this.environmentContext.headers[existingKey];
            delete this.environmentContext.headers[existingKey];
            this.environmentContext.headers[normalizedName] = oldValue;
            updatedName = normalizedName;
        } else if (part === 'value') {
            if (value === '') {
                vscode.window.showErrorMessage('Header value is required.');
                return;
            }
            if (!this.isPrintableAscii(value)) {
                vscode.window.showErrorMessage('Header values must use printable ASCII characters.');
                return;
            }
            this.environmentContext.headers[existingKey] = value;
        }
        
        await this.saveEnvironmentContext();
        this.panel?.webview.postMessage({
            command: 'upsertEnvironmentHeaderRow',
            oldName: existingKey !== updatedName ? existingKey : undefined,
            name: updatedName,
            value: this.environmentContext.headers[updatedName]
        });
        vscode.window.setStatusBarMessage('$(check) Header updated', 3000);
    }

    private async handleSaveNewEnvironmentHeader(message: any, currentTemplatePath: string): Promise<void> {
        if (!await this.ensureEnvironmentContextFile()) {
            return;
        }
        if (!this.environmentContext.headers) {
            this.environmentContext.headers = {};
        }
        
        const name = (message.name || '').trim();
        const value = (message.value || '').trim();
        
        // Validation - reject if either field is empty
        if (name === '' || value === '') {
            vscode.window.showErrorMessage('Both header name and value are required.');
            return;
        }

        if (!this.isPrintableAscii(name)) {
            vscode.window.showErrorMessage('Header names must use printable ASCII characters.');
            return;
        }
        if (!this.isPrintableAscii(value)) {
            vscode.window.showErrorMessage('Header values must use printable ASCII characters.');
            return;
        }

        const normalizedName = this.normalizeHeaderName(name);
        
        // Check for duplicates
        if (this.findHeaderKey(this.environmentContext.headers, normalizedName)) {
            vscode.window.showErrorMessage(`Header name "${name}" already exists.`);
            return;
        }
        
        // Add new header
        this.environmentContext.headers[normalizedName] = value;
        
        await this.saveEnvironmentContext();
        this.panel?.webview.postMessage({
            command: 'upsertEnvironmentHeaderRow',
            name: normalizedName,
            value: this.environmentContext.headers[normalizedName]
        });
        
        vscode.window.setStatusBarMessage('$(check) Header added', 3000);
    }

    private async handleDeleteEnvironmentHeader(message: any, currentTemplatePath: string): Promise<void> {
        if (!await this.ensureEnvironmentContextFile()) {
            return;
        }
        if (!this.environmentContext.headers) {
            return;
        }
        
        const headerName = message.name;
        // Allow deletion even if headerName is empty or a temp ID
        if (headerName !== undefined && this.environmentContext.headers.hasOwnProperty(headerName)) {
            delete this.environmentContext.headers[headerName];
            await this.saveEnvironmentContext();
            this.panel?.webview.postMessage({
                command: 'deleteEnvironmentHeaderRow',
                name: headerName
            });
            vscode.window.setStatusBarMessage('$(check) Header deleted', 3000);
        }
    }

    private async handleSaveNewEnvironmentVariable(message: any, currentTemplatePath: string): Promise<void> {
        if (!await this.ensureEnvironmentContextFile()) {
            return;
        }
        
        const name = (message.name || '').trim();
        const value = (message.value || '').trim();
        
        // Validation - reject if either field is empty
        if (name === '' || value === '') {
            vscode.window.showErrorMessage('Both variable name and value are required.');
            return;
        }
        
        // Check for duplicates
        if (this.environmentContext.data.hasOwnProperty(name)) {
            const existingValue = this.environmentContext.data[name];
            if (typeof existingValue !== 'object' || existingValue === null) {
                vscode.window.showErrorMessage(`Variable name "${name}" already exists.`);
                return;
            }
        }
        if (this.environmentContext.mockFunctions && this.environmentContext.mockFunctions.hasOwnProperty(name)) {
            vscode.window.showErrorMessage(`Variable name "${name}" already exists as a mock function.`);
            return;
        }
        
        // Add new variable
        this.environmentContext.data[name] = value;
        
        await this.saveEnvironmentContext();
        this.panel?.webview.postMessage({
            command: 'upsertEnvironmentVariableRow',
            name: name,
            value: this.environmentContext.data[name]
        });
        
        vscode.window.setStatusBarMessage('$(check) Variable added', 3000);
    }

    private async handleDeleteEnvironmentVariable(message: any, currentTemplatePath: string): Promise<void> {
        if (!await this.ensureEnvironmentContextFile()) {
            return;
        }
        const varName = message.name;
        // Allow deletion even if varName is empty or a temp ID
        if (varName !== undefined && this.environmentContext.data.hasOwnProperty(varName)) {
            delete this.environmentContext.data[varName];
            await this.saveEnvironmentContext();
            this.panel?.webview.postMessage({
                command: 'deleteEnvironmentVariableRow',
                name: varName
            });
            vscode.window.setStatusBarMessage('$(check) Variable deleted', 3000);
        }
    }

    private async handleSaveEnvironmentVariableRow(message: any, currentTemplatePath: string): Promise<void> {
        if (!await this.ensureEnvironmentContextFile()) {
            return;
        }
        const oldName = message.oldName;
        const part = message.part;
        const value = message.value;
        let updatedName = oldName;
        
        if (part === 'name' && oldName) {
            // Rename variable - check for duplicates
            if (oldName !== value) {
                // Check if new name already exists (excluding objects with methods)
                if (this.environmentContext.data.hasOwnProperty(value)) {
                    const existingValue = this.environmentContext.data[value];
                    // Allow if it's an object (might be for mock functions), but show error if it's a simple value
                    if (typeof existingValue !== 'object' || existingValue === null) {
                        vscode.window.showErrorMessage(
                            `Variable name "${value}" already exists. Please choose a different name.`,
                            'Open File'
                        ).then(selection => {
                            if (selection === 'Open File' && this.environmentContext.filePath) {
                                vscode.workspace.openTextDocument(this.environmentContext.filePath).then(doc => {
                                    vscode.window.showTextDocument(doc);
                                });
                            }
                        });
                        return;
                    }
                }
                if (this.environmentContext.mockFunctions && this.environmentContext.mockFunctions.hasOwnProperty(value)) {
                    vscode.window.showErrorMessage(
                        `Variable name "${value}" already exists as a mock function. Please choose a different name.`,
                        'Open File'
                    ).then(selection => {
                        if (selection === 'Open File' && this.environmentContext.filePath) {
                            vscode.workspace.openTextDocument(this.environmentContext.filePath).then(doc => {
                                vscode.window.showTextDocument(doc);
                            });
                        }
                    });
                    return;
                }
                const oldValue = this.environmentContext.data[oldName];
                delete this.environmentContext.data[oldName];
                this.environmentContext.data[value] = oldValue;
                updatedName = value;
            }
        } else if (part === 'value' && oldName) {
            // Update value
            this.environmentContext.data[oldName] = value;
        }
        
        await this.saveEnvironmentContext();
        if (updatedName) {
            this.panel?.webview.postMessage({
                command: 'upsertEnvironmentVariableRow',
                oldName: oldName !== updatedName ? oldName : undefined,
                name: updatedName,
                value: this.environmentContext.data[updatedName]
            });
        }
        vscode.window.setStatusBarMessage('$(check) Variable updated', 3000);
    }

    private async handleSaveNewEnvironmentMockFunction(message: any, currentTemplatePath: string): Promise<void> {
        if (!await this.ensureEnvironmentContextFile()) {
            return;
        }

        if (!this.environmentContext.mockFunctions) {
            this.environmentContext.mockFunctions = {};
        }

        const implementation = (message.implementation || '').trim();

        if (implementation === '') {
            vscode.window.showErrorMessage('Mock function implementation is required.');
            return;
        }

        // Validate JavaScript syntax
        const validation = this.isValidJavaScript(implementation);
        if (!validation.valid) {
            vscode.window.showErrorMessage(`Invalid JavaScript syntax: ${validation.error}`);
            return;
        }

        // Extract function name from implementation
        const name = this.extractFunctionName(implementation);
        if (!name) {
            vscode.window.showErrorMessage('Invalid function declaration. First non-empty line must be: function functionName(...) {');
            return;
        }

        if (this.environmentContext.mockFunctions.hasOwnProperty(name)) {
            vscode.window.showErrorMessage(`Mock function "${name}" already exists.`);
            return;
        }

        this.environmentContext.mockFunctions[name] = implementation;
        await this.saveEnvironmentContext();

        this.panel?.webview.postMessage({
            command: 'upsertEnvironmentMockFunctionRow',
            name: name,
            implementation: this.environmentContext.mockFunctions[name]
        });

        vscode.window.setStatusBarMessage('$(check) Mock function added', 3000);
    }

    private async handleSaveEnvironmentMockFunctionRow(message: any, currentTemplatePath: string): Promise<void> {
        if (!await this.ensureEnvironmentContextFile()) {
            return;
        }

        if (!this.environmentContext.mockFunctions) {
            this.environmentContext.mockFunctions = {};
        }

        const oldName = (message.oldName || '').trim();
        const implementation = (message.value || '').trim();

        if (!oldName || !this.environmentContext.mockFunctions.hasOwnProperty(oldName)) {
            return;
        }

        if (implementation === '') {
            vscode.window.showErrorMessage('Mock function implementation is required.');
            return;
        }

        // Validate JavaScript syntax
        const validation = this.isValidJavaScript(implementation);
        if (!validation.valid) {
            vscode.window.showErrorMessage(`Invalid JavaScript syntax: ${validation.error}`);
            return;
        }

        // Extract function name from implementation
        const extractedName = this.extractFunctionName(implementation);
        if (!extractedName) {
            vscode.window.showErrorMessage('Invalid function declaration. First non-empty line must be: function functionName(...) {');
            return;
        }

        // Check for duplicates (excluding old name)
        if (extractedName !== oldName && this.environmentContext.mockFunctions.hasOwnProperty(extractedName)) {
            vscode.window.showErrorMessage(`Mock function "${extractedName}" already exists.`);
            return;
        }

        // Remove old entry if name changed
        if (oldName && oldName !== extractedName) {
            delete this.environmentContext.mockFunctions[oldName];
        }

        // Save with extracted name
        this.environmentContext.mockFunctions[extractedName] = implementation;

        await this.saveEnvironmentContext();
        this.panel?.webview.postMessage({
            command: 'upsertEnvironmentMockFunctionRow',
            oldName: oldName !== extractedName ? oldName : undefined,
            name: extractedName,
            implementation: this.environmentContext.mockFunctions[extractedName]
        });
        vscode.window.setStatusBarMessage('$(check) Mock function updated', 3000);
    }

    private async handleDeleteEnvironmentMockFunction(message: any, currentTemplatePath: string): Promise<void> {
        if (!await this.ensureEnvironmentContextFile()) {
            return;
        }

        if (!this.environmentContext.mockFunctions) {
            this.environmentContext.mockFunctions = {};
        }

        const name = (message.name || '').trim();
        if (!name) {
            return;
        }

        if (this.environmentContext.mockFunctions.hasOwnProperty(name)) {
            delete this.environmentContext.mockFunctions[name];
            await this.saveEnvironmentContext();
            this.panel?.webview.postMessage({
                command: 'deleteEnvironmentMockFunctionRow',
                name: name
            });
            vscode.window.setStatusBarMessage('$(check) Mock function deleted', 3000);
        }
    }

    private async handleRequestVariableInput(message: any, contextData: ContextData, currentTemplatePath: string): Promise<void> {
        const varType = message.inferredType || 'string';
        
        if (varType === 'boolean') {
            await this.handleBooleanVariableInput(message, contextData, currentTemplatePath);
        } else if (varType === 'number') {
            await this.handleNumberVariableInput(message, contextData, currentTemplatePath);
        } else {
            await this.handleStringVariableInput(message, contextData, currentTemplatePath, varType);
        }
    }

    private async handleBooleanVariableInput(message: any, contextData: ContextData, currentTemplatePath: string): Promise<void> {
        const boolChoice = await vscode.window.showQuickPick(['true', 'false'], {
            placeHolder: `Select value for $${message.name}`,
            title: `Configure $${message.name} (Boolean)`
        });
        if (boolChoice !== undefined) {
            contextData[message.name] = boolChoice === 'true';
            await this.saveContext(currentTemplatePath, contextData);
            this.updateWebview(currentTemplatePath);
            vscode.window.setStatusBarMessage('$(check) Variable $' + message.name + ' = ' + boolChoice, 3000);
        }
    }

    private async handleNumberVariableInput(message: any, contextData: ContextData, currentTemplatePath: string): Promise<void> {
        const varValue = await vscode.window.showInputBox({
            prompt: `Enter numeric value for $${message.name}`,
            value: '0',
            validateInput: (text) => Number.isNaN(Number(text)) ? 'Please enter a valid number' : null
        });
        if (varValue !== undefined) {
            contextData[message.name] = Number(varValue);
            await this.saveContext(currentTemplatePath, contextData);
            this.updateWebview(currentTemplatePath);
            vscode.window.setStatusBarMessage('$(check) Variable $' + message.name + ' = ' + varValue, 3000);
        }
    }

    private async handleStringVariableInput(message: any, contextData: ContextData, currentTemplatePath: string, varType: string): Promise<void> {
        const placeholder = varType === 'url' ? 'https://example.com' : 'Enter text value';
        const varValue = await vscode.window.showInputBox({
            prompt: `Enter ${varType} value for $${message.name}`,
            value: varType === 'url' ? 'https://' : '',
            placeHolder: placeholder
        });
        if (varValue !== undefined) {
            contextData[message.name] = varValue;
            await this.saveContext(currentTemplatePath, contextData);
            this.updateWebview(currentTemplatePath);
            vscode.window.setStatusBarMessage('$(check) Variable $' + message.name + ' configured', 3000);
        }
    }

    private async handleRequestPropertyInput(message: any, contextData: ContextData, currentTemplatePath: string): Promise<void> {
        const propType = message.inferredType || 'string';
        
        if (propType === 'boolean') {
            await this.handleBooleanPropertyInput(message, contextData, currentTemplatePath);
        } else if (propType === 'number') {
            await this.handleNumberPropertyInput(message, contextData, currentTemplatePath);
        } else {
            await this.handleStringPropertyInput(message, contextData, currentTemplatePath, propType);
        }
    }

    private async handleBooleanPropertyInput(message: any, contextData: ContextData, currentTemplatePath: string): Promise<void> {
        const boolChoice = await vscode.window.showQuickPick(['true', 'false'], {
            placeHolder: `Select value for $${message.objectName}.${message.propertyName}`,
            title: `Configure $${message.objectName}.${message.propertyName} (Boolean)`
        });
        if (boolChoice !== undefined) {
            if (!contextData[message.objectName]) {
                contextData[message.objectName] = {};
            }
            contextData[message.objectName][message.propertyName] = boolChoice === 'true';
            await this.saveContext(currentTemplatePath, contextData);
            this.updateWebview(currentTemplatePath);
            vscode.window.setStatusBarMessage(`$(check) Property configured = ${boolChoice}`, 3000);
        }
    }

    private async handleNumberPropertyInput(message: any, contextData: ContextData, currentTemplatePath: string): Promise<void> {
        const propValue = await vscode.window.showInputBox({
            prompt: `Enter numeric value for $${message.objectName}.${message.propertyName}`,
            value: '0',
            validateInput: (text) => Number.isNaN(Number(text)) ? 'Please enter a valid number' : null
        });
        if (propValue !== undefined) {
            if (!contextData[message.objectName]) {
                contextData[message.objectName] = {};
            }
            contextData[message.objectName][message.propertyName] = Number(propValue);
            await this.saveContext(currentTemplatePath, contextData);
            this.updateWebview(currentTemplatePath);
            vscode.window.setStatusBarMessage(`$(check) Property configured = ${propValue}`, 3000);
        }
    }

    private async handleStringPropertyInput(message: any, contextData: ContextData, currentTemplatePath: string, propType: string): Promise<void> {
        const placeholder = propType === 'url' ? 'https://example.com' : 'Enter text value';
        const propValue = await vscode.window.showInputBox({
            prompt: `Enter ${propType} value for $${message.objectName}.${message.propertyName}`,
            value: propType === 'url' ? 'https://' : '',
            placeHolder: placeholder
        });
        if (propValue !== undefined) {
            if (!contextData[message.objectName]) {
                contextData[message.objectName] = {};
            }
            contextData[message.objectName][message.propertyName] = propValue;
            await this.saveContext(currentTemplatePath, contextData);
            this.updateWebview(currentTemplatePath);
            vscode.window.setStatusBarMessage('$(check) Property configured', 3000);
        }
    }

    private async handleRequestMethodInput(message: any, contextData: ContextData, currentTemplatePath: string): Promise<void> {
        let template;
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
            validateInput: (text) => (!text?.trim()) ? 'Implementation cannot be empty' : null
        });
        if (methodImpl?.trim()) {
            if (!contextData[message.objectName]) {
                contextData[message.objectName] = {};
            }
            contextData[message.objectName][message.methodName] = {
                _implementation: methodImpl
            };
            await this.saveContext(currentTemplatePath, contextData);
            this.updateWebview(currentTemplatePath);
            vscode.window.setStatusBarMessage('$(check) Method $' + message.objectName + '.' + message.methodName + '() configured', 3000);
        }
    }

    private async handleRequestDeleteConfirm(message: any, contextData: ContextData, currentTemplatePath: string): Promise<void> {
        const deleteChoice = await vscode.window.showWarningMessage(
            message.message,
            { modal: true },
            'Delete'
        );
        if (deleteChoice === 'Delete') {
            if (message.type === 'variable') {
                delete contextData[message.name];
            } else if (message.type === 'property') {
                if (contextData[message.objectName]) {
                    delete contextData[message.objectName][message.propertyName];
                    if (Object.keys(contextData[message.objectName]).length === 0) {
                        delete contextData[message.objectName];
                    }
                }
            } else if (message.type === 'method') {
                if (contextData[message.objectName]) {
                    delete contextData[message.objectName][message.methodName];
                    if (Object.keys(contextData[message.objectName]).length === 0) {
                        delete contextData[message.objectName];
                    }
                }
            }
            await this.saveContext(currentTemplatePath, contextData);
            this.updateWebview(currentTemplatePath);
            vscode.window.setStatusBarMessage('$(check) Deleted successfully', 3000);
        }
    }

    private async handleSwitchScenario(message: any, currentTemplatePath: string): Promise<void> {
        const fileData = this.getTemplateContextFileData(currentTemplatePath);
        fileData.activeScenario = message.scenario;
        const contextFilePath = this.getContextFilePath(currentTemplatePath);
        fs.writeFileSync(contextFilePath, JSON.stringify(fileData, null, 2), 'utf8');
        this.contextCache.set(contextFilePath, fileData);
        
        // Instead of full webview update, send scenario data to update DOM
        const scenarios = fileData.scenarios || { Default: { variables: {} } };
        const activeScenario = scenarios[message.scenario] || { variables: {} };
        const contextData = this.getTemplateOnlyContext(currentTemplatePath);
        
        // Determine URL and its source
        const { url, urlSource } = this.getUrlWithSource(message.scenario, fileData);
        
        // Generate headers and variables HTML
        const headersHtml = this.generateScenarioHeadersRows(activeScenario, fileData.headers || '');
        const variablesHtml = this.generateScenarioVariablesRows(activeScenario, contextData);
        
        // Generate URL source options based on current scenario
        const urlSourceOptions = this.generateUrlSourceOptions(message.scenario, fileData.scenarios || {}, fileData);
        
        // Send update to webview
        this.panel?.webview.postMessage({
            command: 'updateScenario',
            scenarioName: message.scenario,
            url: url,
            urlSource: urlSource,
            urlSourceOptions: urlSourceOptions,
            headersHtml: headersHtml,
            variablesHtml: variablesHtml
        });
        
        this.refreshPreviewIfOpen(currentTemplatePath);
        vscode.window.setStatusBarMessage(`$(check) Switched to scenario: ${message.scenario}`, 3000);
    }

    private async handleCreateScenario(currentTemplatePath: string): Promise<void> {
        const newScenarioName = await vscode.window.showInputBox({
            prompt: 'Enter scenario name',
            placeHolder: 'e.g., Incorrect Creds, Account Locked',
            validateInput: (value) => {
                if (!value) return 'Scenario name cannot be empty';
                const fileData = this.getTemplateContextFileData(currentTemplatePath);
                if (fileData.scenarios?.[value]) {
                    return 'Scenario already exists';
                }
                return null;
            }
        });
        if (newScenarioName) {
            const fileData = this.getTemplateContextFileData(currentTemplatePath);
            if (!fileData.scenarios) {
                fileData.scenarios = { Default: { variables: {} } };
            }
            fileData.scenarios[newScenarioName] = {
                variables: {}
            };
            fileData.activeScenario = newScenarioName;
            const contextFilePath = this.getContextFilePath(currentTemplatePath);
            fs.writeFileSync(contextFilePath, JSON.stringify(fileData, null, 2), 'utf8');
            this.contextCache.set(contextFilePath, fileData);
            this.updateWebview(currentTemplatePath);
            vscode.window.setStatusBarMessage(`$(check) Created scenario: ${newScenarioName}`, 3000);
        }
    }

    private async handleSaveNewScenario(message: any, currentTemplatePath: string): Promise<void> {
        const { name } = message;
        
        if (!name || !name.trim()) {
            vscode.window.showErrorMessage('Scenario name cannot be empty');
            return;
        }
        
        const fileData = this.getTemplateContextFileData(currentTemplatePath);
        
        if (!fileData.scenarios) {
            fileData.scenarios = { Default: { variables: {} } };
        }
        
        // Check if scenario already exists
        if (fileData.scenarios[name]) {
            vscode.window.showErrorMessage(`Scenario "${name}" already exists`);
            return;
        }
        
        // Create new scenario
        fileData.scenarios[name] = {
            variables: {}
        };
        
        // Make it active
        fileData.activeScenario = name;
        
        const contextFilePath = this.getContextFilePath(currentTemplatePath);
        fs.writeFileSync(contextFilePath, JSON.stringify(fileData, null, 2), 'utf8');
        this.contextCache.set(contextFilePath, fileData);
        this.updateWebview(currentTemplatePath);
        vscode.window.setStatusBarMessage(`$(check) Created scenario: ${name}`, 3000);
    }

    private async handleDeleteScenario(message: any, currentTemplatePath: string): Promise<void> {
        const scenarioName = message.scenario || message.name;
        
        if (scenarioName === 'Default') {
            vscode.window.showWarningMessage('Cannot delete the Default scenario');
            return;
        }
        
        const confirm = await vscode.window.showWarningMessage(
            `Delete scenario "${scenarioName}"?`,
            { modal: true },
            'Delete'
        );
        if (confirm === 'Delete') {
            const fileData = this.getTemplateContextFileData(currentTemplatePath);
            if (fileData.scenarios) {
                delete fileData.scenarios[scenarioName];
                if (fileData.activeScenario === scenarioName) {
                    fileData.activeScenario = 'Default';
                }
            }
            const contextFilePath = this.getContextFilePath(currentTemplatePath);
            fs.writeFileSync(contextFilePath, JSON.stringify(fileData, null, 2), 'utf8');
            this.contextCache.set(contextFilePath, fileData);
            this.updateWebview(currentTemplatePath);
            vscode.window.setStatusBarMessage(`$(check) Deleted scenario: ${scenarioName}`, 3000);
        }
    }

    private async handleRenameScenario(message: any, currentTemplatePath: string): Promise<void> {
        const oldName = message.oldName;
        const newName = message.newName;
        
        if (!oldName || !newName) {
            vscode.window.showErrorMessage('Invalid scenario names');
            return;
        }
        
        if (oldName === 'Default') {
            vscode.window.showWarningMessage('Cannot rename the Default scenario');
            this.updateWebview(currentTemplatePath);
            return;
        }
        
        if (oldName === newName) {
            return; // No change
        }
        
        const fileData = this.getTemplateContextFileData(currentTemplatePath);
        
        // Check if new name already exists
        if (fileData.scenarios && fileData.scenarios[newName]) {
            vscode.window.showErrorMessage(`A scenario named "${newName}" already exists`);
            this.updateWebview(currentTemplatePath);
            return;
        }
        
        if (!fileData.scenarios || !fileData.scenarios[oldName]) {
            vscode.window.showErrorMessage(`Scenario "${oldName}" not found`);
            this.updateWebview(currentTemplatePath);
            return;
        }
        
        // Rename the scenario
        fileData.scenarios[newName] = fileData.scenarios[oldName];
        delete fileData.scenarios[oldName];
        
        // Update activeScenario if needed
        if (fileData.activeScenario === oldName) {
            fileData.activeScenario = newName;
        }
        
        // Update urlSource references in other scenarios
        Object.keys(fileData.scenarios).forEach(scenarioKey => {
            const scenario = fileData.scenarios![scenarioKey];
            if (scenario.urlSource === oldName) {
                scenario.urlSource = newName;
            }
        });
        
        const contextFilePath = this.getContextFilePath(currentTemplatePath);
        fs.writeFileSync(contextFilePath, JSON.stringify(fileData, null, 2), 'utf8');
        this.contextCache.set(contextFilePath, fileData);
        this.updateWebview(currentTemplatePath);
        vscode.window.setStatusBarMessage(`$(check) Renamed scenario: ${oldName} → ${newName}`, 3000);
    }

    private async handleSaveMethodMapping(message: any, contextData: ContextData, currentTemplatePath: string): Promise<void> {
        const methodName = message.method;
        const mappedTo = message.mappedTo || '';
        
        console.log('Saving method mapping:', methodName, '->', mappedTo);
        
        // Initialize methodMappings if it doesn't exist
        if (!contextData.methodMappings) {
            contextData.methodMappings = {};
        }
        
        // Save or remove mapping
        if (mappedTo) {
            contextData.methodMappings[methodName] = mappedTo;
        } else {
            delete contextData.methodMappings[methodName];
        }
        
        // Save to file
        await this.saveContext(currentTemplatePath, contextData);
        this.updateWebview(currentTemplatePath);
        
        const statusMessage = mappedTo 
            ? `$(check) Mapped ${methodName} to ${mappedTo}`
            : `$(check) Unmapped ${methodName}`;
        vscode.window.setStatusBarMessage(statusMessage, 3000);
    }

    private async handleSaveScenarioHeaderValue(message: any, currentTemplatePath: string): Promise<void> {
        const fileData = this.getTemplateContextFileData(currentTemplatePath);
        // Use scenario from message (the scenario the input field belonged to) rather than activeScenario from file
        const targetScenario = message.scenario || fileData.activeScenario || 'Default';
        const scenario = fileData.scenarios?.[targetScenario];
        
        if (!scenario) {
            return;
        }
        
        // Initialize headers object if needed
        if (!scenario.headers || typeof scenario.headers !== 'object') {
            scenario.headers = {};
        }
        
        // Update the header value
        scenario.headers[message.name] = message.value;
        
        // Save to file
        const contextFilePath = this.getContextFilePath(currentTemplatePath);
        fs.writeFileSync(contextFilePath, JSON.stringify(fileData, null, 2), 'utf8');
        // Clear cache to force fresh read
        this.contextCache.delete(contextFilePath);
        
        vscode.window.setStatusBarMessage(`$(check) Header "${message.name}" updated in ${targetScenario}`, 3000);
    }

    private async handleSaveScenarioVariableValue(message: any, currentTemplatePath: string): Promise<void> {
        const fileData = this.getTemplateContextFileData(currentTemplatePath);
        // Use scenario from message (the scenario the input field belonged to) rather than activeScenario from file
        const targetScenario = message.scenario || fileData.activeScenario || 'Default';
        const scenario = fileData.scenarios?.[targetScenario];
        
        if (!scenario) {
            return;
        }
        
        // Initialize variables object if needed
        if (!scenario.variables || typeof scenario.variables !== 'object') {
            scenario.variables = {};
        }
        
        // Parse value if it looks like JSON
        let value = message.value;
        if (value && (value.startsWith('{') || value.startsWith('[') || value.startsWith('"'))) {
            try {
                value = JSON.parse(value);
            } catch (e) {
                // Keep as string if not valid JSON
            }
        }
        
        // Update the variable value
        scenario.variables[message.name] = value;
        
        // Save to file
        const contextFilePath = this.getContextFilePath(currentTemplatePath);
        fs.writeFileSync(contextFilePath, JSON.stringify(fileData, null, 2), 'utf8');
        // Clear cache to force fresh read
        this.contextCache.delete(contextFilePath);
        
        vscode.window.setStatusBarMessage(`$(check) Variable "${message.name}" updated in ${targetScenario}`, 3000);
    }

    private async handleSaveNewScenarioHeader(message: any, currentTemplatePath: string): Promise<void> {
        const { name, value } = message;
        
        if (!name || !name.trim()) {
            vscode.window.showErrorMessage('Header name cannot be empty');
            return;
        }
        
        const fileData = this.getTemplateContextFileData(currentTemplatePath);
        const activeScenario = fileData.activeScenario || 'Default';
        
        if (!fileData.scenarios) {
            fileData.scenarios = { Default: { variables: {} } };
        }
        if (!fileData.scenarios[activeScenario]) {
            fileData.scenarios[activeScenario] = { variables: {} };
        }
        if (!fileData.scenarios[activeScenario].headers) {
            fileData.scenarios[activeScenario].headers = {};
        }
        
        // Check if header already exists
        if (fileData.scenarios[activeScenario].headers[name]) {
            vscode.window.showErrorMessage(`Header "${name}" already exists`);
            return;
        }
        
        fileData.scenarios[activeScenario].headers[name] = value;
        
        const contextFilePath = this.getContextFilePath(currentTemplatePath);
        fs.writeFileSync(contextFilePath, JSON.stringify(fileData, null, 2), 'utf8');
        this.contextCache.set(contextFilePath, fileData);
        this.updateWebview(currentTemplatePath);
        vscode.window.setStatusBarMessage(`$(check) Added header: ${name}`, 3000);
    }

    private async handleDeleteScenarioHeader(message: any, currentTemplatePath: string): Promise<void> {
        const { name } = message;
        const fileData = this.getTemplateContextFileData(currentTemplatePath);
        const activeScenario = fileData.activeScenario || 'Default';
        
        if (fileData.scenarios?.[activeScenario]?.headers) {
            delete fileData.scenarios[activeScenario].headers[name];
            
            // Also delete from headerSources if exists
            if (fileData.scenarios[activeScenario].headerSources?.[name]) {
                delete fileData.scenarios[activeScenario].headerSources[name];
            }
            
            const contextFilePath = this.getContextFilePath(currentTemplatePath);
            fs.writeFileSync(contextFilePath, JSON.stringify(fileData, null, 2), 'utf8');
            this.contextCache.set(contextFilePath, fileData);
            this.updateWebview(currentTemplatePath);
            vscode.window.setStatusBarMessage(`$(check) Deleted header: ${name}`, 3000);
        }
    }

    private updateWebview(templatePath: string): void {
        console.log('=== updateWebview called for:', templatePath);
        if (!this.panel) {
            console.log('ERROR: panel is undefined!');
            return;
        }

        const contextData = this.getTemplateOnlyContext(templatePath);
        
        // Extract context structure from template
        let contextItems: Map<string, ContextItem> = new Map();
        let parseError: string | undefined;
        try {
            const templateContent = fs.readFileSync(templatePath, 'utf8');
            contextItems = TemplateParser.analyzeContext(templateContent);
            
            // Debug logging
            console.log('Template content length:', templateContent.length);
            console.log('Context items found:', contextItems.size);
            contextItems.forEach((item, key) => {
                console.log(`- ${key}: ${item.type}`, 
                    item.properties ? `props=${item.properties.size}` : '',
                    item.methods ? `methods=${item.methods.size}` : ''
                );
            });
        } catch (error) {
            console.error('Failed to parse template:', error);
            parseError = error instanceof Error ? error.message : String(error);
        }
        
        const html = this.getWebviewHtml(contextData, contextItems, path.basename(templatePath), parseError);
        console.log('=== About to set webview HTML ===');
        console.log('HTML length:', html.length);
        
        // Write HTML to temp file for inspection
        const tempPath = path.join(os.tmpdir(), 'velocity-context-debug.html');
        fs.writeFileSync(tempPath, html, 'utf8');
        console.log('Debug HTML written to:', tempPath);
        
        console.log('=== About to set webview HTML ===');
        console.log('Panel exists:', !!this.panel);
        console.log('Panel visible:', this.panel?.visible);
        console.log('Panel active:', this.panel?.active);
        console.log('Webview exists:', !!this.panel?.webview);
        
        this.panel.webview.html = html;
        
        console.log('=== Webview HTML set complete ===');
        console.log('=== CRITICAL DEBUG INFO ===');
        console.log('HTML contains script tag:', html.includes('<script'));
        console.log('HTML contains nonce:', html.includes('nonce='));
        console.log('HTML contains acquireVsCodeApi:', html.includes('acquireVsCodeApi'));
        console.log('HTML contains console.log:', html.includes('console.log'));
        console.log('Script tag nonce:', html.match(/<script nonce="([^"]+)"/)?.[1]);
        console.log('CSP nonce:', html.match(/script-src 'nonce-([^']+)'/)?.[1]);
        console.log('Nonces match:', html.match(/<script nonce="([^"]+)"/)?.[1] === html.match(/script-src 'nonce-([^']+)'/)?.[1]);
    }

    private loadTemplate(filename: string): string {
        const templatePath = path.join(__dirname, 'templates', filename);
        return fs.readFileSync(templatePath, 'utf8');
    }

    private getWebviewHtml(contextData: ContextData, contextItems: Map<string, ContextItem>, templateName: string, parseError?: string): string {
        console.log('');
        console.log('░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░');
        console.log('░░░ getWebviewHtml() CALLED ░░░');
        console.log('░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░');
        console.log('');
        
        const items = Array.from(contextItems.values());
        const nonce = this.getNonce();
        console.log('Generated nonce:', nonce);
        console.log('Nonce length:', nonce.length);
        const environmentFilePath = this.environmentContext.filePath || '';
        
        // Get URIs for CSP and codicon
        const cspSource = this.panel?.webview.cspSource || "'none'";
        const codiconUri = this.panel?.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css')
        );
        
        // Load external template files
        const templateHtml = this.loadTemplate('webview.html');
        const stylesContent = this.loadTemplate('styles.css');
        const scriptsContent = this.loadTemplate('scripts.js');
        
        // Generate dynamic tab content
        const templateTabContent = this.generateTemplateTabHtml(items, contextData);
        const environmentTabContent = this.generateEnvironmentTabHtml();
        
        console.log('[getWebviewHtml] environmentTabContent length:', environmentTabContent.length);
        console.log('[getWebviewHtml] environmentTabContent first 300 chars:', environmentTabContent.substring(0, 300));
        
        // Replace placeholders in template
        // Note: Use split().join() instead of replaceAll() for content with $ characters
        // to avoid $ being interpreted as special replacement patterns
        let html = templateHtml
            .split('{{nonce}}').join(nonce)
            .split('{{cspSource}}').join(cspSource)
            .split('{{codiconUri}}').join(codiconUri?.toString() || '')
            .split('{{templateName}}').join(this.escapeHtml(templateName))
            .split('{{environmentFilePath}}').join(this.escapeHtml(environmentFilePath))
            .split('{{templateTabContent}}').join(templateTabContent)
            .split('{{environmentTabContent}}').join(environmentTabContent);
        
        // Replace styles and scripts separately to preserve $ characters in JavaScript
        html = html.split('{{styles}}').join(`<style nonce="${nonce}">\n${stylesContent}\n</style>`);
        html = html.split('{{scripts}}').join(`<script nonce="${nonce}">\n${scriptsContent}\n</script>`);
        
        console.log('[getWebviewHtml] Final HTML contains environmentTabContent:', html.includes('environment-tab'));
        console.log('[getWebviewHtml] Final HTML still has placeholder:', html.includes('{{environmentTabContent}}'));
        
        return html;
    }
    
    private getUrlWithSource(scenarioName: string, fileData: ContextFileData): { url: string, urlSource: string } {
        const scenarios = fileData.scenarios || {};
        const scenario = scenarios[scenarioName];
        
        // Check if scenario has its own URL
        if (scenario?.url) {
            return { url: scenario.url, urlSource: 'Self' };
        }
        
        // Check if scenario has a urlSource field (inheriting from specific scenario)
        if (scenario?.urlSource) {
            const sourceScenario = scenarios[scenario.urlSource];
            if (sourceScenario?.url) {
                return { url: sourceScenario.url, urlSource: scenario.urlSource };
            }
        }
        
        // Fallback: try to find a URL from Default scenario
        if (scenarios['Default']?.url && scenarioName !== 'Default') {
            return { url: scenarios['Default'].url, urlSource: 'Default' };
        }
        
        // Check if there's a top-level URL (legacy fallback)
        if (fileData.url) {
            return { url: fileData.url, urlSource: 'Default' };
        }
        
        return { url: '', urlSource: 'Self' };
    }
    
    private generateUrlSourceOptions(currentScenario: string, scenarios: any, fileData: ContextFileData): string {
        let { urlSource } = this.getUrlWithSource(currentScenario, fileData);
        
        // Default to Self if no urlSource is set
        if (!urlSource || urlSource === '') {
            urlSource = 'Self';
        }
        
        // Default scenario can only have Self
        if (currentScenario === 'Default') {
            return '<option value="self" selected>Self</option>';
        }
        
        // For other scenarios, show Self + all other scenarios
        let options = `<option value="self" ${urlSource === 'Self' ? 'selected' : ''}>Self</option>`;
        
        // Add all other scenarios as inheritance options
        for (const scenarioName of Object.keys(scenarios)) {
            if (scenarioName !== currentScenario) {
                options += `<option value="${this.escapeHtml(scenarioName)}" ${urlSource === scenarioName ? 'selected' : ''}>${this.escapeHtml(scenarioName)}</option>`;
            }
        }
        
        return options;
    }
    
    private generateScenarioHeadersRows(activeScenario: string, scenario: any, legacyHeaders: string): string {
        // Parse headers from the legacy format or scenario headers
        const headers: Array<{name: string, value: string, source: string}> = [];
        const headerSources = scenario.headerSources || {};
        
        // If scenario has headers (new format), use those
        if (scenario.headers && typeof scenario.headers === 'object') {
            Object.entries(scenario.headers).forEach(([name, value]) => {
                const source = headerSources[name] || 'self';
                headers.push({ name, value: String(value), source });
            });
        } else if (legacyHeaders) {
            // Parse legacy "Name: Value" format from textarea
            legacyHeaders.split('\n').forEach(line => {
                const colonIdx = line.indexOf(':');
                if (colonIdx > 0) {
                    const name = line.substring(0, colonIdx).trim();
                    const value = line.substring(colonIdx + 1).trim();
                    if (name) {
                        headers.push({ name, value, source: 'self' });
                    }
                }
            });
        }
        
        let rowsHtml = headers.map(({ name, value, source }) => {
            const isSelf = source === 'self';
            const sourceDisplay = source === 'self' ? 'Self' : source === 'environment' ? 'Environment' : source;
            const editableClass = isSelf ? 'data-action="editHeaderCell"' : '';
            const valueDisplay = isSelf ? `<span class="header-cell-value">${this.escapeHtml(value) || '(empty)'}</span>` : this.escapeHtml(value);
            return `
            <tr>
                <td>${this.escapeHtml(name)}</td>
                <td ${editableClass}>
                    ${valueDisplay}
                    ${isSelf ? `<input type="text" value="${this.escapeHtml(value)}" data-action="editScenarioHeader" data-field="value" data-name="${this.escapeHtml(name)}" data-scenario="${this.escapeHtml(activeScenario)}" class="header-cell-input" />` : ''}
                </td>
                <td style="font-size: 0.9em; color: var(--vscode-descriptionForeground);">${this.escapeHtml(sourceDisplay)}</td>
                <td>
                    ${isSelf ? `<button class="icon-button" data-action="deleteScenarioHeader" data-name="${this.escapeHtml(name)}" title="Delete">
                        <span class="codicon codicon-trash"></span>
                    </button>` : ''}
                </td>
            </tr>
        `;
        }).join('');
        
        // Add the "Add Header" button row
        rowsHtml += `
            <tr class="add-row">
                <td colspan="4">
                    <button class="add-table-row-button" data-action="addScenarioHeader">Add Header</button>
                </td>
            </tr>
        `;
        
        return rowsHtml;
    }
    
    private generateScenarioVariablesRows(activeScenario: string, scenario: any, contextData: ContextData): string {
        const variables: Array<{name: string, value: any}> = [];
        
        // If scenario has variables, use those
        if (scenario.variables && typeof scenario.variables === 'object') {
            Object.entries(scenario.variables).forEach(([name, value]) => {
                variables.push({ name, value });
            });
        } else {
            // Fall back to contextData for backward compatibility
            Object.entries(contextData).forEach(([name, value]) => {
                // Skip special keys
                if (!['url', 'headers', 'scenarios', 'activeScenario', 'httpServletRequestVar', 'localeVar', 'templateMessagesVar', 'escapeToolVar'].includes(name)) {
                    variables.push({ name, value });
                }
            });
        }
        
        const variableSources = scenario.variableSources || {};
        
        let rowsHtml = variables.map(({ name, value }) => {
            const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
            const source = variableSources[name] || 'self';
            const isSelf = source === 'self';
            const sourceDisplay = source === 'self' ? 'Self' : source === 'environment' ? 'Environment' : source;
            const editableClass = isSelf ? 'data-action="editVariableCell"' : '';
            const valueDisplay = isSelf ? `<span class="header-cell-value">${this.escapeHtml(valueStr) || '(empty)'}</span>` : this.escapeHtml(valueStr);
            return `
                <tr>
                    <td>${this.escapeHtml(name)}</td>
                    <td ${editableClass}>
                        ${valueDisplay}
                        ${isSelf ? `<input type="text" value="${this.escapeHtml(valueStr)}" data-action="editScenarioVariable" data-field="value" data-name="${this.escapeHtml(name)}" data-scenario="${this.escapeHtml(activeScenario)}" class="header-cell-input" />` : ''}
                    </td>
                    <td style="font-size: 0.9em; color: var(--vscode-descriptionForeground);">${this.escapeHtml(sourceDisplay)}</td>
                    <td>
                        ${isSelf ? `<button class="icon-button" data-action="deleteScenarioVariable" data-name="${this.escapeHtml(name)}" title="Delete">
                            <span class="codicon codicon-trash"></span>
                        </button>` : ''}
                    </td>
                </tr>
            `;
        }).join('');
        
        // Add the "Add Variable" button row
        rowsHtml += `
            <tr class="add-row">
                <td colspan="4">
                    <button class="add-table-row-button" data-action="addScenarioVariable">Add Variable</button>
                </td>
            </tr>
        `;
        
        return rowsHtml;
    }
    
    private generateTemplateTabHtml(items: ContextItem[], contextData: ContextData): string {
        try {
            console.log('=== generateTemplateTabHtml called ===');
            console.log('Items count:', items.length);
            console.log('Items:', items.map(i => `${i.name} (${i.type})`).join(', '));
            console.log('Context data keys:', Object.keys(contextData));
            
            // Get template file data
            const fullPath = this.templateFilePath;
            console.log('[HttpServletRequest Mapping] fullPath:', fullPath);
            console.log('[HttpServletRequest Mapping] this.templateFilePath:', this.templateFilePath);
            
            if (!fullPath) {
                console.error('[HttpServletRequest Mapping] ERROR: fullPath is undefined or empty!');
                return '<div class="error-banner">Error: Template file path is not set</div>';
            }
        
        const templateData: ContextFileData = this.getTemplateContextFileData(fullPath);
        const activeScenario = templateData.activeScenario || 'Default';
        const scenarios = templateData.scenarios || { Default: {} };
        const scenarioNames = Object.keys(scenarios);
        
        console.log('[HttpServletRequest Mapping] Template data:', templateData);
        console.log('[HttpServletRequest Mapping] Manual var:', templateData.httpServletRequestVar);
        console.log('[Scenarios] Active scenario:', activeScenario);
        console.log('[Scenarios] Available scenarios:', scenarioNames);
        
        // Debug URL loading
        const urlInfo = this.getUrlWithSource(activeScenario, templateData);
        console.log('[URL Debug] Active scenario URL info:', urlInfo);
        console.log('[URL Debug] Scenario data:', scenarios[activeScenario]);
        
        // Detect HttpServletRequest variable (only if not explicitly cleared)
        // Empty string means user cleared it, undefined means not set yet
        const httpServletVar = (templateData.httpServletRequestVar !== '') 
            ? this.detectHttpServletRequestVariable(fullPath) 
            : undefined;
        const manualVar = templateData.httpServletRequestVar && templateData.httpServletRequestVar !== '' 
            ? templateData.httpServletRequestVar 
            : undefined;
        const effectiveVar = httpServletVar || manualVar;
        
        console.log('[HttpServletRequest Mapping] httpServletVar:', httpServletVar);
        console.log('[HttpServletRequest Mapping] manualVar:', manualVar);
        console.log('[HttpServletRequest Mapping] effectiveVar:', effectiveVar);
        
        // Detect locale variable (items is the parameter passed to this function)
        const localeObjects = items.filter(item => item.type === 'object' && this.isLocaleObject(item));
        const localeVar = templateData.localeVar || (localeObjects.length > 0 ? localeObjects[0].name : undefined);
        
        // Detect template messages variable
        const messagesObjects = items.filter(item => item.type === 'object' && this.isTemplateMessagesObject(item));
        const messagesVar = templateData.templateMessagesVar || (messagesObjects.length > 0 ? messagesObjects[0].name : undefined);
        
        // Detect escape tool variable
        const escapeObjects = items.filter(item => item.type === 'object' && this.isEscapeToolObject(item));
        const escapeVar = templateData.escapeToolVar || (escapeObjects.length > 0 ? escapeObjects[0].name : undefined);
        
        // Get available HttpServletRequest candidates for mapping dropdown
        const availableObjects = items
            .filter(item => item.type === 'object' && item.methods && item.methods.size > 0)
            .map(item => {
                const methodNames = Array.from(item.methods.keys());
                const httpServletRequestMethods = new Set([
                    'getHeader', 'getHeaders', 'getHeaderNames', 'getParameter', 'getParameterValues',
                    'getParameterMap', 'getRequestURI', 'getRequestURL', 'getMethod', 'getQueryString',
                    'getContextPath', 'getServletPath', 'getPathInfo', 'getRemoteAddr', 'getRemoteHost',
                    'getServerName', 'getServerPort', 'getScheme', 'isSecure'
                ]);
                const matchCount = methodNames.filter(m => httpServletRequestMethods.has(m)).length;
                return { name: item.name, matchCount, methodNames };
            })
            .sort((a, b) => b.matchCount - a.matchCount); // Sort by relevance
        
        const availableVars = availableObjects.map(obj => obj.name);
        
        // Get template context file path
        const templateContextPath = this.getContextFilePath(fullPath);
        const displayPath = templateContextPath || 'No file associated';
        
        // Template Context File section
        let html = `
            <div class="config-section">
                <div class="label-with-info">
                    <label for="template-context-file-path" class="section-label">Template Context File</label>
                    <button class="codicon codicon-info info-icon" title="This file contains variables and methods specific to this template"></button>
                </div>
                <div class="form-field">
                    <div class="button-group">
                        <input type="text" id="template-context-file-path" value="${this.escapeHtml(displayPath)}" 
                               placeholder="No file associated" readonly />
                        <button class="codicon codicon-folder-opened browse-button" data-action="changeTemplateContextFile" title="Change Template Context File"></button>
                        <button class="codicon codicon-refresh browse-button" data-action="reloadTemplateContext" title="Reload Template Context File"></button>
                    </div>
                </div>
            </div>
            
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
                            <td>${effectiveVar ? '$' + this.escapeHtml(effectiveVar) + ' (auto-detected)' : 'Not detected'}</td>
                        </tr>
                        <tr>
                            <td>Locale Provider</td>
                            <td>${localeVar ? '$' + this.escapeHtml(localeVar) + ' (auto-detected)' : 'Not detected'}</td>
                        </tr>
                        <tr>
                            <td>Message Provider</td>
                            <td>${messagesVar ? '$' + this.escapeHtml(messagesVar) + ' (auto-detected)' : 'Not detected'}</td>
                        </tr>
                        <tr>
                            <td>Escape Tool</td>
                            <td>${escapeVar ? '$' + this.escapeHtml(escapeVar) + ' (auto-detected)' : 'Not detected'}</td>
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
                        ${Object.keys(scenarios).map(name => `
                            <tr>
                                <td style="text-align: center;">
                                    <input type="radio" name="active-scenario" value="${this.escapeHtml(name)}" 
                                           ${name === activeScenario ? 'checked' : ''} 
                                           data-action="changeScenario" />
                                </td>
                                <td data-action="editScenarioName" data-old-name="${this.escapeHtml(name)}">
                                    <span class="header-cell-value">${this.escapeHtml(name)}</span>
                                    <input type="text" value="${this.escapeHtml(name)}" data-action="saveScenarioName" data-old-name="${this.escapeHtml(name)}" class="header-cell-input" style="display: none;" />
                                </td>
                                <td style="text-align: center;">
                                    ${name !== 'Default' ? `
                                        <button class="icon-button" data-action="deleteScenario" data-name="${this.escapeHtml(name)}" title="Delete scenario">
                                            <span class="codicon codicon-trash"></span>
                                        </button>
                                    ` : ''}
                                </td>
                            </tr>
                        `).join('')}
                        <tr class="add-row">
                            <td colspan="3">
                                <button class="add-table-row-button" data-action="addScenario">Add Scenario</button>
                            </td>
                        </tr>
                    </tbody>
                </table>
                
                <div class="separator"></div>
                
                <div class="scenario-title">${this.escapeHtml(activeScenario)}</div>
                
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
                            <td data-action="editUrlCell" data-url-editable="${this.getUrlWithSource(activeScenario, templateData).urlSource === 'Self' ? 'true' : 'false'}">
                                <span class="header-cell-value">${this.escapeHtml(this.getUrlWithSource(activeScenario, templateData).url) || '<span style="opacity: 0.5;">Not set</span>'}</span>
                                <input type="text" id="template-url" value="${this.escapeHtml(this.getUrlWithSource(activeScenario, templateData).url)}" 
                                       data-action="saveTemplateUrl" data-scenario="${this.escapeHtml(activeScenario)}" placeholder="https://example.com/path?param=value" 
                                       class="header-cell-input" style="display: none;" 
                                       ${this.getUrlWithSource(activeScenario, templateData).urlSource === 'Self' ? '' : 'disabled'} />
                            </td>
                            <td data-action="editSourceCell">
                                <span class="header-cell-value">${this.escapeHtml(this.getUrlWithSource(activeScenario, templateData).urlSource || 'Self')}</span>
                                <select id="url-source" data-action="changeUrlSource" class="header-cell-input" style="display: none;">
                                    ${this.generateUrlSourceOptions(activeScenario, scenarios, templateData)}
                                </select>
                            </td>
                        </tr>
                    </tbody>
                </table>
                
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
                        ${this.generateScenarioHeadersRows(activeScenario, scenarios[activeScenario] || {}, templateData.headers || '')}
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
                            <th>Source</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody id="scenario-variables-tbody">
                        ${this.generateScenarioVariablesRows(activeScenario, scenarios[activeScenario] || {}, contextData)}
                    </tbody>
                </table>
            </div>
        `;
        
        console.log('Generated HTML length:', html.length);
        console.log('First 200 chars:', html.substring(0, 200));
        
        return html;
        } catch (error) {
            console.error('Error in generateTemplateTabHtml:', error);
            return `<div class="error-banner">Error generating template tab: ${error instanceof Error ? error.message : String(error)}</div>`;
        }
    }
    
    private generateTemplateVariableHtml(item: ContextItem, contextData: ContextData): string {
        const hasLocalValue = contextData[item.name] !== undefined;
        const environmentValue = this.environmentContext.data[item.name];
        const hasEnvironmentValue = environmentValue !== undefined;
        
        // If has local value, source is template
        // If no local but has environment, source is environment
        // If neither, default to template (needs configuration)
        const source = hasLocalValue ? 'template' : (hasEnvironmentValue ? 'environment' : 'template');
        const displayValue = hasLocalValue ? contextData[item.name] : environmentValue;
        const valueStr = displayValue !== undefined 
            ? (typeof displayValue === 'string' ? displayValue : JSON.stringify(displayValue))
            : '';
        
        return `
            <div class="context-item">
                <div class="item-header">
                    <div class="item-name">\$${this.escapeHtml(item.name)}</div>
                    <div class="item-controls">
                        <select class="source-select" data-action="setVariableSource" data-name="${this.escapeHtml(item.name)}">
                            <option value="template" ${source === 'template' ? 'selected' : ''}>Template</option>
                            <option value="environment" ${source === 'environment' ? 'selected' : ''}>Environment</option>
                        </select>
                        <button class="delete" data-action="deleteItem" data-type="variable" data-name="${this.escapeHtml(item.name)}" title="Delete">🗑</button>
                    </div>
                </div>
                ${source === 'template' || !hasEnvironmentValue ? `
                    <input id="input-${this.escapeHtml(item.name)}" value="${this.escapeHtml(valueStr)}" placeholder="Enter value (JSON format)" data-action="saveValue" data-name="${this.escapeHtml(item.name)}" data-object="" data-prop="" />
                ` : `
                    <div class="value-display readonly">${this.escapeHtml(valueStr)}</div>
                `}
            </div>
        `;
    }
    
    private generateTemplateObjectHtml(item: ContextItem, contextData: ContextData): string {
        const objectData = contextData[item.name] || {};
        const environmentData = this.environmentContext.data[item.name] || {};
        
        let html = `<div class="context-item"><div class="item-header"><div class="item-name">\$${this.escapeHtml(item.name)}</div></div>`;
        
        // Properties
        if (item.properties && item.properties.size > 0) {
            item.properties.forEach((propData, propName) => {
                const hasLocal = objectData[propName] !== undefined;
                const environmentVal = environmentData[propName];
                const hasEnvironment = environmentVal !== undefined;
                const source = hasLocal ? 'template' : (hasEnvironment ? 'environment' : 'template');
                const val = hasLocal ? objectData[propName] : environmentVal;
                const valStr = val !== undefined 
                    ? (typeof val === 'string' ? val : JSON.stringify(val))
                    : '';
                
                html += `
                    <div class="nested-item">
                        <div class="nested-header">
                            <div class="nested-name">.${this.escapeHtml(propName)}</div>
                            <div class="item-controls">
                                <select class="source-select" data-action="setPropertySource" data-object="${this.escapeHtml(item.name)}" data-prop="${this.escapeHtml(propName)}">
                                    <option value="template" ${source === 'template' ? 'selected' : ''}>Template</option>
                                    <option value="environment" ${source === 'environment' ? 'selected' : ''}>Environment</option>
                                </select>
                                <button class="delete" data-action="deleteItem" data-type="property" data-object="${this.escapeHtml(item.name)}" data-prop="${this.escapeHtml(propName)}" title="Delete">🗑</button>
                            </div>
                        </div>
                        ${source === 'template' || !hasEnvironment ? `
                            <input id="input-${this.escapeHtml(item.name)}-${this.escapeHtml(propName)}" value="${this.escapeHtml(valStr)}" placeholder="Enter value" data-action="saveValue" data-name="" data-object="${this.escapeHtml(item.name)}" data-prop="${this.escapeHtml(propName)}" />
                        ` : `
                            <div class="value-display readonly">${this.escapeHtml(valStr)}</div>
                        `}
                    </div>
                `;
            });
        }
        
        // Methods
        if (item.methods && item.methods.size > 0) {
            item.methods.forEach((methodData, methodName) => {
                const localMethod = objectData[methodName];
                const hasLocal = localMethod && localMethod._implementation;
                const environmentMethod = environmentData[methodName];
                const hasEnvironment = environmentMethod && environmentMethod._implementation;
                const source = hasLocal ? 'template' : (hasEnvironment ? 'environment' : 'template');
                const impl = hasLocal ? localMethod._implementation : (hasEnvironment ? environmentMethod._implementation : '');
                
                html += `
                    <div class="nested-item">
                        <div class="nested-header">
                            <div class="nested-name">.${this.escapeHtml(methodName)}()</div>
                            <div class="item-controls">
                                <select class="source-select" data-action="setMethodSource" data-object="${this.escapeHtml(item.name)}" data-method="${this.escapeHtml(methodName)}">
                                    <option value="template" ${source === 'template' ? 'selected' : ''}>Template</option>
                                    <option value="environment" ${source === 'environment' ? 'selected' : ''}>Environment</option>
                                </select>
                                <button class="delete" data-action="deleteItem" data-type="method" data-object="${this.escapeHtml(item.name)}" data-method="${this.escapeHtml(methodName)}" title="Delete">🗑</button>
                            </div>
                        </div>
                        ${source === 'template' || !hasEnvironment ? `
                            <textarea id="method-${this.escapeHtml(item.name)}-${this.escapeHtml(methodName)}" placeholder="Enter implementation (use args[0], args[1], etc.)" data-action="saveMethod" data-object="${this.escapeHtml(item.name)}" data-method="${this.escapeHtml(methodName)}">${this.escapeHtml(impl)}</textarea>
                        ` : `
                            <div class="value-display readonly">${this.escapeHtml(impl)}</div>
                        `}
                    </div>
                `;
            });
        }
        
        html += `</div>`;
        return html;
    }
    
    private generateEnvironmentTabHtml(): string {
        const data = this.environmentContext.data;
        const hasData = Object.keys(data).length > 0;
        
        console.log('[generateEnvironmentTabHtml] Called');
        console.log('[generateEnvironmentTabHtml] Data keys:', Object.keys(data));
        console.log('[generateEnvironmentTabHtml] Environment context file:', this.environmentContext.filePath);
        
        // Configuration section (messages and language)
        let html = `
            <div class="config-section">
                <div class="label-with-info">
                    <label for="messages-file-path" class="section-label">Messages Properties File</label>
                    <button class="codicon codicon-info info-icon" title="Load a .properties file for internationalization messages"></button>
                </div>
                <div class="form-field">
                    <div class="button-group">
                        <input type="text" id="messages-file-path" value="${this.escapeHtml(this.environmentContext.messagesPropertiesPath || '')}" 
                               data-action="saveMessagesFilePath" placeholder="/path/to/messages.properties" readonly />
                        <button class="codicon codicon-folder-opened browse-button" data-action="browseMessagesFile" title="Browse for messages file"></button>
                    </div>
                </div>
                
                <div class="label-with-info">
                    <label for="environment-language" class="section-label">Default Language Code</label>
                    <button class="codicon codicon-info info-icon" title="Specify the default language/locale code (e.g., 'en' for English, 'fr' for French, 'es' for Spanish)"></button>
                </div>
                <div class="form-field">
                    <input type="text" id="environment-language" value="${this.escapeHtml(this.environmentContext.language || 'en')}" 
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
        
        // Add objects with properties/methods (not in table format)
        Object.keys(data).sort().forEach(key => {
            const value = data[key];
            
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                // Object with properties/methods
                html += `<div class="context-item"><div class="item-header"><div class="item-name">$${this.escapeHtml(key)}</div></div>`;
                
                Object.keys(value).sort().forEach(subKey => {
                    const subValue = value[subKey];
                    const isMethod = subValue && typeof subValue === 'object' && subValue._implementation;
                    
                    if (isMethod) {
                        html += `
                            <div class="nested-item">
                                <div class="nested-name">.${this.escapeHtml(subKey)}()</div>
                                <textarea id="gmethod-${this.escapeHtml(key)}-${this.escapeHtml(subKey)}" data-action="saveEnvironmentMethod" data-object="${this.escapeHtml(key)}" data-method="${this.escapeHtml(subKey)}">${this.escapeHtml(subValue._implementation)}</textarea>
                            </div>
                        `;
                    } else {
                        const valStr = typeof subValue === 'string' ? subValue : JSON.stringify(subValue);
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
        
        console.log('[generateEnvironmentTabHtml] Generated HTML length:', html.length);
        console.log('[generateEnvironmentTabHtml] HTML preview (first 500 chars):', html.substring(0, 500));
        
        return html;
    }

    private generateEnvironmentVariablesTable(): string {
        const data = this.environmentContext.data;
        const variables: Array<{name: string, value: string}> = [];
        
        // Extract simple variables (not objects)
        Object.keys(data).forEach(key => {
            const value = data[key];
            if (typeof value !== 'object' || value === null || Array.isArray(value)) {
                const valStr = typeof value === 'string' ? value : JSON.stringify(value);
                variables.push({name: key, value: valStr});
            }
        });
        
        // Only render saved variables (no temp rows)
        const regularVars = variables.filter(v => v.name);
        regularVars.sort((a, b) => a.name.localeCompare(b.name));
        
        let tableHtml = '<table class="headers-table"><thead><tr><th>Name</th><th>Value</th><th></th></tr></thead><tbody>';
        
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
        
        tableHtml += '</tbody></table>';
        return tableHtml;
    }

    private generateenvironmentHeadersTable(): string {
        const headers = this.environmentContext.headers || {};
        
        let tableHtml = '<table class="headers-table"><thead><tr><th>Name</th><th>Value</th><th></th></tr></thead><tbody>';
        
        // Only render saved headers (no temp rows)
        const headerKeys = Object.keys(headers).filter(name => name).sort();
        
        headerKeys.forEach(name => {
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
        
        tableHtml += '</tbody></table>';
        return tableHtml;
    }

    private generateEnvironmentMockFunctionsTable(): string {
        const mockFunctions = this.environmentContext.mockFunctions || {};
        const names = Object.keys(mockFunctions).sort((a, b) => a.localeCompare(b));

        let tableHtml = '<table class="headers-table mock-functions-table"><thead><tr><th>Implementation</th><th width="60"></th></tr></thead><tbody>';

        names.forEach(name => {
            const implementation = mockFunctions[name] || '';
            const escapedName = this.escapeHtml(name);
            const escapedImpl = this.escapeHtml(implementation);
            const implDisplay = escapedImpl.replace(/\n/g, '<br>');

            tableHtml += `
                <tr class="header-row" data-mock-name="${escapedName}">
                    <td data-action="editMockFunctionCell">
                        <span class="header-cell-value mock-implementation-value">${implDisplay || '(empty)'}</span>
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

        tableHtml += '</tbody></table>';
        return tableHtml;
    }

    private getContextFilePath(templatePath: string): string {
        // Check if there's a stored association
        const storedPath = this.context.workspaceState.get<string>(`contextFile:${templatePath}`);
        if (storedPath && fs.existsSync(storedPath)) {
            return storedPath;
        }
        
        // Fall back to default location
        const dir = path.dirname(templatePath);
        const base = path.basename(templatePath);
        return path.join(dir, `${base}.context.json`);
    }

    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    private escapeHtml(text: string): string {
        const map: { [key: string]: string } = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, (m) => map[m]);
    }

    private extractFunctionName(implementation: string): string | null {
        const lines = implementation.split('\n');
        
        // Find first non-empty line
        const firstLine = lines.find(line => line.trim() !== '');
        if (!firstLine) {
            return null;
        }
        
        // Match: function functionName(...) {
        const match = /^\s*function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/.exec(firstLine);
        return match ? match[1] : null;
    }

    private isValidJavaScript(code: string): { valid: boolean; error?: string } {
        try {
            // Note: This only checks syntax; it does not execute the code.
            new Function(code);
            return { valid: true };
        } catch (e) {
            return { valid: false, error: e instanceof Error ? e.message : String(e) };
        }
    }

    private findDuplicateVariableNames(data: any): string[] {
        const names: string[] = [];
        const duplicates = new Set<string>();
        
        Object.keys(data).forEach(key => {
            const value = data[key];
            // Only count simple variables, not objects with methods
            if (typeof value !== 'object' || value === null || Array.isArray(value)) {
                if (names.includes(key)) {
                    duplicates.add(key);
                } else {
                    names.push(key);
                }
            }
        });
        
        return Array.from(duplicates);
    }

    private findDuplicateMockFunctionNames(mockFunctions: { [name: string]: string }): string[] {
        const duplicates = new Set<string>();
        const seen = new Set<string>();

        Object.keys(mockFunctions || {}).forEach(name => {
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
        return text.replace(/\\/g, '\\\\')
                   .replace(/'/g, "\\'")
                   .replace(/"/g, '\\"')
                   .replace(/\n/g, '\\n')
                   .replace(/\r/g, '\\r');
    }

    private isLocaleObject(item: ContextItem): boolean {
        return this.canMapEnvironmentObject(item, ['getLanguage']);
    }

    private isTemplateMessagesObject(item: ContextItem): boolean {
        return this.canMapEnvironmentObject(item, ['getMessage']);
    }

    private isEscapeToolObject(item: ContextItem): boolean {
        return this.canMapEnvironmentObject(item, ['escape']);
    }

    private isHttpServletRequestObject(item: ContextItem): boolean {
        return this.canMapEnvironmentObject(item, ['getHeader', 'getParameter', 'getParameterMap']);
    }

    private canMapEnvironmentObject(item: ContextItem, expectedMethods: string[]): boolean {
        if (item.type !== 'object' || !item.methods) {
            return false;
        }

        const methods = new Set(item.methods.keys());
        return expectedMethods.some(m => methods.has(m));
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
    private generateTemplateMethodsTable(items: ContextItem[], contextData: ContextData): string {
        const availableEnvironmentMocks = this.getAvailableEnvironmentMockFunctions();
        const methodMappings = contextData.methodMappings || {};
        
        // Extract all methods from items, excluding special objects
        const templateMethods = new Map<string, { objectName: string; methodName: string; lineNumber: number }>();
        
        for (const item of items) {
            // Skip special objects
            if (this.isLocaleObject(item) || 
                this.isTemplateMessagesObject(item) || 
                this.isEscapeToolObject(item) ||
                this.isHttpServletRequestObject(item)) {
                continue;
            }
            
            // Extract methods from this object
            if (item.type === 'object' && item.methods) {
                for (const [methodName, methodData] of item.methods.entries()) {
                    const fullMethodName = `${item.name}.${methodName}`;
                    if (!templateMethods.has(fullMethodName)) {
                        templateMethods.set(fullMethodName, {
                            objectName: item.name,
                            methodName: methodName,
                            lineNumber: methodData.lineNumber
                        });
                    }
                }
            }
        }
        
        // Generate table rows
        let rowsHtml = '';
        
        if (templateMethods.size === 0) {
            rowsHtml = `
                <tr>
                    <td colspan="2" style="text-align: center; color: var(--vscode-descriptionForeground); font-style: italic;">
                        No template methods detected
                    </td>
                </tr>
            `;
        } else {
            const sortedMethods = Array.from(templateMethods.entries()).sort((a, b) => a[0].localeCompare(b[0]));
            
            for (const [fullMethodName, methodData] of sortedMethods) {
                const currentMapping = methodMappings[fullMethodName] || '';
                const displayValue = currentMapping || '-- Not Mapped --';
                
                // Generate dropdown options
                let optionsHtml = '<option value="">-- Not Mapped --</option>';
                for (const mockFunction of availableEnvironmentMocks) {
                    const selected = currentMapping === mockFunction ? 'selected' : '';
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




















