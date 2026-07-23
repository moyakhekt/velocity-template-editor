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
