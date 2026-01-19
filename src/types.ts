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
