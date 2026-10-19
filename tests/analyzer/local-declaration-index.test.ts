// Phase 2, Chunk 2.7: Local Declaration Index Unit Tests.
// Tests parsing, extraction, and read-only query capabilities of LocalDeclarationIndex
// across JavaScript and TypeScript source documents with exact evidence, source positions,
// declaration kinds, and snapshot provenance.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DocumentUri, ParsedDocument, ProjectIndexView, SourceDocument } from "@undrift/core";
import { TreeSitterParserAdapter } from "@undrift/parser-tree-sitter";
import {
  LocalDeclarationIndex,
  createLocalDeclarationIndex,
  indexLocalDeclarations,
  type LocalExportDeclaration,
  type LocalFunctionDeclaration,
  type LocalImportDeclaration,
  type LocalTypeAliasDeclaration,
  type LocalVariableDeclaration
} from "../../packages/analyzer-js-ts/src/index";

describe("LocalDeclarationIndex (Chunk 2.7)", () => {
  let parser: TreeSitterParserAdapter;

  beforeAll(() => {
    parser = new TreeSitterParserAdapter();
  });

  afterAll(() => {
    parser.dispose();
  });

  async function parseCode(
    text: string,
    languageId: "javascript" | "typescript" = "javascript",
    uri: DocumentUri = "file:///src/module.js"
  ): Promise<{ document: SourceDocument; parsed: ParsedDocument }> {
    const document: SourceDocument = {
      uri,
      languageId,
      text,
      contentHash: `hash-${text.length}`
    };

    const parsed = await parser.parse({ document });
    return { document, parsed };
  }

  describe("1. Variable Declarations", () => {
    it("indexes const, let, and var declarations with literal values and constant flags", async () => {
      const code = `
        const API_URL = "/api/v1";
        let retryCount = 3;
        var isEnabled = true;
        const config = null;
      `;
      const { document, parsed } = await parseCode(code);
      const decls = indexLocalDeclarations(document, parsed);

      expect(decls).toHaveLength(4);

      // const API_URL
      const apiUrl = decls.find((d) => d.name === "API_URL") as LocalVariableDeclaration;
      expect(apiUrl).toBeDefined();
      expect(apiUrl.kind).toBe("variable");
      expect(apiUrl.declarationType).toBe("const");
      expect(apiUrl.isConstant).toBe(true);
      expect(apiUrl.literalValue).toBe("/api/v1");
      expect(apiUrl.documentUri).toBe(document.uri);
      expect(apiUrl.snapshotHash).toBe(document.contentHash);
      expect(apiUrl.evidence.kind).toBe("local-declaration");
      expect(apiUrl.evidence.strength).toBe("direct");
      expect(apiUrl.exported).toBe(false);

      // let retryCount
      const retryCount = decls.find((d) => d.name === "retryCount") as LocalVariableDeclaration;
      expect(retryCount).toBeDefined();
      expect(retryCount.declarationType).toBe("let");
      expect(retryCount.isConstant).toBe(false);
      expect(retryCount.literalValue).toBe(3);

      // var isEnabled
      const isEnabled = decls.find((d) => d.name === "isEnabled") as LocalVariableDeclaration;
      expect(isEnabled).toBeDefined();
      expect(isEnabled.declarationType).toBe("var");
      expect(isEnabled.isConstant).toBe(false);
      expect(isEnabled.literalValue).toBe(true);

      // const config = null
      const config = decls.find((d) => d.name === "config") as LocalVariableDeclaration;
      expect(config).toBeDefined();
      expect(config.literalValue).toBeNull();
    });

    it("indexes destructured object pattern variable declarations", async () => {
      const code = `
        const { timeout, retries } = options;
        const { port: serverPort } = config;
      `;
      const { document, parsed } = await parseCode(code);
      const decls = indexLocalDeclarations(document, parsed);

      expect(decls).toHaveLength(3);
      const names = decls.map((d) => d.name);
      expect(names).toContain("timeout");
      expect(names).toContain("retries");
      expect(names).toContain("serverPort");

      const timeout = decls.find((d) => d.name === "timeout") as LocalVariableDeclaration;
      expect(timeout.declarationType).toBe("const");
      expect(timeout.isConstant).toBe(true);
    });

    it("preserves dynamic initializers as variables without literal values", async () => {
      const code = "const router = express.Router();";
      const { document, parsed } = await parseCode(code);
      const decls = indexLocalDeclarations(document, parsed);

      expect(decls).toHaveLength(1);
      const router = decls[0] as LocalVariableDeclaration;
      expect(router.name).toBe("router");
      expect(router.isConstant).toBe(true);
      expect(router.literalValue).toBeUndefined();
      expect(router.initializerText).toBe("express.Router()");
    });
  });

  describe("2. Function Declarations", () => {
    it("indexes standard, async, and generator functions", async () => {
      const code = `
        function standardHandler(req, res) { return true; }
        async function asyncHandler(req, res) { return await Promise.resolve(); }
        function* generatorFunc() { yield 1; }
      `;
      const { document, parsed } = await parseCode(code);
      const decls = indexLocalDeclarations(document, parsed);

      expect(decls).toHaveLength(3);

      const standard = decls.find((d) => d.name === "standardHandler") as LocalFunctionDeclaration;
      expect(standard).toBeDefined();
      expect(standard.kind).toBe("function");
      expect(standard.isAsync).toBe(false);
      expect(standard.isGenerator).toBe(false);
      expect(standard.evidence.kind).toBe("local-declaration");

      const asyncFunc = decls.find((d) => d.name === "asyncHandler") as LocalFunctionDeclaration;
      expect(asyncFunc).toBeDefined();
      expect(asyncFunc.isAsync).toBe(true);

      const genFunc = decls.find((d) => d.name === "generatorFunc") as LocalFunctionDeclaration;
      expect(genFunc).toBeDefined();
      expect(genFunc.isGenerator).toBe(true);
    });
  });

  describe("3. TypeScript Types and Interfaces", () => {
    it("indexes type aliases and interface declarations in TypeScript files", async () => {
      const code = `
        type UserId = string;
        type Status = "active" | "inactive";
        interface UserProfile {
          id: UserId;
          name: string;
        }
      `;
      const { document, parsed } = await parseCode(code, "typescript", "file:///src/types.ts");
      const decls = indexLocalDeclarations(document, parsed);

      expect(decls).toHaveLength(3);

      const userId = decls.find((d) => d.name === "UserId") as LocalTypeAliasDeclaration;
      expect(userId).toBeDefined();
      expect(userId.kind).toBe("type-alias");
      expect(userId.typeText).toBe("string");
      expect(userId.documentUri).toBe("file:///src/types.ts");

      const status = decls.find((d) => d.name === "Status") as LocalTypeAliasDeclaration;
      expect(status).toBeDefined();
      expect(status.kind).toBe("type-alias");
      expect(status.typeText).toBe('"active" | "inactive"');

      const userProfile = decls.find((d) => d.name === "UserProfile");
      expect(userProfile).toBeDefined();
      expect(userProfile?.kind).toBe("interface");
    });
  });

  describe("4. Imports (ES Module and CommonJS)", () => {
    it("indexes default, named, and namespace ES module imports", async () => {
      const code = `
        import express from "express";
        import { Router, Request as ExpressReq } from "express";
        import * as fs from "fs";
      `;
      const { document, parsed } = await parseCode(code);
      const decls = indexLocalDeclarations(document, parsed);

      expect(decls).toHaveLength(4);

      // Default import express
      const expressImport = decls.find((d) => d.name === "express") as LocalImportDeclaration;
      expect(expressImport).toBeDefined();
      expect(expressImport.kind).toBe("import");
      expect(expressImport.moduleSpecifier).toBe("express");
      expect(expressImport.importedName).toBe("default");
      expect(expressImport.importKind).toBe("default");
      expect(expressImport.evidence.kind).toBe("imported-declaration");

      // Named import Router
      const routerImport = decls.find((d) => d.name === "Router") as LocalImportDeclaration;
      expect(routerImport).toBeDefined();
      expect(routerImport.importedName).toBe("Router");
      expect(routerImport.importKind).toBe("named");

      // Aliased import ExpressReq
      const reqImport = decls.find((d) => d.name === "ExpressReq") as LocalImportDeclaration;
      expect(reqImport).toBeDefined();
      expect(reqImport.importedName).toBe("Request");
      expect(reqImport.importKind).toBe("named");

      // Namespace import fs
      const fsImport = decls.find((d) => d.name === "fs") as LocalImportDeclaration;
      expect(fsImport).toBeDefined();
      expect(fsImport.importedName).toBe("*");
      expect(fsImport.importKind).toBe("namespace");
      expect(fsImport.moduleSpecifier).toBe("fs");
    });

    it("indexes CommonJS require imports for default and destructured bindings", async () => {
      const code = `
        const axios = require("axios");
        const { get, post: httpPost } = require("axios");
      `;
      const { document, parsed } = await parseCode(code);
      const decls = indexLocalDeclarations(document, parsed);

      expect(decls).toHaveLength(3);

      const axiosImport = decls.find((d) => d.name === "axios") as LocalImportDeclaration;
      expect(axiosImport).toBeDefined();
      expect(axiosImport.kind).toBe("import");
      expect(axiosImport.importKind).toBe("require");
      expect(axiosImport.moduleSpecifier).toBe("axios");
      expect(axiosImport.importedName).toBe("default");

      const getImport = decls.find((d) => d.name === "get") as LocalImportDeclaration;
      expect(getImport).toBeDefined();
      expect(getImport.importKind).toBe("require");
      expect(getImport.importedName).toBe("get");

      const postImport = decls.find((d) => d.name === "httpPost") as LocalImportDeclaration;
      expect(postImport).toBeDefined();
      expect(postImport.importKind).toBe("require");
      expect(postImport.importedName).toBe("post");
    });
  });

  describe("5. Exports", () => {
    it("indexes exported declarations with exported: true", async () => {
      const code = `
        export const BASE_ROUTE = "/api";
        export function initServer() {}
        export interface Config {}
        export type Route = string;
      `;
      const { document, parsed } = await parseCode(code, "typescript", "file:///src/api.ts");
      const decls = indexLocalDeclarations(document, parsed);

      expect(decls).toHaveLength(4);
      for (const decl of decls) {
        expect(decl.exported).toBe(true);
      }
    });

    it("indexes export default and export clause specifiers", async () => {
      const code = `
        const router = express.Router();
        export default router;
        export { a, b as customB };
      `;
      const { document, parsed } = await parseCode(code);
      const decls = indexLocalDeclarations(document, parsed);

      const defaultExport = decls.find((d) => d.name === "default") as LocalExportDeclaration;
      expect(defaultExport).toBeDefined();
      expect(defaultExport.kind).toBe("export");
      expect(defaultExport.isDefault).toBe(true);
      expect(defaultExport.targetSymbolName).toBe("router");

      const exportA = decls.find((d) => d.name === "a") as LocalExportDeclaration;
      expect(exportA).toBeDefined();
      expect(exportA.targetSymbolName).toBe("a");

      const exportCustomB = decls.find((d) => d.name === "customB") as LocalExportDeclaration;
      expect(exportCustomB).toBeDefined();
      expect(exportCustomB.targetSymbolName).toBe("b");
    });
  });

  describe("6. Negative Cases and Filtering", () => {
    it("does not index unrelated identifier references or expressions", async () => {
      const code = `
        console.log("hello");
        const x = y + z();
        if (condition) {
          doSomething();
        }
      `;
      const { document, parsed } = await parseCode(code);
      const decls = indexLocalDeclarations(document, parsed);

      // Only 'x' is a declaration; y, z, condition, console, log, doSomething are references
      expect(decls).toHaveLength(1);
      expect(decls[0].name).toBe("x");
    });

    it("handles empty document gracefully", async () => {
      const { document, parsed } = await parseCode("");
      const decls = indexLocalDeclarations(document, parsed);
      expect(decls).toEqual([]);
    });

    it("tolerates syntax errors and extracts valid surrounding declarations", async () => {
      const code = `
        const validBefore = 1;
        const broken = ;
        const validAfter = 2;
      `;
      const { document, parsed } = await parseCode(code);
      const decls = indexLocalDeclarations(document, parsed);

      const names = decls.map((d) => d.name);
      expect(names).toContain("validBefore");
      expect(names).toContain("validAfter");
    });
  });

  describe("7. LocalDeclarationIndex Class and ProjectIndexView Conformance", () => {
    it("conforms to ProjectIndexView interface and resolves getDocument and lookupSymbol", async () => {
      const doc1Code = 'export const API_PREFIX = "/v1"; export const TIMEOUT = 5000;';
      const doc2Code = 'const LOCAL_VAR = "local"; const TIMEOUT = 1000;';

      const entry1 = await parseCode(doc1Code, "javascript", "file:///src/config.js");
      const entry2 = await parseCode(doc2Code, "javascript", "file:///src/service.js");

      const index = createLocalDeclarationIndex([entry1, entry2]);

      // Verify ProjectIndexView assignment
      const view: ProjectIndexView = index;
      expect(view).toBeDefined();

      // getDocument
      expect(view.getDocument?.("file:///src/config.js")).toBe(entry1.document);
      expect(view.getDocument?.("file:///src/service.js")).toBe(entry2.document);
      expect(view.getDocument?.("file:///nonexistent.js")).toBeUndefined();

      // lookupSymbol without fromUri (returns exported or first match)
      const apiPrefix = view.lookupSymbol?.("API_PREFIX");
      expect(apiPrefix).toBeDefined();
      expect((apiPrefix as LocalVariableDeclaration).literalValue).toBe("/v1");

      // lookupSymbol with fromUri (prioritizes local document scope)
      const timeoutService = view.lookupSymbol?.("TIMEOUT", "file:///src/service.js");
      expect(timeoutService).toBeDefined();
      expect((timeoutService as LocalVariableDeclaration).documentUri).toBe(
        "file:///src/service.js"
      );
      expect((timeoutService as LocalVariableDeclaration).literalValue).toBe(1000);

      const timeoutConfig = view.lookupSymbol?.("TIMEOUT", "file:///src/config.js");
      expect(timeoutConfig).toBeDefined();
      expect((timeoutConfig as LocalVariableDeclaration).documentUri).toBe("file:///src/config.js");
      expect((timeoutConfig as LocalVariableDeclaration).literalValue).toBe(5000);

      // lookupSymbol non-existent
      expect(view.lookupSymbol?.("DOES_NOT_EXIST")).toBeUndefined();
    });

    it("queries declarations by kind, document, imports, and exports", async () => {
      const code = `
        import express from "express";
        export const PORT = 3000;
        export function start() {}
        const internalHelper = () => {};
      `;
      const entry = await parseCode(code, "javascript", "file:///src/server.js");
      const index = new LocalDeclarationIndex([entry]);

      expect(index.hasDocument("file:///src/server.js")).toBe(true);
      expect(index.getDocumentUris()).toEqual(["file:///src/server.js"]);

      // getDeclarationsForDocument
      const docDecls = index.getDeclarationsForDocument("file:///src/server.js");
      expect(docDecls).toHaveLength(4);

      // getDeclarationsByKind
      const vars = index.getDeclarationsByKind("variable");
      expect(vars).toHaveLength(2);
      const funcs = index.getDeclarationsByKind("function");
      expect(funcs).toHaveLength(1);
      const imports = index.getDeclarationsByKind("import");
      expect(imports).toHaveLength(1);

      // findImports
      const expressImports = index.findImports("express");
      expect(expressImports).toHaveLength(1);
      expect(expressImports[0].name).toBe("express");
      expect(index.findImports("axios")).toHaveLength(0);

      // findExports
      const exports = index.findExports();
      expect(exports).toHaveLength(2);
      expect(exports.map((e) => e.name)).toEqual(["PORT", "start"]);

      // lookupSymbols across all matches
      const portMatches = index.lookupSymbols("PORT");
      expect(portMatches).toHaveLength(1);
    });

    it("supports incremental updating, removal, and clearing of documents", async () => {
      const doc1 = await parseCode("const a = 1;", "javascript", "file:///doc1.js");
      const doc2 = await parseCode("const b = 2;", "javascript", "file:///doc2.js");

      const index = new LocalDeclarationIndex([doc1, doc2]);
      expect(index.lookupSymbol("a")).toBeDefined();
      expect(index.lookupSymbol("b")).toBeDefined();

      // Update doc1 with new content
      const doc1Updated = await parseCode("const aUpdated = 10;", "javascript", "file:///doc1.js");
      index.indexDocument(doc1Updated.document, doc1Updated.parsed);

      expect(index.lookupSymbol("a")).toBeUndefined();
      expect(index.lookupSymbol("aUpdated")).toBeDefined();
      expect(index.lookupSymbol("b")).toBeDefined();

      // Remove doc2
      index.removeDocument("file:///doc2.js");
      expect(index.hasDocument("file:///doc2.js")).toBe(false);
      expect(index.lookupSymbol("b")).toBeUndefined();
      expect(index.lookupSymbol("aUpdated")).toBeDefined();

      // Clear all
      index.clear();
      expect(index.getAllDeclarations()).toHaveLength(0);
      expect(index.getDocumentUris()).toHaveLength(0);
    });

    it("toProjectIndexView returns valid ProjectIndexView adapter", async () => {
      const doc = await parseCode("const testVal = 99;", "javascript", "file:///test.js");
      const index = new LocalDeclarationIndex([doc]);

      const view = index.toProjectIndexView();
      expect(view.getDocument?.("file:///test.js")).toBe(doc.document);
      expect(view.lookupSymbol?.("testVal")).toBeDefined();
    });
  });
});
