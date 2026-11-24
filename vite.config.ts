import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.{ts,tsx}', 'scripts/**/*.spec.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**', '.claude/**'],
  },
});
