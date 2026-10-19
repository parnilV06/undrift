// Local declaration index for JavaScript and TypeScript source documents
// as specified in LLD.md Section 7.6 and Section 8.4.
// Indexes local variable declarations, functions, type aliases, interfaces, and imports
// providing read-only query access conforming to ProjectIndexView.

import type {
  DocumentUri,
  EvidenceRef,
  ParsedDocument,
  ProjectIndexView,
  SourceDocument,
  SourceSpan,
  SyntaxNode
} from "@undrift/core";
import { PositionMapper } from "@undrift/parser-tree-sitter";

/**
 * Kind of local declaration indexed in source documents.
 */
export type LocalDeclarationKind =
  "variable" | "function" | "type-alias" | "interface" | "import" | "export";

/**
 * Base metadata shared by all indexed local declarations.
 */
export interface LocalDeclarationBase {
  /** Identifier name of the declared or bound symbol. */
  readonly name: string;
  /** Categorized kind of the declaration. */
  readonly kind: LocalDeclarationKind;
  /** Exact source span where the declaration appears in the document snapshot. */
  readonly source: SourceSpan;
  /** URI of the source document containing the declaration. */
  readonly documentUri: DocumentUri;
  /** Content hash of the document snapshot from which the declaration was extracted. */
  readonly snapshotHash: string;
  /** Evidence reference anchoring the declaration to syntax. */
  readonly evidence: EvidenceRef;
  /** Whether this declaration is marked with an export modifier or exported. */
  readonly exported: boolean;
}

/**
 * Indexed local variable declaration (const, let, var).
 */
export interface LocalVariableDeclaration extends LocalDeclarationBase {
  readonly kind: "variable";
  /** Specific keyword used for declaration. */
  readonly declarationType: "const" | "let" | "var";
  /** True if declared with const keyword. */
  readonly isConstant: boolean;
  /** Literal value if initialized with a static literal. */
  readonly literalValue?: string | number | boolean | null;
  /** Source text of initializer expression, if present. */
  readonly initializerText?: string;
}

/**
 * Indexed local function declaration.
 */
export interface LocalFunctionDeclaration extends LocalDeclarationBase {
  readonly kind: "function";
  /** True if declared as an async function. */
  readonly isAsync?: boolean;
  /** True if declared as a generator function. */
  readonly isGenerator?: boolean;
}

/**
 * Indexed TypeScript type alias declaration (type X = ...).
 */
export interface LocalTypeAliasDeclaration extends LocalDeclarationBase {
  readonly kind: "type-alias";
  /** Text representation of the aliased type expression. */
  readonly typeText?: string;
}

/**
 * Indexed TypeScript interface declaration (interface X { ... }).
 */
export interface LocalInterfaceDeclaration extends LocalDeclarationBase {
  readonly kind: "interface";
}

/**
 * Indexed import declaration (ES module or CommonJS require).
 */
export interface LocalImportDeclaration extends LocalDeclarationBase {
  readonly kind: "import";
  /** Module specifier string (e.g. 'express', 'axios', './utils'). */
  readonly moduleSpecifier: string;
  /** Exported name imported from the module ('default', '*', or specific named export). */
  readonly importedName: string;
  /** Flavor of import declaration. */
  readonly importKind: "default" | "named" | "namespace" | "require";
}

/**
 * Indexed export declaration (export default, export { ... }).
 */
export interface LocalExportDeclaration extends LocalDeclarationBase {
  readonly kind: "export";
  /** True if default export. */
  readonly isDefault: boolean;
  /** Target symbol name being exported, if aliased or referencing an existing identifier. */
  readonly targetSymbolName?: string;
}

/**
 * Union of all supported local declaration types.
 */
export type LocalDeclaration =
  | LocalVariableDeclaration
  | LocalFunctionDeclaration
  | LocalTypeAliasDeclaration
  | LocalInterfaceDeclaration
  | LocalImportDeclaration
  | LocalExportDeclaration;

/**
 * Extracts literal value if a node represents a string, number, boolean, or null literal.
 */
function extractLiteralValue(node: SyntaxNode): string | number | boolean | null | undefined {
  if (node.kind === "string") {
    const text = node.text();
    return text.slice(1, -1);
  }
  if (node.kind === "number") {
    return Number(node.text());
  }
  if (node.kind === "true") {
    return true;
  }
  if (node.kind === "false") {
    return false;
  }
  if (node.kind === "null") {
    return null;
  }
  return undefined;
}

/**
 * Traverses a parsed document snapshot and indexes all supported local declarations.
 * Conforms to LLD Section 7.6.
 */
export function indexLocalDeclarations(
  document: SourceDocument,
  parsed: ParsedDocument
): LocalDeclaration[] {
  const declarations: LocalDeclaration[] = [];
  const mapper = new PositionMapper(document.text, document.uri);

  function makeSpan(node: SyntaxNode): SourceSpan {
    return mapper.toSourceSpanFromUtf16(node.range.start, node.range.end, document.uri);
  }

  function makeEvidence(
    node: SyntaxNode,
    name: string,
    isImport: boolean,
    description: string
  ): EvidenceRef {
    const span = makeSpan(node);
    return {
      id: `ev-decl-${name}-${node.range.start}`,
      kind: isImport ? "imported-declaration" : "local-declaration",
      strength: "direct",
      source: span,
      description
    };
  }

  function processVariableDeclarator(
    declarator: SyntaxNode,
    declType: "const" | "let" | "var",
    exported: boolean
  ): void {
    const nameNode = declarator.childForField("name") ?? declarator.namedChildren()[0];
    const valNode = declarator.childForField("value") ?? declarator.namedChildren()[1];

    if (!nameNode) {
      return;
    }

    // Check if the value is a CommonJS require(...) call
    let isRequireCall = false;
    let requireModule = "";
    if (valNode && valNode.kind === "call_expression") {
      const callee = valNode.childForField("function") ?? valNode.namedChildren()[0];
      const args = valNode.childForField("arguments")?.namedChildren() ?? [];
      if (callee?.kind === "identifier" && callee.text() === "require" && args.length > 0) {
        if (args[0].kind === "string") {
          isRequireCall = true;
          requireModule = args[0].text().slice(1, -1);
        }
      }
    }

    // Direct identifier binding e.g. const api = "/api/v1"; or const express = require("express");
    if (nameNode.kind === "identifier") {
      const name = nameNode.text();

      if (isRequireCall) {
        const evidence = makeEvidence(
          declarator,
          name,
          true,
          `CommonJS require of '${requireModule}' bound to '${name}'`
        );
        declarations.push({
          name,
          kind: "import",
          source: makeSpan(declarator),
          documentUri: document.uri,
          snapshotHash: document.contentHash,
          evidence,
          exported,
          moduleSpecifier: requireModule,
          importedName: "default",
          importKind: "require"
        });
        return;
      }

      const literalValue = valNode ? extractLiteralValue(valNode) : undefined;
      const initializerText = valNode?.text();
      const evidence = makeEvidence(
        declarator,
        name,
        false,
        `${declType} variable declaration '${name}'`
      );

      declarations.push({
        name,
        kind: "variable",
        source: makeSpan(declarator),
        documentUri: document.uri,
        snapshotHash: document.contentHash,
        evidence,
        exported,
        declarationType: declType,
        isConstant: declType === "const",
        literalValue,
        initializerText
      });
      return;
    }

    // Destructured object pattern e.g. const { Router } = require("express"); or const { a, b } = config;
    if (nameNode.kind === "object_pattern") {
      for (const child of nameNode.namedChildren()) {
        if (child.kind === "shorthand_property_identifier_pattern") {
          const propName = child.text();
          if (isRequireCall) {
            const evidence = makeEvidence(
              child,
              propName,
              true,
              `Destructured CommonJS require member '${propName}' from '${requireModule}'`
            );
            declarations.push({
              name: propName,
              kind: "import",
              source: makeSpan(child),
              documentUri: document.uri,
              snapshotHash: document.contentHash,
              evidence,
              exported,
              moduleSpecifier: requireModule,
              importedName: propName,
              importKind: "require"
            });
          } else {
            const evidence = makeEvidence(
              child,
              propName,
              false,
              `Destructured ${declType} variable '${propName}'`
            );
            declarations.push({
              name: propName,
              kind: "variable",
              source: makeSpan(child),
              documentUri: document.uri,
              snapshotHash: document.contentHash,
              evidence,
              exported,
              declarationType: declType,
              isConstant: declType === "const"
            });
          }
        } else if (child.kind === "pair_pattern") {
          const keyNode = child.childForField("key") ?? child.namedChildren()[0];
          const valPatternNode = child.childForField("value") ?? child.namedChildren()[1];
          if (keyNode && valPatternNode && valPatternNode.kind === "identifier") {
            const importedKey =
              keyNode.kind === "string" ? keyNode.text().slice(1, -1) : keyNode.text();
            const boundName = valPatternNode.text();

            if (isRequireCall) {
              const evidence = makeEvidence(
                child,
                boundName,
                true,
                `Destructured CommonJS require member '${importedKey}' as '${boundName}' from '${requireModule}'`
              );
              declarations.push({
                name: boundName,
                kind: "import",
                source: makeSpan(child),
                documentUri: document.uri,
                snapshotHash: document.contentHash,
                evidence,
                exported,
                moduleSpecifier: requireModule,
                importedName: importedKey,
                importKind: "require"
              });
            } else {
              const evidence = makeEvidence(
                child,
                boundName,
                false,
                `Destructured ${declType} variable '${boundName}'`
              );
              declarations.push({
                name: boundName,
                kind: "variable",
                source: makeSpan(child),
                documentUri: document.uri,
                snapshotHash: document.contentHash,
                evidence,
                exported,
                declarationType: declType,
                isConstant: declType === "const"
              });
            }
          }
        }
      }
    }
  }

  function processDeclarationList(
    node: SyntaxNode,
    declType: "const" | "let" | "var",
    exported: boolean
  ): void {
    for (const child of node.namedChildren()) {
      if (child.kind === "variable_declarator") {
        processVariableDeclarator(child, declType, exported);
      }
    }
  }

  function processFunctionDeclaration(node: SyntaxNode, exported: boolean): void {
    const nameNode = node.childForField("name");
    if (!nameNode || nameNode.kind !== "identifier") {
      return;
    }

    const name = nameNode.text();
    const isAsync = node.text().startsWith("async ");
    const isGenerator = node.kind === "generator_function_declaration";

    const evidence = makeEvidence(node, name, false, `Function declaration '${name}'`);

    declarations.push({
      name,
      kind: "function",
      source: makeSpan(node),
      documentUri: document.uri,
      snapshotHash: document.contentHash,
      evidence,
      exported,
      isAsync,
      isGenerator
    });
  }

  function processTypeAliasDeclaration(node: SyntaxNode, exported: boolean): void {
    const nameNode = node.childForField("name");
    if (!nameNode) {
      return;
    }

    const name = nameNode.text();
    const valueNode = node.childForField("value") ?? node.childForField("type");
    const typeText = valueNode?.text();

    const evidence = makeEvidence(node, name, false, `TypeScript type alias '${name}'`);

    declarations.push({
      name,
      kind: "type-alias",
      source: makeSpan(node),
      documentUri: document.uri,
      snapshotHash: document.contentHash,
      evidence,
      exported,
      typeText
    });
  }

  function processInterfaceDeclaration(node: SyntaxNode, exported: boolean): void {
    const nameNode = node.childForField("name");
    if (!nameNode) {
      return;
    }

    const name = nameNode.text();
    const evidence = makeEvidence(node, name, false, `TypeScript interface '${name}'`);

    declarations.push({
      name,
      kind: "interface",
      source: makeSpan(node),
      documentUri: document.uri,
      snapshotHash: document.contentHash,
      evidence,
      exported
    });
  }

  function processImportStatement(node: SyntaxNode): void {
    const sourceNode = node.childForField("source");
    if (!sourceNode || sourceNode.kind !== "string") {
      return;
    }

    const moduleSpecifier = sourceNode.text().slice(1, -1);
    const clauseNode = node.namedChildren().find((c) => c.kind === "import_clause");
    if (!clauseNode) {
      return;
    }

    for (const child of clauseNode.namedChildren()) {
      // 1. Default import e.g. import express from "express";
      if (child.kind === "identifier") {
        const name = child.text();
        const evidence = makeEvidence(
          child,
          name,
          true,
          `Default import '${name}' from '${moduleSpecifier}'`
        );
        declarations.push({
          name,
          kind: "import",
          source: makeSpan(child),
          documentUri: document.uri,
          snapshotHash: document.contentHash,
          evidence,
          exported: false,
          moduleSpecifier,
          importedName: "default",
          importKind: "default"
        });
      }

      // 2. Named imports e.g. import { Router, Request as Req } from "express";
      if (child.kind === "named_imports") {
        for (const specifier of child.namedChildren()) {
          if (specifier.kind === "import_specifier") {
            const nameChild = specifier.childForField("name") ?? specifier.namedChildren()[0];
            const aliasChild = specifier.childForField("alias") ?? specifier.namedChildren()[1];

            if (nameChild) {
              const importedName = nameChild.text();
              const boundName = aliasChild ? aliasChild.text() : importedName;

              const evidence = makeEvidence(
                specifier,
                boundName,
                true,
                `Named import '${importedName}' as '${boundName}' from '${moduleSpecifier}'`
              );

              declarations.push({
                name: boundName,
                kind: "import",
                source: makeSpan(specifier),
                documentUri: document.uri,
                snapshotHash: document.contentHash,
                evidence,
                exported: false,
                moduleSpecifier,
                importedName,
                importKind: "named"
              });
            }
          }
        }
      }

      // 3. Namespace import e.g. import * as fs from "fs";
      if (child.kind === "namespace_import") {
        const idChild = child.namedChildren().find((c) => c.kind === "identifier");
        if (idChild) {
          const name = idChild.text();
          const evidence = makeEvidence(
            child,
            name,
            true,
            `Namespace import '* as ${name}' from '${moduleSpecifier}'`
          );

          declarations.push({
            name,
            kind: "import",
            source: makeSpan(child),
            documentUri: document.uri,
            snapshotHash: document.contentHash,
            evidence,
            exported: false,
            moduleSpecifier,
            importedName: "*",
            importKind: "namespace"
          });
        }
      }
    }
  }

  function processExportStatement(node: SyntaxNode): void {
    for (const child of node.namedChildren()) {
      if (child.kind === "lexical_declaration") {
        const declType = child.text().startsWith("const") ? "const" : "let";
        processDeclarationList(child, declType, true);
      } else if (child.kind === "variable_declaration") {
        processDeclarationList(child, "var", true);
      } else if (
        child.kind === "function_declaration" ||
        child.kind === "generator_function_declaration"
      ) {
        processFunctionDeclaration(child, true);
      } else if (child.kind === "type_alias_declaration") {
        processTypeAliasDeclaration(child, true);
      } else if (child.kind === "interface_declaration") {
        processInterfaceDeclaration(child, true);
      } else if (child.kind === "export_clause") {
        // export { a, b as c };
        for (const specifier of child.namedChildren()) {
          if (specifier.kind === "export_specifier") {
            const nameNode = specifier.childForField("name") ?? specifier.namedChildren()[0];
            const aliasNode = specifier.childForField("alias") ?? specifier.namedChildren()[1];
            if (nameNode) {
              const localName = nameNode.text();
              const exportedName = aliasNode ? aliasNode.text() : localName;
              const evidence = makeEvidence(
                specifier,
                exportedName,
                false,
                `Exported specifier '${exportedName}' referencing '${localName}'`
              );
              declarations.push({
                name: exportedName,
                kind: "export",
                source: makeSpan(specifier),
                documentUri: document.uri,
                snapshotHash: document.contentHash,
                evidence,
                exported: true,
                isDefault: false,
                targetSymbolName: localName
              });
            }
          }
        }
      } else if (child.kind === "identifier") {
        // export default router;
        const name = child.text();
        const evidence = makeEvidence(child, "default", false, `Default export of '${name}'`);
        declarations.push({
          name: "default",
          kind: "export",
          source: makeSpan(child),
          documentUri: document.uri,
          snapshotHash: document.contentHash,
          evidence,
          exported: true,
          isDefault: true,
          targetSymbolName: name
        });
      }
    }
  }

  // Pre-order tree traversal
  function walk(node: SyntaxNode): void {
    if (node.kind === "lexical_declaration") {
      const declType = node.text().startsWith("const") ? "const" : "let";
      processDeclarationList(node, declType, false);
      return;
    }

    if (node.kind === "variable_declaration") {
      processDeclarationList(node, "var", false);
      return;
    }

    if (node.kind === "function_declaration" || node.kind === "generator_function_declaration") {
      processFunctionDeclaration(node, false);
      return;
    }

    if (node.kind === "type_alias_declaration") {
      processTypeAliasDeclaration(node, false);
      return;
    }

    if (node.kind === "interface_declaration") {
      processInterfaceDeclaration(node, false);
      return;
    }

    if (node.kind === "import_statement") {
      processImportStatement(node);
      return;
    }

    if (node.kind === "export_statement") {
      processExportStatement(node);
      return;
    }

    for (const child of node.namedChildren()) {
      walk(child);
    }
  }

  walk(parsed.root);
  return declarations;
}

/**
 * Concrete in-memory local declaration index conforming to ProjectIndexView
 * as specified in LLD.md Section 7.6, Section 8.4, and Section 5.2.
 */
export class LocalDeclarationIndex implements ProjectIndexView {
  readonly [key: string]: unknown;
  readonly isLocalDeclarationIndex = true;
  private readonly documents = new Map<DocumentUri, SourceDocument>();
  private readonly declarationsByDoc = new Map<DocumentUri, LocalDeclaration[]>();
  private readonly declarationsByName = new Map<string, LocalDeclaration[]>();

  constructor(entries?: Array<{ document: SourceDocument; parsed: ParsedDocument }>) {
    if (entries) {
      for (const entry of entries) {
        this.indexDocument(entry.document, entry.parsed);
      }
    }
  }

  /**
   * Indexes a document snapshot and extracts its local declarations.
   */
  indexDocument(document: SourceDocument, parsed: ParsedDocument): void {
    // If previously indexed, remove stale declarations first
    if (this.documents.has(document.uri)) {
      this.removeDocument(document.uri);
    }

    this.documents.set(document.uri, document);
    const decls = indexLocalDeclarations(document, parsed);
    this.declarationsByDoc.set(document.uri, decls);

    for (const decl of decls) {
      let list = this.declarationsByName.get(decl.name);
      if (!list) {
        list = [];
        this.declarationsByName.set(decl.name, list);
      }
      list.push(decl);
    }
  }

  /**
   * Removes an indexed document and its declarations from the index.
   */
  removeDocument(uri: DocumentUri): void {
    this.documents.delete(uri);
    const oldDecls = this.declarationsByDoc.get(uri);
    if (!oldDecls) {
      return;
    }

    this.declarationsByDoc.delete(uri);
    for (const decl of oldDecls) {
      const list = this.declarationsByName.get(decl.name);
      if (list) {
        const filtered = list.filter((d) => d.documentUri !== uri);
        if (filtered.length > 0) {
          this.declarationsByName.set(decl.name, filtered);
        } else {
          this.declarationsByName.delete(decl.name);
        }
      }
    }
  }

  /**
   * Checks whether a document URI is tracked in the index.
   */
  hasDocument(uri: DocumentUri): boolean {
    return this.documents.has(uri);
  }

  /**
   * Retrieves an indexed source document snapshot by URI (ProjectIndexView requirement).
   */
  getDocument(uri: DocumentUri): SourceDocument | undefined {
    return this.documents.get(uri);
  }

  /**
   * Looks up a symbol or declaration by name, optionally prioritizing a specific document scope
   * (ProjectIndexView requirement).
   */
  lookupSymbol(name: string, fromUri?: DocumentUri): LocalDeclaration | undefined {
    const matches = this.declarationsByName.get(name);
    if (!matches || matches.length === 0) {
      return undefined;
    }

    if (fromUri) {
      // Prioritize declaration local to the requesting document
      const localMatch = matches.find((d) => d.documentUri === fromUri);
      if (localMatch) {
        return localMatch;
      }
    }

    // Default to first match (or first exported match if cross-file)
    const exportedMatch = matches.find((d) => d.exported);
    return exportedMatch ?? matches[0];
  }

  /**
   * Returns all matching declarations for a given symbol name across documents.
   */
  lookupSymbols(name: string, fromUri?: DocumentUri): readonly LocalDeclaration[] {
    const matches = this.declarationsByName.get(name);
    if (!matches) {
      return [];
    }

    if (fromUri) {
      // Sort matches so that declarations from fromUri appear first
      return [...matches].sort((a, b) => {
        if (a.documentUri === fromUri && b.documentUri !== fromUri) return -1;
        if (b.documentUri === fromUri && a.documentUri !== fromUri) return 1;
        return 0;
      });
    }

    return [...matches];
  }

  /**
   * Retrieves all declarations extracted from a specific document.
   */
  getDeclarationsForDocument(uri: DocumentUri): readonly LocalDeclaration[] {
    return this.declarationsByDoc.get(uri) ?? [];
  }

  /**
   * Filters indexed declarations by kind, optionally within a single document.
   */
  getDeclarationsByKind(
    kind: LocalDeclarationKind,
    uri?: DocumentUri
  ): readonly LocalDeclaration[] {
    if (uri) {
      const docDecls = this.declarationsByDoc.get(uri) ?? [];
      return docDecls.filter((d) => d.kind === kind);
    }

    const results: LocalDeclaration[] = [];
    for (const decls of this.declarationsByDoc.values()) {
      for (const d of decls) {
        if (d.kind === kind) {
          results.push(d);
        }
      }
    }
    return results;
  }

  /**
   * Finds all import declarations importing from a specified module.
   */
  findImports(moduleSpecifier: string, fromUri?: DocumentUri): readonly LocalImportDeclaration[] {
    const importDecls = this.getDeclarationsByKind("import", fromUri) as LocalImportDeclaration[];
    return importDecls.filter((d) => d.moduleSpecifier === moduleSpecifier);
  }

  /**
   * Returns all exported declarations, optionally filtered by document.
   */
  findExports(fromUri?: DocumentUri): readonly LocalDeclaration[] {
    if (fromUri) {
      const docDecls = this.declarationsByDoc.get(fromUri) ?? [];
      return docDecls.filter((d) => d.exported);
    }

    const results: LocalDeclaration[] = [];
    for (const decls of this.declarationsByDoc.values()) {
      for (const d of decls) {
        if (d.exported) {
          results.push(d);
        }
      }
    }
    return results;
  }

  /**
   * Returns all declarations currently held in the index.
   */
  getAllDeclarations(): readonly LocalDeclaration[] {
    const results: LocalDeclaration[] = [];
    for (const decls of this.declarationsByDoc.values()) {
      results.push(...decls);
    }
    return results;
  }

  /**
   * Returns the list of document URIs currently indexed.
   */
  getDocumentUris(): readonly DocumentUri[] {
    return Array.from(this.documents.keys());
  }

  /**
   * Clears all indexed documents and declarations.
   */
  clear(): void {
    this.documents.clear();
    this.declarationsByDoc.clear();
    this.declarationsByName.clear();
  }

  /**
   * Explicitly returns this index as a ProjectIndexView.
   */
  toProjectIndexView(): ProjectIndexView {
    return this;
  }
}

/**
 * Type guard verifying if an unknown object conforms to LocalDeclarationIndex.
 */
export function isLocalDeclarationIndex(obj: unknown): obj is LocalDeclarationIndex {
  return (
    obj instanceof LocalDeclarationIndex ||
    (typeof obj === "object" &&
      obj !== null &&
      "lookupSymbols" in obj &&
      typeof (obj as { lookupSymbols?: unknown }).lookupSymbols === "function" &&
      "getDocument" in obj &&
      typeof (obj as { getDocument?: unknown }).getDocument === "function")
  );
}

/**
 * Factory helper creating a LocalDeclarationIndex from an optional array of documents.
 */
export function createLocalDeclarationIndex(
  entries?: Array<{ document: SourceDocument; parsed: ParsedDocument }>
): LocalDeclarationIndex {
  return new LocalDeclarationIndex(entries);
}
