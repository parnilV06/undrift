import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SourceDocument } from "@undrift/core";
import {
  TreeSitterParserAdapter,
  ParserRuntime,
  GrammarRegistry,
  UnsupportedLanguageError,
  TreeSitterRuntimeError,
  SyntaxNodeFacade
} from "../src/index";

describe("TreeSitterParserAdapter Unit Tests", () => {
  let runtime: ParserRuntime;
  let registry: GrammarRegistry;
  let adapter: TreeSitterParserAdapter;

  beforeAll(async () => {
    runtime = new ParserRuntime();
    await runtime.init();
    registry = new GrammarRegistry({ runtime });
    adapter = new TreeSitterParserAdapter({ runtime, registry });
  });

  afterAll(() => {
    adapter.dispose();
  });

  describe("1. Language and file extension support (supports)", () => {
    it("accepts documented JavaScript, TypeScript, JSX, and TSX combinations", () => {
      // By languageId
      expect(adapter.supports("javascript", "file:///app.js")).toBe(true);
      expect(adapter.supports("javascriptreact", "file:///app.jsx")).toBe(true);
      expect(adapter.supports("typescript", "file:///server.ts")).toBe(true);
      expect(adapter.supports("typescriptreact", "file:///view.tsx")).toBe(true);
      expect(adapter.supports("jsx", "file:///comp.jsx")).toBe(true);
      expect(adapter.supports("ts", "file:///mod.ts")).toBe(true);
      expect(adapter.supports("tsx", "file:///page.tsx")).toBe(true);

      // By file extension alone when languageId is generic
      expect(adapter.supports("", "file:///index.js")).toBe(true);
      expect(adapter.supports("", "file:///index.mjs")).toBe(true);
      expect(adapter.supports("", "file:///index.cjs")).toBe(true);
      expect(adapter.supports("", "file:///component.jsx")).toBe(true);
      expect(adapter.supports("", "file:///service.ts")).toBe(true);
      expect(adapter.supports("", "file:///component.tsx")).toBe(true);
    });

    it("rejects unsupported languages and file extensions", () => {
      expect(adapter.supports("python", "file:///script.py")).toBe(false);
      expect(adapter.supports("rust", "file:///main.rs")).toBe(false);
      expect(adapter.supports("go", "file:///main.go")).toBe(false);
      expect(adapter.supports("java", "file:///App.java")).toBe(false);
      expect(adapter.supports("", "file:///README.md")).toBe(false);
      expect(adapter.supports("", "file:///styles.css")).toBe(false);
    });

    it("has stable adapter ID", () => {
      expect(adapter.id).toBe("tree-sitter");
    });
  });

  describe("2. Unsupported language rejection on parse()", () => {
    it("throws UnsupportedLanguageError for unsupported language", async () => {
      const doc: SourceDocument = {
        uri: "file:///script.py",
        languageId: "python",
        text: "print('hello')",
        contentHash: "hash1"
      };

      await expect(adapter.parse({ document: doc })).rejects.toThrow(UnsupportedLanguageError);
      await expect(adapter.parse({ document: doc })).rejects.toThrow(/python.*not supported/);
    });
  });

  describe("3. Valid JavaScript parsing and document snapshot binding", () => {
    it("returns ParsedDocument matching source snapshot with usable syntax tree", async () => {
      const source = "const message = 'Hello UNDRIFT!';\nconsole.log(message);\n";
      const doc: SourceDocument = {
        uri: "file:///app.js",
        languageId: "javascript",
        text: source,
        contentHash: "hash-js-1",
        documentVersion: 1
      };

      const parsed = await adapter.parse({ document: doc });

      try {
        // Document snapshot reference must match exactly
        expect(parsed.source).toBe(doc);
        expect(parsed.issues).toEqual([]);

        // Root syntax facade
        const root = parsed.root;
        expect(root).toBeInstanceOf(SyntaxNodeFacade);
        expect(root.kind).toBe("program");
        expect(root.text()).toBe(source);
        expect(root.range).toEqual({ start: 0, end: source.length });

        // Children traversal
        const children = root.children();
        expect(children.length).toBe(2);
        expect(children[0].kind).toBe("lexical_declaration");
        expect(children[0].text()).toBe("const message = 'Hello UNDRIFT!';");
        expect(children[1].kind).toBe("expression_statement");
        expect(children[1].text()).toBe("console.log(message);");

        // Named children & field lookup
        const declarator = children[0].namedChildren()[0];
        expect(declarator.kind).toBe("variable_declarator");
        const nameNode = declarator.childForField("name");
        expect(nameNode?.text()).toBe("message");
        const valueNode = declarator.childForField("value");
        expect(valueNode?.text()).toBe("'Hello UNDRIFT!'");
      } finally {
        parsed.dispose();
      }
    });
  });

  describe("4. TypeScript declaration and type shape parsing", () => {
    it("parses TypeScript interfaces, types, and annotations correctly", async () => {
      const source =
        "interface User {\n" +
        "  id: string;\n" +
        "  name: string;\n" +
        "}\n\n" +
        "function getUser(id: string): User {\n" +
        "  return { id, name: 'Alice' };\n" +
        "}\n";

      const doc: SourceDocument = {
        uri: "file:///user-service.ts",
        languageId: "typescript",
        text: source,
        contentHash: "hash-ts-1"
      };

      const parsed = await adapter.parse({ document: doc });

      try {
        expect(parsed.issues).toEqual([]);
        const root = parsed.root;
        expect(root.kind).toBe("program");

        const named = root.namedChildren();
        expect(named.length).toBe(2);

        // 1. interface User
        const interfaceNode = named[0];
        expect(interfaceNode.kind).toBe("interface_declaration");
        const interfaceName = interfaceNode.childForField("name");
        expect(interfaceName?.text()).toBe("User");

        // 2. function getUser
        const funcNode = named[1];
        expect(funcNode.kind).toBe("function_declaration");
        const funcName = funcNode.childForField("name");
        expect(funcName?.text()).toBe("getUser");

        const retType = funcNode.childForField("return_type");
        expect(retType?.text()).toBe(": User");
      } finally {
        parsed.dispose();
      }
    });
  });

  describe("5. JSX and TSX parsing with respective grammars", () => {
    it("parses JSX elements using JavaScript grammar", async () => {
      const source = "const btn = <button className='btn' onClick={handleClick}>Save</button>;";
      const doc: SourceDocument = {
        uri: "file:///Button.jsx",
        languageId: "javascriptreact",
        text: source,
        contentHash: "hash-jsx-1"
      };

      const parsed = await adapter.parse({ document: doc });

      try {
        expect(parsed.issues).toEqual([]);
        const declarator = parsed.root.namedChildren()[0].namedChildren()[0];
        const jsxElem = declarator.childForField("value");
        expect(jsxElem?.kind).toBe("jsx_element");
        expect(jsxElem?.text()).toBe("<button className='btn' onClick={handleClick}>Save</button>");
      } finally {
        parsed.dispose();
      }
    });

    it("parses TSX combining TypeScript generic types and JSX elements", async () => {
      const source =
        "interface Props { title: string; }\n" +
        "const Header: React.FC<Props> = ({ title }) => <h1>{title}</h1>;\n";

      const doc: SourceDocument = {
        uri: "file:///Header.tsx",
        languageId: "typescriptreact",
        text: source,
        contentHash: "hash-tsx-1"
      };

      const parsed = await adapter.parse({ document: doc });

      try {
        expect(parsed.issues).toEqual([]);
        const named = parsed.root.namedChildren();
        expect(named[0].kind).toBe("interface_declaration");
        expect(named[1].kind).toBe("lexical_declaration");
        expect(named[1].text()).toContain("<h1>{title}</h1>");
      } finally {
        parsed.dispose();
      }
    });
  });

  describe("6. Error recovery and ParseIssue collection on malformed source", () => {
    it("recovers syntax tree and produces ParseIssue on incomplete syntax", async () => {
      const source = "const x = ;\nconst y = 42;";
      const doc: SourceDocument = {
        uri: "file:///broken.js",
        languageId: "javascript",
        text: source,
        contentHash: "hash-broken-1"
      };

      const parsed = await adapter.parse({ document: doc });

      try {
        // Must return usable tree despite parse errors
        expect(parsed.root).toBeDefined();
        expect(parsed.root.kind).toBe("program");

        // Statement 2 should still be successfully parsed!
        const stmts = parsed.root.namedChildren();
        expect(stmts.length).toBeGreaterThanOrEqual(2);
        expect(stmts[stmts.length - 1].text()).toBe("const y = 42;");

        // Parse issues must be reported
        expect(parsed.issues.length).toBeGreaterThan(0);
        const issue = parsed.issues[0];
        expect(issue.isError).toBe(true);
        expect(issue.message).toMatch(/unexpected token/i);
        expect(issue.source).toBeDefined();
        expect(issue.source?.uri).toBe("file:///broken.js");
        expect(issue.source?.start).toEqual({ line: 0, character: 8 });
      } finally {
        parsed.dispose();
      }
    });

    it("produces ParseIssue with location for missing syntax tokens", async () => {
      const source = "let x = (1 + 2;\nlet z = 99;";
      const doc: SourceDocument = {
        uri: "file:///missing-paren.js",
        languageId: "javascript",
        text: source,
        contentHash: "hash-missing-1"
      };

      const parsed = await adapter.parse({ document: doc });

      try {
        expect(parsed.issues.length).toBeGreaterThan(0);
        const missingIssue = parsed.issues.find((i) => i.message.includes("missing"));
        expect(missingIssue).toBeDefined();
        expect(missingIssue?.isError).toBe(true);
        expect(missingIssue?.message).toContain("missing ')'");
        expect(missingIssue?.source).toBeDefined();
        expect(missingIssue?.source?.start.line).toBe(0);
      } finally {
        parsed.dispose();
      }
    });
  });

  describe("7. Unicode, emoji, and CRLF coordinate accuracy", () => {
    it("preserves exact source spans across CRLF and emojis end-to-end", async () => {
      const source =
        "// 🚀 Service: Alpha\r\n" +
        "const route = '/api/🚀/data';\r\n" +
        "const status = 200;\r\n";

      const doc: SourceDocument = {
        uri: "file:///unicode-crlf.ts",
        languageId: "typescript",
        text: source,
        contentHash: "hash-uni-1"
      };

      const parsed = await adapter.parse({ document: doc });

      try {
        expect(parsed.issues).toEqual([]);
        const nodes = parsed.root.namedChildren();

        // 1. Comment
        const comment = nodes[0];
        expect(comment.kind).toBe("comment");
        expect(source.slice(comment.range.start, comment.range.end)).toBe(comment.text());

        // 2. const route = '/api/🚀/data';
        const stmt1 = nodes[1];
        expect(stmt1.kind).toBe("lexical_declaration");
        expect(source.slice(stmt1.range.start, stmt1.range.end)).toBe(stmt1.text());

        const strLiteral = stmt1.namedChildren()[0].childForField("value")!;
        expect(strLiteral.text()).toBe("'/api/🚀/data'");
        expect(source.slice(strLiteral.range.start, strLiteral.range.end)).toBe("'/api/🚀/data'");

        // 3. const status = 200; on next CRLF line
        const stmt2 = nodes[2];
        expect(stmt2.kind).toBe("lexical_declaration");
        expect(source.slice(stmt2.range.start, stmt2.range.end)).toBe("const status = 200;");
      } finally {
        parsed.dispose();
      }
    });
  });

  describe("8. Resource lifecycle, disposal, and idempotency", () => {
    it("safely disposes parsed document and is idempotent", async () => {
      const doc: SourceDocument = {
        uri: "file:///lifecycle.js",
        languageId: "javascript",
        text: "const a = 1;",
        contentHash: "hash-life-1"
      };

      const parsed = await adapter.parse({ document: doc });
      expect(parsed.root).toBeDefined();

      // First disposal
      expect(() => parsed.dispose()).not.toThrow();

      // Repeated disposal must be safely idempotent
      expect(() => parsed.dispose()).not.toThrow();
    });

    it("rejects parse() calls after adapter disposal", async () => {
      const localAdapter = new TreeSitterParserAdapter();
      localAdapter.dispose();

      expect(localAdapter.supports("javascript", "file:///app.js")).toBe(false);

      const doc: SourceDocument = {
        uri: "file:///test.js",
        languageId: "javascript",
        text: "const x = 1;",
        contentHash: "hash-1"
      };

      await expect(localAdapter.parse({ document: doc })).rejects.toThrow(TreeSitterRuntimeError);
      await expect(localAdapter.parse({ document: doc })).rejects.toThrow(/has been disposed/);

      // Repeated disposal on adapter is idempotent
      expect(() => localAdapter.dispose()).not.toThrow();
    });
  });

  describe("9. Cancellation with AbortSignal", () => {
    it("rejects immediately when passed an already-aborted signal", async () => {
      const doc: SourceDocument = {
        uri: "file:///abort.js",
        languageId: "javascript",
        text: "const a = 100;",
        contentHash: "hash-abort-1"
      };

      const controller = new AbortController();
      controller.abort();

      await expect(adapter.parse({ document: doc }, controller.signal)).rejects.toThrow();
    });

    it("cleans up resources cleanly when aborted during execution", async () => {
      const doc: SourceDocument = {
        uri: "file:///abort-mid.js",
        languageId: "javascript",
        text: "const largeCode = Array(100).fill(1);",
        contentHash: "hash-abort-2"
      };

      const controller = new AbortController();
      // Abort immediately before call finishes
      const parsePromise = adapter.parse({ document: doc }, controller.signal);
      controller.abort();

      await expect(parsePromise).rejects.toThrow();
    });
  });

  describe("10. Public interface boundary and encapsulation", () => {
    it("never exposes concrete web-tree-sitter Tree or Node objects through ParsedDocument", async () => {
      const doc: SourceDocument = {
        uri: "file:///boundary.js",
        languageId: "javascript",
        text: "function test() { return 42; }",
        contentHash: "hash-bound-1"
      };

      const parsed = await adapter.parse({ document: doc });

      try {
        // ParsedDocument keys must only be source, root, issues, dispose
        const docKeys = Object.keys(parsed);
        expect(docKeys).toContain("source");
        expect(docKeys).toContain("root");
        expect(docKeys).toContain("issues");
        expect(docKeys).toContain("dispose");

        const parsedAny = parsed as unknown as Record<string, unknown>;
        expect(parsedAny.tree).toBeUndefined();
        expect(parsedAny.parser).toBeUndefined();

        // Root node
        const rootAny = parsed.root as unknown as Record<string, unknown>;
        expect(rootAny.innerNode).toBeUndefined();
        expect(rootAny.tree).toBeUndefined();
        expect(rootAny.id).toBeUndefined();
      } finally {
        parsed.dispose();
      }
    });
  });

  describe("11. Previous parsed document handling", () => {
    it("safely handles ParseRequest with previous document without mutating or disposing it", async () => {
      const docV1: SourceDocument = {
        uri: "file:///versioned.ts",
        languageId: "typescript",
        text: "const v = 1;",
        contentHash: "hash-v1",
        documentVersion: 1
      };

      const parsedV1 = await adapter.parse({ document: docV1 });

      const docV2: SourceDocument = {
        uri: "file:///versioned.ts",
        languageId: "typescript",
        text: "const v = 2;",
        contentHash: "hash-v2",
        documentVersion: 2
      };

      // Pass previous parsed document
      const parsedV2 = await adapter.parse({
        document: docV2,
        previous: parsedV1
      });

      try {
        expect(parsedV2.source).toBe(docV2);
        expect(parsedV2.root.text()).toBe("const v = 2;");

        // previous document must remain untouched and undisposed
        expect(parsedV1.source).toBe(docV1);
        expect(parsedV1.root.text()).toBe("const v = 1;");
      } finally {
        parsedV2.dispose();
        parsedV1.dispose();
      }
    });
  });

  describe("12. Grammar loading failure and error handling", () => {
    it("propagates GrammarLoadError and cleans up when grammar loading fails", async () => {
      const failingRegistry = new GrammarRegistry({
        runtime,
        grammarPaths: {
          javascript: "z:/non/existent/path/tree-sitter-javascript.wasm"
        }
      });
      const failingAdapter = new TreeSitterParserAdapter({
        runtime,
        registry: failingRegistry
      });

      const doc: SourceDocument = {
        uri: "file:///fail.js",
        languageId: "javascript",
        text: "const fail = true;",
        contentHash: "hash-fail"
      };

      await expect(failingAdapter.parse({ document: doc })).rejects.toThrow();

      failingAdapter.dispose();
    });
  });
});
