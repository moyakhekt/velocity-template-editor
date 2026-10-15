import { splitVariablesAndMocks } from '../../shared/renderInput';

describe('splitVariablesAndMocks', () => {
    it('passes plain values through as variables', () => {
        const context = { name: 'Ann', count: 3, tags: ['a'], user: { name: 'Ann' }, missing: null };
        expect(splitVariablesAndMocks(context)).toEqual({ variables: context, mocks: {} });
    });

    it('turns objects with _implementation members into mocks', () => {
        const { variables, mocks } = splitVariablesAndMocks({
            cart: { count: { _implementation: 'return 3;' } },
        });
        expect(mocks).toEqual({ cart: { count: { name: 'count', implementation: 'return 3;' } } });
        expect(variables).toEqual({});
    });

    it('keeps a mock object\'s other members as its properties', () => {
        const { variables, mocks } = splitVariablesAndMocks({
            user: { name: 'Ann', getEmail: { _implementation: 'return "a@b";' } },
        });
        expect(mocks.user).toEqual({ getEmail: { name: 'getEmail', implementation: 'return "a@b";' } });
        expect(variables.user).toEqual({ name: 'Ann' });
    });

    it('ignores _implementation values that aren\'t strings', () => {
        const context = { odd: { m: { _implementation: 42 } } };
        expect(splitVariablesAndMocks(context)).toEqual({ variables: context, mocks: {} });
    });
});
