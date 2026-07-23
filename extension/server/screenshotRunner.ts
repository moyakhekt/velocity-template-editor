import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { EnvironmentContextConfig, TemplateContextInEnvironment, ScenarioData } from '../shared/types';
import { VelocityServerClient } from './velocityServerClient';

export interface ScreenshotProgress {
    current: number;
    total: number;
    label: string;
}

export interface ScreenshotResult {
    template: string;
    scenario: string;
    file: string;
    success: boolean;
    error?: string;
}

export interface ScreenshotRunResult {
    succeeded: number;
    failed: number;
    results: ScreenshotResult[];
}

// Minimal interface for what screenshotRunner needs from ContextManager
export interface ScreenshotContextSource {
    getEnvironmentContext(): EnvironmentContextConfig;
    getContextForSpecificScenario(templatePath: string, scenarioName: string): Promise<Record<string, any>>;
    getTemplateMappings(templatePath: string): Promise<{ localeVar?: string; templateMessagesVar?: string; escapeToolVar?: string }>;
}

/**
 * Splits a merged context object into variables and method mocks,
 * matching the logic in preview.ts.
 */
function splitContextIntoVariablesAndMocks(
    contextData: Record<string, any>
): { variables: Record<string, any>; mocks: Record<string, Record<string, any>> } {
    const variables: Record<string, any> = {};
    const mocks: Record<string, Record<string, any>> = {};

    for (const [key, value] of Object.entries(contextData)) {
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            const hasMethods = Object.values(value).some(
                (v: any) => v && typeof v === 'object' && '_implementation' in v
            );
            if (hasMethods) {
                mocks[key] = {};
                for (const [methodName, methodData] of Object.entries(value)) {
                    if (methodData && typeof methodData === 'object' && '_implementation' in (methodData as any)) {
                        mocks[key][methodName] = {
                            name: methodName,
                            implementation: (methodData as any)._implementation,
                        };
                    } else {
                        if (!variables[key]) {
                            variables[key] = {};
                        }
                        variables[key][methodName] = methodData;
                    }
                }
                if (!variables[key] || Object.keys(variables[key]).length === 0) {
                    delete variables[key];
                }
            } else {
                variables[key] = value;
            }
        } else {
            variables[key] = value;
        }
    }

    return { variables, mocks };
}

export async function runScreenshots(
    contextSource: ScreenshotContextSource,
    velocityServer: VelocityServerClient,
    outputDir: string,
    templateRoot: string,
    onProgress: (p: ScreenshotProgress) => void
): Promise<ScreenshotRunResult> {
    const results: ScreenshotResult[] = [];

    const environmentContext = contextSource.getEnvironmentContext();
    const templates = environmentContext.templates || {};

    // Base dir for resolving relative template paths — prefer user-supplied templateRoot
    const contextFileDir = templateRoot ||
        (environmentContext.filePath ? path.dirname(environmentContext.filePath) : process.cwd());

    // Build list of all (templatePath, scenarioName) pairs
    const pairs: Array<{ rawKey: string; resolvedPath: string; scenarioName: string }> = [];
    for (const [rawTemplatePath, templateCtx] of Object.entries(templates)) {
        // Resolve relative paths against the context file's directory
        const resolvedPath = path.isAbsolute(rawTemplatePath)
            ? rawTemplatePath
            : path.resolve(contextFileDir, rawTemplatePath);
        const scenarios = templateCtx.scenarios || {};
        const scenarioNames = Object.keys(scenarios);
        if (scenarioNames.length === 0) {
            pairs.push({ rawKey: rawTemplatePath, resolvedPath, scenarioName: 'Default' });
        } else {
            for (const scenarioName of scenarioNames) {
                pairs.push({ rawKey: rawTemplatePath, resolvedPath, scenarioName });
            }
        }
    }

    const total = pairs.length;
    if (total === 0) {
        return { succeeded: 0, failed: 0, results: [] };
    }

    // Ensure output dir exists
    fs.mkdirSync(outputDir, { recursive: true });

    // --- Local HTTP server ---
    // Mirrors preview.ts exactly: serves the in-memory rendered HTML at /__preview__
    // and resolves static asset requests (CSS, images, fonts) against the current
    // template's own directory, with fallback to ancestor directories.
    // Base href is always http://localhost:PORT/ (root) so relative and absolute
    // asset URLs both resolve the same way the live preview browser does.
    let currentHtml = '';
    let currentTemplateDir = '';   // updated before each screenshot

    const contentTypes: Record<string, string> = {
        '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
        '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
        '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject',
    };

    function serveFile(filePath: string, res: http.ServerResponse): void {
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not found');
                return;
            }
            const ext = path.extname(filePath).toLowerCase();
            res.writeHead(200, {
                'Content-Type': contentTypes[ext] || 'application/octet-stream',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-cache',
            });
            res.end(data);
        });
    }

    const assetServer = http.createServer((req, res) => {
        const url = new URL(req.url || '/', `http://localhost`);
        const pathname = url.pathname;

        // Special endpoint: serve the in-memory rendered HTML
        if (pathname === '/__preview__') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
            res.end(currentHtml);
            return;
        }

        // Static assets: try templateDir and progressively higher parent dirs,
        // then fall back to templateRoot.  This matches preview.ts fallback logic.
        const relativePath = decodeURIComponent(pathname.substring(1));
        const candidates = [
            path.join(currentTemplateDir, relativePath),
            path.join(path.dirname(currentTemplateDir), relativePath),
            path.join(path.dirname(path.dirname(currentTemplateDir)), relativePath),
            path.join(templateRoot, relativePath),
        ];

        const existing = candidates.find(p => {
            try { return fs.statSync(p).isFile(); } catch { return false; }
        });

        if (existing) {
            serveFile(existing, res);
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found: ' + pathname);
        }
    });

    const serverPort = await new Promise<number>((resolve, reject) => {
        assetServer.listen(0, 'localhost', () => {
            resolve((assetServer.address() as any).port);
        }).on('error', reject);
    });

    // Use the user's installed browser via playwright-core (no bundled Chromium download).
    // Tries Google Chrome first, then Microsoft Edge (pre-installed on Windows).
    const { chromium } = await import('playwright-core');
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    for (const channel of ['chrome', 'msedge'] as const) {
        try {
            browser = await chromium.launch({ channel, headless: true });
            break;
        } catch {
            // This browser channel is not installed — try the next one.
        }
    }
    if (!browser) {
        throw new Error(
            'No supported browser found for screenshots. ' +
            'Please install Google Chrome or Microsoft Edge.'
        );
    }

    try {
        for (let i = 0; i < pairs.length; i++) {
            const { rawKey, resolvedPath, scenarioName } = pairs[i];
            const templateName = path.basename(resolvedPath, path.extname(resolvedPath));
            const safeName = scenarioName.replace(/\s+/g, '-');
            const outputFile = path.join(outputDir, `${templateName}-${safeName}.png`);

            onProgress({
                current: i + 1,
                total,
                label: `${templateName} / ${scenarioName}`,
            });

            try {
                // Read template file using resolved absolute path
                if (!fs.existsSync(resolvedPath)) {
                    throw new Error(`Template file not found: ${resolvedPath}`);
                }
                const templateContent = fs.readFileSync(resolvedPath, 'utf8');

                // Get merged context using the raw key (matches environment context lookup)
                const contextData = await contextSource.getContextForSpecificScenario(rawKey, scenarioName);
                const { variables, mocks } = splitContextIntoVariablesAndMocks(contextData);

                // Get messages paths and language from environment context
                let messagesPropertiesPaths: string[] = [];
                if (environmentContext.messagesPropertiesPaths) {
                    messagesPropertiesPaths = environmentContext.messagesPropertiesPaths;
                } else if ((environmentContext as any).messagesPropertiesPath) {
                    messagesPropertiesPaths = [(environmentContext as any).messagesPropertiesPath];
                }
                const language = environmentContext.language || 'en';
                const templateMappings = await contextSource.getTemplateMappings(rawKey);

                // Render via Velocity server
                const rendered = await velocityServer.render(
                    templateContent,
                    variables,
                    mocks,
                    messagesPropertiesPaths,
                    language,
                    templateMappings
                );

                // Set the current template directory so the HTTP server knows where to
                // look for assets (CSS, images, fonts). Mirrors preview.ts exactly.
                const templateDir = path.dirname(resolvedPath);
                currentTemplateDir = templateDir;

                // Base href is always root-relative (http://localhost:PORT/) matching preview.ts.
                // Relative CSS paths like ../../assets/css/styles.css resolve against the
                // template dir via our server's multi-level fallback lookup.
                const baseHref = `http://localhost:${serverPort}/`;

                // Inject <base> tag if template doesn't already have one (mirrors preview.ts)
                const hasBaseTag = /<base\s+href=/i.test(rendered);
                let htmlWithBase = rendered;
                if (!hasBaseTag) {
                    const baseTag = `<base href="${baseHref}">`;
                    if (/<head(\s[^>]*)?>/i.test(rendered)) {
                        htmlWithBase = rendered.replace(/(<head(\s[^>]*)?>)/i, `$1\n    ${baseTag}`);
                    } else {
                        htmlWithBase = `${baseTag}${rendered}`;
                    }
                }

                // Place rendered HTML in the in-memory slot so the server can serve it
                currentHtml = htmlWithBase;

                // Navigate browser to the local HTTP server — assets load properly
                const page = await browser.newPage();
                await page.setViewportSize({ width: 1440, height: 900 });
                await page.goto(`http://localhost:${serverPort}/__preview__`, {
                    waitUntil: 'networkidle',
                    timeout: 30000,
                });
                // Extra settle time for web fonts / CSS animations / lazy resources
                await new Promise(r => setTimeout(r, 1000));
                await page.screenshot({ path: outputFile, fullPage: true });
                await page.close();

                results.push({ template: templateName, scenario: scenarioName, file: outputFile, success: true });
            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                results.push({
                    template: templateName,
                    scenario: scenarioName,
                    file: outputFile,
                    success: false,
                    error: errorMsg,
                });
            }
        }
    } finally {
        await browser.close();
        assetServer.close();
    }

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    return { succeeded, failed, results };
}
