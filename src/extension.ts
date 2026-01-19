import * as vscode from 'vscode';
import { VelocityPreviewProvider } from './preview';
import { ContextManager } from './contextManager';
import { VelocityServerClient } from './velocityServerClient';

let velocityServer: VelocityServerClient | undefined;
let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext) {
    console.log('Velocity Template Editor is now active');

    // Create output channel for server logs
    outputChannel = vscode.window.createOutputChannel('Velocity Server');
    context.subscriptions.push(outputChannel);

    // Start Apache Velocity server
    const config = vscode.workspace.getConfiguration('velocity');
    const useApacheVelocity = config.get<boolean>('useApacheVelocity', true);

    if (useApacheVelocity) {
        velocityServer = VelocityServerClient.getInstance(context.extensionPath);
        try {
            outputChannel.appendLine('Starting Apache Velocity server...');
            await velocityServer.start();
            outputChannel.appendLine('✅ Apache Velocity server started successfully');
            vscode.window.showInformationMessage('Velocity Template Editor: Using Apache Velocity engine');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            outputChannel.appendLine('❌ Failed to start Apache Velocity server:');
            outputChannel.appendLine(errorMessage);
            outputChannel.show();
            
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
    const contextManager = new ContextManager(context);
    const previewProvider = new VelocityPreviewProvider(context, contextManager, velocityServer);
    contextManager.setPreviewProvider(previewProvider);

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

    // Watch for document changes to refresh preview
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document.languageId === 'velocity') {
                previewProvider.refresh(event.document);
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
        console.log('Stopping Velocity server...');
        await velocityServer.stop();
    }
    
    if (outputChannel) {
        outputChannel.dispose();
    }
}
