import {
    getUrlWithSource,
    getUrlSourceOptionsData,
    getScenarioHeadersData,
    getScenarioVariablesData,
} from '../../context/contextManagerServices';
import type { ScenarioData, ScenariosData } from '../../shared/types';
import type { ContextData } from '../../context/contextManager';

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
    it('returns own variables with source "self"', () => {
        const scenario: ScenarioData = {
            variables: { username: 'alice', age: 30 },
        };
        const items = getScenarioVariablesData(scenario, {} as ContextData);
        const userItem = items.find(i => i.name === 'username');
        expect(userItem).toBeDefined();
        expect(userItem!.source).toBe('self');
        expect(userItem!.value).toBe('alice');
    });

    it('serializes non-string values to JSON strings', () => {
        const scenario: ScenarioData = {
            variables: { count: 42, active: true },
        };
        const items = getScenarioVariablesData(scenario, {} as ContextData);
        expect(items.find(i => i.name === 'count')!.value).toBe('42');
        expect(items.find(i => i.name === 'active')!.value).toBe('true');
    });

    it('resolves inherited variable from source scenario', () => {
        const allScenarios: ScenariosData = {
            Default: { variables: { apiKey: 'prod-key' } },
            Staging: { variables: {}, variableSources: { apiKey: 'Default' } },
        };
        const stagingScenario = allScenarios['Staging'];
        const items = getScenarioVariablesData(
            stagingScenario,
            {} as ContextData,
            allScenarios,
            'Staging',
        );
        const apiKeyItem = items.find(i => i.name === 'apiKey');
        expect(apiKeyItem).toBeDefined();
        expect(apiKeyItem!.source).toBe('Default');
        expect(apiKeyItem!.value).toBe('prod-key');
    });

    it('falls back to contextData variable names when scenario has no variables', () => {
        const scenario: ScenarioData = { variables: {} };
        const contextData: ContextData = { firstName: '', lastName: '' } as unknown as ContextData;
        const items = getScenarioVariablesData(scenario, contextData);
        const names = items.map(i => i.name);
        expect(names).toContain('firstName');
        expect(names).toContain('lastName');
    });

    it('excludes reserved keys from the contextData fallback', () => {
        const scenario: ScenarioData = { variables: {} };
        const contextData = {
            url: '', headers: '', scenarios: {}, activeScenario: 'Default',
            httpServletRequestVar: '', localeVar: '',
        } as unknown as ContextData;
        const items = getScenarioVariablesData(scenario, contextData);
        const names = items.map(i => i.name);
        expect(names).not.toContain('url');
        expect(names).not.toContain('headers');
        expect(names).not.toContain('scenarios');
        expect(names).not.toContain('activeScenario');
    });

    it('respects the isJson flag when set', () => {
        const scenario: ScenarioData = {
            variables: { tags: '["a","b","c"]' },
            variableJsonFlags: { tags: true },
        };
        const items = getScenarioVariablesData(scenario, {} as ContextData);
        expect(items.find(i => i.name === 'tags')!.isJson).toBe(true);
    });

    it('computes inheritableFrom listing other scenarios that own the variable', () => {
        const allScenarios: ScenariosData = {
            Default: { variables: { locale: 'en' } },
            French: { variables: { locale: 'fr' } },
            German: { variables: { locale: 'de' } },
            Active: { variables: {}, variableSources: { locale: 'Default' } },
        };
        const items = getScenarioVariablesData(
            allScenarios['Active'],
            {} as ContextData,
            allScenarios,
            'Active',
        );
        const localeItem = items.find(i => i.name === 'locale');
        expect(localeItem).toBeDefined();
        // Default and German and French all own 'locale' and are not the active scenario
        expect(localeItem!.inheritableFrom).toContain('Default');
        expect(localeItem!.inheritableFrom).toContain('French');
        expect(localeItem!.inheritableFrom).toContain('German');
        expect(localeItem!.inheritableFrom).not.toContain('Active');
    });
});
