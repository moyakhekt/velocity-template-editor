import * as fs from 'node:fs';
import { ContextState } from '../../context/contextState';
import type { ContextFileData } from '../../context/contextManager';

const baseContext: ContextFileData = {
    methods: {},
    scenarios: { Default: { variables: {} } },
    activeScenario: 'Default',
};

// Helper that builds a ContextState with in-memory state only (no file I/O)
function makeState(): ContextState {
    return new ContextState();
}

// =============================================================================
// Scenario management (no file I/O — contextFilePath is empty, so writeToFile
// is a no-op via the guard: `if (!this.contextFilePath) return`)
// =============================================================================

describe('scenario management', () => {
    let state: ContextState;

    beforeEach(() => {
        state = makeState();
        state.updateTemplateContext(ctx => {
            ctx.scenarios = { Default: { variables: {} } };
            ctx.activeScenario = 'Default';
        });
    });

    it('switchScenario changes the active scenario', () => {
        state.updateTemplateContext(ctx => {
            ctx.scenarios!.Mobile = { variables: {} };
        });
        const changed = state.switchScenario('Mobile');
        expect(changed).toBe(true);
        expect(state.getTemplateContext()?.activeScenario).toBe('Mobile');
    });

    it('switchScenario returns false when already on the same scenario', () => {
        const changed = state.switchScenario('Default');
        expect(changed).toBe(false);
    });

    it('createScenario adds a new scenario and activates it', () => {
        state.createScenario('Staging');
        const ctx = state.getTemplateContext();
        expect(ctx?.scenarios?.Staging).toBeDefined();
        expect(ctx?.activeScenario).toBe('Staging');
    });

    it('deleteScenario removes the specified scenario', () => {
        state.updateTemplateContext(ctx => {
            ctx.scenarios!.ToDelete = { variables: {} };
        });
        state.deleteScenario('ToDelete');
        expect(state.getTemplateContext()?.scenarios?.ToDelete).toBeUndefined();
    });

    it('deleteScenario resets the active scenario to Default when the active one is deleted', () => {
        state.updateTemplateContext(ctx => {
            ctx.scenarios!.Temp = { variables: {} };
            ctx.activeScenario = 'Temp';
        });
        state.deleteScenario('Temp');
        expect(state.getTemplateContext()?.activeScenario).toBe('Default');
    });

    it('renameScenario renames the scenario and updates the active pointer', () => {
        state.updateTemplateContext(ctx => {
            ctx.scenarios!.Old = { variables: { x: '1' } };
            ctx.activeScenario = 'Old';
        });
        state.renameScenario('Old', 'New');
        const ctx = state.getTemplateContext();
        expect(ctx?.scenarios?.Old).toBeUndefined();
        expect(ctx?.scenarios?.New).toBeDefined();
        expect(ctx?.activeScenario).toBe('New');
    });

    it('renameScenario preserves the variable data of the renamed scenario', () => {
        state.updateTemplateContext(ctx => {
            ctx.scenarios!.Source = { variables: { key: 'value' } };
        });
        state.renameScenario('Source', 'Renamed');
        expect(state.getTemplateContext()?.scenarios?.Renamed?.variables?.key).toBe('value');
    });
});

// =============================================================================
// Context merging
// =============================================================================

describe('getMergedContext', () => {
    let state: ContextState;

    beforeEach(() => {
        state = makeState();
    });

    it('returns a copy of environment data when no template context is loaded', () => {
        state.updateEnvironmentContext(env => { (env as Record<string, unknown>).locale = 'en'; });
        const merged = state.getMergedContext();
        expect(merged).toMatchObject({ locale: 'en' });
    });

    it('merges environment base with template scenario variables', () => {
        state.updateEnvironmentContext(env => { (env as Record<string, unknown>).envVar = 'env'; });
        state.updateTemplateContext(ctx => {
            ctx.scenarios = { Default: { variables: { tplVar: 'tpl' } } };
            ctx.activeScenario = 'Default';
        });
        const merged = state.getMergedContext();
        expect(merged).toMatchObject({ envVar: 'env', tplVar: 'tpl' });
    });

    it('template scalar overrides environment scalar of the same name', () => {
        state.updateEnvironmentContext(env => { (env as Record<string, unknown>).name = 'from-env'; });
        state.updateTemplateContext(ctx => {
            ctx.scenarios = { Default: { variables: { name: 'from-template' } } };
            ctx.activeScenario = 'Default';
        });
        const merged = state.getMergedContext();
        expect((merged as Record<string, unknown>).name).toBe('from-template');
    });

    it('deeply merges nested objects instead of replacing them', () => {
        state.updateEnvironmentContext(env => {
            (env as Record<string, unknown>).user = { role: 'admin', email: 'admin@example.com' };
        });
        state.updateTemplateContext(ctx => {
            ctx.scenarios = { Default: { variables: { user: { name: 'Alice' } } } };
            ctx.activeScenario = 'Default';
        });
        const merged = state.getMergedContext() as Record<string, Record<string, unknown>>;
        // Objects should be merged, not replaced
        expect(merged.user.name).toBe('Alice');
        expect(merged.user.role).toBe('admin');
        expect(merged.user.email).toBe('admin@example.com');
    });

    it('returns variables from the active scenario, not a different one', () => {
        state.updateTemplateContext(ctx => {
            ctx.scenarios = {
                Default: { variables: { var1: 'default-value' } },
                Alt: { variables: { var1: 'alt-value' } },
            };
            ctx.activeScenario = 'Alt';
        });
        const merged = state.getMergedContext() as Record<string, unknown>;
        expect(merged.var1).toBe('alt-value');
    });
});

// =============================================================================
// Change detection
// =============================================================================

describe('change detection', () => {
    let state: ContextState;

    beforeEach(() => {
        state = makeState();
        state.updateTemplateContext(ctx => {
            ctx.scenarios = { Default: { variables: { x: '1' } } };
            ctx.activeScenario = 'Default';
        });
    });

    it('updateTemplateContext returns false when the value is unchanged', () => {
        const changed = state.updateTemplateContext(ctx => {
            ctx.scenarios!.Default.variables.x = '1'; // same value
        });
        expect(changed).toBe(false);
    });

    it('updateTemplateContext returns true when the value changes', () => {
        const changed = state.updateTemplateContext(ctx => {
            ctx.scenarios!.Default.variables.x = '2'; // different value
        });
        expect(changed).toBe(true);
    });

    it('fires a ContextStateChangeEvent when context changes', () => {
        const listener = jest.fn();
        state.event(listener);

        state.updateTemplateContext(ctx => { ctx.scenarios!.Default.variables.y = 'new'; });

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener.mock.calls[0][0]).toMatchObject({ source: expect.any(String) });
    });

    it('does NOT fire a change event when context is identical', () => {
        const listener = jest.fn();
        state.event(listener);

        state.updateTemplateContext(ctx => { ctx.scenarios!.Default.variables.x = '1'; });

        expect(listener).not.toHaveBeenCalled();
    });
});

// =============================================================================
// Watcher suppression
// =============================================================================

describe('watcher suppression', () => {
    let readFileSpy: jest.SpyInstance;
    let writeFileSpy: jest.SpyInstance;
    let state: ContextState;

    beforeEach(async () => {
        readFileSpy = jest
            .spyOn(fs.promises, 'readFile')
            .mockResolvedValue(JSON.stringify(baseContext) as any);
        writeFileSpy = jest
            .spyOn(fs.promises, 'writeFile')
            .mockResolvedValue(undefined);

        state = new ContextState();
        await state.loadTemplateContext('/test.vm', '/test.vm.context.json');
        // Clear call counts, but keep the mock implementation active
        readFileSpy.mockClear();
        writeFileSpy.mockClear();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('ignores file change events while a write is in progress', async () => {
        // updateTemplateContext fires writeToFile() which synchronously increments
        // suppressWriteCount before its first await, so suppression is active immediately
        state.updateTemplateContext(ctx => {
            ctx.scenarios!.Default.variables.writtenFlag = true;
        });

        await state.handleFileChange('/test.vm.context.json');

        // readFile should NOT have been called — the change was suppressed
        expect(readFileSpy).not.toHaveBeenCalled();
    });

    it('processes file change events after the 100 ms suppress window expires', async () => {
        state.updateTemplateContext(ctx => {
            ctx.scenarios!.Default.variables.writtenFlag = true;
        });

        // Wait for the suppress window to close (100 ms) with some margin
        await new Promise<void>(resolve => setTimeout(resolve, 150));

        await state.handleFileChange('/test.vm.context.json');

        expect(readFileSpy).toHaveBeenCalledWith('/test.vm.context.json', 'utf8');
    });
});

// =============================================================================
// loadTemplateContext
// =============================================================================

describe('loadTemplateContext', () => {
    let readFileSpy: jest.SpyInstance;
    let writeFileSpy: jest.SpyInstance;

    beforeEach(() => {
        writeFileSpy = jest
            .spyOn(fs.promises, 'writeFile')
            .mockResolvedValue(undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('reads and parses the context JSON file from disk', async () => {
        const context: ContextFileData = {
            methods: {},
            scenarios: { Default: { variables: { user: 'Alice' } } },
            activeScenario: 'Default',
        };
        readFileSpy = jest
            .spyOn(fs.promises, 'readFile')
            .mockResolvedValue(JSON.stringify(context) as any);

        const state = new ContextState();
        await state.loadTemplateContext('/a/tmpl.vm', '/a/tmpl.vm.context.json');

        const loaded = state.getTemplateContext();
        expect(loaded?.scenarios?.Default?.variables?.user).toBe('Alice');
    });

    it('creates an empty context structure when the file does not exist (ENOENT)', async () => {
        readFileSpy = jest
            .spyOn(fs.promises, 'readFile')
            .mockRejectedValue(
                Object.assign(new Error('no such file'), { code: 'ENOENT' }),
            );

        const state = new ContextState();
        await state.loadTemplateContext('/a/new.vm', '/a/new.vm.context.json');

        const loaded = state.getTemplateContext();
        expect(loaded).toBeDefined();
        expect(loaded?.scenarios).toBeDefined();
        expect(loaded?.activeScenario).toBeTruthy();
    });

    it('writes an empty context to disk when the file is missing', async () => {
        readFileSpy = jest
            .spyOn(fs.promises, 'readFile')
            .mockRejectedValue(
                Object.assign(new Error('no such file'), { code: 'ENOENT' }),
            );

        const state = new ContextState();
        await state.loadTemplateContext('/a/new.vm', '/a/new.vm.context.json');

        expect(writeFileSpy).toHaveBeenCalled();
    });

    it('fires a context change event on the first successful load', async () => {
        readFileSpy = jest
            .spyOn(fs.promises, 'readFile')
            .mockResolvedValue(JSON.stringify(baseContext) as any);

        const state = new ContextState();
        const listener = jest.fn();
        state.event(listener);

        await state.loadTemplateContext('/a/tmpl.vm', '/a/tmpl.vm.context.json');

        expect(listener).toHaveBeenCalledTimes(1);
    });
});
