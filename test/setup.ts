import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

type Migrations = Parameters<typeof applyD1Migrations>[1];
await applyD1Migrations(env.DB, (env as unknown as { TEST_MIGRATIONS: Migrations }).TEST_MIGRATIONS);
