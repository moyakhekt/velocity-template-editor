/** A method mock as the Velocity server's /render endpoint expects it. */
export interface RenderMethodMock {
    name: string;
    implementation: string;
}

/** Object name → method name → mock. */
export type RenderMethodMocks = Record<string, Record<string, RenderMethodMock>>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMethodImpl(value: unknown): value is { _implementation: string } {
    return isPlainObject(value) && typeof value._implementation === 'string';
}

/**
 * Splits a render context into plain variables and method mocks for the Velocity
 * server. An object with any member of the form `{ _implementation }` becomes a mock
 * object: those members are its methods, and its other members stay as properties.
 */
export function splitVariablesAndMocks(context: Record<string, unknown>): {
    variables: Record<string, unknown>;
    mocks: RenderMethodMocks;
} {
    const variables: Record<string, unknown> = {};
    const mocks: RenderMethodMocks = {};

    for (const [key, value] of Object.entries(context)) {
        if (!isPlainObject(value) || !Object.values(value).some(isMethodImpl)) {
            variables[key] = value;
            continue;
        }
        const methods: Record<string, RenderMethodMock> = {};
        const properties: Record<string, unknown> = {};
        for (const [member, memberValue] of Object.entries(value)) {
            if (isMethodImpl(memberValue)) {
                methods[member] = { name: member, implementation: memberValue._implementation };
            } else {
                properties[member] = memberValue;
            }
        }
        mocks[key] = methods;
        if (Object.keys(properties).length > 0) {
            variables[key] = properties;
        }
    }

    return { variables, mocks };
}
