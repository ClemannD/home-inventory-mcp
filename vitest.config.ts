import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Tests run in workerd against the real Worker with local D1, R2 and KV.
// ASSETS is stubbed: only the gate in front of the SPA is under test.
export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      main: "./worker/index.ts",
      miniflare: {
        compatibilityDate: "2026-08-22",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        r2Buckets: ["FILES"],
        kvNamespaces: ["OAUTH_KV"],
        serviceBindings: { ASSETS: () => new Response("<!doctype html>spa", { headers: { "content-type": "text/html" } }) },
        bindings: {
          APP_NAME: "Home Inventory",
          PUBLIC_URL: "https://home.example.com",
          OWNER_EMAIL: "owner@example.com",
          INGEST_ADDRESS: "inventory@example.com",
          TIMEZONE: "America/New_York",
          DEV_LOG_CODES: "1",
          TEST_MIGRATIONS: await readD1Migrations("./migrations")
        }
      }
    })
  ],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"]
  }
}));
