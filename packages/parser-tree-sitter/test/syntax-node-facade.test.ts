import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SyntaxNode } from "@undrift/core";
import { ParserRuntime, GrammarRegistry, PositionMapper, SyntaxNodeFacade } from "../src/index";

describe("SyntaxNodeFacade Unit Tests", () => {
  let runtime: ParserRuntime;
  let registry: GrammarRegistry;

  beforeAll(async () => {
    runtime = new ParserRuntime();
    await runtime.init();
    registry = new GrammarRegistry({ runtime });
    await registry.getLanguage("javascript");
    await registry.getLanguage("typescript");
  });

  afterAll(() => {
    registry.dispose();
    runtime.dispose();
  });

  describe("1. Root node properties and kind", () => {
    it("wraps root node exposing kind, range, byteRange, and text", async () => {
      const source = "const greeting = 'hello';";
      const jsLang = await registry.getLanguage("javascript");
      const handle = runtime.parseSnippet(source, jsLang);

      try {
        const mapper = new PositionMapper(source, "file:///app.js");
        const root: SyntaxNode = new SyntaxNodeFacade(handle.tree.rootNode, mapper);

        expect(root.kind).toBe("program");
        expect(root.range).toEqual({ start: 0, end: source.length });
        expect(root.byteRange).toEqual({ start: 0, end: source.length });
        expect(root.text()).toBe(source);
      } finally {
        handle.dispose();
      }
    });
  });

  describe("2. Child traversal and encapsulation", () => {
    it("returns children wrapped as SyntaxNode facades", async () => {
      const source = "const a = 1; let b = 2;";
      const jsLang = await registry.getLanguage("javascript");
      const handle = runtime.parseSnippet(source, jsLang);

      try {
        const mapper = new PositionMapper(source);
        const root = new SyntaxNodeFacade(handle.tree.rootNode, mapper);

        const children = root.children();
        expect(children.length).toBeGreaterThan(0);

        // Every child must be a SyntaxNodeFacade
        for (const child of children) {
          expect(child).toBeInstanceOf(SyntaxNodeFacade);
          expect(typeof child.kind).toBe("string");
          expect(child.range.start).toBeGreaterThanOrEqual(0);
          expect(child.range.end).toBeLessThanOrEqual(source.length);
          expect(child.text()).toBe(source.slice(child.range.start, child.range.end));
        }

        // Verify statements
        expect(children[0].kind).toBe("lexical_declaration");
        expect(children[0].text()).toBe("const a = 1;");
        expect(children[1].kind).toBe("lexical_declaration");
        expect(children[1].text()).toBe("let b = 2;");
      } finally {
        handle.dispose();
      }
    });
  });

  describe("3. Named-child traversal", () => {
    it("returns only named children, omitting punctuation", async () => {
      const source = "const sum = add(1, 2);";
      const jsLang = await registry.getLanguage("javascript");
      const handle = runtime.parseSnippet(source, jsLang);

      try {
        const mapper = new PositionMapper(source);
        const root = new SyntaxNodeFacade(handle.tree.rootNode, mapper);

        const statement = root.children()[0];
        expect(statement.kind).toBe("lexical_declaration");

        // statement.children() includes anonymous tokens ("const", ";")
        const allChildren = statement.children();
        const namedChildren = statement.namedChildren();

        expect(allChildren.length).toBeGreaterThan(namedChildren.length);
        expect(namedChildren.length).toBe(1);
        expect(namedChildren[0].kind).toBe("variable_declarator");
        expect(namedChildren[0].text()).toBe("sum = add(1, 2)");
      } finally {
        handle.dispose();
      }
    });
  });

  describe("4. Named field lookup (childForField)", () => {
    it("retrieves child nodes by grammar field name", async () => {
      const source = "const name = 'Alice';";
      const jsLang = await registry.getLanguage("javascript");
      const handle = runtime.parseSnippet(source, jsLang);

      try {
        const mapper = new PositionMapper(source);
        const root = new SyntaxNodeFacade(handle.tree.rootNode, mapper);
        const declarator = root.namedChildren()[0].namedChildren()[0];
        expect(declarator.kind).toBe("variable_declarator");

        const nameField = declarator.childForField("name");
        expect(nameField).toBeDefined();
        expect(nameField).toBeInstanceOf(SyntaxNodeFacade);
        expect(nameField!.kind).toBe("identifier");
        expect(nameField!.text()).toBe("name");
        expect(nameField!.range).toEqual({ start: 6, end: 10 });

        const valueField = declarator.childForField("value");
        expect(valueField).toBeDefined();
        expect(valueField!.kind).toBe("string");
        expect(valueField!.text()).toBe("'Alice'");

        // Non-existent field returns undefined
        const nonExistent = declarator.childForField("non_existent_field");
        expect(nonExistent).toBeUndefined();
      } finally {
        handle.dispose();
      }
    });

    it("looks up function and arguments fields in call expressions", async () => {
      const source = "app.get('/api/users', handler);";
      const jsLang = await registry.getLanguage("javascript");
      const handle = runtime.parseSnippet(source, jsLang);

      try {
        const mapper = new PositionMapper(source);
        const root = new SyntaxNodeFacade(handle.tree.rootNode, mapper);
        const exprStmt = root.namedChildren()[0];
        const callExpr = exprStmt.namedChildren()[0];
        expect(callExpr.kind).toBe("call_expression");

        const funcField = callExpr.childForField("function");
        expect(funcField).toBeDefined();
        expect(funcField!.kind).toBe("member_expression");
        expect(funcField!.text()).toBe("app.get");

        const argsField = callExpr.childForField("arguments");
        expect(argsField).toBeDefined();
        expect(argsField!.kind).toBe("arguments");
        expect(argsField!.text()).toBe("('/api/users', handler)");

        const argList = argsField!.namedChildren();
        expect(argList.length).toBe(2);
        expect(argList[0].kind).toBe("string");
        expect(argList[0].text()).toBe("'/api/users'");
        expect(argList[1].kind).toBe("identifier");
        expect(argList[1].text()).toBe("handler");
      } finally {
        handle.dispose();
      }
    });
  });

  describe("5. Parent navigation", () => {
    it("navigates upwards through the AST hierarchy", async () => {
      const source = "const port = 3000;";
      const jsLang = await registry.getLanguage("javascript");
      const handle = runtime.parseSnippet(source, jsLang);

      try {
        const mapper = new PositionMapper(source);
        const root = new SyntaxNodeFacade(handle.tree.rootNode, mapper);

        // Root has no parent
        expect(root.parent()).toBeUndefined();

        const declarator = root.namedChildren()[0].namedChildren()[0];
        const idNode = declarator.childForField("name")!;
        expect(idNode.text()).toBe("port");

        // idNode's parent is declarator
        const parentOfId = idNode.parent();
        expect(parentOfId).toBeDefined();
        expect(parentOfId).toBeInstanceOf(SyntaxNodeFacade);
        expect(parentOfId!.kind).toBe("variable_declarator");
        expect(parentOfId!.text()).toBe("port = 3000");

        // declarator's parent is lexical_declaration
        const declStmt = parentOfId!.parent();
        expect(declStmt).toBeDefined();
        expect(declStmt!.kind).toBe("lexical_declaration");
        expect(declStmt!.text()).toBe("const port = 3000;");

        // lexical_declaration's parent is program (root)
        const parentOfStmt = declStmt!.parent();
        expect(parentOfStmt).toBeDefined();
        expect(parentOfStmt!.kind).toBe("program");

        // parent of program is undefined
        expect(parentOfStmt!.parent()).toBeUndefined();
      } finally {
        handle.dispose();
      }
    });
  });

  describe("6. Unicode and emoji range mapping with real AST", () => {
    it("maps UTF-16 ranges accurately in source containing emojis and CRLF", async () => {
      const source =
        "// Header: 🚀 Rocket Service\r\n" +
        'const endpoint = "/api/🚀/status";\r\n' +
        "const port = 8080;\r\n";

      const tsLang = await registry.getLanguage("typescript");
      const handle = runtime.parseSnippet(source, tsLang);

      try {
        const mapper = new PositionMapper(source, "file:///server.ts");
        const root = new SyntaxNodeFacade(handle.tree.rootNode, mapper);

        const nodes = root.namedChildren();
        // Comment node: // Header: 🚀 Rocket Service\r
        const commentNode = nodes[0];
        expect(commentNode.kind).toBe("comment");
        expect(commentNode.text().trimEnd()).toBe("// Header: 🚀 Rocket Service");
        expect(source.slice(commentNode.range.start, commentNode.range.end)).toBe(
          commentNode.text()
        );

        // First statement: const endpoint = "/api/🚀/status";
        const stmt1 = nodes[1];
        expect(stmt1.kind).toBe("lexical_declaration");
        expect(stmt1.text()).toBe('const endpoint = "/api/🚀/status";');

        // Check the string literal containing the emoji
        const declarator1 = stmt1.namedChildren()[0];
        const strNode = declarator1.childForField("value")!;
        expect(strNode.kind).toBe("string");
        expect(strNode.text()).toBe('"/api/🚀/status"');

        // Verify range maps to exact UTF-16 code units
        expect(source.slice(strNode.range.start, strNode.range.end)).toBe('"/api/🚀/status"');

        // Verify second statement on subsequent CRLF line
        const stmt2 = nodes[2];
        expect(stmt2.kind).toBe("lexical_declaration");
        expect(stmt2.text()).toBe("const port = 8080;");
        expect(source.slice(stmt2.range.start, stmt2.range.end)).toBe("const port = 8080;");

        // Check identifier and number value in stmt2
        const declarator2 = stmt2.namedChildren()[0];
        const portId = declarator2.childForField("name")!;
        expect(portId.text()).toBe("port");
        expect(source.slice(portId.range.start, portId.range.end)).toBe("port");

        const portVal = declarator2.childForField("value")!;
        expect(portVal.text()).toBe("8080");
        expect(source.slice(portVal.range.start, portVal.range.end)).toBe("8080");
      } finally {
        handle.dispose();
      }
    });
  });

  describe("7. Encapsulation and interface boundary", () => {
    it("does not expose concrete web-tree-sitter node properties", async () => {
      const source = "const x = 1;";
      const jsLang = await registry.getLanguage("javascript");
      const handle = runtime.parseSnippet(source, jsLang);

      try {
        const mapper = new PositionMapper(source);
        const root = new SyntaxNodeFacade(handle.tree.rootNode, mapper);

        // Public properties must only be kind, range, byteRange
        const facadeKeys = Object.keys(root);
        expect(facadeKeys).toContain("kind");
        expect(facadeKeys).toContain("range");
        expect(facadeKeys).toContain("byteRange");

        // Concrete Tree-sitter node internal properties must not be public
        const facadeAny = root as unknown as Record<string, unknown>;
        expect(facadeAny.innerNode).toBeUndefined();
        expect(facadeAny.tree).toBeUndefined();
        expect(facadeAny.id).toBeUndefined();
        expect(facadeAny.childCount).toBeUndefined();
        expect(facadeAny.namedChildCount).toBeUndefined();
        expect(facadeAny.firstChild).toBeUndefined();
        expect(facadeAny.lastChild).toBeUndefined();
        expect(facadeAny.nextSibling).toBeUndefined();
        expect(facadeAny.hasError).toBeUndefined();
        expect(facadeAny.isMissing).toBeUndefined();
      } finally {
        handle.dispose();
      }
    });
  });

  describe("8. Support for native UTF-8 byte-offset node wrapping", () => {
    it("converts byte offsets to UTF-16 TextRange when inner node carries byte offsets", () => {
      // Source: "const 🚀 = 1;"
      // UTF-16 length: 14 ("const " (6), "🚀" (2), " = 1;" (6))
      // UTF-8 byte length: 16 ("const " (6), "🚀" (4), " = 1;" (6))
      const source = "const 🚀 = 1;";
      const mapper = new PositionMapper(source);

      // Simulate a native Tree-sitter node with UTF-8 byte offsets for the rocket emoji:
      // Byte offset for 🚀 is start: 6, end: 10 (4 bytes).
      const mockByteNode = {
        type: "identifier",
        startIndex: 6,
        endIndex: 10,
        text: "🚀",
        children: [],
        namedChildren: [],
        childForFieldName: () => null,
        parent: null
      } as unknown as import("web-tree-sitter").Parser.SyntaxNode;

      const facade = new SyntaxNodeFacade(mockByteNode, mapper);
      expect(facade.kind).toBe("identifier");
      expect(facade.byteRange).toEqual({ start: 6, end: 10 });
      // In UTF-16, 🚀 is at indices 6..8 (2 code units)
      expect(facade.range).toEqual({ start: 6, end: 8 });
      expect(facade.text()).toBe("🚀");
      expect(source.slice(facade.range.start, facade.range.end)).toBe("🚀");
    });
  });
});
