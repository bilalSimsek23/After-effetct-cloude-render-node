import { defineConfig } from 'vitest/config';

// Community Render Asset Protection & Project Lifecycle Security phase —
// this repo previously had no unit test framework at all (only the
// tsx-run `check:*` scripts, which need a real machine with After Effects
// installed and therefore can't run in CI/sandboxed environments). Vitest
// is added specifically to unit-test the new pure/mockable logic this
// phase introduces (AsyncMutex, ExecutionPipeline's guaranteed project-close,
// AdobeWorkspaceService's stale-workspace safety) without needing real AE —
// it does not replace or modify any existing check-script.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
