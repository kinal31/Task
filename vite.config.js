import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{js,jsx}'],
    setupFiles: ['tests/setup.js'],
    // Day 2 note: UI tests under tests/ui/ will run with `environment: 'jsdom'`
    // via test.projects once @testing-library deps are installed.
  },
});
