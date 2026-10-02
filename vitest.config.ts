import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: [
      'packages/**/*.test.ts',
      'apps/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    testTimeout: 15000,
    // Bound worker memory while an optional local inference runtime shares the desktop.
    maxWorkers: 4,
  },
});
