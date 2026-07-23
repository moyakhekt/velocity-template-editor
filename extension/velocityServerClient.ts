import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import * as vscode from 'vscode';

export class VelocityServerClient {
    private static instance: VelocityServerClient | undefined;
    private serverProcess: ChildProcess | null = null;
    private readonly port = 9876;
    private readonly jarPath: string;
    private startupPromise: Promise<void> | null = null;
    private isShuttingDown = false;
    private outputChannel: vscode.OutputChannel;

    private constructor(extensionPath: string, outputChannel: vscode.OutputChannel) {
        this.jarPath = path.join(extensionPath, 'server', 'target', 'velocity-server-1.0.0.jar');
        this.outputChannel = outputChannel;
    }

    public static getInstance(extensionPath: string, outputChannel: vscode.OutputChannel): VelocityServerClient {
        if (!VelocityServerClient.instance) {
            VelocityServerClient.instance = new VelocityServerClient(extensionPath, outputChannel);
        }
        return VelocityServerClient.instance;
    }

    public async start(): Promise<void> {
        // Return existing startup promise if already starting
        if (this.startupPromise) {
            return this.startupPromise;
        }

        // Check if JAR exists
        if (!fs.existsSync(this.jarPath)) {
            const message = `Velocity server JAR not found. Build it first:\n\ncd server\nmvn clean package`;
            throw new Error(message);
        }

        // Check if server is already running
        if (await this.isRunning()) {
            return;
        }

        this.startupPromise = new Promise((resolve, reject) => {
            
            // Check for Java
            const javaCmd = process.platform === 'win32' ? 'java.exe' : 'java';
            
            this.serverProcess = spawn(javaCmd, ['-jar', this.jarPath], {
                cwd: path.dirname(this.jarPath),
                stdio: ['ignore', 'pipe', 'pipe']
            });

            let startupOutput = '';

            this.serverProcess.stdout?.on('data', (data) => {
                const message = data.toString();
                startupOutput += message;
                this.outputChannel.appendLine(message.trim());
                
                if (message.includes('started on port')) {
                    this.outputChannel.appendLine('✅ Velocity server started successfully');
                    resolve();
                }
            });

            this.serverProcess.stderr?.on('data', (data) => {
                const message = data.toString();
                this.outputChannel.appendLine('[ERROR] ' + message.trim());
                
                // Check for common errors
                if (message.includes('Address already in use')) {
                    reject(new Error(`Port ${this.port} is already in use. Is another Velocity server running?`));
                }
            });

            this.serverProcess.on('error', (error) => {
                
                if ((error as any).code === 'ENOENT') {
                    reject(new Error('Java not found. Please install Java 11 or higher and ensure it\'s in your PATH.'));
                } else {
                    reject(error);
                }
            });

            this.serverProcess.on('exit', (code, signal) => {
                if (!this.isShuttingDown) {
                }
                this.serverProcess = null;
                this.startupPromise = null;
            });

            // Timeout if server doesn't start
            setTimeout(() => {
                if (!this.serverProcess) {
                    return;
                }
                
                this.isRunning().then(running => {
                    if (!running) {
                        const error = new Error(
                            `Velocity server failed to start within 15 seconds.\n\nOutput:\n${startupOutput}`
                        );
                        reject(error);
                        this.stop();
                    }
                });
            }, 15000);
        });

        return this.startupPromise;
    }

    public async isRunning(): Promise<boolean> {
        return new Promise((resolve) => {
            const req = http.get(`http://localhost:${this.port}/health`, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const health = JSON.parse(data);
                        resolve(res.statusCode === 200 && health.status === 'ok');
                    } catch {
                        resolve(false);
                    }
                });
            });

            req.on('error', () => {
                resolve(false);
            });

            req.setTimeout(2000, () => {
                req.destroy();
                resolve(false);
            });
        });
    }

    public async render(
        template: string,
        variables: Record<string, any>,
        methods: Record<string, any>,
        messagesPropertiesPaths?: string[],
        language?: string,
        variableMappings?: { localeVar?: string, templateMessagesVar?: string, escapeToolVar?: string }
    ): Promise<string> {
       if (!await this.isRunning()) {
            throw new Error('Velocity server is not running. Please check the Output panel for errors.');
        }

        // Debug: Log HttpServletRequest variables
        this.outputChannel.appendLine('=== Render Request Debug ===');
        this.outputChannel.appendLine(`Variables keys: ${Object.keys(variables).join(', ')}`);
        this.outputChannel.appendLine(`scenarioInfo in variables: ${'scenarioInfo' in variables}`);
        if ('scenarioInfo' in variables) {
            this.outputChannel.appendLine(`scenarioInfo value: ${JSON.stringify(variables.scenarioInfo, null, 2)}`);
        }
        for (const [key, value] of Object.entries(variables)) {
            if (value && typeof value === 'object' && value._httpServletRequest) {
                this.outputChannel.appendLine(`HttpServletRequest variable: ${key}`);
                this.outputChannel.appendLine(`  URL: ${value.url}`);
                this.outputChannel.appendLine(`  Headers: ${value.headers || '(none)'}`);
            }
        }
        this.outputChannel.appendLine('============================');

        return new Promise((resolve, reject) => {
            const postData = JSON.stringify({
                template,
                variables: variables || {},
                methods: methods || {},
                messagesPropertiesPaths: messagesPropertiesPaths || [],
                language: language || 'en',
                localeVar: variableMappings?.localeVar || 'locale',
                templateMessagesVar: variableMappings?.templateMessagesVar || 'templateMessages',
                escapeToolVar: variableMappings?.escapeToolVar || 'escape'
            });

            const options = {
                hostname: 'localhost',
                port: this.port,
                path: '/render',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                }
            };

            const req = http.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode === 200) {
                        resolve(data);
                    } else {
                        reject(new Error(`Server returned ${res.statusCode}: ${data}`));
                    }
                });

                res.on('error', (error) => {
                    reject(new Error(`Response error: ${error.message}`));
                });
            });

            req.on('error', (error) => {
                reject(new Error(`Failed to communicate with Velocity server: ${error.message}`));
            });

            req.on('socket', (socket) => {
                socket.setTimeout(30000);
                socket.on('timeout', () => {
                    req.destroy();
                    reject(new Error('Socket timeout - no data received for 30 seconds'));
                });
            });

            // Set timeout after creating request
            req.setTimeout(30000, () => {
                req.destroy();
                reject(new Error('Velocity server request timed out after 30 seconds'));
            });

            req.write(postData);
            req.end();
        });
    }

    public async stop(): Promise<void> {
        if (!this.serverProcess) {
            return;
        }

        this.isShuttingDown = true;

        try {
            // Try graceful shutdown first
            await new Promise<void>((resolve) => {
                const req = http.request({
                    hostname: 'localhost',
                    port: this.port,
                    path: '/shutdown',
                    method: 'POST',
                    timeout: 2000
                }, (res) => {
                    res.on('data', () => {}); // Consume response
                    res.on('end', () => resolve());
                });

                req.on('error', () => {
                    // If graceful shutdown fails, kill process
                    if (this.serverProcess) {
                        this.serverProcess.kill('SIGTERM');
                    }
                    resolve();
                });

                req.on('timeout', () => {
                    req.destroy();
                    if (this.serverProcess) {
                        this.serverProcess.kill('SIGTERM');
                    }
                    resolve();
                });

                req.end();
            });

        } catch (error) {
            this.outputChannel.appendLine(`[Server] Error during stop: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            this.serverProcess = null;
            this.startupPromise = null;
            this.isShuttingDown = false;
        }
    }

    public static reset(): void {
        VelocityServerClient.instance = undefined;
    }
}
