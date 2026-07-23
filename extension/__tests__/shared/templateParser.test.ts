import { TemplateParser } from '../../shared/templateParser';

// =============================================================================
// TemplateParser – pure static class, no dependencies on VS Code or file system
// =============================================================================

describe('TemplateParser.analyzeContext', () => {
    it('extracts a simple variable as a variable item', () => {
        const result = TemplateParser.analyzeContext('<p>$name</p>');
        const item = result.get('name');
        expect(item).toBeDefined();
        expect(item!.type).toBe('variable');
    });

    it('extracts an object property access as an object item', () => {
        const result = TemplateParser.analyzeContext('<p>$user.firstName</p>');
        const item = result.get('user');
        expect(item).toBeDefined();
        expect(item!.type).toBe('object');
        expect(item!.properties?.has('firstName')).toBe(true);
    });

    it('extracts a method call as an object item with a methods map', () => {
        const result = TemplateParser.analyzeContext('<p>$user.getName()</p>');
        const item = result.get('user');
        expect(item).toBeDefined();
        expect(item!.type).toBe('object');
        expect(item!.methods?.has('getName')).toBe(true);
    });

    it('promotes a variable to an object when the same name is also used as an object', () => {
        // $user referenced both as plain variable and via $user.getName()
        const result = TemplateParser.analyzeContext('$user $user.getName()');
        const item = result.get('user');
        expect(item).toBeDefined();
        // Must come out as 'object', not 'variable'
        expect(item!.type).toBe('object');
    });

    it('does not include variables assigned by #set', () => {
        const result = TemplateParser.analyzeContext('#set($counter = 0) $input');
        expect(result.has('counter')).toBe(false);
        // $input should still be captured
        expect(result.has('input')).toBe(true);
    });

    it('ignores variables inside single-line ## comments', () => {
        const result = TemplateParser.analyzeContext(
            '## $secret should be ignored\n$visible'
        );
        expect(result.has('secret')).toBe(false);
        expect(result.has('visible')).toBe(true);
    });

    it('ignores variables inside multi-line #* *# block comments', () => {
        const result = TemplateParser.analyzeContext(
            '#* $hidden inside block *#\n$exposed'
        );
        expect(result.has('hidden')).toBe(false);
        expect(result.has('exposed')).toBe(true);
    });

    it('handles an empty template without throwing', () => {
        expect(() => TemplateParser.analyzeContext('')).not.toThrow();
        expect(TemplateParser.analyzeContext('').size).toBe(0);
    });

    it('records the paramCount for method calls', () => {
        const result = TemplateParser.analyzeContext('$dao.findById($id, $order)');
        const dao = result.get('dao');
        expect(dao?.methods?.get('findById')?.paramCount).toBe(2);
    });
});

describe('TemplateParser.extractVariables', () => {
    it('returns all direct variable references', () => {
        const vars = TemplateParser.extractVariables('<p>$firstName $lastName</p>');
        const names = vars.map(v => v.name);
        expect(names).toContain('firstName');
        expect(names).toContain('lastName');
    });

    it('does not return object-qualified references as standalone variables', () => {
        // $user.name → 'user' is a simple variable ref, but not 'name'
        const vars = TemplateParser.extractVariables('$user.name');
        // The parser should capture $user (the object root) but not $user.name as a standalone var
        const names = vars.map(v => v.name);
        expect(names).not.toContain('name');
    });

    it('includes the line number for each variable', () => {
        const vars = TemplateParser.extractVariables('line one\n$myVar');
        const v = vars.find(x => x.name === 'myVar');
        expect(v).toBeDefined();
        expect(v!.lineNumber).toBeGreaterThanOrEqual(2);
    });
});

describe('TemplateParser.inferType', () => {
    it('infers "url" for variables named *URL* or *Url*', () => {
        const type = TemplateParser.inferType('baseUrl', 'baseUrl', '$baseUrl');
        expect(type).toBe('url');
    });

    it('infers "boolean" for variables used in an #if block', () => {
        const type = TemplateParser.inferType('isVisible', 'isVisible', '#if($isVisible)');
        expect(type).toBe('boolean');
    });

    it('infers "number" for count-style variable names', () => {
        const type = TemplateParser.inferType('itemCount', 'itemCount', '$itemCount');
        expect(type).toBe('number');
    });

    it('defaults to "string" for generic variable names', () => {
        const type = TemplateParser.inferType('pageTitle', 'pageTitle', '$pageTitle');
        expect(type).toBe('string');
    });
});
