import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 15000,
    // Integration tests share one real Postgres database via a global Prisma
    // singleton. Running test files in parallel lets one file's
    // beforeEach/afterAll cleanup (deleteMany) race against another file's
    // in-flight assertions, deleting rows out from under it. Force files to
    // run sequentially so shared-DB state stays consistent.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
