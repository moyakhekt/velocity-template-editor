/**
 * Parser for extracting Velocity variables and method calls from templates
 */

export interface ExtractedVariable {
    name: string;
    lineNumber: number;
    context: string; // surrounding code for context
}

export interface ExtractedProperty {
    objectName: string;
    propertyName: string;
    lineNumber: number;
    context: string;
}

export interface ExtractedMethod {
    objectName: string;
    methodName: string;
    paramCount: number;
    lineNumber: number;
    context: string;
    fullExpression: string; // e.g., $templateMessages.getMessage($messageKeyPrefix, 'title')
}

export type InferredType = 'string' | 'number' | 'boolean' | 'url' | 'unknown';

export interface DetectedRequestParameter {
    name: string;
    lineNumber: number;
    context: string;
}

export type BranchType = 'if' | 'elseif' | 'else';

export interface BranchCondition {
    type: BranchType;
    expression: string; // raw condition text; empty for 'else'
    lineNumber: number;
    variables: string[]; // $variable references found in this condition
}

export interface ConditionalBlock {
    startLine: number;
    branches: BranchCondition[];
}

export interface ContextItem {
    name: string;
    type: 'variable' | 'object';
    value?: any; // For simple variables
    inferredType?: InferredType; // For variables
    properties?: Map<string, { value: any; lineNumber: number; context: string; inferredType?: InferredType }>;
    methods?: Map<string, { paramCount: number; implementation?: string; lineNumber: number; context: string }>;
    lineNumber: number;
    context: string;
}

export class TemplateParser {
    /**
     * Infer the type of a variable based on how it's used in the template
     */
    static inferType(varName: string, context: string, allContent: string): InferredType {
        const varPattern = new RegExp(`\\$${varName}\\b`, 'g');
        const lines = allContent.split('\n');
        const usageContexts: string[] = [];
        
        // Collect all lines where the variable is used
        lines.forEach(line => {
            if (varPattern.test(line)) {
                usageContexts.push(line);
            }
        });
        
        const allUsages = usageContexts.join(' ');
        
        // URL patterns - check first as they're most specific
        if (/https?:\/\/|\.com|\.net|\.org|BaseURL|[Uu][Rr][Ll]/i.test(context) || 
            /https?:\/\/|\.com|\.net|\.org|BaseURL|[Uu][Rr][Ll]/i.test(allUsages)) {
            return 'url';
        }
        
        // Boolean patterns
        if (/#if\s*\(\s*\$/.test(allUsages) || // Used in #if directly
            /!\s*\$/.test(allUsages) || // Negation
            /\$\w+\s*(==|!=|&&|\|\|)/.test(allUsages) || // Boolean operators
            /true|false|enabled|disabled|visible|hidden/i.test(context)) {
            return 'boolean';
        }
        
        // Number patterns
        if (/\$\w+\s*[+\-*/%]/.test(allUsages) || // Math operations
            /[+\-*/%]\s*\$/.test(allUsages) ||
            /\d+/.test(context) ||
            /count|size|length|index|amount|price|quantity/i.test(varName)) {
            return 'number';
        }
        
        // String patterns (default, but look for indicators)
        if (/\.toLowerCase|\.toUpperCase|\.substring|\.trim|\.split/.test(allUsages) ||
            /['"]/.test(context) ||
            /name|title|message|text|label|description/i.test(varName)) {
            return 'string';
        }
        
        // Default to string as it's most common
        return 'string';
    }

    /**
     * Remove Velocity comments from content
     * Handles both multi-line (#* ... *#) and single-line (##) comments
     * Preserves line numbers by replacing comment content with spaces
     */
    private static stripComments(content: string): string {
        // First, remove multi-line comments: #* ... *#
        // Replace the comment content with spaces to preserve positions
        let cleaned = content.replace(/#\*([\s\S]*?)\*#/g, (match, p1, offset) => {
            // Replace all non-newline characters with spaces to preserve line structure
            return match.replace(/[^\r\n]/g, ' ');
        });
        
        // Remove single-line comments: ## ... (to end of line)
        // Replace everything after ## with spaces (preserving the newline)
        cleaned = cleaned.replace(/##[^\r\n]*/g, (match, offset) => {
            return ' '.repeat(match.length);
        });
        
        
        return cleaned;
    }
    
    /**
     * Extract variables that are set within the template using #set directive
     */
    private static extractSetVariables(content: string): Set<string> {
        const cleanedContent = this.stripComments(content);
        const setVariables = new Set<string>();
        
        // Match #set($variable = ...) patterns - captures base variable name
        // This handles: #set($var = ...), #set($var.prop = ...), #set($var[index] = ...)
        const setPattern = /#set\s*\(\s*\$([a-zA-Z_][a-zA-Z0-9_]*)[\s.=\[]/g;
        
        let match;
        while ((match = setPattern.exec(cleanedContent)) !== null) {
            setVariables.add(match[1]);
        }
        
        return setVariables;
    }
    
    /**
     * Extract all Velocity variable references from template content
     */
    static extractVariables(content: string): ExtractedVariable[] {
        // Strip comments first
        const cleanedContent = TemplateParser.stripComments(content);
        
        // Get variables that are set in the template (should be excluded)
        const setVariables = TemplateParser.extractSetVariables(content);
        
        const variables = new Map<string, ExtractedVariable>();
        const lines = content.split('\n'); // Use original for line numbers
        const cleanedLines = cleanedContent.split('\n');
        
        // Match $variable patterns, excluding method calls
        // Pattern: $variable but not $variable.method() or $variable[
        const varPattern = /\$([a-zA-Z_][a-zA-Z0-9_]*)\b(?!\s*[.([])/g;
        
        cleanedLines.forEach((line, index) => {
            let match;
            while ((match = varPattern.exec(line)) !== null) {
                const varName = match[1];
                
                // Skip if already captured or if it's set within the template
                if (!variables.has(varName) && !setVariables.has(varName)) {
                    variables.set(varName, {
                        name: varName,
                        lineNumber: index + 1,
                        context: lines[index].trim() // Use original line for context
                    });
                }
            }
        });
        
        return Array.from(variables.values());
    }
    
    /**
     * Extract all property accesses from template content
     * Matches $object.property but not $object.method()
     */
    static extractProperties(content: string): ExtractedProperty[] {
        const cleanedContent = TemplateParser.stripComments(content);
        
        // Get variables that are set in the template (should be excluded)
        const setVariables = TemplateParser.extractSetVariables(content);
        
        const properties = new Map<string, ExtractedProperty>();
        const lines = content.split('\n');
        const cleanedLines = cleanedContent.split('\n');
        
        // Match $object.property patterns, excluding method calls
        const propertyPattern = /\$([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)\b(?!\s*\()/g;
        
        cleanedLines.forEach((line, index) => {
            let match;
            while ((match = propertyPattern.exec(line)) !== null) {
                const objectName = match[1];
                const propertyName = match[2];
                const key = `${objectName}.${propertyName}`;
                
                // Skip if the object itself is set within the template
                if (!properties.has(key) && !setVariables.has(objectName)) {
                    properties.set(key, {
                        objectName,
                        propertyName,
                        lineNumber: index + 1,
                        context: lines[index].trim()
                    });
                }
            }
        });
        
        return Array.from(properties.values());
    }
    
    /**
     * Analyze template and return unified context structure
     */
    static analyzeContext(content: string): Map<string, ContextItem> {
        const variables = TemplateParser.extractVariables(content);
        const properties = TemplateParser.extractProperties(content);
        const methods = TemplateParser.extractMethods(content);
        const contextMap = new Map<string, ContextItem>();
        
        // Add simple variables with type inference
        variables.forEach(v => {
            // Check if this variable is also used as an object
            const hasProperties = properties.some(p => p.objectName === v.name);
            const hasMethods = methods.some(m => m.objectName === v.name);
            
            if (!hasProperties && !hasMethods) {
                const inferredType = TemplateParser.inferType(v.name, v.context, content);
                contextMap.set(v.name, {
                    name: v.name,
                    type: 'variable',
                    inferredType: inferredType,
                    lineNumber: v.lineNumber,
                    context: v.context
                });
            }
        });
        
        // Add objects with their properties and methods
        const objectNames = new Set<string>();
        properties.forEach(p => objectNames.add(p.objectName));
        methods.forEach(m => objectNames.add(m.objectName));
        
        objectNames.forEach(objName => {
            const objProperties = properties.filter(p => p.objectName === objName);
            const objMethods = methods.filter(m => m.objectName === objName);
            
            const propertiesMap = new Map<string, any>();
            objProperties.forEach(p => {
                const propInferredType = TemplateParser.inferType(`${objName}.${p.propertyName}`, p.context, content);
                propertiesMap.set(p.propertyName, {
                    value: undefined,
                    lineNumber: p.lineNumber,
                    context: p.context,
                    inferredType: propInferredType
                });
            });
            
            const methodsMap = new Map<string, any>();
            objMethods.forEach(m => {
                methodsMap.set(m.methodName, {
                    paramCount: m.paramCount,
                    implementation: undefined,
                    lineNumber: m.lineNumber,
                    context: m.context
                });
            });
            
            // Find first occurrence for line number
            const firstProperty = objProperties[0];
            const firstMethod = objMethods[0];
            const firstOccurrence = firstProperty || firstMethod;
            
            contextMap.set(objName, {
                name: objName,
                type: 'object',
                properties: propertiesMap,
                methods: methodsMap,
                lineNumber: firstOccurrence.lineNumber,
                context: firstOccurrence.context
            });
        });
        
        return contextMap;
    }
    
    /**
     * Extract all method calls from template content
     * Matches $object.method(...) patterns
     */
    static extractMethods(content: string): ExtractedMethod[] {
        const cleanedContent = TemplateParser.stripComments(content);
        
        // Get variables that are set in the template (should be excluded)
        const setVariables = TemplateParser.extractSetVariables(content);
        
        const methods = new Map<string, ExtractedMethod>();
        const lines = content.split('\n'); // Use original for line numbers
        const cleanedLines = cleanedContent.split('\n');
        
        // Match $object.method(...) patterns
        const methodPattern = /\$([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)/g;
        
        cleanedLines.forEach((line, index) => {
            let match;
            while ((match = methodPattern.exec(line)) !== null) {
                const objectName = match[1];
                const methodName = match[2];
                const argsString = match[3];
                const fullExpression = match[0];
                
                // Skip if the object itself is set within the template
                if (setVariables.has(objectName)) {
                    continue;
                }
                
                // Count parameters (simple heuristic: split by comma, but ignore commas in strings)
                const params = TemplateParser.parseParameters(argsString);
                const paramCount = params.length;
                
                const key = `${objectName}.${methodName}`;
                
                // If not captured yet, or this instance has more parameters, update it
                if (!methods.has(key) || methods.get(key)!.paramCount < paramCount) {
                    methods.set(key, {
                        objectName,
                        methodName,
                        paramCount,
                        lineNumber: index + 1,
                        context: lines[index].trim(), // Use original line for context
                        fullExpression
                    });
                }
            }
        });
        
        return Array.from(methods.values());
    }
    
    /**
     * Parse method parameters from argument string
     * Handles strings, variables, and nested method calls
     */
    private static parseParameters(argsString: string): string[] {
        if (!argsString.trim()) {
            return [];
        }
        
        const params: string[] = [];
        let currentParam = '';
        let inString = false;
        let stringChar = '';
        let parenDepth = 0;
        
        for (let i = 0; i < argsString.length; i++) {
            const char = argsString[i];
            
            if ((char === '"' || char === "'") && (i === 0 || argsString[i - 1] !== '\\')) {
                if (!inString) {
                    inString = true;
                    stringChar = char;
                } else if (char === stringChar) {
                    inString = false;
                }
                currentParam += char;
            } else if (char === '(' && !inString) {
                parenDepth++;
                currentParam += char;
            } else if (char === ')' && !inString) {
                parenDepth--;
                currentParam += char;
            } else if (char === ',' && !inString && parenDepth === 0) {
                params.push(currentParam.trim());
                currentParam = '';
            } else {
                currentParam += char;
            }
        }
        
        if (currentParam.trim()) {
            params.push(currentParam.trim());
        }
        
        return params;
    }
    
    /**
     * Escape a string for safe use inside a RegExp
     */
    private static escapeRegExp(text: string): string {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Detect $<requestVarName>.getParameter("name") / .getParameterValues("name")
     * calls with a literal string argument. This surfaces exactly the HTTP request
     * parameters a template statically reads, so a caller can seed a scenario URL's
     * query string. Calls with a non-literal (dynamic) argument can't be resolved
     * statically and are skipped.
     */
    static extractHttpRequestParameters(content: string, requestVarName: string): DetectedRequestParameter[] {
        if (!requestVarName) {
            return [];
        }

        const cleanedContent = TemplateParser.stripComments(content);
        const lines = content.split('\n');
        const cleanedLines = cleanedContent.split('\n');

        const escapedVar = TemplateParser.escapeRegExp(requestVarName);
        const paramPattern = new RegExp(
            `\\$${escapedVar}\\.(?:getParameter|getParameterValues)\\s*\\(\\s*(['"])([^'"]*)\\1`,
            'g',
        );

        const params = new Map<string, DetectedRequestParameter>();
        cleanedLines.forEach((line, index) => {
            let match;
            while ((match = paramPattern.exec(line)) !== null) {
                const name = match[2];
                if (name && !params.has(name)) {
                    params.set(name, {
                        name,
                        lineNumber: index + 1,
                        context: lines[index].trim(),
                    });
                }
            }
        });

        return Array.from(params.values());
    }

    /**
     * Find the index of the ')' that matches the '(' at content[openIndex].
     * Skips over parens inside single/double-quoted strings. Returns -1 if unmatched.
     */
    private static findMatchingParen(content: string, openIndex: number): number {
        let depth = 0;
        let inString = false;
        let stringChar = '';

        for (let i = openIndex; i < content.length; i++) {
            const char = content[i];
            if (inString) {
                if (char === stringChar && content[i - 1] !== '\\') {
                    inString = false;
                }
                continue;
            }
            if (char === '"' || char === "'") {
                inString = true;
                stringChar = char;
            } else if (char === '(') {
                depth++;
            } else if (char === ')') {
                depth--;
                if (depth === 0) {
                    return i;
                }
            }
        }
        return -1;
    }

    /**
     * Extract $variable / $object.property references from a condition expression
     */
    private static extractVariablesFromExpression(expression: string): string[] {
        const names = new Set<string>();
        const pattern = /\$([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)/g;
        let match;
        while ((match = pattern.exec(expression)) !== null) {
            names.add(match[1]);
        }
        return Array.from(names);
    }

    /**
     * Parse #if / #elseif / #else / #end chains into decision points, each with its
     * branch conditions. Correctly tracks nesting against #foreach, #macro, and
     * #define blocks (which also close with #end) so unrelated #end directives don't
     * get attributed to the wrong #if. Directives inside string literals within a
     * condition (e.g. a literal containing "#end") are not accounted for; this is a
     * static best-effort scan, not a full Velocity parser.
     */
    static extractConditionalBranches(content: string): ConditionalBlock[] {
        const cleanedContent = TemplateParser.stripComments(content);
        const directivePattern = /#(if|elseif|else|foreach|macro|define|end)\b/g;

        type Frame = {
            type: 'if' | 'foreach' | 'macro' | 'define';
            startLine: number;
            branches: BranchCondition[];
        };
        const stack: Frame[] = [];
        const blocks: ConditionalBlock[] = [];

        const lineNumberAt = (index: number): number => {
            let line = 1;
            for (let i = 0; i < index; i++) {
                if (cleanedContent[i] === '\n') {
                    line++;
                }
            }
            return line;
        };

        let match;
        while ((match = directivePattern.exec(cleanedContent)) !== null) {
            const directive = match[1];
            const lineNumber = lineNumberAt(match.index);

            if (directive === 'end') {
                const frame = stack.pop();
                if (frame && frame.type === 'if') {
                    blocks.push({ startLine: frame.startLine, branches: frame.branches });
                }
                continue;
            }

            if (directive === 'foreach' || directive === 'macro' || directive === 'define') {
                stack.push({ type: directive, startLine: lineNumber, branches: [] });
                continue;
            }

            if (directive === 'if' || directive === 'elseif') {
                // Find the parenthesized condition immediately following the directive
                let cursor = directivePattern.lastIndex;
                while (cursor < cleanedContent.length && /\s/.test(cleanedContent[cursor])) {
                    cursor++;
                }
                let expression = '';
                if (cleanedContent[cursor] === '(') {
                    const closeIdx = TemplateParser.findMatchingParen(cleanedContent, cursor);
                    if (closeIdx !== -1) {
                        expression = cleanedContent.slice(cursor + 1, closeIdx).trim();
                        directivePattern.lastIndex = closeIdx + 1;
                    }
                }
                const branch: BranchCondition = {
                    type: directive,
                    expression,
                    lineNumber,
                    variables: TemplateParser.extractVariablesFromExpression(expression),
                };

                if (directive === 'if') {
                    stack.push({ type: 'if', startLine: lineNumber, branches: [branch] });
                } else {
                    const top = stack[stack.length - 1];
                    if (top && top.type === 'if') {
                        top.branches.push(branch);
                    }
                    // #elseif with no enclosing #if is a malformed template; ignore it.
                }
                continue;
            }

            if (directive === 'else') {
                const top = stack[stack.length - 1];
                if (top && top.type === 'if') {
                    top.branches.push({ type: 'else', expression: '', lineNumber, variables: [] });
                }
                continue;
            }
        }

        // Any #if frames still on the stack at EOF are unterminated (missing #end);
        // surface them anyway rather than silently dropping detected branches.
        while (stack.length > 0) {
            const frame = stack.pop()!;
            if (frame.type === 'if') {
                blocks.push({ startLine: frame.startLine, branches: frame.branches });
            }
        }
        blocks.sort((a, b) => a.startLine - b.startLine);

        return blocks;
    }

    /**
     * Find the base names of variables used as the source of a #foreach loop, e.g.
     * #foreach($item in $devices) -> "devices". Only matches a bare $variable as the
     * loop source (not $object.property), since that's the only shape that maps to a
     * top-level scenario variable worth seeding as a JSON array placeholder.
     */
    static extractForeachSourceVariables(content: string): Set<string> {
        const cleanedContent = TemplateParser.stripComments(content);
        const pattern = /#foreach\s*\(\s*\$[a-zA-Z_][a-zA-Z0-9_]*\s+in\s+\$([a-zA-Z_][a-zA-Z0-9_]*)\b(?!\s*[.([])/g;
        const names = new Set<string>();
        let match;
        while ((match = pattern.exec(cleanedContent)) !== null) {
            names.add(match[1]);
        }
        return names;
    }

    /** Returns the loop variable names declared by #foreach, e.g. $device from #foreach($device in $devices). */
    static extractForeachLoopVariables(content: string): Set<string> {
        const cleanedContent = TemplateParser.stripComments(content);
        const pattern = /#foreach\s*\(\s*\$([a-zA-Z_][a-zA-Z0-9_]*)\s+in\s+/g;
        const names = new Set<string>();
        let match;
        while ((match = pattern.exec(cleanedContent)) !== null) {
            names.add(match[1]);
        }
        return names;
    }

    /**
     * Get a summary of all references in the template
     */
    static analyzeTemplate(content: string): {
        variables: ExtractedVariable[];
        methods: ExtractedMethod[];
        summary: string;
    } {
        const variables = TemplateParser.extractVariables(content);
        const methods = TemplateParser.extractMethods(content);
        
        const summary = [
            `Found ${variables.length} unique variables:`,
            ...variables.map(v => `  - $${v.name} (line ${v.lineNumber})`),
            '',
            `Found ${methods.length} unique methods:`,
            ...methods.map(m => `  - $${m.objectName}.${m.methodName}() with ${m.paramCount} param(s) (line ${m.lineNumber})`)
        ].join('\n');
        
        return { variables, methods, summary };
    }
}
