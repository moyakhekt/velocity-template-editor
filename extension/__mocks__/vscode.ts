/**
 * Minimal VS Code API mock used exclusively by unit tests.
 * Source files do `import * as vscode from 'vscode'`; Jest's moduleNameMapper
 * redirects that import to this file.
 *
 * Only the surface area exercised at runtime by the code under test is
 * implemented.  Type-only uses of the VS Code API don't need anything here
 * because they're erased during compilation.
 */

type Listener<T> = (e: T) => void;

// Type alias intentionally — `interface Disposable` would merge with
// TypeScript 5.2+'s built-in global `Disposable { [Symbol.dispose](): void }`,
// silently making [Symbol.dispose] required. A type alias never merges.
type MockDisposable = { dispose(): void };

// ---------------------------------------------------------------------------
// EventEmitter – used as base class of ContextState
// ---------------------------------------------------------------------------
class EventEmitter<T> {
    // True ECMAScript private field — inaccessible at runtime (not just
    // compile-time), unlike the `private` keyword.
    #listeners: Array<Listener<T>> = [];

    // VS Code exposes the subscribe function directly as the `event` property.
    event = (listener: Listener<T>): MockDisposable => {
        this.#listeners.push(listener);
        const remove = () => {
            const idx = this.#listeners.indexOf(listener);
            if (idx >= 0) this.#listeners.splice(idx, 1);
        };
        return { dispose: remove };
    };

    fire(data: T): void {
        for (const l of [...this.#listeners]) l(data);
    }

    dispose(): void {
        this.#listeners.length = 0;
    }
}

// ---------------------------------------------------------------------------
// Stubs for APIs that are called but whose return value tests don't inspect
// ---------------------------------------------------------------------------

// Factory returning a fresh Disposable per call — prevents shared mutable
// state from leaking between tests.
const noop = (): void => {};
const makeDisposable = (): MockDisposable => ({ dispose: noop });

const workspace = {
    textDocuments: [] as unknown[],
    onDidChangeTextDocument: () => makeDisposable(),
    onDidSaveTextDocument: () => makeDisposable(),
    createFileSystemWatcher: () => ({
        onDidChange: () => makeDisposable(),
        onDidCreate: () => makeDisposable(),
        onDidDelete: () => makeDisposable(),
        dispose: noop,
    }),
    getConfiguration: () => ({ get: (): unknown => undefined }),
    openTextDocument: () => Promise.resolve({}),
};

const vsWindow = {
    showErrorMessage: (..._args: unknown[]): Promise<undefined> => Promise.resolve(undefined),
    showWarningMessage: (..._args: unknown[]): Promise<undefined> => Promise.resolve(undefined),
    showInformationMessage: (..._args: unknown[]): Promise<undefined> => Promise.resolve(undefined),
    showInputBox: (): Promise<undefined> => Promise.resolve(undefined),
    showQuickPick: (): Promise<undefined> => Promise.resolve(undefined),
    showTextDocument: () => Promise.resolve({}),
    createOutputChannel: () => ({
        appendLine(_msg: string): void {},
        append(_msg: string): void {},
        show(): void {},
        hide(): void {},
        dispose: noop,
    }),
    createWebviewPanel: () => ({
        webview: { html: '', postMessage(): void {} },
        dispose: noop,
    }),
};

const Uri = {
    file: (f: string) => ({ fsPath: f, toString: () => `file://${f}` }),
    parse: (s: string) => ({ fsPath: s, toString: () => s }),
    joinPath: (base: { fsPath: string }, ...segments: string[]) => {
        const joined = [base.fsPath, ...segments].join('/').replace(/\/{2,}/g, '/');
        return { fsPath: joined, toString: () => `file://${joined}` };
    },
};

const commands = {
    registerCommand: (_id: string, _cb: unknown): MockDisposable => makeDisposable(),
};

const ViewColumn = { One: 1, Two: 2, Three: 3 } as const;

// Export as a CommonJS-compatible module so that
// `const vscode = require('vscode')` yields an object with all these keys.
module.exports = {
    EventEmitter,
    workspace,
    window: vsWindow,
    Uri,
    commands,
    ViewColumn,
};
