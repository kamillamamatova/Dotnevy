import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  root: path.resolve(__dirname),
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Set required env vars for modules that validate at load time
    env: {
      MASTER_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', // 32 zero bytes base64
      CLI_JWT_SECRET: 'test-cli-jwt-secret-for-unit-tests-only',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
