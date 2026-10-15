// Production entrypoint.
//
// Plesk's Node.js support runs `node <startup file>`, so this file registers tsx's loader and then
// loads the TypeScript server. That keeps production and development on the same code path — there is
// no separate compiled artifact to keep in sync. `tsx` is therefore a runtime dependency.

import { register } from "tsx/esm/api";

register();
await import("./src/index.ts");
