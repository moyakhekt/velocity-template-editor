import * as vscode from 'vscode';
import * as fs from 'node:fs';
import { ContextFileData, ContextData } from './contextManager';
import { EnvironmentContextConfig } from './types';

/**
 * Type alias for context change source
 */
type ContextChangeSource = 'ui' | 'api' | 'file';

/**
 * Centralized state management for context data.
 * Single source of truth for all template and environment context.
 * Emits events when data changes, enabling reactive updates to the UI.
 */
export class ContextState extends vscode.EventEmitter<ContextStateChangeEvent> {
    private readonly environmentContext: EnvironmentContextConfig = { data: {}, mockFunctions: {} };
    private readonly outputChannel?: vscode.OutputChannel;

    constructor(outputChannel?: vscode.OutputChannel) {
        super();
        this.outputChannel = outputChannel;
    }

    private templateContext: ContextFileData | null = null;
    private templateFilePath: string = '';
    private contextFilePath: string = '';
    private suppressWriteCount: number = 0;

    /**
     * Load template context from file path
     */
    async loadTemplateContext(templatePath: string, contextPath: string): Promise<void> {
        this.templateFilePath = templatePath;
        this.contextFilePath = contextPath;

        try {
            const content = await fs.promises.readFile(contextPath, 'utf8');
            const newData = JSON.parse(content);
            
            // Only update and emit if data actually changed
            if (!this.deepEqual(this.templateContext, newData)) {
                const oldData = this.templateContext;
                this.templateContext = newData;
                this.fire({
                    type: 'templateContext',
                    source: 'file',
                    oldValue: oldData,
                    newValue: newData
                });
            }
        } catch (e) {
            // File doesn't exist or failed to parse - create empty context
            const emptyContext = this.getEmptyContextData();
            this.templateContext = emptyContext;
            void this.writeToFile();
        }
    }

    /**
     * Load environment context from file path
     */
    async loadEnvironmentContext(filePath: string): Promise<void> {
        try {
            const content = await fs.promises.readFile(filePath, 'utf8');
            const newData = JSON.parse(content);
            
            if (!this.deepEqual(this.environmentContext.data, newData)) {
                const oldData = this.environmentContext.data;
                this.environmentContext.data = newData;
                this.environmentContext.filePath = filePath;
                this.fire({
                    type: 'environmentContext',
                    source: 'file',
                    oldValue: oldData,
                    newValue: newData
                });
            }
        } catch (e) {
            this.outputChannel?.appendLine(`[ContextState] Failed to load environment context "${filePath}": ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    /**
     * Update template context programmatically
     */
    updateTemplateContext(updater: (ctx: ContextFileData) => void, source: ContextChangeSource = 'api'): boolean {
        this.templateContext ??= this.getEmptyContextData();

        const oldData = structuredClone(this.templateContext);
        updater(this.templateContext);

        // Only emit and write if data actually changed
        if (!this.deepEqual(oldData, this.templateContext)) {
            this.fire({
                type: 'templateContext',
                source: source,
                oldValue: oldData,
                newValue: this.templateContext
            });

            // Write to file if not from file watcher
            if (source !== 'file') {
                void this.writeToFile();
            }
            return true; // Changed
        }
        return false; // No change
    }

    /**
     * Update environment context programmatically
     */
    updateEnvironmentContext(updater: (ctx: ContextData) => void, source: ContextChangeSource = 'api'): void {
        const oldData = structuredClone(this.environmentContext.data);
        updater(this.environmentContext.data);

        if (!this.deepEqual(oldData, this.environmentContext.data)) {
            this.fire({
                type: 'environmentContext',
                source: source,
                oldValue: oldData,
                newValue: this.environmentContext.data
            });

            // Write to environment file if configured
            if (source !== 'file' && this.environmentContext.filePath) {
                void this.writeEnvironmentToFile();
            }
        }
    }

    /**
     * Get current template context (read-only)
     */
    getTemplateContext(): Readonly<ContextFileData> | null {
        return this.templateContext ? structuredClone(this.templateContext) : null;
    }

    /**
     * Get current environment context (read-only)
     */
    getEnvironmentContext(): Readonly<ContextData> {
        return structuredClone(this.environmentContext.data);
    }

    /**
     * Get merged context for rendering
     */
    getMergedContext(): ContextData {
        if (!this.templateContext) {
            return this.environmentContext.data;
        }

        const activeScenario = this.templateContext.activeScenario || 'Default';
        const scenarioData = this.templateContext.scenarios?.[activeScenario] || { variables: {} };

        // Merge: environment < template scenario
        return this.deepMerge(
            this.environmentContext.data,
            scenarioData.variables || {}
        );
    }

    /**
     * Handle file system changes (called by FileSystemWatcher)
     */
    async handleFileChange(filePath: string): Promise<void> {
        if (this.suppressWriteCount > 0) {
            return;
        }

        if (filePath === this.contextFilePath) {
            await this.loadTemplateContext(this.templateFilePath, this.contextFilePath);
        } else if (filePath === this.environmentContext.filePath) {
            await this.loadEnvironmentContext(filePath);
        }
    }

    /**
     * Write template context to file with watcher suspension
     */
    private async writeToFile(): Promise<void> {
        if (!this.templateContext || !this.contextFilePath) {
            return;
        }

        this.suppressWriteCount++;
        try {
            await fs.promises.writeFile(
                this.contextFilePath,
                JSON.stringify(this.templateContext, null, 2),
                'utf8'
            );
        } finally {
            // Decrement counter after delay to cover async FS event delivery
            setTimeout(() => {
                this.suppressWriteCount = Math.max(0, this.suppressWriteCount - 1);
            }, 100);
        }
    }

    /**
     * Write environment context to file with watcher suspension
     */
    private async writeEnvironmentToFile(): Promise<void> {
        if (!this.environmentContext.filePath) {
            return;
        }

        this.suppressWriteCount++;
        try {
            await fs.promises.writeFile(
                this.environmentContext.filePath,
                JSON.stringify(this.environmentContext.data, null, 2),
                'utf8'
            );
        } finally {
            setTimeout(() => {
                this.suppressWriteCount = Math.max(0, this.suppressWriteCount - 1);
            }, 100);
        }
    }

    /**
     * Deep equality check
     */
    private deepEqual(obj1: any, obj2: any): boolean {
        if (obj1 === obj2) return true;
        if (obj1 == null || obj2 == null) return false;
        if (typeof obj1 !== 'object' || typeof obj2 !== 'object') return false;

        const keys1 = Object.keys(obj1);
        const keys2 = Object.keys(obj2);

        if (keys1.length !== keys2.length) return false;

        for (const key of keys1) {
            if (!keys2.includes(key)) return false;
            if (!this.deepEqual(obj1[key], obj2[key])) return false;
        }

        return true;
    }

    /**
     * Deep merge objects
     */
    private deepMerge(target: any, source: any): any {
        const result = { ...target };
        
        for (const key in source) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                result[key] = this.deepMerge(result[key] || {}, source[key]);
            } else {
                result[key] = source[key];
            }
        }
        
        return result;
    }

    /**
     * Get empty context structure
     */
    private getEmptyContextData(): ContextFileData {
        return {
            methods: {},
            scenarios: {
                Default: { variables: {} }
            },
            activeScenario: 'Default'
        };
    }

    /**
     * Get context file path
     */
    getContextFilePath(): string {
        return this.contextFilePath;
    }

    /**
     * Get template file path
     */
    getTemplateFilePath(): string {
        return this.templateFilePath;
    }

    // =======================================================================
    // High-level convenience methods for common operations
    // =======================================================================

    /**
     * Switch active scenario
     */
    switchScenario(scenarioName: string): boolean {
        return this.updateTemplateContext(ctx => {
            ctx.activeScenario = scenarioName;
        }, 'ui');
    }

    /**
     * Create new scenario
     */
    createScenario(scenarioName: string): boolean {
        return this.updateTemplateContext(ctx => {
            if (!ctx.scenarios) {
                ctx.scenarios = { Default: { variables: {} } };
            }
            ctx.scenarios[scenarioName] = { variables: {} };
            ctx.activeScenario = scenarioName;
        }, 'ui');
    }

    /**
     * Delete scenario
     */
    deleteScenario(scenarioName: string): boolean {
        return this.updateTemplateContext(ctx => {
            if (ctx.scenarios?.[scenarioName]) {
                delete ctx.scenarios[scenarioName];
                
                // If we deleted the active scenario, switch to Default
                if (ctx.activeScenario === scenarioName) {
                    ctx.activeScenario = 'Default';
                }
            }
        }, 'ui');
    }

    /**
     * Rename scenario
     */
    renameScenario(oldName: string, newName: string): boolean {
        return this.updateTemplateContext(ctx => {
            if (ctx.scenarios?.[oldName]) {
                ctx.scenarios[newName] = ctx.scenarios[oldName];
                delete ctx.scenarios[oldName];
                
                if (ctx.activeScenario === oldName) {
                    ctx.activeScenario = newName;
                }
            }
        }, 'ui');
    }

    /**
     * Update scenario variable
     */
    updateScenarioVariable(scenarioName: string, varName: string, value: any): boolean {
        return this.updateTemplateContext(ctx => {
            if (!ctx.scenarios) {
                ctx.scenarios = { Default: { variables: {} } };
            }
            if (!ctx.scenarios[scenarioName]) {
                ctx.scenarios[scenarioName] = { variables: {} };
            }
            if (!ctx.scenarios[scenarioName].variables) {
                ctx.scenarios[scenarioName].variables = {};
            }
            ctx.scenarios[scenarioName].variables[varName] = value;
        }, 'ui');
    }

    /**
     * Delete scenario variable
     */
    deleteScenarioVariable(scenarioName: string, varName: string): boolean {
        return this.updateTemplateContext(ctx => {
            if (ctx.scenarios?.[scenarioName]?.variables) {
                delete ctx.scenarios[scenarioName].variables[varName];
            }
        }, 'ui');
    }

    /**
     * Update scenario URL
     */
    updateScenarioUrl(scenarioName: string, url: string): boolean {
        return this.updateTemplateContext(ctx => {
            if (!ctx.scenarios) {
                ctx.scenarios = { Default: { variables: {} } };
            }
            if (!ctx.scenarios[scenarioName]) {
                ctx.scenarios[scenarioName] = { variables: {} };
            }
            ctx.scenarios[scenarioName].url = url;
        }, 'ui');
    }

    /**
     * Update scenario header
     */
    updateScenarioHeader(scenarioName: string, headerName: string, value: string): boolean {
        return this.updateTemplateContext(ctx => {
            if (!ctx.scenarios) {
                ctx.scenarios = { Default: { variables: {} } };
            }
            if (!ctx.scenarios[scenarioName]) {
                ctx.scenarios[scenarioName] = { variables: {} };
            }
            if (!ctx.scenarios[scenarioName].headers) {
                ctx.scenarios[scenarioName].headers = {};
            }
            const headers = ctx.scenarios[scenarioName].headers;
            if (typeof headers === 'object' && headers !== null) {
                headers[headerName] = value;
            }
        }, 'ui');
    }

    /**
     * Delete scenario header
     */
    deleteScenarioHeader(scenarioName: string, headerName: string): boolean {
        return this.updateTemplateContext(ctx => {
            const headers = ctx.scenarios?.[scenarioName]?.headers;
            if (headers && typeof headers === 'object' && headers !== null) {
                delete headers[headerName];
            }
        }, 'ui');
    }

    /**
     * Get active scenario name
     */
    getActiveScenario(): string {
        return this.templateContext?.activeScenario || 'Default';
    }

    /**
     * Get scenario data
     */
    getScenarioData(scenarioName: string): any {
        return this.templateContext?.scenarios?.[scenarioName] || { variables: {} };
    }
}

/**
 * Event emitted when context state changes
 */
export interface ContextStateChangeEvent {
    type: 'templateContext' | 'environmentContext';
    source: ContextChangeSource;
    oldValue: any;
    newValue: any;
}
