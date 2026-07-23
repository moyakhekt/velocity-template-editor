import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { ContextManager } from './context/contextManager';
import { VelocityServerClient } from './server/velocityServerClient';
import { ScenariosData } from './shared/types';

export class VelocityPreviewProvider {
    private context: vscode.ExtensionContext;
    private contextManager: ContextManager;
    private refreshTimeout: ReturnType<typeof setTimeout> | undefined;
    private velocityServer: VelocityServerClient | undefined;
    previewFilePath: string | undefined;
    private previewServer: http.Server | undefined;
    private serverPort: number = 0;
    private templateDir: string | undefined;
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
        this.templateDir = path.dirname(templatePath);

        // Set active template in context manager before rendering
        this.contextManager.templateFilePath = templatePath;

        // Start HTTP server first if not already running
        const tempDir = this.context.globalStorageUri.fsPath;
        await fs.promises.mkdir(tempDir, { recursive: true });
        
        if (!this.previewServer) {
            await this.startPreviewServer(tempDir);
        }

        // Now render the template with the correct port
        const { mainHtml, contentHtml } = await this.renderTemplate(editor.document);
        
        // Write the rendered content
        const contentFilePath = path.join(tempDir, 'velocity-preview-content.html');
        await fs.promises.writeFile(contentFilePath, contentHtml, 'utf-8');
        
        // Write the main preview with iframe
        this.previewFilePath = path.join(tempDir, 'velocity-preview.html');
        await fs.promises.writeFile(this.previewFilePath, mainHtml, 'utf-8');
        
        // Open in default browser (more reliable than Simple Browser)
        const url = `http://localhost:${this.serverPort}/velocity-preview.html`;
        await vscode.env.openExternal(vscode.Uri.parse(url));
    }

    refresh(document: vscode.TextDocument): void {
        const config = vscode.workspace.getConfiguration('velocity.preview');
        const autoRefresh = config.get<boolean>('autoRefresh', true);
        
        if (!autoRefresh) {
            return;
        }

        const delay = config.get<number>('refreshDelay', 500);

        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
        }

        this.refreshTimeout = setTimeout(async () => {
            await this.updatePreviewFile(document);
        }, delay);
    }

    setActiveTemplate(templatePath: string): void {
        // If preview is open, re-render with the new template
        if (this.previewFilePath) {
            const doc = vscode.workspace.textDocuments.find(
                d => d.uri.fsPath === templatePath || d.uri.fsPath.toLowerCase() === templatePath.toLowerCase()
            );
            if (doc) {
                this.refresh(doc);
            }
        }
    }

    private async updatePreviewFile(document: vscode.TextDocument): Promise<void> {
        if (!this.previewFilePath) {
            return;
        }

        const { mainHtml, contentHtml } = await this.renderTemplate(document);
        
        // Update both files
        const contentFilePath = this.previewFilePath.replace('velocity-preview.html', 'velocity-preview-content.html');
        await fs.promises.writeFile(contentFilePath, contentHtml, 'utf-8');
        await fs.promises.writeFile(this.previewFilePath, mainHtml, 'utf-8');
    }

    private async renderTemplate(document: vscode.TextDocument): Promise<{ mainHtml: string, contentHtml: string }> {
        const templatePath = document.uri.fsPath;
        const templateContent = document.getText();
        
        // Get scenarioInfo for UI wrapper (NOT for template rendering)
        const scenarioInfo = await this.contextManager.getScenarioInfo(templatePath);
        
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
                    // If there are non-method properties, keep the object in variables too
                    if (variables[key] && Object.keys(variables[key]).length > 0) {
                        // Keep both
                    } else {
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
            return this.wrapInHtmlDocument(rendered, false, templatePath, scenarioInfo);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return this.wrapInHtmlDocument(errorMessage, true, templatePath, scenarioInfo);
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

    private wrapInHtmlDocument(content: string, isError: boolean, templatePath?: string, scenarioInfo?: { scenarios: ScenariosData, activeScenario: string }): { mainHtml: string, contentHtml: string } {
        const cspMetaTag = this.buildCspMetaTag();
        
        const mainStyles = `
            body {
                margin: 0;
                padding: 0;
                font-family: var(--vscode-font-family);
                background-color: var(--vscode-editor-background);
                overflow: hidden;
                width: 100%;
                height: 100vh;
                position: relative;
            }
            .scenario-toolbar {
                position: fixed;
                bottom: 16px;
                left: 16px;
                background-color: var(--vscode-editorWidget-background, var(--vscode-editor-widget-background, #2d2d2d));
                border: 1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border, #454545));
                border-radius: 12px;
                padding: 8px 12px;
                display: flex;
                align-items: center;
                gap: 10px;
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5), 0 1px 4px rgba(0, 0, 0, 0.4);
                z-index: 1000;
            }
            .velocity-logo {
                width: 32px;
                height: 32px;
                flex-shrink: 0;
                animation: pulse 2s ease-in-out infinite;
            }
            @keyframes pulse {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.05); }
            }
            .scenario-toolbar select {
                background-color: var(--vscode-dropdown-background, #3c3c3c);
                color: var(--vscode-dropdown-foreground, #cccccc);
                border: 1px solid var(--vscode-dropdown-border, var(--vscode-contrastBorder, #6b6b6b));
                border-radius: 6px;
                padding: 4px 8px;
                font-family: var(--vscode-font-family);
                font-size: var(--vscode-font-size);
                cursor: pointer;
                outline: none;
                min-width: 150px;
            }
            .scenario-toolbar select:focus {
                border-color: var(--vscode-focusBorder, #007fd4);
                outline: 1px solid var(--vscode-focusBorder, #007fd4);
            }
            .scenario-toolbar select:hover {
                border-color: var(--vscode-dropdown-border, var(--vscode-contrastBorder, #a0a0a0));
                filter: brightness(1.1);
            }
            .preview-frame {
                width: 100%;
                height: 100vh;
                border: none;
                display: block;
                position: absolute;
                top: 0;
                left: 0;
            }
        `;

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
            
            const contentHtml = `
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
                    <div class="error">${this.escapeHtml(content)}</div>
                </body>
                </html>
            `;

            const mainHtml = `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Velocity Preview Error</title>
                    <style>${mainStyles}</style>
                </head>
                <body>
                    <iframe src="velocity-preview-content.html" class="preview-frame"></iframe>
                </body>
                </html>
            `;

            return { mainHtml, contentHtml };
        }

        // Check if content is already a full HTML document
        const isFullHtml = /^\s*<!DOCTYPE/i.test(content) || /^\s*<html/i.test(content);
        
        // Only add base tag if template doesn't already have one
        const hasBaseTag = /<base\s+href=/i.test(content);
        const baseTag = (templatePath && !hasBaseTag) ? `<base href="http://localhost:${this.serverPort}/${path.relative(this.templateDir || '', path.dirname(templatePath)).replace(/\\/g, '/')}/">` : '';
        
        // JavaScript to intercept navigation and forms
        const interceptScript = this.getInterceptScript();
        
        let contentHtml: string;
        if (isFullHtml) {
            // Insert CSP meta tag and base tag after <head> if template is full HTML
            let htmlWithTags = content;
            
            // Insert CSP before any other meta tags
            if (cspMetaTag) {
                htmlWithTags = htmlWithTags.replace(/(<head[^>]*>)/i, `$1\n    ${cspMetaTag}`);
            }
            
            // Insert base tag if needed
            if (baseTag && !hasBaseTag) {
                htmlWithTags = htmlWithTags.replace(/(<head[^>]*>)/i, `$1\n    ${baseTag}`);
            }
            
            // Inject intercept script IMMEDIATELY after opening <body> tag for early execution
            htmlWithTags = htmlWithTags.replace(/(<body[^>]*>)/i, `$1\n${interceptScript}`);
            
            contentHtml = htmlWithTags;
        } else {
            contentHtml = `
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

        const mainHtml = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Velocity Preview</title>
                <style>${mainStyles}</style>
                <script>
                    function switchScenario() {
                        const select = document.getElementById('scenario-select');
                        if (select && select.value) {
                            // Reload the main page with scenario parameter
                            const url = new URL(window.location.href);
                            url.searchParams.set('scenario', select.value);
                            window.location.href = url.toString();
                        }
                    }
                    
                    // Auto-reload iframe when content changes
                    let lastModified = '';
                    setInterval(async () => {
                        try {
                            const response = await fetch('/velocity-preview-content.html?_=' + Date.now(), { method: 'HEAD', cache: 'no-store' });
                            const modified = response.headers.get('last-modified') || '';
                            if (modified && modified !== lastModified) {
                                if (lastModified !== '') { // Don't reload on first check
                                    const iframe = document.querySelector('.preview-frame');
                                    if (iframe) {
                                        iframe.src = '/velocity-preview-content.html?_=' + Date.now();
                                    }
                                }
                                lastModified = modified;
                            }
                        } catch (e) {
                            // Ignore errors
                        }
                    }, 500);
                </script>
            </head>
            <body>
                ${scenarioInfo ? `
                <div class="scenario-toolbar">
                    <svg class="velocity-logo" viewBox="0 0 200 118" xmlns="http://www.w3.org/2000/svg" style="color: var(--vscode-icon-foreground, var(--vscode-foreground, #cccccc))">
                        <!-- V: left arm -->
                        <polygon points="0,0 28,0 72,118 44,118" fill="currentColor"/>
                        <!-- V: right arm -->
                        <polygon points="44,118 72,118 100,0 72,0" fill="currentColor"/>
                        <!-- E: spine -->
                        <rect x="110" y="0" width="16" height="118" fill="currentColor"/>
                        <!-- E: top bar -->
                        <rect x="126" y="0"  width="64" height="28" fill="currentColor"/>
                        <!-- E: middle bar (shorter) -->
                        <rect x="126" y="47" width="48" height="24" fill="currentColor"/>
                        <!-- E: bottom bar -->
                        <rect x="126" y="90" width="64" height="28" fill="currentColor"/>
                    </svg>
                    <select id="scenario-select" onchange="switchScenario()">
                        ${Object.keys(scenarioInfo.scenarios).map(name => 
                            `<option value="${this.escapeHtml(name)}" ${name === scenarioInfo.activeScenario ? 'selected' : ''}>
                                ${name === 'Default' ? '✓ ' : ''}${this.escapeHtml(name)}
                            </option>`
                        ).join('')}
                    </select>
                </div>
                ` : ''}
                <iframe src="velocity-preview-content.html" class="preview-frame"></iframe>
            </body>
            </html>
        `;

        return { mainHtml, contentHtml };
    }

    private async startPreviewServer(tempDir: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.previewServer = http.createServer(async (req, res) => {
                let filePath: string;
                
                // Parse URL and query parameters
                const url = new URL(req.url || '', `http://localhost:${this.serverPort}`);
                const pathname = url.pathname;
                const scenarioParam = url.searchParams.get('scenario');
                
                // Handle scenario switching via query parameter
                if (scenarioParam && pathname === '/velocity-preview.html') {
                    const editor = vscode.window.activeTextEditor;
                    if (editor && editor.document.languageId === 'velocity') {
                        const templatePath = editor.document.uri.fsPath;
                        
                        // Switch to the requested scenario
                        await this.contextManager.switchScenario(templatePath, scenarioParam);
                        
                        // Re-render the template with the new active scenario
                        const { mainHtml, contentHtml } = await this.renderTemplate(editor.document);
                        
                        // Update both files
                        const contentFilePath = path.join(tempDir, 'velocity-preview-content.html');
                        await fs.promises.writeFile(contentFilePath, contentHtml, 'utf-8');
                        
                        this.previewFilePath = path.join(tempDir, 'velocity-preview.html');
                        await fs.promises.writeFile(this.previewFilePath, mainHtml, 'utf-8');
                        
                        // Serve the updated main HTML
                        filePath = this.previewFilePath;
                    } else {
                        filePath = path.join(tempDir, 'velocity-preview.html');
                    }
                } else if (pathname === '/' || pathname === '/velocity-preview.html') {
                    filePath = path.join(tempDir, 'velocity-preview.html');
                } else if (pathname === '/velocity-preview-content.html') {
                    filePath = path.join(tempDir, 'velocity-preview-content.html');
                } else {
                    // Serve files relative to template directory
                    const relativePath = pathname.substring(1) || ''; // Remove leading /
                    const decodedPath = decodeURIComponent(relativePath);
                    filePath = path.join(this.templateDir || '', decodedPath);
                    
                    // If file doesn't exist in template dir, try parent directory (for assets)
                    const fileExists = await fs.promises.access(filePath).then(() => true).catch(() => false);
                    if (!fileExists) {
                        const parentDir = path.dirname(this.templateDir || '');
                        const parentPath = path.join(parentDir, decodedPath);
                        const parentExists = await fs.promises.access(parentPath).then(() => true).catch(() => false);
                        if (parentExists) {
                            filePath = parentPath;
                        }
                    }
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
                        res.writeHead(200, { 
                            'Content-Type': contentType,
                            'Access-Control-Allow-Origin': '*',
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
        // Close the HTTP server
        if (this.previewServer) {
            this.previewServer.close();
            this.previewServer = undefined;
        }
        
        // Clear preview file path
        this.previewFilePath = undefined;
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
            
            console.log('[Velocity Preview] Initializing navigation interceptors...');
            
            // CRITICAL: Override HTMLFormElement.prototype.submit to catch programmatic submissions
            // Calling form.submit() bypasses ALL event listeners!
            const originalFormSubmit = HTMLFormElement.prototype.submit;
            HTMLFormElement.prototype.submit = function() {
                console.log('[Velocity Preview] form.submit() intercepted (programmatic)', this);
                
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
            
            // Add styles to document
            const styleEl = document.createElement('style');
            styleEl.textContent = dialogStyles;
            document.head.appendChild(styleEl);
            
            // Show dialog function
            function showDialog(title, icon, sections) {
                console.log('[Velocity Preview] Showing dialog:', title);
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
                    console.log('[Velocity Preview] Closing dialog and reloading...');
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
                console.log('[Velocity Preview] Form submission intercepted', e.target);
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
                console.log('[Velocity Preview] Form submission intercepted (document)', e.target);
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
                        console.log('[Velocity Preview] Link click intercepted:', href);
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
            
            // Intercept window.location.href setter
            let isNavigating = false;
            const originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
            const originalHref = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
            
            if (originalHref && originalHref.set) {
                Object.defineProperty(Location.prototype, 'href', {
                    set: function(url) {
                        if (!isNavigating) {
                            console.log('[Velocity Preview] location.href setter intercepted:', url);
                            showDialog(
                                'Navigation Captured',
                                '🔗',
                                [
                                    { label: 'Target URL', content: escapeHtml(url.toString()) },
                                    { label: 'Method', content: 'JavaScript (location.href)' }
                                ]
                            );
                        } else {
                            originalHref.set.call(this, url);
                        }
                    },
                    get: originalHref.get
                });
            }
            
            // Intercept window.location methods using Object.defineProperty
            // Direct assignment fails in sandboxed contexts (CSP/webview)
            const originalLocationAssign = window.location.assign.bind(window.location);
            const originalLocationReplace = window.location.replace.bind(window.location);
            
            try {
                Object.defineProperty(window.location, 'assign', {
                    value: function(url) {
                        console.log('[Velocity Preview] location.assign intercepted:', url);
                        showDialog(
                            'Navigation Captured',
                            '🔗',
                            [
                                { label: 'Target URL', content: escapeHtml(url.toString()) },
                                { label: 'Method', content: 'JavaScript (location.assign)' }
                            ]
                        );
                    },
                    writable: false,
                    configurable: true
                });
            } catch (e) {
                console.warn('[Velocity Preview] Could not override location.assign:', e);
            }
            
            try {
                Object.defineProperty(window.location, 'replace', {
                    value: function(url) {
                        console.log('[Velocity Preview] location.replace intercepted:', url);
                        showDialog(
                            'Navigation Captured',
                            '🔗',
                            [
                                { label: 'Target URL', content: escapeHtml(url.toString()) },
                                { label: 'Method', content: 'JavaScript (location.replace)' }
                            ]
                        );
                    },
                    writable: false,
                    configurable: true
                });
            } catch (e) {
                console.warn('[Velocity Preview] Could not override location.replace:', e);
            }
            
            // Intercept window.open
            const originalWindowOpen = window.open.bind(window);
            try {
                Object.defineProperty(window, 'open', {
                    value: function(url, target, features) {
                        if (url) {
                            console.log('[Velocity Preview] window.open intercepted:', url);
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
            
            console.log('[Velocity Preview] Navigation and form submission interceptors active');
        })();
        </script>
        `;
    }
}
