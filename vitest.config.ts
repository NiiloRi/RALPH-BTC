import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'src/lib/data/normalizer.ts',
        'src/lib/features/valuation.ts',
        'src/lib/features/momentum.ts',
        'src/lib/features/volatility.ts',
        'src/lib/features/cycle.ts',
        'src/lib/features/macro.ts',
        'src/lib/features/attention.ts',
        'src/lib/features/index.ts',
        'src/lib/risk/model.ts',
        'src/lib/risk/calibration.ts',
      ],
      exclude: ['**/*.test.ts', '**/*.d.ts', '**/index.ts'],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
