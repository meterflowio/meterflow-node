/**
 * Does the tarball carry everything its own declarations ask for?
 *
 * The build can be green and the package still useless: `dist/resources/*.d.ts` import
 * `../types/openapi`, which `tsc` never emitted and `files: ["dist"]` therefore never shipped.
 * Under `skipLibCheck` — on by default in every app — that dangling import is silent, and a
 * consumer's request bodies and return types quietly become `any`. 0.5.0 through 0.7.0 shipped
 * that way and nothing noticed (docs/DECISIONS.md, 2026-10-15).
 *
 * So this checks the **tarball**, not the build: `npm pack --dry-run --json` is exactly the file
 * list npm would publish. Every relative type import in every packed declaration must resolve to
 * another packed file, and every entry point the manifest promises must be there.
 *
 *   node scripts/check-pack.mjs        # after `npm run build`
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

/** What npm would put in the tarball, as paths relative to the package root. */
function packedFiles() {
  const output = execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: root, encoding: "utf8" });
  return new Set(JSON.parse(output)[0].files.map((file) => file.path));
}

/** The relative specifiers a declaration file imports — `import type { x } from "./y"` and friends. */
function relativeImports(source) {
  const specifiers = [...source.matchAll(/from\s+["'](\.[^"']+)["']/g), ...source.matchAll(/import\(["'](\.[^"']+)["']\)/g)];
  return specifiers.map((match) => match[1]);
}

/** Where a specifier would resolve from `declaration`, or null when nothing it could mean is packed. */
function resolved(declaration, specifier, packed) {
  const base = normalize(join(dirname(declaration), specifier));
  const candidates = [`${base}.d.ts`, join(base, "index.d.ts"), base];
  return candidates.find((candidate) => packed.has(candidate)) ?? null;
}

const packed = packedFiles();
const problems = [];

// Every entry point the manifest promises a consumer.
const entryPoints = [manifest.types, manifest.main, manifest.module];
for (const subpath of Object.values(manifest.exports ?? {})) {
  entryPoints.push(...Object.values(subpath));
}
for (const entry of entryPoints.filter(Boolean).map((path) => path.replace(/^\.\//, ""))) {
  if (!packed.has(entry)) problems.push(`${entry} is promised by package.json and is not in the tarball`);
}

// Every relative import inside a packed declaration.
for (const declaration of [...packed].filter((path) => path.endsWith(".d.ts"))) {
  const source = readFileSync(join(root, declaration), "utf8");
  for (const specifier of relativeImports(source)) {
    if (!resolved(declaration, specifier, packed)) {
      problems.push(`${declaration} imports "${specifier}", which is not in the tarball`);
    }
  }
}

if (problems.length > 0) {
  console.error(`The tarball is missing ${problems.length} file(s) its own declarations need:\n`);
  for (const problem of problems) console.error(`  • ${problem}`);
  console.error("\nA consumer would compile against `any` instead of these types, and nothing would say so.");
  console.error("Hand-written .d.ts files are copied into dist/ by scripts/build-fix.mjs — run `npm run build` first.");
  process.exit(1);
}

console.log(`Tarball ok: ${packed.size} files, every declaration's imports resolve inside it.`);
