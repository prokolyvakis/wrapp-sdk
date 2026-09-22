import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['test/setup.ts'],
    include: ['test/**/*.test.ts'],
    passWithNoTests: false,
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'json-summary', 'lcov'],
      thresholds: { lines: 90, statements: 90, functions: 90, branches: 85 },
    },
  },
});
