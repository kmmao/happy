import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
    test: {
        globals: false,
        environment: 'node',
        include: ['src/**/*.test.ts'],
    },
    resolve: {
        alias: {
            '@': resolve('./src'),
            '@kmmao/happy-wire': resolve('../happy-wire/src/index.ts'),
        },
    },
})
