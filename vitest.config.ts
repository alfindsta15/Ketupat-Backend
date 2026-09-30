import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globalSetup: ["tests/globalSetup.ts"],
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    env: {
      DATABASE_URL: "file:./test.db",
      JWT_SECRET: "test-secret",
      FONNTE_TOKEN: "test-token",
      NODE_ENV: "test",
      APP_BASE_URL: "http://localhost:4000",
    },
  },
});
