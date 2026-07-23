import { isWebviewMessage } from '../../shared/messageTypes';

// =============================================================================
// isWebviewMessage – runtime security guard for all webview → extension messages
// =============================================================================

describe('isWebviewMessage', () => {
    // ── valid inputs ──────────────────────────────────────────────────────────

    it('accepts a minimal valid message with only a command', () => {
        expect(isWebviewMessage({ command: 'reloadEnvironmentContext' })).toBe(true);
    });

    it('accepts a message with a command and additional payload fields', () => {
        expect(
            isWebviewMessage({ command: 'switchScenario', scenario: 'Mobile', extra: 42 })
        ).toBe(true);
    });

    it('accepts every documented command string (spot-check)', () => {
        const commands = [
            'saveVariable', 'saveProperty', 'saveMethod',
            'switchScenario', 'createScenario', 'deleteScenario', 'renameScenario',
            'saveNewScenarioVariable', 'saveScenarioVariableValue',
            'toggleScenarioVariableJson', 'changeScenarioVariableSource',
            'loadEnvironmentContext', 'saveEnvironmentContext',
            'getAvailableScenarioVariables',
        ];
        for (const cmd of commands) {
            expect(isWebviewMessage({ command: cmd })).toBe(true);
        }
    });

    // ── null / undefined / primitives ─────────────────────────────────────────

    it('rejects null', () => {
        expect(isWebviewMessage(null)).toBe(false);
    });

    it('rejects undefined', () => {
        expect(isWebviewMessage(undefined)).toBe(false);
    });

    it('rejects a plain string', () => {
        expect(isWebviewMessage('switchScenario')).toBe(false);
    });

    it('rejects a number', () => {
        expect(isWebviewMessage(42)).toBe(false);
    });

    it('rejects a boolean', () => {
        expect(isWebviewMessage(true)).toBe(false);
    });

    // ── array ─────────────────────────────────────────────────────────────────

    it('rejects an array (even one that contains a valid message object)', () => {
        expect(isWebviewMessage([{ command: 'test' }])).toBe(false);
    });

    // ── malformed objects ─────────────────────────────────────────────────────

    it('rejects an object that is missing the command property', () => {
        expect(isWebviewMessage({ type: 'switchScenario', scenario: 'Default' })).toBe(false);
    });

    it('rejects an object whose command property is a number', () => {
        expect(isWebviewMessage({ command: 123 })).toBe(false);
    });

    it('rejects an object whose command property is null', () => {
        expect(isWebviewMessage({ command: null })).toBe(false);
    });

    it('rejects an object with an empty-string command', () => {
        expect(isWebviewMessage({ command: '' })).toBe(false);
    });

    it('rejects an object with a boolean command', () => {
        expect(isWebviewMessage({ command: true })).toBe(false);
    });
});
