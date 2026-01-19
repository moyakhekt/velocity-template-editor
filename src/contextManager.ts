import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { TemplateParser, ContextItem } from './templateParser';

export interface ContextData {
    [key: string]: any;
}

export interface HttpServletRequestConfig {
    url: string;
    headers: string;
}

export interface ContextFileData {
    url?: string;
    headers?: string;
    httpServletRequestVar?: string;
    context: ContextData;
}

export interface ContextItemWithSource {
    value: any;
    source: 'global' | 'template';
}

export interface GlobalContextConfig {
    filePath?: string;
    headers?: string;
    data: ContextData;
}

export class ContextManager {
    private context: vscode.ExtensionContext;
    private contextCache: Map<string, ContextData> = new Map();
    private panel: vscode.WebviewPanel | undefined;
    private globalContext: GlobalContextConfig = { data: {} };
    private globalContextLoaded: boolean = false;
    private previewProvider: any = undefined;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.loadGlobalContextPath();
    }

    setPreviewProvider(previewProvider: any): void {
        this.previewProvider = previewProvider;
    }

    private loadGlobalContextPath(): void {
        const savedPath = this.context.globalState.get<string>('globalContextPath');
        if (savedPath && fs.existsSync(savedPath)) {
            try {
                const content = fs.readFileSync(savedPath, 'utf8');
                const parsed = JSON.parse(content);
                // Handle new format with headers
                if (parsed.headers !== undefined || parsed.context !== undefined) {
                    this.globalContext = {
                        filePath: savedPath,
                        headers: parsed.headers,
                        data: parsed.context || parsed.data || {}
                    };
                } else {
                    // Legacy format
                    this.globalContext = {
                        filePath: savedPath,
                        data: parsed
                    };
                }
                this.globalContextLoaded = true;
            } catch (e) {
                console.error('Error loading global context:', e);
            }
        }
    }

    private async saveGlobalContext(): Promise<void> {
        if (!this.globalContext.filePath) {
            return;
        }
        try {
            const dataToSave: any = {
                headers: this.globalContext.headers || '',
                context: this.globalContext.data
            };
            const content = JSON.stringify(dataToSave, null, 2);
            fs.writeFileSync(this.globalContext.filePath, content, 'utf8');
            
            // Trigger preview refresh for current template if preview is open
            if (this.panel) {
                const templatePath = this.panel.title.replace('Context Manager - ', '');
                this.refreshPreviewIfOpen(templatePath);
            }
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to save global context: ${e}`);
        }
    }

    private refreshPreviewIfOpen(templatePath: string): void {
        if (this.previewProvider && this.previewProvider.previewFilePath) {
            // Find the document for this template
            const doc = vscode.workspace.textDocuments.find(d => 
                d.uri.fsPath === templatePath || d.uri.fsPath.toLowerCase() === templatePath.toLowerCase()
            );
            if (doc) {
                this.previewProvider.refresh(doc);
            }
        }
    }

    private async ensureGlobalContextFile(): Promise<boolean> {
        if (this.globalContext.filePath) {
            return true;
        }
        
        const saveFile = await vscode.window.showSaveDialog({
            filters: { 'JSON': ['json'] },
            title: 'Save Global Context File',
            saveLabel: 'Create Global Context'
        });
        
        if (saveFile) {
            this.globalContext.filePath = saveFile.fsPath;
            await this.context.globalState.update('globalContextPath', saveFile.fsPath);
            return true;
        }
        
        return false;
    }

    private getGlobalValue(name: string): any {
        return this.globalContext.data[name];
    }

    public getContextForTemplate(templatePath: string): ContextData {
        const contextFilePath = this.getContextFilePath(templatePath);
        
        // Check cache first
        let templateContextData: ContextFileData;
        if (this.contextCache.has(contextFilePath)) {
            templateContextData = this.contextCache.get(contextFilePath) as any;
        } else {
            // Load from file if exists
            if (fs.existsSync(contextFilePath)) {
                try {
                    const content = fs.readFileSync(contextFilePath, 'utf8');
                    const parsed = JSON.parse(content);
                    // Handle legacy format (just context object) vs new format (with url/headers/context)
                    if (parsed.context !== undefined) {
                        templateContextData = parsed as ContextFileData;
                    } else {
                        templateContextData = { context: parsed };
                    }
                } catch (e) {
                    console.error('Failed to load context file:', e);
                    templateContextData = { context: {} };
                }
            } else {
                templateContextData = { context: {} };
            }
            this.contextCache.set(contextFilePath, templateContextData as any);
        }
        
        const templateContext = templateContextData.context || {};
        
        // Merge global context into template context for rendering
        const mergedContext: ContextData = { ...this.globalContext.data };
        
        // Override with template-specific values and merge objects
        for (const [key, value] of Object.entries(templateContext)) {
            if (typeof value === 'object' && value !== null && !Array.isArray(value) &&
                typeof mergedContext[key] === 'object' && mergedContext[key] !== null && !Array.isArray(mergedContext[key])) {
                // Both are objects, merge them
                mergedContext[key] = { ...mergedContext[key], ...value };
            } else {
                // Template value takes precedence
                mergedContext[key] = value;
            }
        }
        
        // Add HttpServletRequest only if:
        // 1. A variable name is configured (auto-detected or manually selected)
        // 2. A URL is defined
        let httpServletVarName = this.detectHttpServletRequestVariable(templatePath);
        if (!httpServletVarName && templateContextData.httpServletRequestVar) {
            httpServletVarName = templateContextData.httpServletRequestVar;
        }
        
        // Only add HttpServletRequest if both variable and URL are configured
        if (httpServletVarName && templateContextData.url) {
            // Merge headers: global + template (template takes priority)
            const mergedHeaders = this.mergeHeaders(this.globalContext.headers, templateContextData.headers);
            mergedContext[httpServletVarName] = {
                _httpServletRequest: true,
                url: templateContextData.url,
                headers: mergedHeaders
            };
        }
        
        return mergedContext;
    }

    private mergeHeaders(globalHeaders?: string, templateHeaders?: string): string {
        if (!globalHeaders && !templateHeaders) {
            return '';
        }
        if (!globalHeaders) {
            return templateHeaders || '';
        }
        if (!templateHeaders) {
            return globalHeaders;
        }
        
        // Parse headers into map
        const headerMap = new Map<string, string>();
        
        // Add global headers first
        globalHeaders.split('\n').forEach(line => {
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
            const match = content.match(/\$(\w*[Ss]ervlet[Rr]equest\w*)/);
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
        if (this.contextCache.has(contextFilePath)) {
            const cached = this.contextCache.get(contextFilePath) as any;
            const contextData = cached.context || cached;
            // Exclude HttpServletRequest variable if manually selected
            if (cached.httpServletRequestVar) {
                const filtered = { ...contextData };
                delete filtered[cached.httpServletRequestVar];
                return filtered;
            }
            return contextData;
        }
        
        // Load from file if exists
        if (fs.existsSync(contextFilePath)) {
            try {
                const content = fs.readFileSync(contextFilePath, 'utf8');
                const data = JSON.parse(content);
                this.contextCache.set(contextFilePath, data);
                const contextData = data.context || data;
                // Exclude HttpServletRequest variable if manually selected
                if (data.httpServletRequestVar) {
                    const filtered = { ...contextData };
                    delete filtered[data.httpServletRequestVar];
                    return filtered;
                }
                return contextData;
            } catch (e) {
                console.error('Failed to load context file:', e);
            }
        }
        
        // Return empty context
        const emptyContext: ContextData = {};
        this.contextCache.set(contextFilePath, { context: emptyContext });
        return emptyContext;
    }

    private async saveContext(templatePath: string, contextData: ContextData): Promise<void> {
        const contextFilePath = this.getContextFilePath(templatePath);
        
        // Load existing file to preserve url and headers
        let existingData: ContextFileData = { context: {} };
        if (fs.existsSync(contextFilePath)) {
            try {
                const content = fs.readFileSync(contextFilePath, 'utf8');
                const parsed = JSON.parse(content);
                if (parsed.context !== undefined) {
                    existingData = parsed;
                } else {
                    existingData = { context: parsed };
                }
            } catch (e) {
                console.error('Error loading existing context:', e);
            }
        }
        
        // Update context but preserve url and headers
        existingData.context = contextData;
        
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
        console.log('=== manageContext called ===');
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

        this.showContextWebview(templatePath);
    }

    private showContextWebview(templatePath: string): void {
        console.log('=== showContextWebview called ===');
        this.templateFilePath = templatePath;
        
        if (this.panel) {
            console.log('Panel already exists, updating and revealing it');
            this.updateWebview(templatePath);
            this.panel.reveal(vscode.ViewColumn.Two);
        } else {
            console.log('Creating new webview panel');
            this.panel = vscode.window.createWebviewPanel(
                'velocityContext',
                'Velocity Context Manager',
                vscode.ViewColumn.Two,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: []
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
        
        // Always use this.templateFilePath instead of the closure parameter
        const currentTemplatePath = this.templateFilePath;
        const contextData = this.getTemplateOnlyContext(currentTemplatePath);
        
        switch (message.command) {
            case 'test':
                console.log('Test message received:', message.message);
                vscode.window.setStatusBarMessage('$(check) Webview button clicked!', 3000);
                break;
            
            case 'openDevTools':
                vscode.commands.executeCommand('workbench.action.webview.openDeveloperTools');
                break;
            
            case 'loadGlobalContext':
                const loadFile = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectFolders: false,
                    canSelectMany: false,
                    filters: { 'JSON': ['json'] },
                    title: 'Load Global Context File'
                });
                if (loadFile && loadFile[0]) {
                    try {
                        const content = fs.readFileSync(loadFile[0].fsPath, 'utf8');
                        this.globalContext = {
                            filePath: loadFile[0].fsPath,
                            data: JSON.parse(content)
                        };
                        this.globalContextLoaded = true;
                        await this.context.globalState.update('globalContextPath', loadFile[0].fsPath);
                        this.updateWebview(currentTemplatePath);
                        vscode.window.setStatusBarMessage('$(check) Global context loaded', 3000);
                    } catch (e) {
                        vscode.window.showErrorMessage(`Failed to load: ${e}`);
                    }
                }
                break;
            
            case 'saveGlobalContextAs':
                const saveFile = await vscode.window.showSaveDialog({
                    filters: { 'JSON': ['json'] },
                    defaultUri: this.globalContext.filePath ? vscode.Uri.file(this.globalContext.filePath) : undefined,
                    title: 'Save Global Context File'
                });
                if (saveFile) {
                    this.globalContext.filePath = saveFile.fsPath;
                    await this.context.globalState.update('globalContextPath', saveFile.fsPath);
                    await this.saveGlobalContext();
                    this.updateWebview(currentTemplatePath);
                    vscode.window.setStatusBarMessage('$(check) Global context saved', 3000);
                }
                break;
            
            case 'saveGlobalVariable':
                if (!await this.ensureGlobalContextFile()) {
                    break;
                }
                this.globalContext.data[message.name] = message.value;
                await this.saveGlobalContext();
                this.updateWebview(currentTemplatePath);
                vscode.window.setStatusBarMessage(`$(check) Global variable \$${message.name} saved`, 3000);
                break;
            
            case 'saveGlobalProperty':
                if (!await this.ensureGlobalContextFile()) {
                    break;
                }
                if (!this.globalContext.data[message.objectName]) {
                    this.globalContext.data[message.objectName] = {};
                }
                this.globalContext.data[message.objectName][message.propertyName] = message.value;
                await this.saveGlobalContext();
                this.updateWebview(currentTemplatePath);
                vscode.window.setStatusBarMessage('$(check) Global property saved', 3000);
                break;
            
            case 'saveGlobalMethod':
                if (!await this.ensureGlobalContextFile()) {
                    break;
                }
                if (!this.globalContext.data[message.objectName]) {
                    this.globalContext.data[message.objectName] = {};
                }
                this.globalContext.data[message.objectName][message.methodName] = {
                    _implementation: message.implementation
                };
                await this.saveGlobalContext();
                this.updateWebview(currentTemplatePath);
                vscode.window.setStatusBarMessage('$(check) Global method saved', 3000);
                break;
            
            case 'promoteToGlobal':
                if (!await this.ensureGlobalContextFile()) {
                    break;
                }
                if (message.itemType === 'variable') {
                    this.globalContext.data[message.name] = contextData[message.name];
                } else if (message.itemType === 'property') {
                    if (!this.globalContext.data[message.objectName]) {
                        this.globalContext.data[message.objectName] = {};
                    }
                    this.globalContext.data[message.objectName][message.propertyName] = 
                        contextData[message.objectName][message.propertyName];
                } else if (message.itemType === 'method') {
                    if (!this.globalContext.data[message.objectName]) {
                        this.globalContext.data[message.objectName] = {};
                    }
                    this.globalContext.data[message.objectName][message.methodName] = 
                        contextData[message.objectName][message.methodName];
                }
                await this.saveGlobalContext();
                this.updateWebview(currentTemplatePath);
                vscode.window.setStatusBarMessage('$(check) Promoted to global context', 3000);
                break;
            
            case 'setVariableSource':
                if (message.source === 'global') {
                    // Move to global context
                    if (!await this.ensureGlobalContextFile()) {
                        break;
                    }
                    // Copy value to global if exists in template
                    if (contextData[message.name] !== undefined) {
                        this.globalContext.data[message.name] = contextData[message.name];
                        delete contextData[message.name];
                        await this.saveGlobalContext();
                    }
                } else {
                    // Move to template context
                    // Copy value from global if exists
                    if (this.globalContext.data[message.name] !== undefined) {
                        contextData[message.name] = this.globalContext.data[message.name];
                    } else {
                        contextData[message.name] = '';
                    }
                }
                await this.saveContext(currentTemplatePath, contextData);
                this.updateWebview(currentTemplatePath);
                break;
            
            case 'setPropertySource':
                if (message.source === 'global') {
                    // Move to global context
                    if (!await this.ensureGlobalContextFile()) {
                        break;
                    }
                    if (!this.globalContext.data[message.objectName]) {
                        this.globalContext.data[message.objectName] = {};
                    }
                    // Copy value to global if exists in template
                    if (contextData[message.objectName] && contextData[message.objectName][message.propertyName] !== undefined) {
                        this.globalContext.data[message.objectName][message.propertyName] = 
                            contextData[message.objectName][message.propertyName];
                        delete contextData[message.objectName][message.propertyName];
                        if (Object.keys(contextData[message.objectName]).length === 0) {
                            delete contextData[message.objectName];
                        }
                        await this.saveGlobalContext();
                    }
                } else {
                    // Move to template context
                    if (!contextData[message.objectName]) {
                        contextData[message.objectName] = {};
                    }
                    // Copy value from global if exists
                    if (this.globalContext.data[message.objectName] && 
                        this.globalContext.data[message.objectName][message.propertyName] !== undefined) {
                        contextData[message.objectName][message.propertyName] = 
                            this.globalContext.data[message.objectName][message.propertyName];
                    } else {
                        contextData[message.objectName][message.propertyName] = '';
                    }
                }
                await this.saveContext(currentTemplatePath, contextData);
                this.updateWebview(currentTemplatePath);
                break;
            
            case 'setMethodSource':
                if (message.source === 'global') {
                    // Move to global context
                    if (!await this.ensureGlobalContextFile()) {
                        break;
                    }
                    if (!this.globalContext.data[message.objectName]) {
                        this.globalContext.data[message.objectName] = {};
                    }
                    // Copy implementation to global if exists in template
                    if (contextData[message.objectName] && contextData[message.objectName][message.methodName] !== undefined) {
                        this.globalContext.data[message.objectName][message.methodName] = 
                            contextData[message.objectName][message.methodName];
                        delete contextData[message.objectName][message.methodName];
                        if (Object.keys(contextData[message.objectName]).length === 0) {
                            delete contextData[message.objectName];
                        }
                        await this.saveGlobalContext();
                    }
                } else {
                    // Move to template context
                    if (!contextData[message.objectName]) {
                        contextData[message.objectName] = {};
                    }
                    // Copy implementation from global if exists
                    if (this.globalContext.data[message.objectName] && 
                        this.globalContext.data[message.objectName][message.methodName] !== undefined) {
                        contextData[message.objectName][message.methodName] = 
                            this.globalContext.data[message.objectName][message.methodName];
                    } else {
                        contextData[message.objectName][message.methodName] = { _implementation: 'return ""' };
                    }
                }
                await this.saveContext(currentTemplatePath, contextData);
                this.updateWebview(currentTemplatePath);
                break;
            
            case 'setSourceGlobal':
                // When switching to global, remove from template context
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
                break;
            
            case 'setSourceTemplate':
                // When switching to template, add default value if not exists
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
                break;
            
            case 'saveVariable':
                contextData[message.name] = message.value;
                await this.saveContext(currentTemplatePath, contextData);
                this.updateWebview(currentTemplatePath);
                vscode.window.setStatusBarMessage(`$(check) Variable \$${message.name} saved`, 3000);
                break;
            
            case 'saveProperty':
                if (!contextData[message.objectName]) {
                    contextData[message.objectName] = {};
                }
                contextData[message.objectName][message.propertyName] = message.value;
                await this.saveContext(currentTemplatePath, contextData);
                this.updateWebview(currentTemplatePath);
                vscode.window.setStatusBarMessage(`$(check) Property \$${message.objectName}.${message.propertyName} saved`, 3000);
                break;
            
            case 'saveMethod':
                if (!contextData[message.objectName]) {
                    contextData[message.objectName] = {};
                }
                contextData[message.objectName][message.methodName] = {
                    _implementation: message.implementation
                };
                await this.saveContext(currentTemplatePath, contextData);
                this.updateWebview(currentTemplatePath);
                vscode.window.setStatusBarMessage(`$(check) Method \$${message.objectName}.${message.methodName}() saved`, 3000);
                break;
            
            case 'saveTemplateUrl':
                const contextFilePath = this.getContextFilePath(currentTemplatePath);
                let existingData: ContextFileData = { context: {} };
                if (fs.existsSync(contextFilePath)) {
                    try {
                        const content = fs.readFileSync(contextFilePath, 'utf8');
                        const parsed = JSON.parse(content);
                        existingData = parsed.context !== undefined ? parsed : { context: parsed };
                    } catch (e) {
                        console.error('Error loading context:', e);
                    }
                }
                existingData.url = message.url;
                fs.writeFileSync(contextFilePath, JSON.stringify(existingData, null, 2), 'utf8');
                this.contextCache.set(contextFilePath, existingData);
                vscode.window.setStatusBarMessage('$(check) Template URL saved', 3000);
                break;
            
            case 'saveTemplateHeaders':
                const contextFilePath2 = this.getContextFilePath(currentTemplatePath);
                let existingData2: ContextFileData = { context: {} };
                if (fs.existsSync(contextFilePath2)) {
                    try {
                        const content = fs.readFileSync(contextFilePath2, 'utf8');
                        const parsed = JSON.parse(content);
                        existingData2 = parsed.context !== undefined ? parsed : { context: parsed };
                    } catch (e) {
                        console.error('Error loading context:', e);
                    }
                }
                existingData2.headers = message.headers;
                fs.writeFileSync(contextFilePath2, JSON.stringify(existingData2, null, 2), 'utf8');
                this.contextCache.set(contextFilePath2, existingData2);
                vscode.window.setStatusBarMessage('$(check) Template headers saved', 3000);
                break;
            
            case 'saveHttpServletRequestVar':
                const contextFilePath3 = this.getContextFilePath(currentTemplatePath);
                let existingData3: ContextFileData = { context: {} };
                if (fs.existsSync(contextFilePath3)) {
                    try {
                        const content = fs.readFileSync(contextFilePath3, 'utf8');
                        const parsed = JSON.parse(content);
                        existingData3 = parsed.context !== undefined ? parsed : { context: parsed };
                    } catch (e) {
                        console.error('Error loading context:', e);
                    }
                }
                existingData3.httpServletRequestVar = message.variable || undefined;
                fs.writeFileSync(contextFilePath3, JSON.stringify(existingData3, null, 2), 'utf8');
                this.contextCache.set(contextFilePath3, existingData3);
                this.updateWebview(currentTemplatePath);
                vscode.window.setStatusBarMessage('$(check) HttpServletRequest variable mapped', 3000);
                break;
            
            case 'clearHttpServletRequestVar':
                console.log('[clearHttpServletRequestVar] Clearing mapping');
                const contextFilePath4 = this.getContextFilePath(currentTemplatePath);
                console.log('[clearHttpServletRequestVar] Context file path:', contextFilePath4);
                let existingData4: ContextFileData = { context: {} };
                if (fs.existsSync(contextFilePath4)) {
                    try {
                        const content = fs.readFileSync(contextFilePath4, 'utf8');
                        const parsed = JSON.parse(content);
                        existingData4 = parsed.context !== undefined ? parsed : { context: parsed };
                        console.log('[clearHttpServletRequestVar] Existing data loaded:', existingData4);
                    } catch (e) {
                        console.error('Error loading context:', e);
                    }
                }
                // Set to empty string to indicate "user explicitly cleared this"
                // This prevents auto-detection from re-applying
                existingData4.httpServletRequestVar = '';
                console.log('[clearHttpServletRequestVar] Saving data:', existingData4);
                fs.writeFileSync(contextFilePath4, JSON.stringify(existingData4, null, 2), 'utf8');
                this.contextCache.set(contextFilePath4, existingData4);
                this.updateWebview(currentTemplatePath);
                vscode.window.setStatusBarMessage('$(check) HttpServletRequest mapping cleared', 3000);
                break;
            
            case 'addVariableToConfig':
                if (message.type === 'variable') {
                    // Add variable with empty string default
                    contextData[message.name] = '';
                } else if (message.type === 'object') {
                    // Add empty object
                    contextData[message.name] = {};
                }
                await this.saveContext(currentTemplatePath, contextData);
                this.updateWebview(currentTemplatePath);
                vscode.window.setStatusBarMessage(`$(check) Variable \$${message.name} added to configuration`, 3000);
                break;
            
            case 'saveGlobalHeaders':
                if (!await this.ensureGlobalContextFile()) {
                    break;
                }
                this.globalContext.headers = message.headers;
                await this.saveGlobalContext();
                this.updateWebview(currentTemplatePath);
                vscode.window.setStatusBarMessage('$(check) Global headers saved', 3000);
                break;
                
            case 'requestVariableInput':
                let varValue: string | undefined;
                const varType = message.inferredType || 'string';
                
                if (varType === 'boolean') {
                    const boolChoice = await vscode.window.showQuickPick(['true', 'false'], {
                        placeHolder: `Select value for $${message.name}`,
                        title: `Configure $${message.name} (Boolean)`
                    });
                    if (boolChoice !== undefined) {
                        contextData[message.name] = boolChoice === 'true';
                        await this.saveContext(currentTemplatePath, contextData);
                        this.updateWebview(currentTemplatePath);
                        vscode.window.setStatusBarMessage(`$(check) Variable \$${message.name} = ${boolChoice}`, 3000);
                    }
                } else if (varType === 'number') {
                    varValue = await vscode.window.showInputBox({
                        prompt: `Enter numeric value for $${message.name}`,
                        value: '0',
                        validateInput: (text) => {
                            if (isNaN(Number(text))) {
                                return 'Please enter a valid number';
                            }
                            return null;
                        }
                    });
                    if (varValue !== undefined) {
                        contextData[message.name] = Number(varValue);
                        await this.saveContext(currentTemplatePath, contextData);
                        this.updateWebview(currentTemplatePath);
                        vscode.window.setStatusBarMessage(`$(check) Variable \$${message.name} = ${varValue}`, 3000);
                    }
                } else {
                    // String or URL
                    const placeholder = varType === 'url' ? 'https://example.com' : 'Enter text value';
                    varValue = await vscode.window.showInputBox({
                        prompt: `Enter ${varType} value for $${message.name}`,
                        value: varType === 'url' ? 'https://' : '',
                        placeHolder: placeholder
                    });
                    if (varValue !== undefined) {
                        contextData[message.name] = varValue;
                        await this.saveContext(currentTemplatePath, contextData);
                        this.updateWebview(currentTemplatePath);
                        vscode.window.setStatusBarMessage(`$(check) Variable \$${message.name} configured`, 3000);
                    }
                }
                break;
                
            case 'requestPropertyInput':
                let propValue: string | undefined;
                const propType = message.inferredType || 'string';
                
                if (propType === 'boolean') {
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
                } else if (propType === 'number') {
                    propValue = await vscode.window.showInputBox({
                        prompt: `Enter numeric value for $${message.objectName}.${message.propertyName}`,
                        value: '0',
                        validateInput: (text) => {
                            if (isNaN(Number(text))) {
                                return 'Please enter a valid number';
                            }
                            return null;
                        }
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
                } else {
                    const placeholder = propType === 'url' ? 'https://example.com' : 'Enter text value';
                    propValue = await vscode.window.showInputBox({
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
                break;
                
            case 'requestMethodInput':
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
                    validateInput: (text) => {
                        if (!text || !text.trim()) {
                            return 'Implementation cannot be empty';
                        }
                        return null;
                    }
                });
                if (methodImpl !== undefined && methodImpl.trim()) {
                    if (!contextData[message.objectName]) {
                        contextData[message.objectName] = {};
                    }
                    contextData[message.objectName][message.methodName] = {
                        _implementation: methodImpl
                    };
                    await this.saveContext(currentTemplatePath, contextData);
                    this.updateWebview(currentTemplatePath);
                    vscode.window.setStatusBarMessage(`$(check) Method \$${message.objectName}.${message.methodName}() configured`, 3000);
                }
                break;
                
            case 'requestDeleteConfirm':
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
                break;
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
    }

    private getWebviewHtml(contextData: ContextData, contextItems: Map<string, ContextItem>, templateName: string, parseError?: string): string {
        const items = Array.from(contextItems.values());
        const nonce = this.getNonce();
        const globalFileInfo = this.globalContext.filePath 
            ? path.basename(this.globalContext.filePath)
            : 'No file loaded';
        
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { box-sizing: border-box; }
        :root {
            color-scheme: dark;
        }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            padding: 0;
            margin: 0;
            color-scheme: dark;
        }
        .header {
            background: var(--vscode-editorGroupHeader-tabsBackground);
            padding: 16px 20px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .header h1 {
            font-size: 1.3em;
            margin: 0 0 6px 0;
        }
        .template-name {
            color: var(--vscode-descriptionForeground);
            font-size: 0.85em;
        }
        .tabs {
            display: flex;
            background: var(--vscode-editorGroupHeader-tabsBackground);
            border-bottom: 1px solid var(--vscode-panel-border);
            padding: 0 20px;
        }
        .tab {
            padding: 10px 20px;
            cursor: pointer;
            border-bottom: 2px solid transparent;
            color: var(--vscode-foreground);
            opacity: 0.7;
            user-select: none;
            background: transparent;
        }
        .tab:hover {
            opacity: 1;
            background: var(--vscode-list-hoverBackground);
        }
        .tab.active {
            opacity: 1;
            border-bottom-color: var(--vscode-focusBorder);
        }
        .source-select {
            background: var(--vscode-dropdown-background) !important;
            color: var(--vscode-dropdown-foreground) !important;
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 3px;
            padding: 4px 8px;
            font-size: 11px;
            font-family: var(--vscode-font-family);
            cursor: pointer;
            margin-right: 8px;
            min-width: 80px;
            outline: none;
            color-scheme: dark;
        }
        .source-select:hover {
            background: var(--vscode-dropdown-listBackground);
        }
        .source-select:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }
        .source-select option {
            background-color: var(--vscode-dropdown-listBackground) !important;
            color: var(--vscode-dropdown-foreground) !important;
        }
        select option {
            background-color: var(--vscode-dropdown-listBackground) !important;
            color: var(--vscode-dropdown-foreground) !important;
        }
        .tab-content {
            display: none;
            padding: 20px;
            max-height: calc(100vh - 140px);
            overflow-y: auto;
        }
        .tab-content.active {
            display: block;
        }
        .toolbar {
            margin-bottom: 16px;
            padding: 12px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
        }
        .context-item {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            margin-bottom: 12px;
            padding: 12px;
        }
        .item-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }
        .item-name {
            font-family: 'Consolas', monospace;
            font-weight: 600;
            font-size: 1.05em;
        }
        .item-controls {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .item-controls .delete {
            flex-shrink: 0;
        }
        .value-display {
            font-family: 'Consolas', monospace;
            padding: 8px;
            background: var(--vscode-textCodeBlock-background);
            border-radius: 4px;
            margin-top: 8px;
            font-size: 0.9em;
        }
        .value-display.readonly {
            opacity: 0.7;
            font-style: italic;
        }
        input, textarea {
            width: 100%;
            padding: 6px 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            font-family: 'Consolas', monospace;
            font-size: 0.9em;
        }
        textarea {
            min-height: 80px;
            resize: vertical;
        }
        button {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 6px;
            cursor: pointer;
            border-radius: 3px;
            margin-right: 4px;
            font-size: 16px;
            font-family: var(--vscode-font-family);
            line-height: 16px;
            text-align: center;
            outline-offset: 2px !important;
            width: 28px;
            height: 28px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }
        button:hover:not(:disabled) {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        button:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: 2px;
        }
        button:active {
            background: var(--vscode-list-activeSelectionBackground);
        }
        button:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }
        button.primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-color: transparent;
        }
        button.primary:hover:not(:disabled) {
            background: var(--vscode-button-hoverBackground);
        }
        button.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--vscode-button-border, transparent);
        }
        button.secondary:hover:not(:disabled) {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .toolbar button {
            width: auto;
            padding: 4px 12px;
        }
        .empty-state {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }
        .config-section {
            background: var(--vscode-editor-background);
            padding: 16px 20px;
            margin: 12px 0;
            border-radius: 4px;
            border: 1px solid var(--vscode-panel-border);
        }
        .config-section h3 {
            margin: 0 0 12px 0;
            font-size: 1.1em;
            color: var(--vscode-foreground);
        }
        .form-field {
            margin-bottom: 12px;
        }
        .form-field label {
            display: block;
            margin-bottom: 4px;
            font-weight: 500;
            color: var(--vscode-foreground);
        }
        .form-field input[type="text"],
        .form-field textarea {
            width: 100%;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 6px 8px;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            border-radius: 3px;
        }
        .form-field input[type="text"]:focus,
        .form-field textarea:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        .info-banner {
            padding: 8px 12px;
            background: var(--vscode-textBlockQuote-background);
            border-left: 3px solid var(--vscode-textLink-foreground);
            margin-bottom: 12px;
            font-family: var(--vscode-font-family);
        }
        .info-banner code {
            background: var(--vscode-textCodeBlock-background);
            padding: 2px 6px;
            border-radius: 3px;
            font-family: 'Consolas', monospace;
        }
        .warning-banner {
            padding: 8px 12px;
            background: var(--vscode-inputValidation-warningBackground);
            border-left: 3px solid var(--vscode-inputValidation-warningBorder);
            margin-bottom: 12px;
            color: var(--vscode-inputValidation-warningForeground);
        }
        .nested-item {
            padding-left: 16px;
            border-left: 3px solid var(--vscode-textLink-foreground);
            margin: 12px 0;
        }
        .nested-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }
        .nested-name {
            font-family: 'Consolas', monospace;
            font-weight: 600;
        }
        .dev-tools-fab {
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 48px;
            height: 48px;
            border-radius: 50%;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            z-index: 1000;
        }
        .dev-tools-fab:hover {
            background: var(--vscode-button-hoverBackground);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
        }
    </style>
</head>
<body>
    <button class="dev-tools-fab" onclick="openDevTools()" title="Open Developer Tools">🔧</button>
    
    <div class="header">
        <h1>🔧 Velocity Context Manager</h1>
        <div class="template-name">Template: ${this.escapeHtml(templateName)}</div>
    </div>
    
    <div class="tabs">
        <div class="tab" onclick="switchTab('global')">Global Context</div>
        <div class="tab active" onclick="switchTab('template')">Template Context</div>
    </div>
    
    <div id="template-tab" class="tab-content active">
        ${this.generateTemplateTabHtml(items, contextData)}
    </div>
    
    <div id="global-tab" class="tab-content">
        <div class="toolbar">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                <div><strong>Global Context File:</strong> ${this.escapeHtml(globalFileInfo)}</div>
                <button class="secondary" onclick="loadGlobalContext()" title="Load Global Context File">📂</button>
            </div>
        </div>
        ${this.generateGlobalTabHtml()}
    </div>
    
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        
        function switchTab(tab) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            
            if (tab === 'template') {
                document.querySelectorAll('.tab')[1].classList.add('active');
                document.getElementById('template-tab').classList.add('active');
            } else {
                document.querySelectorAll('.tab')[0].classList.add('active');
                document.getElementById('global-tab').classList.add('active');
            }
        }
        
        function loadGlobalContext() {
            vscode.postMessage({ command: 'loadGlobalContext' });
        }
        
        function saveGlobalContextAs() {
            vscode.postMessage({ command: 'saveGlobalContextAs' });
        }
        
        function promoteToGlobal(itemType, name, objectName, propertyName, methodName) {
            vscode.postMessage({
                command: 'promoteToGlobal',
                itemType,
                name,
                objectName,
                propertyName,
                methodName
            });
        }
        
        function saveValue(name, objectName, propertyName) {
            const inputId = objectName ? 'input-' + objectName + '-' + propertyName : 'input-' + name;
            const input = document.getElementById(inputId);
            if (!input) return;
            
            let value = input.value;
            try {
                value = JSON.parse(value);
            } catch (e) {
                // Keep as string if not valid JSON
            }
            
            if (objectName) {
                vscode.postMessage({ command: 'saveProperty', objectName, propertyName, value });
            } else {
                vscode.postMessage({ command: 'saveVariable', name, value });
            }
        }
        
        function saveMethod(objectName, methodName) {
            const textarea = document.getElementById('method-' + objectName + '-' + methodName);
            if (!textarea) return;
            
            vscode.postMessage({
                command: 'saveMethod',
                objectName,
                methodName,
                implementation: textarea.value
            });
        }
        
        function saveGlobalValue(name, objectName, propertyName) {
            const inputId = objectName ? 'ginput-' + objectName + '-' + propertyName : 'ginput-' + name;
            const input = document.getElementById(inputId);
            if (!input) return;
            
            let value = input.value;
            try {
                value = JSON.parse(value);
            } catch (e) {
                // Keep as string
            }
            
            if (objectName) {
                vscode.postMessage({ command: 'saveGlobalProperty', objectName, propertyName, value });
            } else {
                vscode.postMessage({ command: 'saveGlobalVariable', name, value });
            }
        }
        
        function saveGlobalMethod(objectName, methodName) {
            const textarea = document.getElementById('gmethod-' + objectName + '-' + methodName);
            if (!textarea) return;
            
            vscode.postMessage({
                command: 'saveGlobalMethod',
                objectName,
                methodName,
                implementation: textarea.value
            });
        }
        
        function saveTemplateUrl() {
            const url = document.getElementById('template-url').value;
            vscode.postMessage({
                command: 'saveTemplateUrl',
                url
            });
        }
        
        function saveTemplateHeaders() {
            const headers = document.getElementById('template-headers').value;
            vscode.postMessage({
                command: 'saveTemplateHeaders',
                headers
            });
        }
        
        function saveHttpServletRequestVar() {
            const select = document.getElementById('servlet-var-select');
            const variable = select ? select.value : '';
            vscode.postMessage({
                command: 'saveHttpServletRequestVar',
                variable
            });
        }
        
        function clearHttpServletRequestVar() {
            vscode.postMessage({
                command: 'clearHttpServletRequestVar'
            });
        }
        
        function addVariableToConfig() {
            const select = document.getElementById('add-variable-select');
            if (!select || !select.value) return;
            
            const [name, type] = select.value.split(':');
            vscode.postMessage({
                command: 'addVariableToConfig',
                name: name,
                type: type
            });
            select.value = ''; // Reset dropdown
        }
        
        function openDevTools() {
            vscode.postMessage({
                command: 'openDevTools'
            });
        }
        
        function saveGlobalHeaders() {
            const headers = document.getElementById('global-headers').value;
            vscode.postMessage({
                command: 'saveGlobalHeaders',
                headers
            });
        }
        
        function deleteItem(itemType, name, objectName, propertyName, methodName) {
            const message = itemType === 'variable' 
                ? \`Delete variable $\${name}?\`
                : itemType === 'property'
                ? \`Delete property $\${objectName}.\${propertyName}?\`
                : \`Delete method $\${objectName}.\${methodName}()?\`;
            
            vscode.postMessage({
                command: 'requestDeleteConfirm',
                message,
                type: itemType,
                name,
                objectName,
                propertyName,
                methodName
            });
        }
        
        function setVariableSource(name, source) {
            vscode.postMessage({
                command: 'setVariableSource',
                name,
                source
            });
        }
        
        function setPropertySource(objectName, propertyName, source) {
            vscode.postMessage({
                command: 'setPropertySource',
                objectName,
                propertyName,
                source
            });
        }
        
        function setMethodSource(objectName, methodName, source) {
            vscode.postMessage({
                command: 'setMethodSource',
                objectName,
                methodName,
                source
            });
        }
    </script>
</body>
</html>`;
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
        
        let templateData: ContextFileData = { context: {} };
        const contextFilePath = this.getContextFilePath(fullPath);
        console.log('[HttpServletRequest Mapping] contextFilePath:', contextFilePath);
        
        if (fs.existsSync(contextFilePath)) {
            try {
                const content = fs.readFileSync(contextFilePath, 'utf8');
                const parsed = JSON.parse(content);
                templateData = parsed.context !== undefined ? parsed : { context: parsed };
            } catch (e) {
                console.error('Error loading template data:', e);
            }
        }
        
        console.log('[HttpServletRequest Mapping] Template data:', templateData);
        console.log('[HttpServletRequest Mapping] Manual var:', templateData.httpServletRequestVar);
        
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
        
        // HttpServletRequest interface methods (and parent interfaces)
        const httpServletRequestMethods = new Set([
            'getParameter', 'getParameterValues', 'getParameterMap', 'getParameterNames',
            'getHeader', 'getHeaderNames', 'getHeaders', 'getIntHeader', 'getDateHeader',
            'getQueryString', 'getRequestURI', 'getRequestURL', 'getContextPath',
            'getServletPath', 'getPathInfo', 'getMethod', 'getProtocol',
            'getRemoteAddr', 'getRemoteHost', 'getRemotePort', 'getLocalAddr',
            'getContentType', 'getContentLength', 'getCharacterEncoding',
            'getAttribute', 'getAttributeNames', 'setAttribute', 'removeAttribute',
            'getSession', 'getCookies', 'getAuthType', 'getRemoteUser'
        ]);
        
        // Get objects with methods, prioritize those matching HttpServletRequest interface
        const availableObjects = items
            .filter(item => item.type === 'object' && item.methods && item.methods.size > 0)
            .map(item => {
                const methodNames = Array.from(item.methods.keys());
                const matchCount = methodNames.filter(m => httpServletRequestMethods.has(m)).length;
                return { name: item.name, matchCount, methodNames };
            })
            .sort((a, b) => b.matchCount - a.matchCount); // Sort by relevance
        
        const availableVars = availableObjects.map(obj => obj.name);
        
        let html = `
            <div class="config-section">
                <h3>HttpServletRequest Configuration</h3>
                ${effectiveVar ? 
                    `<div class="info-banner" style="display: flex; justify-content: space-between; align-items: center;">
                        <span>Object mapped to: <code>$${effectiveVar}</code>${httpServletVar ? ' (auto-detected)' : ' (manually selected)'}</span>
                        <button class="delete" onclick="clearHttpServletRequestVar()" title="Clear mapping" style="margin: 0;">✕</button>
                    </div>` : 
                    `<div class="warning-banner">No HttpServletRequest variable detected in template</div>`
                }
                ${!effectiveVar && availableVars.length > 0 ? `
                    <div class="form-field">
                        <label for="servlet-var-select">Map Variable to Request:</label>
                        <select id="servlet-var-select" class="source-select" onchange="saveHttpServletRequestVar()" style="width: auto; min-width: 150px;">
                            <option value="">-- Select Variable --</option>
                            ${availableVars.map(v => `<option value="${this.escapeHtml(v)}">$${this.escapeHtml(v)}</option>`).join('')}
                        </select>
                    </div>
                ` : ''}
                <div class="form-field">
                    <label for="template-url">URL:</label>
                    <input type="text" id="template-url" value="${this.escapeHtml(templateData.url || '')}" 
                           onblur="saveTemplateUrl()" placeholder="https://example.com/path?param=value" />
                </div>
                <div class="form-field">
                    <label for="template-headers">Headers (Name: Value per line):</label>
                    <textarea id="template-headers" onblur="saveTemplateHeaders()" rows="4"
                              placeholder="Content-Type: application/json&#10;Authorization: Bearer token&#10;X-Custom-Header: value">${this.escapeHtml(templateData.headers || '')}</textarea>
                </div>
            </div>
        `;
        
        // Filter out the HttpServletRequest variable from items if it's manually mapped
        const filteredItems = items.filter(item => item.name !== manualVar);
        
        // Separate configured and unconfigured items
        const configuredItems = filteredItems.filter(item => {
            if (item.type === 'variable') {
                return contextData[item.name] !== undefined || this.globalContext.data[item.name] !== undefined;
            } else {
                // For objects, check if any property or method is configured
                const objData = contextData[item.name];
                const globalObjData = this.globalContext.data[item.name];
                return (objData && Object.keys(objData).length > 0) || (globalObjData && Object.keys(globalObjData).length > 0);
            }
        });
        
        const unconfiguredItems = filteredItems.filter(item => {
            if (item.type === 'variable') {
                return contextData[item.name] === undefined && this.globalContext.data[item.name] === undefined;
            } else {
                const objData = contextData[item.name];
                const globalObjData = this.globalContext.data[item.name];
                return (!objData || Object.keys(objData).length === 0) && (!globalObjData || Object.keys(globalObjData).length === 0);
            }
        });
        
        // Add dropdown for unconfigured items
        if (unconfiguredItems.length > 0) {
            html += `
                <div class="toolbar" style="margin-bottom: 16px;">
                    <label for="add-variable-select">Add Variable to Configure:</label>
                    <select id="add-variable-select" class="source-select" onchange="addVariableToConfig()" style="width: auto; min-width: 200px; margin-left: 8px;">
                        <option value="">-- Select Variable --</option>
                        ${unconfiguredItems.map(item => {
                            const typeLabel = item.type === 'variable' ? 'variable' : 'object';
                            return `<option value="${this.escapeHtml(item.name)}:${item.type}">$${this.escapeHtml(item.name)} (${typeLabel})</option>`;
                        }).join('')}
                    </select>
                </div>
            `;
        }
        
        if (configuredItems.length === 0) {
            html += '<div class="empty-state">No configured variables. Select a variable from the dropdown above to configure it.</div>';
            return html;
        }
        
        html += configuredItems.map(item => {
            if (item.type === 'variable') {
                return this.generateTemplateVariableHtml(item, contextData);
            } else {
                return this.generateTemplateObjectHtml(item, contextData);
            }
        }).join('');
        
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
        const globalValue = this.globalContext.data[item.name];
        const hasGlobalValue = globalValue !== undefined;
        
        // If has local value, source is template
        // If no local but has global, source is global
        // If neither, default to template (needs configuration)
        const source = hasLocalValue ? 'template' : (hasGlobalValue ? 'global' : 'template');
        const displayValue = hasLocalValue ? contextData[item.name] : globalValue;
        const valueStr = displayValue !== undefined 
            ? (typeof displayValue === 'string' ? displayValue : JSON.stringify(displayValue))
            : '';
        
        return `
            <div class="context-item">
                <div class="item-header">
                    <div class="item-name">\$${this.escapeHtml(item.name)}</div>
                    <div class="item-controls">
                        <select class="source-select" onchange="setVariableSource('${this.escapeJs(item.name)}', this.value)">
                            <option value="template" ${source === 'template' ? 'selected' : ''}>Template</option>
                            <option value="global" ${source === 'global' ? 'selected' : ''}>Global</option>
                        </select>
                        <button class="delete" onclick="deleteItem('variable', '${this.escapeJs(item.name)}', '', '', '')" title="Delete">🗑</button>
                    </div>
                </div>
                ${source === 'template' || !hasGlobalValue ? `
                    <input id="input-${this.escapeHtml(item.name)}" value="${this.escapeHtml(valueStr)}" placeholder="Enter value (JSON format)" onblur="saveValue('${this.escapeJs(item.name)}', '', '')" />
                ` : `
                    <div class="value-display readonly">${this.escapeHtml(valueStr)}</div>
                `}
            </div>
        `;
    }
    
    private generateTemplateObjectHtml(item: ContextItem, contextData: ContextData): string {
        const objectData = contextData[item.name] || {};
        const globalData = this.globalContext.data[item.name] || {};
        
        let html = `<div class="context-item"><div class="item-header"><div class="item-name">\$${this.escapeHtml(item.name)}</div></div>`;
        
        // Properties
        if (item.properties && item.properties.size > 0) {
            item.properties.forEach((propData, propName) => {
                const hasLocal = objectData[propName] !== undefined;
                const globalVal = globalData[propName];
                const hasGlobal = globalVal !== undefined;
                const source = hasLocal ? 'template' : (hasGlobal ? 'global' : 'template');
                const val = hasLocal ? objectData[propName] : globalVal;
                const valStr = val !== undefined 
                    ? (typeof val === 'string' ? val : JSON.stringify(val))
                    : '';
                
                html += `
                    <div class="nested-item">
                        <div class="nested-header">
                            <div class="nested-name">.${this.escapeHtml(propName)}</div>
                            <div class="item-controls">
                                <select class="source-select" onchange="setPropertySource('${this.escapeJs(item.name)}', '${this.escapeJs(propName)}', this.value)">
                                    <option value="template" ${source === 'template' ? 'selected' : ''}>Template</option>
                                    <option value="global" ${source === 'global' ? 'selected' : ''}>Global</option>
                                </select>
                                <button class="delete" onclick="deleteItem('property', '', '${this.escapeJs(item.name)}', '${this.escapeJs(propName)}', '')" title="Delete">🗑</button>
                            </div>
                        </div>
                        ${source === 'template' || !hasGlobal ? `
                            <input id="input-${this.escapeHtml(item.name)}-${this.escapeHtml(propName)}" value="${this.escapeHtml(valStr)}" placeholder="Enter value" onblur="saveValue('', '${this.escapeJs(item.name)}', '${this.escapeJs(propName)}')" />
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
                const globalMethod = globalData[methodName];
                const hasGlobal = globalMethod && globalMethod._implementation;
                const source = hasLocal ? 'template' : (hasGlobal ? 'global' : 'template');
                const impl = hasLocal ? localMethod._implementation : (hasGlobal ? globalMethod._implementation : '');
                
                html += `
                    <div class="nested-item">
                        <div class="nested-header">
                            <div class="nested-name">.${this.escapeHtml(methodName)}()</div>
                            <div class="item-controls">
                                <select class="source-select" onchange="setMethodSource('${this.escapeJs(item.name)}', '${this.escapeJs(methodName)}', this.value)">
                                    <option value="template" ${source === 'template' ? 'selected' : ''}>Template</option>
                                    <option value="global" ${source === 'global' ? 'selected' : ''}>Global</option>
                                </select>
                                <button class="delete" onclick="deleteItem('method', '', '${this.escapeJs(item.name)}', '', '${this.escapeJs(methodName)}')" title="Delete">🗑</button>
                            </div>
                        </div>
                        ${source === 'template' || !hasGlobal ? `
                            <textarea id="method-${this.escapeHtml(item.name)}-${this.escapeHtml(methodName)}" placeholder="Enter implementation (use args[0], args[1], etc.)" onblur="saveMethod('${this.escapeJs(item.name)}', '${this.escapeJs(methodName)}')">${this.escapeHtml(impl)}</textarea>
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
    
    private generateGlobalTabHtml(): string {
        const data = this.globalContext.data;
        const hasData = Object.keys(data).length > 0;
        
        // Always show headers configuration
        let html = `
            <div class="config-section">
                <h3>Global Headers Configuration</h3>
                <div class="info-banner">These headers will be merged with template-specific headers. Template headers take priority.</div>
                <div class="form-field">
                    <label for="global-headers">Headers (Name: Value per line):</label>
                    <textarea id="global-headers" onblur="saveGlobalHeaders()" rows="4"
                              placeholder="Content-Type: application/json&#10;Authorization: Bearer token&#10;X-Custom-Header: value">${this.escapeHtml(this.globalContext.headers || '')}</textarea>
                </div>
            </div>
        `;
        
        if (!hasData) {
            const fileInfo = this.globalContext.filePath 
                ? `Global context file: ${path.basename(this.globalContext.filePath)}`
                : 'No file created yet. File will be created when you save global items.';
            html += `<div class="empty-state">
                <p>${fileInfo}</p>
                <p>Use "⬆️ Global" buttons in Template Context tab to promote items to global context.</p>
            </div>`;
            return html;
        }
        
        html += Object.keys(data).sort().map(key => {
            const value = data[key];
            
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                // Object with properties/methods
                let html = `<div class="context-item"><div class="item-header"><div class="item-name">\$${this.escapeHtml(key)}</div></div>`;
                
                Object.keys(value).sort().forEach(subKey => {
                    const subValue = value[subKey];
                    const isMethod = subValue && typeof subValue === 'object' && subValue._implementation;
                    
                    if (isMethod) {
                        html += `
                            <div class="nested-item">
                                <div class="nested-name">.${this.escapeHtml(subKey)}()</div>
                                <textarea id="gmethod-${this.escapeHtml(key)}-${this.escapeHtml(subKey)}" onblur="saveGlobalMethod('${this.escapeJs(key)}', '${this.escapeJs(subKey)}')">${this.escapeHtml(subValue._implementation)}</textarea>
                            </div>
                        `;
                    } else {
                        const valStr = typeof subValue === 'string' ? subValue : JSON.stringify(subValue);
                        html += `
                            <div class="nested-item">
                                <div class="nested-name">.${this.escapeHtml(subKey)}</div>
                                <input id="ginput-${this.escapeHtml(key)}-${this.escapeHtml(subKey)}" value="${this.escapeHtml(valStr)}" onblur="saveGlobalValue('', '${this.escapeJs(key)}', '${this.escapeJs(subKey)}')" />
                            </div>
                        `;
                    }
                });
                
                html += `</div>`;
                return html;
            } else {
                // Simple variable
                const valStr = typeof value === 'string' ? value : JSON.stringify(value);
                return `
                    <div class="context-item">
                        <div class="item-header"><div class="item-name">\$${this.escapeHtml(key)}</div></div>
                        <input id="ginput-${this.escapeHtml(key)}" value="${this.escapeHtml(valStr)}" onblur="saveGlobalValue('${this.escapeJs(key)}', '', '')" />
                    </div>
                `;
            }
        }).join('');
        
        return html;
    }

    private getContextFilePath(templatePath: string): string {
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

    private escapeJs(text: string): string {
        return text.replace(/\\/g, '\\\\')
                   .replace(/'/g, "\\'")
                   .replace(/"/g, '\\"')
                   .replace(/\n/g, '\\n')
                   .replace(/\r/g, '\\r');
    }
}

