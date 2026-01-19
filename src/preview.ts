import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { ContextManager } from './contextManager';
import { VelocityServerClient } from './velocityServerClient';

export class VelocityPreviewProvider {
    private context: vscode.ExtensionContext;
    private contextManager: ContextManager;
    private refreshTimeout: ReturnType<typeof setTimeout> | undefined;
    private velocityServer: VelocityServerClient | undefined;
    private previewFilePath: string | undefined;
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

        this.templateDir = path.dirname(editor.document.uri.fsPath);

        // Start HTTP server first if not already running
        const tempDir = this.context.globalStorageUri.fsPath;
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        if (!this.previewServer) {
            await this.startPreviewServer(tempDir);
        }

        // Now render the template with the correct port
        const { mainHtml, contentHtml } = await this.renderTemplate(editor.document);
        
        // Write the rendered content
        const contentFilePath = path.join(tempDir, 'velocity-preview-content.html');
        fs.writeFileSync(contentFilePath, contentHtml, 'utf-8');
        
        // Write the main preview with iframe
        this.previewFilePath = path.join(tempDir, 'velocity-preview.html');
        fs.writeFileSync(this.previewFilePath, mainHtml, 'utf-8');
        
        // Open in default browser via HTTP
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

    private async updatePreviewFile(document: vscode.TextDocument): Promise<void> {
        if (!this.previewFilePath) {
            return;
        }

        const { mainHtml, contentHtml } = await this.renderTemplate(document);
        
        // Update both files
        const contentFilePath = this.previewFilePath.replace('velocity-preview.html', 'velocity-preview-content.html');
        fs.writeFileSync(contentFilePath, contentHtml, 'utf-8');
        fs.writeFileSync(this.previewFilePath, mainHtml, 'utf-8');
    }

    private async renderTemplate(document: vscode.TextDocument): Promise<{ mainHtml: string, contentHtml: string }> {
        const templatePath = document.uri.fsPath;
        const templateContent = document.getText();
        
        const contextData = this.contextManager.getContextForTemplate(templatePath);
        
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
            if (!this.velocityServer || !await this.velocityServer.isRunning()) {
                throw new Error('Apache Velocity server is not running. Please check the Output panel for details.');
            }

            const rendered = await this.velocityServer.render(templateContent, variables, mocks);
            return this.wrapInHtmlDocument(rendered, false, templatePath);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return this.wrapInHtmlDocument(errorMessage, true, templatePath);
        }
    }

    private wrapInHtmlDocument(content: string, isError: boolean, templatePath?: string): { mainHtml: string, contentHtml: string } {
        const mainStyles = `
            body {
                margin: 0;
                padding: 0;
                font-family: var(--vscode-font-family);
                background-color: var(--vscode-editor-background);
                overflow: hidden;
            }
            .preview-frame {
                width: 100%;
                height: 100vh;
                border: none;
                display: block;
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
        
        let contentHtml: string;
        if (isFullHtml) {
            // Insert base tag after <head> if template is full HTML and doesn't have one
            contentHtml = baseTag ? content.replace(/(<head[^>]*>)/i, `$1\n    ${baseTag}`) : content;
        } else {
            contentHtml = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                ${baseTag}
                <title>Velocity Template Output</title>
            </head>
            <body>
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
                    // Auto-reload when content changes
                    let lastModified = 0;
                    setInterval(async () => {
                        try {
                            const response = await fetch('/velocity-preview-content.html', { method: 'HEAD' });
                            const modified = response.headers.get('last-modified');
                            if (modified && modified !== lastModified) {
                                if (lastModified !== 0) { // Don't reload on first check
                                    const iframe = document.querySelector('.preview-frame');
                                    if (iframe) {
                                        iframe.contentWindow.location.reload();
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
                <iframe src="velocity-preview-content.html" class="preview-frame"></iframe>
            </body>
            </html>
        `;

        return { mainHtml, contentHtml };
    }

    private async startPreviewServer(tempDir: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.previewServer = http.createServer((req, res) => {
                let filePath: string;
                
                // Handle requests
                if (req.url === '/' || req.url === '/velocity-preview.html') {
                    filePath = path.join(tempDir, 'velocity-preview.html');
                } else if (req.url === '/velocity-preview-content.html') {
                    filePath = path.join(tempDir, 'velocity-preview-content.html');
                } else {
                    // Serve files relative to template directory
                    const relativePath = req.url?.substring(1) || ''; // Remove leading /
                    const decodedPath = decodeURIComponent(relativePath);
                    filePath = path.join(this.templateDir || '', decodedPath);
                    
                    // If file doesn't exist in template dir, try parent directory (for assets)
                    if (!fs.existsSync(filePath)) {
                        const parentDir = path.dirname(this.templateDir || '');
                        const parentPath = path.join(parentDir, decodedPath);
                        if (fs.existsSync(parentPath)) {
                            filePath = parentPath;
                        }
                    }
                }

                // Read and serve the file
                fs.stat(filePath, (statErr, stats) => {
                    if (statErr) {
                        console.error(`[Preview Server] 404: ${req.url} -> ${filePath}`);
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
                            'Cache-Control': 'no-cache'
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
            console.log(`Preview server started on http://localhost:${this.serverPort}`);
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
        if (this.previewServer) {
            this.previewServer.close();
            this.previewServer = undefined;
        }
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}
