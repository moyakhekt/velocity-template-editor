import * as vscode from 'vscode';

let developmentMode = false;

/** Call once on activation: debug logging is always on when running from source (F5). */
export function initDebugLogging(context: vscode.ExtensionContext): void {
    developmentMode = context.extensionMode === vscode.ExtensionMode.Development;
}

/**
 * Whether to log debug details: the Velocity server's render steps, the request
 * sent for each render, and the preview page's navigation interception.
 * On when running from source, otherwise per the velocity.debugLogging setting.
 */
export function isDebugLogging(): boolean {
    return developmentMode || vscode.workspace.getConfiguration('velocity').get<boolean>('debugLogging', false);
}
