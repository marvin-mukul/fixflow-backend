import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",
      SEED_SUPERADMIN_PASSWORD: "Rubi@123",
      UPLOAD_DIR: ".test-uploads",
      STORAGE_DRIVER: "local",
    },
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/helpers/globalSetup.ts"],
          // One DB: run files sequentially so truncation can't race.
          fileParallelism: false,
          testTimeout: 15_000,
        },
      },
    ],
  },
});
