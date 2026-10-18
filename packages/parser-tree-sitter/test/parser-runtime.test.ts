import * as path from "path";
import * as fs from "fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  ParserRuntime,
  GrammarRegistry,
  TreeSitterRuntimeError,
  GrammarLoadError,
  UnsupportedLanguageError
} from "../src/index";

describe("Tree-sitter Runtime & Grammar Loading POC (POC-A)", () => {
  let runtime: ParserRuntime;
  let registry: GrammarRegistry;

  beforeAll(async () => {
    runtime = new ParserRuntime();
    await runtime.init();
    registry = new GrammarRegistry({ runtime });
  });

  afterAll(() => {
    registry.dispose();
    runtime.dispose();
  });

  describe("1. Runtime initialization & lifecycle", () => {
    it("initializes web-tree-sitter successfully", () => {
      expect(runtime.isInitialized()).toBe(true);
      const wasmPath = runtime.getWasmPath();
      expect(wasmPath).toBeDefined();
      expect(fs.existsSync(wasmPath!)).toBe(true);
      expect(wasmPath!.endsWith("tree-sitter.wasm")).toBe(true);
    });

    it("throws TreeSitterRuntimeError if parser creation is attempted before init", () => {
      const uninitRuntime = new ParserRuntime();
      expect(() => uninitRuntime.createParser()).toThrow(TreeSitterRuntimeError);
      expect(() => uninitRuntime.createParser()).toThrow(/runtime has not been initialized/);
    });

    it("handles multiple init calls idempotently", async () => {
      await expect(runtime.init()).resolves.toBeUndefined();
      expect(runtime.isInitialized()).toBe(true);
    });
  });

  describe("2. Grammar loading & language selection", () => {
    it("reports correct support for file extensions", () => {
      expect(registry.supportsExtension(".js")).toBe(true);
      expect(registry.supportsExtension(".mjs")).toBe(true);
      expect(registry.supportsExtension(".cjs")).toBe(true);
      expect(registry.supportsExtension(".jsx")).toBe(true);
      expect(registry.supportsExtension(".ts")).toBe(true);
      expect(registry.supportsExtension(".tsx")).toBe(true);

      // Unsupported extensions
      expect(registry.supportsExtension(".py")).toBe(false);
      expect(registry.supportsExtension(".rs")).toBe(false);
      expect(registry.supportsExtension(".java")).toBe(false);
      expect(registry.supportsExtension(".go")).toBe(false);
    });

    it("resolves file paths to canonical supported language IDs", () => {
      expect(registry.resolveLanguage("javascript")).toBe("javascript");
      expect(registry.resolveLanguage("javascriptreact")).toBe("javascript");
      expect(registry.resolveLanguage("typescript")).toBe("typescript");
      expect(registry.resolveLanguage("typescriptreact")).toBe("tsx");

      expect(registry.resolveLanguage("", "src/app.js")).toBe("javascript");
      expect(registry.resolveLanguage("", "src/component.jsx")).toBe("javascript");
      expect(registry.resolveLanguage("", "src/server.ts")).toBe("typescript");
      expect(registry.resolveLanguage("", "src/view.tsx")).toBe("tsx");
      expect(registry.resolveLanguage("", "src/script.py")).toBeUndefined();
    });

    it("loads JavaScript grammar and caches it", async () => {
      expect(registry.isLoaded("javascript")).toBe(false);
      const jsLang = await registry.getLanguage("javascript");
      expect(jsLang).toBeDefined();
      expect(registry.isLoaded("javascript")).toBe(true);

      // Subsequent call returns cached language instance
      const cached = await registry.getLanguage("javascript");
      expect(cached).toBe(jsLang);
    });

    it("loads TypeScript grammar and caches it", async () => {
      expect(registry.isLoaded("typescript")).toBe(false);
      const tsLang = await registry.getLanguage("typescript");
      expect(tsLang).toBeDefined();
      expect(registry.isLoaded("typescript")).toBe(true);
    });

    it("loads TSX grammar and caches it", async () => {
      expect(registry.isLoaded("tsx")).toBe(false);
      const tsxLang = await registry.getLanguage("tsx");
      expect(tsxLang).toBeDefined();
      expect(registry.isLoaded("tsx")).toBe(true);
    });
  });

  describe("3. Real parsing across JavaScript, JSX, TypeScript, and TSX", () => {
    it("parses JavaScript source and produces valid syntax tree", async () => {
      const jsLang = await registry.getLanguage("javascript");
      const snippet = runtime.parseSnippet("const greeting = 'hello world';", jsLang);
      try {
        expect(snippet.tree.rootNode.type).toBe("program");
        expect(snippet.tree.rootNode.hasError()).toBe(false);
        expect(snippet.tree.rootNode.namedChildCount).toBe(1);
        const decl = snippet.tree.rootNode.namedChild(0);
        expect(decl?.type).toBe("lexical_declaration");
      } finally {
        snippet.dispose();
      }
    });

    it("parses JSX source using the JavaScript grammar with verified JSX support", async () => {
      const jsLang = await registry.getLanguageForFile("Component.jsx");
      const snippet = runtime.parseSnippet(
        'const button = <button className="primary" onClick={handleClick}>Click</button>;',
        jsLang
      );
      try {
        expect(snippet.tree.rootNode.type).toBe("program");
        expect(snippet.tree.rootNode.hasError()).toBe(false);
        const decl = snippet.tree.rootNode.namedChild(0);
        expect(decl?.type).toBe("lexical_declaration");
        const declarator = decl?.childForFieldName("declarator") ?? decl?.namedChild(0);
        const jsx = declarator?.childForFieldName("value");
        expect(jsx?.type).toBe("jsx_element");
      } finally {
        snippet.dispose();
      }
    });

    it("parses TypeScript source with explicit interfaces and type annotations", async () => {
      const tsLang = await registry.getLanguageForFile("service.ts");
      const source = `
        interface User {
          id: string;
          age: number;
        }
        const user: User = { id: 'u1', age: 30 };
      `;
      const snippet = runtime.parseSnippet(source, tsLang);
      try {
        expect(snippet.tree.rootNode.type).toBe("program");
        expect(snippet.tree.rootNode.hasError()).toBe(false);

        const types = snippet.tree.rootNode.namedChildren.map((n) => n.type);
        expect(types).toContain("interface_declaration");
        expect(types).toContain("lexical_declaration");
      } finally {
        snippet.dispose();
      }
    });

    it("parses TSX source with both TypeScript types and JSX elements", async () => {
      const tsxLang = await registry.getLanguageForFile("App.tsx");
      const source = `
        interface Props {
          label: string;
        }
        export const Button: React.FC<Props> = ({ label }) => {
          return <button type="button">{label}</button>;
        };
      `;
      const snippet = runtime.parseSnippet(source, tsxLang);
      try {
        expect(snippet.tree.rootNode.type).toBe("program");
        expect(snippet.tree.rootNode.hasError()).toBe(false);

        const childTypes = snippet.tree.rootNode.namedChildren.map((n) => n.type);
        expect(childTypes).toContain("interface_declaration");
        expect(childTypes).toContain("export_statement");
      } finally {
        snippet.dispose();
      }
    });
  });

  describe("4. Representative function call syntax structure", () => {
    it("parses an API client call and navigates member expression and arguments", async () => {
      const tsLang = await registry.getLanguage("typescript");
      const source = 'axios.get("/api/v1/users", { timeout: 5000 });';
      const snippet = runtime.parseSnippet(source, tsLang);
      try {
        const root = snippet.tree.rootNode;
        expect(root.type).toBe("program");
        expect(root.hasError()).toBe(false);

        const exprStmt = root.namedChild(0);
        expect(exprStmt?.type).toBe("expression_statement");

        const callExpr = exprStmt?.namedChild(0);
        expect(callExpr?.type).toBe("call_expression");

        // Callee: axios.get
        const fn = callExpr?.childForFieldName("function");
        expect(fn?.type).toBe("member_expression");
        const obj = fn?.childForFieldName("object");
        const prop = fn?.childForFieldName("property");
        expect(obj?.text).toBe("axios");
        expect(prop?.text).toBe("get");

        // Arguments: ("/api/v1/users", { timeout: 5000 })
        const args = callExpr?.childForFieldName("arguments");
        expect(args?.type).toBe("arguments");
        expect(args?.namedChild(0)?.type).toBe("string");
        expect(args?.namedChild(0)?.text).toBe('"/api/v1/users"');
        expect(args?.namedChild(1)?.type).toBe("object");
      } finally {
        snippet.dispose();
      }
    });
  });

  describe("5. Incomplete and malformed syntax recovery", () => {
    it("recovers syntax tree and marks error on truncated function signature", async () => {
      const jsLang = await registry.getLanguage("javascript");
      const snippet = runtime.parseSnippet("function calculateTotals(", jsLang);
      try {
        expect(snippet.tree.rootNode.type).toBe("program");
        expect(snippet.tree.rootNode.hasError()).toBe(true);

        // Find error nodes in the tree
        const hasErrorNode = snippet.tree.rootNode.namedChildren.some(
          (child) => child.type === "ERROR" || child.hasError()
        );
        expect(hasErrorNode).toBe(true);
      } finally {
        snippet.dispose();
      }
    });

    it("recovers syntax tree on incomplete variable declaration", async () => {
      const tsLang = await registry.getLanguage("typescript");
      const snippet = runtime.parseSnippet("const x = ;", tsLang);
      try {
        expect(snippet.tree.rootNode.type).toBe("program");
        expect(snippet.tree.rootNode.hasError()).toBe(true);
      } finally {
        snippet.dispose();
      }
    });
  });

  describe("6. Error handling & disposal safety", () => {
    it("throws UnsupportedLanguageError when unsupported language/file is requested", async () => {
      await expect(registry.getLanguageForFile("script.py")).rejects.toThrow(
        UnsupportedLanguageError
      );
      await expect(registry.getLanguageForFile("Main.java")).rejects.toThrow(
        UnsupportedLanguageError
      );
    });

    it("throws GrammarLoadError when a grammar WASM file cannot be found", async () => {
      const customRegistry = new GrammarRegistry({
        grammarPaths: {
          javascript: path.join(__dirname, "non-existent-grammar.wasm")
        },
        runtime
      });

      await expect(customRegistry.getLanguage("javascript")).rejects.toThrow(GrammarLoadError);
      customRegistry.dispose();
    });

    it("disposes active parsers cleanly without errors", () => {
      const parser1 = runtime.createParser();
      const parser2 = runtime.createParser();
      expect(parser1).toBeDefined();
      expect(parser2).toBeDefined();

      expect(() => runtime.disposeParser(parser1)).not.toThrow();
      expect(() => runtime.dispose()).not.toThrow();
    });
  });

  describe("7. Packaged extension layout asset verification", () => {
    it("initializes runtime and loads grammars from packaged dist/wasm directory", async () => {
      const packagedWasmDir = path.resolve(__dirname, "../../../apps/vscode-extension/dist/wasm");

      // Verify the built packaged assets exist
      expect(fs.existsSync(packagedWasmDir)).toBe(true);
      expect(fs.existsSync(path.join(packagedWasmDir, "tree-sitter.wasm"))).toBe(true);
      expect(fs.existsSync(path.join(packagedWasmDir, "tree-sitter-javascript.wasm"))).toBe(true);
      expect(fs.existsSync(path.join(packagedWasmDir, "tree-sitter-typescript.wasm"))).toBe(true);
      expect(fs.existsSync(path.join(packagedWasmDir, "tree-sitter-tsx.wasm"))).toBe(true);

      const packagedRuntime = new ParserRuntime();
      await packagedRuntime.init({ wasmDirectory: packagedWasmDir });
      expect(packagedRuntime.isInitialized()).toBe(true);
      expect(packagedRuntime.getWasmPath()).toBe(path.join(packagedWasmDir, "tree-sitter.wasm"));

      const packagedRegistry = new GrammarRegistry({
        wasmDirectory: packagedWasmDir,
        runtime: packagedRuntime
      });

      // Verify each grammar loads from the packaged directory
      const jsLang = await packagedRegistry.getLanguage("javascript");
      expect(jsLang).toBeDefined();
      const tsLang = await packagedRegistry.getLanguage("typescript");
      expect(tsLang).toBeDefined();
      const tsxLang = await packagedRegistry.getLanguage("tsx");
      expect(tsxLang).toBeDefined();

      // Verify parsing works with grammars loaded from packaged directory
      const snippet = packagedRuntime.parseSnippet("const packaged = true;", jsLang);
      expect(snippet.tree.rootNode.type).toBe("program");
      expect(snippet.tree.rootNode.hasError()).toBe(false);
      snippet.dispose();

      packagedRegistry.dispose();
      packagedRuntime.dispose();
    });
  });
});
