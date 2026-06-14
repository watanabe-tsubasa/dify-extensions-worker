import { defineConfig } from "vitest/config";

// E2E（デプロイ済み Worker への疎通）専用。npm run test:e2e で実行する。
export default defineConfig({
  test: {
    include: ["**/*.e2e.test.ts"],
  },
});
