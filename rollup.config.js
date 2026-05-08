import resolve from "@rollup/plugin-node-resolve";
import typescript from "rollup-plugin-typescript2";
import dts from "rollup-plugin-dts";

const input = "src/index.ts";

const tsPlugin = typescript({
  tsconfig: "./tsconfig.json",
  useTsconfigDeclarationDir: false,
  tsconfigOverride: { exclude: ["tests", "examples"] },
});

export default [
  {
    input,
    output: {
      file: "dist/index.mjs",
      format: "esm",
      sourcemap: true,
    },
    plugins: [resolve(), tsPlugin],
    external: [],
  },
  {
    input,
    output: {
      file: "dist/index.cjs",
      format: "cjs",
      exports: "named",
      sourcemap: true,
    },
    plugins: [resolve(), tsPlugin],
    external: [],
  },
  {
    input: "src/index.ts",
    output: {
      file: "dist/index.d.ts",
      format: "esm",
    },
    plugins: [dts()],
  },
];
