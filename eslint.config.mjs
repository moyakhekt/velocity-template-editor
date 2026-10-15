// ESLint flat config: https://eslint.org/docs/latest/use/configure/
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["out/**", "node_modules/**", "server/**", "docs/**", "**/*.d.ts"],
  },

  // Extension host (TypeScript, Node)
  {
    files: ["extension/**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      // A leading underscore marks a deliberately unused name
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
    },
  },

  // Tests and the vscode mock
  {
    files: ["extension/__tests__/**/*.ts", "extension/__mocks__/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
    },
    rules: {
      // Tests reach into internals and build partial fakes
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // Context Manager webview script (plain JavaScript in the browser)
  {
    files: ["webview-ui/**/*.js"],
    extends: [js.configs.recommended],
    languageOptions: {
      sourceType: "script",
      globals: { ...globals.browser, acquireVsCodeApi: "readonly" },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
    },
  },

  // Build and test configuration (CommonJS, Node)
  {
    files: ["esbuild.js", "jest.config.js"],
    extends: [js.configs.recommended],
    languageOptions: {
      sourceType: "commonjs",
      globals: globals.node,
    },
  },
);
