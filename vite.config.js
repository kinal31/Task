import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // Everything is defined per-project below so the UI project never
    // inherits the SDK project's include/setup (and vice versa).
    projects: [
      {
        extends: true,
        test: {
          name: 'sdk',
          environment: 'node',
          include: ['tests/sdk/**/*.test.{js,jsx}'],
          setupFiles: ['tests/setup.js'],
        },
      },
      {
        extends: true,
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['tests/ui/**/*.test.{js,jsx}'],
          setupFiles: ['tests/ui-setup.js'],
          globals: true,
        },
      },
    ],
  },
});
