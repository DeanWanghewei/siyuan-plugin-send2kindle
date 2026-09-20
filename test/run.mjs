/**
 * 用 esbuild 打包烟雾测试（TS → ESM），然后交给 node 执行。
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));

await build({
    entryPoints: [join(here, "smoke.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: "/tmp/s2k-smoke.mjs",
});

const r = spawnSync(process.execPath, ["/tmp/s2k-smoke.mjs"], { stdio: "inherit" });
process.exit(r.status ?? 1);
