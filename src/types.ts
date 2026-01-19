// Type definitions for Velocity template context

export interface VariableData {
    [key: string]: any;
}

export interface MethodMock {
    name: string;
    implementation: string;
}

export interface MethodMockData {
    [className: string]: {
        [methodName: string]: MethodMock;
    };
}

export interface ScenarioData {
    [variableName: string]: any;
}

export interface ScenariosData {
    [scenarioName: string]: ScenarioData;
}

export interface ContextData {
    url?: string;
    headers?: string;
    httpServletRequestVar?: string | '';
    methods: any; // Methods shared across all scenarios
    scenarios: ScenariosData; // Named variable sets
    activeScenario: string; // Currently selected scenario
}
