/**
 * Post-tsc script: flattens declaration files from dist/src/ → dist/.
 *
 * tsc --emitDeclarationOnly with rootDir:"." outputs:
 *   dist/src/index.d.ts, dist/src/client.d.ts, etc.
 * We want them at dist/index.d.ts, dist/client.d.ts, etc.
 * esbuild handles the JS bundles separately.
 */
import { renameSync, readdirSync, mkdirSync, existsSync, rmSync } from "fs";
import { join } from "path";

const distDir = new URL("../dist", import.meta.url).pathname;

function flattenDir(srcBase, dstBase) {
  for (const entry of readdirSync(srcBase, { withFileTypes: true })) {
    const from = join(srcBase, entry.name);
    const to = join(dstBase, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(to, { recursive: true });
      flattenDir(from, to);
    } else {
      renameSync(from, to);
    }
  }
}

const srcInDist = join(distDir, "src");
if (existsSync(srcInDist)) {
  flattenDir(srcInDist, distDir);
  rmSync(srcInDist, { recursive: true, force: true });
}

console.log("Declarations flattened: dist/*.d.ts ready");
