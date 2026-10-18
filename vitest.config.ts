import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/test/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
      'apps/editor/*/src/**/*.test.ts',
    ],
  },
});
