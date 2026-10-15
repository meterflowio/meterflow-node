/**
 * Post-tsc script: puts the declarations where the package's `exports` map says they are.
 *
 * Two things `tsc --emitDeclarationOnly` leaves for us:
 *
 * 1. With rootDir:"." it writes dist/src/index.d.ts; the package ships dist/index.d.ts.
 * 2. It emits declarations for .ts sources and **copies no hand-written .d.ts**.
 *    src/types/openapi.d.ts is one, and every resource declaration imports it, so without the
 *    copy below dist/types/openapi.d.ts is absent, that import dangles, and — silently, under the
 *    `skipLibCheck` every app sets — a consumer's every request body and return type becomes
 *    `any`. 0.5.0 through 0.7.0 shipped that way (docs/DECISIONS.md, 2026-10-15).
 */
import { copyFileSync, renameSync, readdirSync, mkdirSync, existsSync, rmSync } from "fs";
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

/** The hand-written declarations, copied at the path the emitted ones import them from. */
function copyHandWrittenTypes() {
  const from = new URL("../src/types", import.meta.url).pathname;
  const to = join(distDir, "types");
  mkdirSync(to, { recursive: true });
  const copied = readdirSync(from).filter((name) => name.endsWith(".d.ts"));
  for (const name of copied) copyFileSync(join(from, name), join(to, name));
  return copied;
}

// The test runner's own config is in tsconfig's `include` so it is type-checked, which also means
// tsc emits it here. It is not part of the package's surface and does not ship.
for (const stray of ["vitest.config.d.ts", "vitest.config.d.ts.map", "vitest.config.js", "vitest.config.js.map"]) {
  rmSync(join(distDir, stray), { force: true });
}

const types = copyHandWrittenTypes();
console.log(`Declarations flattened: dist/*.d.ts ready; dist/types/ carries ${types.join(", ")}`);
