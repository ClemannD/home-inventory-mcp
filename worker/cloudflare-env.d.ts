// Types `env` imported from "cloudflare:workers".
import type { Env as WorkerEnv } from "./env";

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}
