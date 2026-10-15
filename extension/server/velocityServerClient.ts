import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, spawnSync, ChildProcess } from 'child_process';
import { randomBytes } from 'crypto';
import * as readline from 'readline';
import * as vscode from 'vscode';
import { isDebugLogging } from '../shared/debugLogging';

export class VelocityServerClient {
    // Must match server/pom.xml's <maven.compiler.release> — the jar's class
    // files won't load on an older JVM.
    private static readonly REQUIRED_JAVA_MAJOR = 17;

    private static instance: VelocityServerClient | undefined;
    private serverProcess: ChildProcess | null = null;
    // Picked by the server (a free loopback port) and read from its startup output
    private port: number | undefined;
    // Shared secret the server requires on every request, so only this extension can use it
    private readonly token = randomBytes(32).toString('hex');
    private static readonly HOST = '127.0.0.1';
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

            // Find a Java runtime new enough to load the jar (PATH's default
            // `java` may resolve to an older JDK even when a suitable one is installed).
            const javaCmd = this.resolveJavaExecutable();

            // The token goes in the environment, not the command line, which other local users can see
            // Server debug logging is fixed for the life of the process (restart to change it)
            const args = isDebugLogging() ? ['-Dvelocity.logLevel=debug', '-jar', this.jarPath] : ['-jar', this.jarPath];
            this.serverProcess = spawn(javaCmd, args, {
                cwd: path.dirname(this.jarPath),
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env, VELOCITY_SERVER_TOKEN: this.token }
            });

            let startupOutput = '';
            let startupTimer: ReturnType<typeof setTimeout> | undefined;

            // stdout is the handshake channel: the server writes {"event":"ready","port":N}
            // once it's listening. Anything else there (e.g. a mock calling print()) is just shown.
            readline.createInterface({ input: this.serverProcess.stdout! }).on('line', (line) => {
                const ready = VelocityServerClient.parseReadyEvent(line);
                if (ready && this.port === undefined) {
                    this.port = ready.port;
                    this.outputChannel.appendLine(`✅ Velocity server started on port ${ready.port}`);
                    clearTimeout(startupTimer);
                    resolve();
                } else if (!ready) {
                    this.outputChannel.appendLine(line);
                }
            });

            // stderr carries the server's logs (and JVM errors)
            readline.createInterface({ input: this.serverProcess.stderr! }).on('line', (message) => {
                if (this.port === undefined) {
                    startupOutput += message + '\n';
                }
                this.outputChannel.appendLine(message);

                // Check for common errors
                if (message.includes('UnsupportedClassVersionError')) {
                    reject(new Error(
                        `The Velocity server jar was built for Java ${VelocityServerClient.REQUIRED_JAVA_MAJOR}, but no Java ${VelocityServerClient.REQUIRED_JAVA_MAJOR}+ runtime was found. ` +
                        `Install a JDK ${VelocityServerClient.REQUIRED_JAVA_MAJOR}+ (e.g. Eclipse Temurin) or point JAVA_HOME at one.`
                    ));
                }
            });

            this.serverProcess.on('error', (error) => {
                
                if ((error as any).code === 'ENOENT') {
                    reject(new Error(`Java not found. Please install Java ${VelocityServerClient.REQUIRED_JAVA_MAJOR} or higher and ensure it's in your PATH.`));
                } else {
                    reject(error);
                }
            });

            this.serverProcess.on('exit', (code, signal) => {
                clearTimeout(startupTimer);
                if (this.port === undefined) {
                    // Exited before the handshake: fail now rather than at the timeout
                    reject(new Error(
                        `Velocity server exited before it was ready (${signal ?? `exit code ${code}`}).\n\nOutput:\n${startupOutput}`
                    ));
                }
                this.serverProcess = null;
                this.port = undefined;
                this.startupPromise = null;
            });

            // Timeout if the ready handshake never arrives
            startupTimer = setTimeout(() => {
                if (this.serverProcess && this.port === undefined) {
                    reject(new Error(
                        `Velocity server failed to start within 15 seconds.\n\nOutput:\n${startupOutput}`
                    ));
                    this.serverProcess.kill('SIGTERM');
                }
            }, 15000);
        });

        return this.startupPromise;
    }

    /** The server's ready handshake on stdout: {"event":"ready","port":N}. */
    private static parseReadyEvent(line: string): { port: number } | undefined {
        try {
            const event = JSON.parse(line);
            if (event?.event === 'ready' && Number.isInteger(event.port) && event.port > 0) {
                return { port: event.port };
            }
        } catch {
            // Not JSON: ordinary output
        }
        return undefined;
    }

    // Resolves a `java` executable that satisfies REQUIRED_JAVA_MAJOR, checking
    // JAVA_HOME, then well-known JDK install locations, then falling back to
    // whatever `java` resolves to on PATH.
    private resolveJavaExecutable(): string {
        const exeName = process.platform === 'win32' ? 'java.exe' : 'java';
        const candidates: string[] = [];

        if (process.env.JAVA_HOME) {
            candidates.push(path.join(process.env.JAVA_HOME, 'bin', exeName));
        }

        const searchRoots: string[] = [];
        if (process.platform === 'win32') {
            for (const base of [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']]) {
                if (!base) {
                    continue;
                }
                searchRoots.push(path.join(base, 'Eclipse Adoptium'));
                searchRoots.push(path.join(base, 'Java'));
                searchRoots.push(path.join(base, 'Microsoft', 'jdk'));
            }
        } else if (process.platform === 'darwin') {
            searchRoots.push('/Library/Java/JavaVirtualMachines');
        } else {
            searchRoots.push('/usr/lib/jvm');
        }

        for (const root of searchRoots) {
            let entries: string[] = [];
            try {
                entries = fs.readdirSync(root);
            } catch {
                continue;
            }
            for (const entry of entries) {
                const binDir = process.platform === 'darwin'
                    ? path.join(root, entry, 'Contents', 'Home', 'bin')
                    : path.join(root, entry, 'bin');
                candidates.push(path.join(binDir, exeName));
            }
        }

        // Last resort: rely on PATH.
        candidates.push(exeName);

        let best: { exe: string, major: number } | undefined;
        for (const candidate of candidates) {
            const major = this.getJavaMajorVersion(candidate);
            if (major !== undefined && major >= VelocityServerClient.REQUIRED_JAVA_MAJOR) {
                if (!best || major > best.major) {
                    best = { exe: candidate, major };
                }
            }
        }

        if (best) {
            this.outputChannel.appendLine(`Using Java ${best.major} runtime: ${best.exe}`);
            return best.exe;
        }

        // Nothing found that satisfies the requirement — fall back to PATH
        // java so the process still spawns and reports a real error
        // (ENOENT or UnsupportedClassVersionError) that the caller can surface.
        return exeName;
    }

    private getJavaMajorVersion(javaExe: string): number | undefined {
        try {
            const result = spawnSync(javaExe, ['-version'], { encoding: 'utf-8' });
            if (result.error || result.status !== 0) {
                return undefined;
            }
            const output = `${result.stdout || ''}${result.stderr || ''}`;
            const match = output.match(/version "(\d+)(?:\.\d+)?/);
            if (!match) {
                return undefined;
            }
            const major = parseInt(match[1], 10);
            return major === 1 ? 8 : major; // Legacy "1.8.0_xxx" style versioning
        } catch {
            return undefined;
        }
    }

    private get authHeaders(): http.OutgoingHttpHeaders {
        return { 'X-Velocity-Token': this.token };
    }

    public async isRunning(): Promise<boolean> {
        if (this.port === undefined) {
            return false;
        }
        return new Promise((resolve) => {
            const req = http.get({ hostname: VelocityServerClient.HOST, port: this.port, path: '/health', headers: this.authHeaders }, (res) => {
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
        if (isDebugLogging()) {
            this.logRenderRequest(variables);
        }

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
                hostname: VelocityServerClient.HOST,
                port: this.port,
                path: '/render',
                method: 'POST',
                headers: {
                    ...this.authHeaders,
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

    private logRenderRequest(variables: Record<string, any>): void {
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
    }

    public async stop(): Promise<void> {
        this.isShuttingDown = true;

        try {
            // Try graceful HTTP shutdown regardless of whether we spawned the process
            if (await this.isRunning()) {
                await new Promise<void>((resolve) => {
                    const req = http.request({
                        hostname: VelocityServerClient.HOST,
                        port: this.port,
                        path: '/shutdown',
                        method: 'POST',
                        headers: this.authHeaders,
                        timeout: 2000
                    }, (res) => {
                        res.on('data', () => {}); // Consume response
                        res.on('end', () => resolve());
                    });

                    req.on('error', () => {
                        // If graceful shutdown fails, kill process if we have a handle
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
            } else if (this.serverProcess) {
                this.serverProcess.kill('SIGTERM');
            }

        } catch (error) {
            this.outputChannel.appendLine(`[Server] Error during stop: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            this.serverProcess = null;
            this.port = undefined;
            this.startupPromise = null;
            this.isShuttingDown = false;
        }
    }

    public static reset(): void {
        VelocityServerClient.instance = undefined;
    }
}
