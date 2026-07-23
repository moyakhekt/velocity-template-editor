import * as vscode from 'vscode';
import { VelocityPreviewProvider } from './preview';
import { ContextManager } from './context/contextManager';
import { VelocityServerClient } from './server/velocityServerClient';

let velocityServer: VelocityServerClient | undefined;
let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext) {
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

    // Detect Velocity syntax in HTML files on open
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(detectVelocityInHtml)
    );

    // Check already open documents
    vscode.workspace.textDocuments.forEach(detectVelocityInHtml);

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

    // Update active template when the user switches editor tabs
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor && editor.document.languageId === 'velocity') {
                const templatePath = editor.document.uri.fsPath;
                contextManager.switchActiveTemplate(templatePath);
                previewProvider.setActiveTemplate(templatePath);
            }
        })
    );

    // Dispose preview server on deactivation
    context.subscriptions.push({
        dispose: () => previewProvider.dispose()
    });
}

function detectVelocityInHtml(document: vscode.TextDocument): void {
    if (document.languageId !== 'html') {
        return;
    }

    const text = document.getText();
    if (hasVelocitySyntax(text)) {
        // Automatically set language to velocity if Velocity syntax detected
        vscode.languages.setTextDocumentLanguage(document, 'velocity');
    }
}

async function detectAndConvertToVelocity(document: vscode.TextDocument): Promise<void> {
    const text = document.getText();
    if (hasVelocitySyntax(text)) {
        await vscode.languages.setTextDocumentLanguage(document, 'velocity');
        vscode.window.showInformationMessage('Velocity syntax detected! Language mode changed to Velocity.');
    } else {
        vscode.window.showInformationMessage('No Velocity syntax detected in this file.');
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
