import { defineConfig, configDefaults } from "vitest/config";

// 既定（npm test）はユニットテストのみ。E2E は分離して実行する。
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/*.e2e.test.ts"],
  },
});
