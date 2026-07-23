'use strict';

/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/extension'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^vscode$': '<rootDir>/extension/__mocks__/vscode.ts',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.test.json',
      },
    ],
  },
  // Print a summary line per test file
  verbose: true,
};
