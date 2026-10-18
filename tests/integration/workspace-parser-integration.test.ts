// Phase 1, Chunk 1.5: Workspace-to-Parser Foundation Integration Test Suite.
// Verifies the end-to-end integration:
// Workspace Source Discovery → SourceDocument Snapshot → TreeSitterParserAdapter → ParsedDocument

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DocumentUri, ParsedDocument, SourceDocument, SyntaxNode } from "@undrift/core";
import { TreeSitterParserAdapter } from "../../packages/parser-tree-sitter/src/index";
import {
  computeContentHash,
  extensionToLanguageId,
  WorkspaceSourceSnapshotProvider,
  type OpenDocumentAccessor,
  type UriLike,
  type WorkspaceAccessor,
  type WorkspaceFolderLike
} from "../../apps/vscode-extension/src/workspace/source-snapshot-provider";

// Helper to create URI-like objects
function makeUri(uriStr: string): UriLike {
  return {
    toString: () => uriStr,
    scheme: uriStr.split(":")[0],
    path: uriStr.replace(/^[a-zA-Z0-9+-.]+:\/\//, "/")
  };
}

// Helper to create mock OpenDocumentAccessor
function makeOpenDoc(
  uriStr: string,
  text: string,
  options?: { languageId?: string; version?: number; isDirty?: boolean; mutateOnRead?: boolean }
): OpenDocumentAccessor {
  let currentVersion = options?.version ?? 1;
  return {
    uri: makeUri(uriStr),
    languageId: options?.languageId ?? extensionToLanguageId(uriStr),
    get version() {
      return currentVersion;
    },
    isDirty: options?.isDirty ?? false,
    getText: () => {
      if (options?.mutateOnRead) {
        currentVersion += 1;
      }
      return text;
    }
  };
}

// Helper to create mock WorkspaceAccessor for controlled workspaces
function createMockWorkspaceAccessor(params: {
  folders?: string[];
  diskFiles?: Record<string, string | Error>;
  openDocuments?: OpenDocumentAccessor[];
  filesExclude?: Record<string, boolean>;
  searchExclude?: Record<string, boolean>;
}): WorkspaceAccessor {
  const folders: WorkspaceFolderLike[] | undefined = params.folders?.map((uriStr, index) => ({
    uri: makeUri(uriStr),
    name: `folder-${index}`,
    index
  }));

  const diskFiles = new Map<string, string | Error>(Object.entries(params.diskFiles ?? {}));

  return {
    getWorkspaceFolders: () => folders,
    findFiles: async () => {
      const uris: UriLike[] = [];
      for (const [uriStr] of diskFiles.entries()) {
        uris.push(makeUri(uriStr));
      }
      return uris;
    },
    readFile: async (uri) => {
      const uriStr = uri.toString();
      const content = diskFiles.get(uriStr);
      if (content === undefined) {
        throw new Error(`File not found: ${uriStr}`);
      }
      if (content instanceof Error) {
        throw content;
      }
      return Buffer.from(content, "utf8");
    },
    getOpenDocuments: () => params.openDocuments ?? [],
    getConfiguration: (section) => ({
      get: <T>(key: string): T | undefined => {
        if (section === "files" && key === "exclude") {
          return params.filesExclude as T | undefined;
        }
        if (section === "search" && key === "exclude") {
          return params.searchExclude as T | undefined;
        }
        return undefined;
      }
    })
  };
}

// Helper to find a syntax node by kind recursively
function findNodeByKind(node: SyntaxNode, kind: string): SyntaxNode | undefined {
  if (node.kind === kind) {
    return node;
  }
  for (const child of node.namedChildren()) {
    const found = findNodeByKind(child, kind);
    if (found) {
      return found;
    }
  }
  return undefined;
}

// Helper to find all syntax nodes by kind recursively
function findAllNodesByKind(node: SyntaxNode, kind: string): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  if (node.kind === kind) {
    result.push(node);
  }
  for (const child of node.namedChildren()) {
    result.push(...findAllNodesByKind(child, kind));
  }
  return result;
}

describe("Workspace-to-Parser Foundation Integration (Chunk 1.5)", () => {
  let adapter: TreeSitterParserAdapter;

  beforeAll(() => {
    adapter = new TreeSitterParserAdapter();
  });

  afterAll(() => {
    adapter.dispose();
  });

  describe("Scenario A: JavaScript Discovery and Syntax Extraction", () => {
    it("discovers JavaScript files, snapshots them, and parses usable ASTs", async () => {
      const jsCode = [
        "export function calculateTotal(items) {",
        "  return items.reduce((sum, item) => sum + item.price, 0);",
        "}",
        "calculateTotal([{ price: 10 }, { price: 20 }]);"
      ].join("\n");

      const accessor = createMockWorkspaceAccessor({
        folders: ["file:///workspace/project"],
        diskFiles: {
          "file:///workspace/project/src/calc.js": jsCode
        }
      });

      // 1. Workspace discovery and snapshot acquisition
      const provider = new WorkspaceSourceSnapshotProvider(accessor);
      const result = await provider.createSnapshot();

      expect(result.status).toBe("success");
      expect(result.documents).toHaveLength(1);

      const snapshot: SourceDocument = result.documents[0];
      expect(snapshot.uri).toBe("file:///workspace/project/src/calc.js");
      expect(snapshot.languageId).toBe("javascript");
      expect(snapshot.text).toBe(jsCode);
      expect(snapshot.contentHash).toBe(computeContentHash(jsCode));
      expect(snapshot.documentVersion).toBeUndefined();
      expect(snapshot.isDirty).toBe(false);

      // 2. Parser adapter integration
      expect(adapter.supports(snapshot.languageId, snapshot.uri)).toBe(true);

      const parsed: ParsedDocument = await adapter.parse({ document: snapshot });
      try {
        expect(parsed.source).toBe(snapshot);
        expect(parsed.root.kind).toBe("program");
        expect(parsed.issues).toEqual([]);

        // Locate function declaration
        const fnDecl = findNodeByKind(parsed.root, "function_declaration");
        expect(fnDecl).toBeDefined();
        const fnName = fnDecl?.childForField("name");
        expect(fnName?.text()).toBe("calculateTotal");

        // Locate call expression
        const callExpressions = findAllNodesByKind(parsed.root, "call_expression");
        expect(callExpressions.length).toBeGreaterThanOrEqual(2);
        const topLevelCall = callExpressions.find(
          (call) => call.childForField("function")?.text() === "calculateTotal"
        );
        expect(topLevelCall).toBeDefined();
        expect(topLevelCall?.childForField("function")?.text()).toBe("calculateTotal");
      } finally {
        parsed.dispose();
      }
    });

    it("supports ES Modules (.mjs) and CommonJS (.cjs) through the workspace pipeline", async () => {
      const mjsCode = "export const greet = (name) => `Hello, ${name}!`;";
      const cjsCode = "const fs = require('fs'); module.exports = { fs };";

      const accessor = createMockWorkspaceAccessor({
        folders: ["file:///workspace/app"],
        diskFiles: {
          "file:///workspace/app/lib/greet.mjs": mjsCode,
          "file:///workspace/app/lib/io.cjs": cjsCode
        }
      });

      const provider = new WorkspaceSourceSnapshotProvider(accessor);
      const result = await provider.createSnapshot();

      expect(result.status).toBe("success");
      expect(result.documents).toHaveLength(2);

      for (const doc of result.documents) {
        expect(adapter.supports(doc.languageId, doc.uri)).toBe(true);
        const parsed = await adapter.parse({ document: doc });
        try {
          expect(parsed.root.kind).toBe("program");
          expect(parsed.issues).toHaveLength(0);
        } finally {
          parsed.dispose();
        }
      }
    });
  });

  describe("Scenario B: JSX Discovery and Grammar Binding", () => {
    it("discovers .jsx documents and parses JSX elements via the JavaScript grammar", async () => {
      const jsxCode = [
        "import React from 'react';",
        "export function UserBadge({ name, role }) {",
        "  return (",
        '    <div className="user-badge" data-role={role}>',
        "      <span>{name}</span>",
        "    </div>",
        "  );",
        "}"
      ].join("\n");

      const accessor = createMockWorkspaceAccessor({
        folders: ["file:///workspace/frontend"],
        diskFiles: {
          "file:///workspace/frontend/src/components/UserBadge.jsx": jsxCode
        }
      });

      const provider = new WorkspaceSourceSnapshotProvider(accessor);
      const result = await provider.createSnapshot();

      expect(result.status).toBe("success");
      expect(result.documents).toHaveLength(1);

      const doc = result.documents[0];
      expect(doc.languageId).toBe("javascriptreact");
      expect(doc.uri).toBe("file:///workspace/frontend/src/components/UserBadge.jsx");
      expect(doc.contentHash).toBe(computeContentHash(jsxCode));

      expect(adapter.supports(doc.languageId, doc.uri)).toBe(true);

      const parsed = await adapter.parse({ document: doc });
      try {
        expect(parsed.root.kind).toBe("program");
        expect(parsed.issues).toEqual([]);

        // Verify JSX element navigation
        const jsxElement = findNodeByKind(parsed.root, "jsx_element");
        expect(jsxElement).toBeDefined();

        const openingElement = findNodeByKind(parsed.root, "jsx_opening_element");
        expect(openingElement).toBeDefined();
        const identifier = openingElement?.childForField("name");
        expect(identifier?.text()).toBe("div");

        // Verify JSX attribute
        const attr = findNodeByKind(parsed.root, "jsx_attribute");
        expect(attr).toBeDefined();
        expect(attr?.text()).toContain('className="user-badge"');
      } finally {
        parsed.dispose();
      }
    });
  });

  describe("Scenario C: TypeScript Discovery and Typed Declarations", () => {
    it("discovers .ts documents and extracts typed interfaces without altering snapshots", async () => {
      const tsCode = [
        "export interface ApiUser {",
        "  id: string;",
        "  email: string;",
        '  status: "active" | "inactive";',
        "}",
        "export function getUserId(user: ApiUser): string {",
        "  return user.id;",
        "}"
      ].join("\n");

      const accessor = createMockWorkspaceAccessor({
        folders: ["file:///workspace/backend"],
        diskFiles: {
          "file:///workspace/backend/src/models/user.ts": tsCode
        }
      });

      const provider = new WorkspaceSourceSnapshotProvider(accessor);
      const result = await provider.createSnapshot();

      expect(result.status).toBe("success");
      const doc = result.documents[0];
      expect(doc.languageId).toBe("typescript");

      const parsed = await adapter.parse({ document: doc });
      try {
        expect(parsed.source).toBe(doc);
        expect(parsed.root.kind).toBe("program");
        expect(parsed.issues).toEqual([]);

        // Verify TypeScript interface declaration
        const interfaceDecl = findNodeByKind(parsed.root, "interface_declaration");
        expect(interfaceDecl).toBeDefined();
        expect(interfaceDecl?.childForField("name")?.text()).toBe("ApiUser");

        // Verify type annotation in function parameter
        const typeAnnotations = findAllNodesByKind(parsed.root, "type_annotation");
        expect(typeAnnotations.length).toBeGreaterThan(0);
        const userTypeAnnotation = typeAnnotations.find((ta) => ta.text() === ": ApiUser");
        expect(userTypeAnnotation).toBeDefined();
        expect(userTypeAnnotation?.text()).toBe(": ApiUser");

        // Verify snapshot invariance: original text and hash are identical
        expect(doc.text).toBe(tsCode);
        expect(doc.contentHash).toBe(computeContentHash(tsCode));
      } finally {
        parsed.dispose();
      }
    });
  });

  describe("Scenario D: TSX Discovery and Combined TypeScript + JSX", () => {
    it("discovers .tsx documents, routes to TSX grammar, and parses generics and JSX elements", async () => {
      const tsxCode = [
        "import React from 'react';",
        "export interface ListProps<T> {",
        "  items: T[];",
        "  renderItem: (item: T) => React.ReactNode;",
        "}",
        "export const List = <T,>({ items, renderItem }: ListProps<T>) => (",
        '  <ul className="list-container">',
        "    {items.map((it, idx) => <li key={idx}>{renderItem(it)}</li>)}",
        "  </ul>",
        ");"
      ].join("\n");

      const accessor = createMockWorkspaceAccessor({
        folders: ["file:///workspace/web"],
        diskFiles: {
          "file:///workspace/web/src/List.tsx": tsxCode
        }
      });

      const provider = new WorkspaceSourceSnapshotProvider(accessor);
      const result = await provider.createSnapshot();

      expect(result.status).toBe("success");
      const doc = result.documents[0];
      expect(doc.languageId).toBe("typescriptreact");

      const parsed = await adapter.parse({ document: doc });
      try {
        expect(parsed.root.kind).toBe("program");
        expect(parsed.issues).toEqual([]);

        // Verify generic type parameter
        const typeParams = findNodeByKind(parsed.root, "type_parameters");
        expect(typeParams).toBeDefined();
        expect(typeParams?.text()).toContain("<T>");

        // Verify JSX elements
        const ulElement = findNodeByKind(parsed.root, "jsx_element");
        expect(ulElement).toBeDefined();
        expect(ulElement?.text()).toContain('className="list-container"');
      } finally {
        parsed.dispose();
      }
    });
  });

  describe("Scenario E: Exact Source Identity and Open-Document Precedence", () => {
    it("preserves open editor buffer modifications, version numbers, and dirty state through parsing", async () => {
      const diskText = "export const apiEndpoint = '/v1/users'; // on-disk version";
      const dirtyEditorText =
        "export const apiEndpoint = '/v2/users'; // unsaved buffer modification";

      const accessor = createMockWorkspaceAccessor({
        folders: ["file:///workspace/app"],
        diskFiles: {
          "file:///workspace/app/src/config.ts": diskText
        },
        openDocuments: [
          makeOpenDoc("file:///workspace/app/src/config.ts", dirtyEditorText, {
            version: 42,
            isDirty: true
          })
        ]
      });

      const provider = new WorkspaceSourceSnapshotProvider(accessor);
      const result = await provider.createSnapshot();

      expect(result.status).toBe("success");
      const doc = result.documents[0];

      // Verify open document took precedence
      expect(doc.text).toBe(dirtyEditorText);
      expect(doc.documentVersion).toBe(42);
      expect(doc.isDirty).toBe(true);
      expect(doc.contentHash).toBe(computeContentHash(dirtyEditorText));

      // Parse document
      const parsed = await adapter.parse({ document: doc });
      try {
        // Parsed document retains exact source identity
        expect(parsed.source).toBe(doc);
        expect(parsed.source.text).toBe(dirtyEditorText);
        expect(parsed.source.documentVersion).toBe(42);
        expect(parsed.source.isDirty).toBe(true);
        expect(parsed.source.contentHash).toBe(computeContentHash(dirtyEditorText));

        // The parser root reflects the modified value
        const stringLiteral = findNodeByKind(parsed.root, "string");
        expect(stringLiteral?.text()).toBe("'/v2/users'");
      } finally {
        parsed.dispose();
      }
    });

    it("maintains distinct identity and fingerprints across different documents with identical content", async () => {
      const commonCode = "export const shared = 'constant';";

      const accessor = createMockWorkspaceAccessor({
        folders: ["file:///workspace/multi"],
        diskFiles: {
          "file:///workspace/multi/src/moduleA.ts": commonCode,
          "file:///workspace/multi/src/moduleB.ts": commonCode
        }
      });

      const provider = new WorkspaceSourceSnapshotProvider(accessor);
      const result = await provider.createSnapshot();

      expect(result.status).toBe("success");
      expect(result.documents).toHaveLength(2);

      const [docA, docB] = result.documents;
      expect(docA.uri).not.toBe(docB.uri);
      expect(docA.contentHash).toBe(docB.contentHash);

      const parsedA = await adapter.parse({ document: docA });
      const parsedB = await adapter.parse({ document: docB });
      try {
        expect(parsedA.source.uri).toBe(docA.uri);
        expect(parsedB.source.uri).toBe(docB.uri);
        expect(parsedA.source).toBe(docA);
        expect(parsedB.source).toBe(docB);
      } finally {
        parsedA.dispose();
        parsedB.dispose();
      }
    });
  });

  describe("Scenario F: Unicode Characters and CRLF Line Endings", () => {
    it("correctly maps UTF-16 coordinates and UTF-8 byte ranges for supplementary Unicode with CRLF", async () => {
      // Contains emojis (surrogate pairs in UTF-16, 4 bytes in UTF-8) and CRLF line breaks
      const crlfUnicodeCode = [
        "// Rocket: 🚀 and Sparkles: ✨\r",
        "export const rocket = '🚀';\r",
        "export const spark = '✨';\r",
        "export function launch() {\r",
        "  return '🚀 Launched!';\r",
        "}\r",
        ""
      ].join("\n");

      const accessor = createMockWorkspaceAccessor({
        folders: ["file:///workspace/unicode"],
        diskFiles: {
          "file:///workspace/unicode/src/emoji.ts": crlfUnicodeCode
        }
      });

      const provider = new WorkspaceSourceSnapshotProvider(accessor);
      const result = await provider.createSnapshot();

      expect(result.status).toBe("success");
      const doc = result.documents[0];

      // Exact CRLF content hash without normalization
      expect(doc.contentHash).toBe(computeContentHash(crlfUnicodeCode));

      const parsed = await adapter.parse({ document: doc });
      try {
        expect(parsed.root.kind).toBe("program");
        expect(parsed.issues).toEqual([]);

        // Validate that all syntax node UTF-16 ranges match the exact source slice
        const validateNode = (node: SyntaxNode): void => {
          const { start, end } = node.range;
          expect(start).toBeGreaterThanOrEqual(0);
          expect(end).toBeLessThanOrEqual(doc.text.length);
          expect(start).toBeLessThanOrEqual(end);

          const expectedSlice = doc.text.slice(start, end);
          expect(node.text()).toBe(expectedSlice);

          // Verify native byte range if present
          if (node.byteRange) {
            expect(node.byteRange.start).toBeGreaterThanOrEqual(0);
            expect(node.byteRange.end).toBeGreaterThanOrEqual(node.byteRange.start);
          }

          for (const child of node.namedChildren()) {
            validateNode(child);
          }
        };

        validateNode(parsed.root);

        // Find the launch function and verify its span
        const fnDecl = findNodeByKind(parsed.root, "function_declaration");
        expect(fnDecl).toBeDefined();
        expect(fnDecl?.text()).toContain("launch()");
        expect(fnDecl?.text()).toContain("return '🚀 Launched!';");
      } finally {
        parsed.dispose();
      }
    });
  });

  describe("Scenario G: Incomplete and Malformed Source Recovery", () => {
    it("retains recoverable syntax structure and populates ParseIssues on malformed source", async () => {
      const malformedCode = [
        "export function broken( {",
        "  const x = ;",
        "  return x +",
        "}"
      ].join("\n");

      const accessor = createMockWorkspaceAccessor({
        folders: ["file:///workspace/malformed"],
        diskFiles: {
          "file:///workspace/malformed/src/bad.js": malformedCode
        }
      });

      const provider = new WorkspaceSourceSnapshotProvider(accessor);
      const result = await provider.createSnapshot();

      expect(result.status).toBe("success");
      const doc = result.documents[0];

      const parsed = await adapter.parse({ document: doc });
      try {
        // 1. Root syntax node remains available despite syntax errors
        expect(parsed.root).toBeDefined();
        expect(parsed.root.kind).toBe("program");

        // 2. Parse issues are collected
        expect(parsed.issues.length).toBeGreaterThan(0);
        for (const issue of parsed.issues) {
          expect(issue.isError).toBe(true);
          expect(issue.message).toBeDefined();
          if (issue.source) {
            expect(issue.source.uri).toBe(doc.uri);
            expect(issue.source.range.start).toBeGreaterThanOrEqual(0);
            expect(issue.source.range.end).toBeLessThanOrEqual(doc.text.length);
          }
        }
      } finally {
        parsed.dispose();
      }
    });
  });

  describe("Scenario H: Snapshot Failures and Empty Workspaces", () => {
    it("reports 'empty' status for workspace with zero supported source files and does not parse", async () => {
      const accessor = createMockWorkspaceAccessor({
        folders: ["file:///workspace/empty-project"],
        diskFiles: {
          "file:///workspace/empty-project/README.md": "# Documentation only",
          "file:///workspace/empty-project/package.json": '{"name": "empty"}',
          "file:///workspace/empty-project/styles.css": "body { color: red; }"
        }
      });

      const provider = new WorkspaceSourceSnapshotProvider(accessor);
      const result = await provider.createSnapshot();

      expect(result.status).toBe("empty");
      expect(result.workspaceRootUris).toEqual(["file:///workspace/empty-project"]);
      expect(result.documents).toHaveLength(0);
      expect(result.failures).toHaveLength(0);

      // Boundary assertion: zero documents means nothing is passed to the parser
      expect(result.documents).toEqual([]);
    });

    it("reports 'partial' status on disk read failures and only valid snapshots reach the parser", async () => {
      const accessor = createMockWorkspaceAccessor({
        folders: ["file:///workspace/faulty"],
        diskFiles: {
          "file:///workspace/faulty/src/good.ts": "export const good = true;",
          "file:///workspace/faulty/src/corrupted.ts": new Error("EACCES: permission denied")
        }
      });

      const provider = new WorkspaceSourceSnapshotProvider(accessor);
      const result = await provider.createSnapshot();

      expect(result.status).toBe("partial");
      expect(result.documents).toHaveLength(1);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].uri).toBe("file:///workspace/faulty/src/corrupted.ts");
      expect(result.failures[0].error).toContain("EACCES");

      // Only successfully acquired documents are parsed
      const validDoc = result.documents[0];
      expect(validDoc.uri).toBe("file:///workspace/faulty/src/good.ts");

      const parsed = await adapter.parse({ document: validDoc });
      try {
        expect(parsed.root.kind).toBe("program");
        expect(parsed.issues).toEqual([]);
      } finally {
        parsed.dispose();
      }
    });

    it("reports 'no-workspace' when no workspace folders are open", async () => {
      const accessor = createMockWorkspaceAccessor({
        folders: undefined
      });

      const provider = new WorkspaceSourceSnapshotProvider(accessor);
      const result = await provider.createSnapshot();

      expect(result.status).toBe("no-workspace");
      expect(result.documents).toHaveLength(0);
    });
  });

  describe("Scenario I: Resource Lifecycle and Disposal Semantics", () => {
    it("allows safe and idempotent disposal of ParsedDocument", async () => {
      const doc: SourceDocument = {
        uri: "file:///workspace/lifecycle.ts",
        languageId: "typescript",
        text: "export const answer = 42;",
        contentHash: computeContentHash("export const answer = 42;")
      };

      const parsed = await adapter.parse({ document: doc });
      expect(parsed.root.kind).toBe("program");

      // First disposal
      expect(() => parsed.dispose()).not.toThrow();

      // Second disposal must be idempotent
      expect(() => parsed.dispose()).not.toThrow();
    });

    it("rejects further parse requests once parser adapter is disposed", async () => {
      const dedicatedAdapter = new TreeSitterParserAdapter();
      const doc: SourceDocument = {
        uri: "file:///workspace/disposed.ts",
        languageId: "typescript",
        text: "export const x = 1;",
        contentHash: computeContentHash("export const x = 1;")
      };

      // Works before disposal
      const parsed = await dedicatedAdapter.parse({ document: doc });
      parsed.dispose();

      // Dispose adapter
      dedicatedAdapter.dispose();

      // Must be rejected after disposal
      await expect(dedicatedAdapter.parse({ document: doc })).rejects.toThrow(
        "TreeSitterParserAdapter has been disposed."
      );
    });
  });
});
