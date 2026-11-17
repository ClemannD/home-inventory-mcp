// Types `exports` from "cloudflare:workers" in tests.
declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof import("../worker/index");
    }
  }
}
export {};
