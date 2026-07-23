// AST-based console statement stripper using TypeScript compiler API
// Handles regex literals, template literals, and multi-line statements correctly
const ts = require("typescript");
const fs = require("fs");
const path = require("path");

function stripConsoleCalls(sourceText, fileName) {
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true
  );

  const linesToRemove = new Set();

  function visit(node) {
    if (ts.isExpressionStatement(node)) {
      const expr = node.expression;
      if (
        ts.isCallExpression(expr) &&
        ts.isPropertyAccessExpression(expr.expression)
      ) {
        const obj = expr.expression.expression;
        const method = expr.expression.name.text;
        if (
          ts.isIdentifier(obj) &&
          obj.text === "console" &&
          ["log", "warn", "error", "info", "debug"].includes(method)
        ) {
          const startLine = source.getLineAndCharacterOfPosition(
            node.getStart(source, true)
          ).line;
          const endLine = source.getLineAndCharacterOfPosition(
            node.getEnd()
          ).line;
          for (let l = startLine; l <= endLine; l++) {
            linesToRemove.add(l);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(source);

  const resultLines = sourceText.split("\n").filter((_, i) => !linesToRemove.has(i));
  // Remove runs of multiple blank lines left by removed console statements (collapse to max 1 blank)
  const cleaned = [];
  let blankCount = 0;
  for (const line of resultLines) {
    if (line.trim() === "") {
      blankCount++;
      if (blankCount <= 1) cleaned.push(line);
    } else {
      blankCount = 0;
      cleaned.push(line);
    }
  }
  return cleaned.join("\n");
}

// Process files
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node strip-console-ast.js <file1> [file2] ...");
  process.exit(1);
}

for (const filePath of files) {
  const abs = path.resolve(filePath);
  const original = fs.readFileSync(abs, "utf8");
  const stripped = stripConsoleCalls(original, path.basename(abs));
  fs.writeFileSync(abs, stripped, "utf8");
  const removedLines = original.split("\n").length - stripped.split("\n").length;
  console.log(`${filePath}: removed ~${removedLines} lines`);
}
