import {
    getUrlWithSource,
    getUrlSourceOptionsData,
    getScenarioHeadersData,
    getScenarioVariablesData,
    resolveScenarioValues,
    applyMethodMappings,
} from '../../context/contextManagerServices';
import type { ScenarioData, ScenariosData } from '../../shared/types';
import type { ContextItem } from '../../shared/templateParser';

// =============================================================================
// getUrlWithSource
// =============================================================================

describe('getUrlWithSource', () => {
    it('returns empty url with Self source when scenario has no url and no urlSource', () => {
        const fileData = { methods: {}, scenarios: { Default: { variables: {} } }, activeScenario: 'Default' };
        const result = getUrlWithSource('Default', fileData);
        expect(result).toEqual({ url: '', urlSource: 'Self' });
    });

    it('returns own url with Self source when scenario defines its own url', () => {
        const fileData = {
            methods: {},
            scenarios: { Default: { variables: {}, url: 'http://api.example.com' } },
            activeScenario: 'Default',
        };
        const result = getUrlWithSource('Default', fileData);
        expect(result).toEqual({ url: 'http://api.example.com', urlSource: 'Self' });
    });

    it('returns fileData.url for Default scenario when no scenario-level url exists', () => {
        const fileData = {
            url: 'http://base.example.com',
            methods: {},
            scenarios: { Default: { variables: {} } },
            activeScenario: 'Default',
        };
        const result = getUrlWithSource('Default', fileData);
        expect(result).toEqual({ url: 'http://base.example.com', urlSource: 'Self' });
    });

    it('does NOT fall back to fileData.url for non-Default scenarios', () => {
        const fileData = {
            url: 'http://base.example.com',
            methods: {},
            scenarios: { Mobile: { variables: {} } },
            activeScenario: 'Mobile',
        };
        const result = getUrlWithSource('Mobile', fileData);
        expect(result).toEqual({ url: '', urlSource: 'Self' });
    });

    it('resolves inherited url from urlSource scenario', () => {
        const fileData = {
            methods: {},
            scenarios: {
                Default: { variables: {}, url: 'http://default.example.com' },
                Mobile: { variables: {}, urlSource: 'Default' },
            },
            activeScenario: 'Mobile',
        };
        const result = getUrlWithSource('Mobile', fileData);
        expect(result).toEqual({ url: 'http://default.example.com', urlSource: 'Default' });
    });

    it('returns empty url if urlSource scenario does not have a url', () => {
        const fileData = {
            methods: {},
            scenarios: {
                Default: { variables: {} },           // no url
                Mobile: { variables: {}, urlSource: 'Default' },
            },
            activeScenario: 'Mobile',
        };
        const result = getUrlWithSource('Mobile', fileData);
        expect(result).toEqual({ url: '', urlSource: 'Self' });
    });
});

// =============================================================================
// getUrlSourceOptionsData
// =============================================================================

describe('getUrlSourceOptionsData', () => {
    it('returns only a Self option for the Default scenario', () => {
        const scenarios: ScenariosData = { Default: { variables: {} } };
        const fileData = { methods: {}, scenarios, activeScenario: 'Default' };
        const opts = getUrlSourceOptionsData('Default', scenarios, fileData);
        expect(opts).toHaveLength(1);
        expect(opts[0]).toMatchObject({ value: 'self', label: 'Self', selected: true });
    });

    it('returns Self plus every other scenario for a non-Default scenario', () => {
        const scenarios: ScenariosData = {
            Default: { variables: {} },
            Mobile: { variables: {} },
            Tablet: { variables: {} },
        };
        const fileData = { methods: {}, scenarios, activeScenario: 'Mobile' };
        const opts = getUrlSourceOptionsData('Mobile', scenarios, fileData);
        const labels = opts.map(o => o.label);
        expect(labels).toContain('Self');
        expect(labels).toContain('Default');
        expect(labels).toContain('Tablet');
        expect(labels).not.toContain('Mobile');  // current scenario excluded
    });

    it('marks the correct option as selected when a url is inherited', () => {
        const scenarios: ScenariosData = {
            Default: { variables: {}, url: 'http://x.com' },
            Mobile: { variables: {}, urlSource: 'Default' },
        };
        const fileData = { methods: {}, scenarios, activeScenario: 'Mobile' };
        const opts = getUrlSourceOptionsData('Mobile', scenarios, fileData);
        const selected = opts.find(o => o.selected);
        expect(selected?.label).toBe('Default');
    });

    it('marks Self as selected when the scenario owns its url', () => {
        const scenarios: ScenariosData = {
            Default: { variables: {} },
            Mobile: { variables: {}, url: 'http://mobile.example.com' },
        };
        const fileData = { methods: {}, scenarios, activeScenario: 'Mobile' };
        const opts = getUrlSourceOptionsData('Mobile', scenarios, fileData);
        const selected = opts.find(o => o.selected);
        expect(selected?.label).toBe('Self');
    });
});

// =============================================================================
// getScenarioHeadersData
// =============================================================================

describe('getScenarioHeadersData', () => {
    it('returns an empty array when the scenario has no headers', () => {
        const scenario: ScenarioData = { variables: {} };
        expect(getScenarioHeadersData(scenario, '')).toEqual([]);
    });

    it('parses object-format headers into ScenarioHeaderItem list', () => {
        const scenario: ScenarioData = {
            variables: {},
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer abc' },
        };
        const items = getScenarioHeadersData(scenario, '');
        const names = items.map(i => i.name);
        expect(names).toContain('Content-Type');
        expect(names).toContain('Authorization');
        expect(items.find(i => i.name === 'Content-Type')?.value).toBe('application/json');
    });

    it('uses headerSources when available', () => {
        const scenario: ScenarioData = {
            variables: {},
            headers: { Accept: 'text/html' },
            headerSources: { Accept: 'Default' },
        };
        const items = getScenarioHeadersData(scenario, '');
        expect(items[0].source).toBe('Default');
    });

    it('defaults source to "self" when no headerSources entry exists', () => {
        const scenario: ScenarioData = {
            variables: {},
            headers: { 'X-Custom': 'value' },
        };
        const items = getScenarioHeadersData(scenario, '');
        expect(items[0].source).toBe('self');
    });

    it('falls back to legacy newline-delimited header string when headers is absent', () => {
        const scenario: ScenarioData = { variables: {} };
        const legacy = 'Content-Type: text/plain\nX-Trace: abc123';
        const items = getScenarioHeadersData(scenario, legacy);
        expect(items).toHaveLength(2);
        expect(items[0].name).toBe('Content-Type');
        expect(items[0].value).toBe('text/plain');
        expect(items[1].name).toBe('X-Trace');
    });
});

// =============================================================================
// getScenarioVariablesData
// =============================================================================

describe('getScenarioVariablesData', () => {
    const item = (name: string, type: ContextItem['type'] = 'variable'): ContextItem =>
        ({ name, type, lineNumber: 1, context: '' });

    it('returns own values as overrides, serializing non-strings to JSON', () => {
        const scenarios: ScenariosData = {
            Default: { variables: { username: 'alice', count: 42, active: true, tags: ['a'] } },
        };
        const items = getScenarioVariablesData(scenarios.Default, scenarios, 'Default', {}, []);
        const byName = Object.fromEntries(items.map(i => [i.name, i]));
        expect(byName.username).toMatchObject({ ownValue: 'alice', isOverride: true, hasParent: false });
        expect(byName.count.ownValue).toBe('42');
        expect(byName.active.ownValue).toBe('true');
        expect(byName.tags.ownValue).toBe('["a"]');
    });

    it('in Default, inherits from the environment data', () => {
        const scenarios: ScenariosData = { Default: { variables: { region: 'eu' } } };
        const env = { apiKey: 'env-key', region: 'us', config: { debug: true } };
        const items = getScenarioVariablesData(scenarios.Default, scenarios, 'Default', env, []);
        const byName = Object.fromEntries(items.map(i => [i.name, i]));
        // Inherited only
        expect(byName.apiKey).toMatchObject({ ownValue: '', parentValue: 'env-key', isOverride: false, hasParent: true });
        expect(byName.config.parentValue).toBe('{"debug":true}');
        // Overridden: keeps both values
        expect(byName.region).toMatchObject({ ownValue: 'eu', parentValue: 'us', isOverride: true, hasParent: true });
    });

    it('in other scenarios, inherits from Default rather than the environment', () => {
        const scenarios: ScenariosData = {
            Default: { variables: { apiKey: 'default-key', locale: 'en' } },
            Staging: { variables: { locale: 'fr' } },
        };
        const env = { envOnly: 'x' };
        const items = getScenarioVariablesData(scenarios.Staging, scenarios, 'Staging', env, []);
        const byName = Object.fromEntries(items.map(i => [i.name, i]));
        expect(byName.apiKey).toMatchObject({ parentValue: 'default-key', isOverride: false, hasParent: true });
        expect(byName.locale).toMatchObject({ ownValue: 'fr', parentValue: 'en', isOverride: true });
        expect(byName.envOnly).toBeUndefined();
    });

    it('lists template variables that have no value anywhere yet', () => {
        const scenarios: ScenariosData = { Default: { variables: {} } };
        const items = getScenarioVariablesData(scenarios.Default, scenarios, 'Default', {}, [item('firstName'), item('lastName')]);
        expect(items.map(i => i.name)).toEqual(['firstName', 'lastName']);
        expect(items[0]).toMatchObject({ ownValue: '', parentValue: '', isOverride: false, hasParent: false });
    });

    it('includes names that only appear in variableSources', () => {
        const scenarios: ScenariosData = {
            Default: { variables: {} },
            Staging: { variables: {}, variableSources: { legacy: 'Default' } },
        };
        const items = getScenarioVariablesData(scenarios.Staging, scenarios, 'Staging', {}, []);
        expect(items.map(i => i.name)).toContain('legacy');
    });

    it('returns names sorted and leaves out excluded ones', () => {
        const scenarios: ScenariosData = { Default: { variables: { zeta: 1, alpha: 2, locale: 'en' } } };
        const items = getScenarioVariablesData(
            scenarios.Default, scenarios, 'Default', { request: {} }, [item('mid')], new Set(['locale', 'request']),
        );
        expect(items.map(i => i.name)).toEqual(['alpha', 'mid', 'zeta']);
    });

    it('in Default, uses its JSON flags (editable), defaulting to true for template objects', () => {
        const scenarios: ScenariosData = {
            Default: { variables: { tags: '["a"]', user: '{}', plain: 'x' }, variableJsonFlags: { tags: true, user: false } },
        };
        const items = getScenarioVariablesData(
            scenarios.Default, scenarios, 'Default', {}, [item('user', 'object'), item('settings', 'object')],
        );
        const byName = Object.fromEntries(items.map(i => [i.name, i]));
        expect(byName.tags).toMatchObject({ isJson: true, isJsonEditable: true });
        expect(byName.user.isJson).toBe(false);      // explicit flag beats the object type
        expect(byName.settings.isJson).toBe(true);   // object in the template, no flag
        expect(byName.plain.isJson).toBe(false);
    });

    it('in other scenarios, follows Default\'s JSON flags and makes them read-only', () => {
        const scenarios: ScenariosData = {
            Default: { variables: {}, variableJsonFlags: { tags: true } },
            Staging: { variables: { tags: '["b"]', other: 'y' }, variableJsonFlags: { tags: false, other: true } },
        };
        const items = getScenarioVariablesData(scenarios.Staging, scenarios, 'Staging', {}, []);
        const byName = Object.fromEntries(items.map(i => [i.name, i]));
        expect(byName.tags).toMatchObject({ isJson: true, isJsonEditable: false });
        expect(byName.other).toMatchObject({ isJson: false, isJsonEditable: false });
    });
});

// =============================================================================
// resolveScenarioValues
// =============================================================================

describe('resolveScenarioValues', () => {
    const item = (name: string, type: ContextItem['type'] = 'variable'): ContextItem =>
        ({ name, type, lineNumber: 1, context: '' });

    it('Default contributes only its own values', () => {
        const scenarios: ScenariosData = { Default: { variables: { a: 'x', n: 5 } } };
        expect(resolveScenarioValues(scenarios, 'Default', [])).toEqual({ a: 'x', n: 5 });
    });

    it('other scenarios inherit Default\'s values and override their own', () => {
        const scenarios: ScenariosData = {
            Default: { variables: { username: '', showError: false, theme: 'dark' } },
            Locked: { variables: { username: 'sam', showError: true } },
        };
        expect(resolveScenarioValues(scenarios, 'Locked', [])).toEqual({ username: 'sam', showError: true, theme: 'dark' });
    });

    it('inherits even when the scenario has no variableSources', () => {
        const scenarios: ScenariosData = { Default: { variables: { apiKey: 'k' } }, Empty: { variables: {} } };
        expect(resolveScenarioValues(scenarios, 'Empty', [])).toEqual({ apiKey: 'k' });
    });

    it('parses JSON by Default\'s flags in every scenario, ignoring a scenario\'s own flags', () => {
        const scenarios: ScenariosData = {
            Default: { variables: { user: '{"name":"Ann"}', note: '{"raw":1}' }, variableJsonFlags: { user: true, note: false } },
            Other: { variables: { user: '{"name":"Sam"}', note: '{"raw":2}' }, variableJsonFlags: { user: false, note: true } },
        };
        expect(resolveScenarioValues(scenarios, 'Default', [])).toEqual({ user: { name: 'Ann' }, note: '{"raw":1}' });
        expect(resolveScenarioValues(scenarios, 'Other', [])).toEqual({ user: { name: 'Sam' }, note: '{"raw":2}' });
    });

    it('with no flag, parses values the template uses as objects', () => {
        const scenarios: ScenariosData = {
            Default: { variables: { user: '{"name":"Ann"}', label: '{"x":1}' } },
            Other: { variables: { user: '{"name":"Sam"}' } },
        };
        const items = [item('user', 'object'), item('label')];
        expect(resolveScenarioValues(scenarios, 'Other', items)).toEqual({ user: { name: 'Sam' }, label: '{"x":1}' });
    });

    it('keeps invalid JSON as text and leaves non-string values alone', () => {
        const scenarios: ScenariosData = {
            Default: { variables: { bad: '{oops', list: ['a'] }, variableJsonFlags: { bad: true, list: true } },
        };
        expect(resolveScenarioValues(scenarios, 'Default', [])).toEqual({ bad: '{oops', list: ['a'] });
    });
});

// =============================================================================
// applyMethodMappings
// =============================================================================

describe('applyMethodMappings', () => {
    const mocks = { getSize: 'return 0;', emailOf: 'return name + "@example.com";' };

    it('adds mapped methods to objects with no value', () => {
        const context: Record<string, unknown> = {};
        applyMethodMappings(context, { 'cart.count': 'getSize' }, mocks);
        expect(context).toEqual({ cart: { count: { _implementation: 'return 0;' } } });
    });

    it('keeps a plain object\'s properties and other methods', () => {
        const context: Record<string, unknown> = { user: { name: 'ann', other: { _implementation: 'x' } } };
        applyMethodMappings(context, { 'user.getEmail': 'emailOf' }, mocks);
        expect(context.user).toEqual({
            name: 'ann',
            other: { _implementation: 'x' },
            getEmail: { _implementation: 'return name + "@example.com";' },
        });
    });

    it('leaves lists and other values with their real methods', () => {
        const context: Record<string, unknown> = { sources: ['a', 'b'], title: 'Hi' };
        applyMethodMappings(context, { 'sources.size': 'getSize', 'title.length': 'getSize' }, mocks);
        expect(context).toEqual({ sources: ['a', 'b'], title: 'Hi' });
    });

    it('skips unmapped methods and unknown mock functions', () => {
        const context: Record<string, unknown> = {};
        applyMethodMappings(context, { 'a.b': '', 'c.d': 'missing', 'nodot': 'getSize' }, mocks);
        expect(context).toEqual({});
    });
});
