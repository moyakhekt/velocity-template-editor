import * as vscode from 'vscode';
import * as path from 'path';
import { VelocityPreviewProvider } from './preview';
import { ContextManager } from './context/contextManager';
import { VelocityServerClient } from './server/velocityServerClient';
import { initDebugLogging } from './shared/debugLogging';

let velocityServer: VelocityServerClient | undefined;
let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext) {
    initDebugLogging(context);

// Create output channel FIRST so we can log to it
    outputChannel = vscode.window.createOutputChannel('Velocity Server');
    
    // Don't automatically show the output channel
    context.subscriptions.push(outputChannel);

    // Start Apache Velocity server
    const config = vscode.workspace.getConfiguration('velocity');
    const useApacheVelocity = config.get<boolean>('useApacheVelocity', true);

    if (useApacheVelocity) {
        velocityServer = VelocityServerClient.getInstance(context.extensionPath, outputChannel);
        try {
            outputChannel.appendLine('Starting Apache Velocity server...');
            await velocityServer.start();
            outputChannel.appendLine('✅ Apache Velocity server started successfully');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            outputChannel.appendLine('❌ Failed to start Apache Velocity server:');
            outputChannel.appendLine(errorMessage);
            // Only show output if there's an error
            
            vscode.window.showErrorMessage(
                'Failed to start Apache Velocity server. Preview will not work. See Output panel for details.',
                'Show Output'
            ).then(choice => {
                if (choice === 'Show Output') {
                    outputChannel.show();
                }
            });
            
            velocityServer = undefined;
        }
    } else {
        outputChannel.appendLine('Apache Velocity is disabled in settings. Preview will not work.');
    }

    // HTML files are never switched to Velocity automatically: plain HTML often has
    // jQuery ($el) or template literals (${x}). Users opt in with Detect Velocity
    // Syntax, which can add a files.associations entry for their template folders.

// Initialize managers
    const contextManager = new ContextManager(context, outputChannel);
    const previewProvider = new VelocityPreviewProvider(context, contextManager, velocityServer);
    contextManager.setPreviewProvider(previewProvider);
    if (velocityServer) {
        contextManager.setVelocityServer(velocityServer);
    }

    // Register preview command
    context.subscriptions.push(
        vscode.commands.registerCommand('velocity.preview', () => {
            previewProvider.showPreview();
        })
    );

    // Register unified context management command
    context.subscriptions.push(
        vscode.commands.registerCommand('velocity.manageContext', async () => {
            await contextManager.manageContext();
        })
    );

    // Register detect Velocity command
    context.subscriptions.push(
        vscode.commands.registerCommand('velocity.detectInHtml', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor?.document.languageId === 'html') {
                await detectAndConvertToVelocity(editor.document);
            }
        })
    );

    // Register screenshot tests command (also accessible from command palette)
    context.subscriptions.push(
        vscode.commands.registerCommand('velocity.runScreenshots', async () => {
            await contextManager.handleRunScreenshots();
        })
    );

    // Register open devtools command (shown in webview panel title bar)
    context.subscriptions.push(
        vscode.commands.registerCommand('velocity.openDevTools', () => {
            vscode.commands.executeCommand('workbench.action.webview.openDeveloperTools');
        })
    );

    // Watch for document changes to refresh preview
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document.languageId === 'velocity') {
                previewProvider.refresh(event.document);
            }
        })
    );

    // Messages .properties files are read from disk by the server, so refresh on save.
    // The watcher also catches edits made outside VS Code (workspace files only).
    const propertiesWatcher = vscode.workspace.createFileSystemWatcher('**/*.properties');
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(document => {
            previewProvider.refreshIfMessagesFile(document.uri.fsPath);
        }),
        propertiesWatcher,
        propertiesWatcher.onDidChange(uri => previewProvider.refreshIfMessagesFile(uri.fsPath)),
        propertiesWatcher.onDidCreate(uri => previewProvider.refreshIfMessagesFile(uri.fsPath))
    );

    // The Context Manager follows the editor; the preview keeps showing the template
    // chosen with the Preview command or its own Template menu.
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor && editor.document.languageId === 'velocity') {
                contextManager.switchActiveTemplate(editor.document.uri.fsPath);
            }
        })
    );

    // Context Manager view in the Velocity container on the Activity Bar
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ContextManager.viewId, contextManager, {
            // Keep unsaved edits, scroll position and the open tab while the view is hidden
            webviewOptions: { retainContextWhenHidden: true },
        })
    );

    // Dispose preview server on deactivation
    context.subscriptions.push({
        dispose: () => previewProvider.dispose()
    });
}

async function detectAndConvertToVelocity(document: vscode.TextDocument): Promise<void> {
    const text = document.getText();
    if (!hasVelocitySyntax(text)) {
        vscode.window.showInformationMessage('No Velocity syntax detected in this file.');
        return;
    }
    await vscode.languages.setTextDocumentLanguage(document, 'velocity');

    // Offer to make it stick for the template's folder (workspace files only)
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    const relativeDir = folder
        ? path.posix.dirname(path.relative(folder.uri.fsPath, document.uri.fsPath).split(path.sep).join('/'))
        : undefined;
    if (relativeDir === undefined) {
        vscode.window.showInformationMessage('Velocity syntax detected. Language mode changed to Velocity.');
        return;
    }
    const pattern = relativeDir === '.' ? '**/*.html' : `**/${relativeDir}/**/*.html`;
    const choice = await vscode.window.showInformationMessage(
        `Velocity syntax detected. Language mode changed to Velocity. Always open ${pattern} as Velocity in this workspace?`,
        'Always',
        'Just This Time',
    );
    if (choice === 'Always') {
        const config = vscode.workspace.getConfiguration('files', document.uri);
        const associations = { ...(config.get<Record<string, string>>('associations') ?? {}), [pattern]: 'velocity' };
        await config.update('associations', associations, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(`Added "${pattern}": "velocity" to files.associations in workspace settings.`);
    }
}

function hasVelocitySyntax(text: string): boolean {
    // Check for common Velocity patterns
    const velocityPatterns = [
        /\$[a-zA-Z_][a-zA-Z0-9_]*/,           // Variables: $var
        /\$\{[^}]+\}/,                        // Variables: ${var}
        /#(?:if|foreach|set|end|else|elseif|macro|include|parse)\b/,  // Directives
        /##.*$/m,                              // Line comments
        /#\*[\s\S]*?\*#/                      // Block comments
    ];

    return velocityPatterns.some(pattern => pattern.test(text));
}

export async function deactivate() {
    if (velocityServer) {
        await velocityServer.stop();
    }
    
    if (outputChannel) {
        outputChannel.dispose();
    }
}
