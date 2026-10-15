import * as esbuild from "esbuild";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

async function build() {
  const outDir = path.join(__dirname, "dist");
  const wasmOutDir = path.join(outDir, "wasm");

  if (!fs.existsSync(wasmOutDir)) {
    fs.mkdirSync(wasmOutDir, { recursive: true });
  }

  // 1. Copy Tree-sitter WASM assets into dist/wasm/
  const wasmFiles = [
    { src: require.resolve("web-tree-sitter/tree-sitter.wasm"), dest: "tree-sitter.wasm" },
    {
      src: require.resolve("tree-sitter-wasms/out/tree-sitter-javascript.wasm"),
      dest: "tree-sitter-javascript.wasm"
    },
    {
      src: require.resolve("tree-sitter-wasms/out/tree-sitter-typescript.wasm"),
      dest: "tree-sitter-typescript.wasm"
    },
    {
      src: require.resolve("tree-sitter-wasms/out/tree-sitter-tsx.wasm"),
      dest: "tree-sitter-tsx.wasm"
    }
  ];

  for (const item of wasmFiles) {
    const target = path.join(wasmOutDir, item.dest);
    fs.copyFileSync(item.src, target);
    console.log(`Copied WASM asset: ${item.dest}`);
  }

  // 2. Bundle extension
  console.log("Bundling VS Code extension...");
  await esbuild.build({
    entryPoints: [path.join(__dirname, "src/extension.ts")],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "cjs",
    outfile: path.join(outDir, "extension.js"),
    external: ["vscode"],
    sourcemap: true,
    minify: false
  });

  console.log("UNDRIFT VS Code extension bundled successfully.");
}

build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
