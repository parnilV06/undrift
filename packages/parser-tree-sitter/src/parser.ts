// Concrete Tree-sitter ParserPort adapter connecting web-tree-sitter runtime,
// GrammarRegistry, PositionMapper, and SyntaxNodeFacade as specified in LLD.md Section 6.

import type {
  DocumentUri,
  ParsedDocument,
  ParseIssue,
  ParseRequest,
  ParserPort,
  SourceSpan
} from "@undrift/core";
import type Parser from "web-tree-sitter";
import { TreeSitterRuntimeError, UnsupportedLanguageError } from "./errors";
import { GrammarRegistry, type GrammarRegistryOptions } from "./grammar-registry/grammar-registry";
import { PositionMapper } from "./position-mapping";
import { ParserRuntime, type ParserRuntimeOptions } from "./runtime/parser-runtime";
import { SyntaxNodeFacade } from "./syntax-view/syntax-node-facade";

/**
 * Configuration options for TreeSitterParserAdapter.
 */
export interface TreeSitterParserAdapterOptions {
  /** Optional existing ParserRuntime instance. If omitted, an internal runtime is managed. */
  runtime?: ParserRuntime;
  /** Optional existing GrammarRegistry instance. If omitted, an internal registry is managed. */
  registry?: GrammarRegistry;
  /** Options passed to the internal ParserRuntime if created automatically. */
  parserRuntimeOptions?: ParserRuntimeOptions;
  /** Options passed to the internal GrammarRegistry if created automatically. */
  grammarRegistryOptions?: GrammarRegistryOptions;
}

/**
 * Concrete implementation of UNDRIFT's core ParserPort backed by web-tree-sitter.
 *
 * Responsibilities:
 * 1. Checks language support via GrammarRegistry.
 * 2. Lazily initializes WebAssembly runtime and language grammars.
 * 3. Parses source snapshots into SyntaxNodeFacade trees without leaking native objects.
 * 4. Collects parse error and missing nodes into normalized ParseIssue records.
 * 5. Returns disposable ParsedDocument instances tied to the exact source snapshot.
 * 6. Respects AbortSignal cancellation at execution boundaries.
 */
export class TreeSitterParserAdapter implements ParserPort {
  readonly id = "tree-sitter";

  private readonly runtime: ParserRuntime;
  private readonly registry: GrammarRegistry;
  private readonly ownsRuntime: boolean;
  private readonly ownsRegistry: boolean;
  private isDisposed = false;

  constructor(options?: TreeSitterParserAdapterOptions) {
    this.ownsRuntime = !options?.runtime;
    this.ownsRegistry = !options?.registry;

    this.runtime = options?.runtime ?? new ParserRuntime();
    this.registry =
      options?.registry ??
      new GrammarRegistry({
        ...options?.grammarRegistryOptions,
        runtime: this.runtime
      });
  }

  /**
   * Determines if this parser adapter supports the given language and document URI.
   */
  supports(languageId: string, uri: DocumentUri): boolean {
    if (this.isDisposed) {
      return false;
    }
    return this.registry.supports(languageId, uri);
  }

  /**
   * Asynchronously parses the requested source document snapshot into a ParsedDocument.
   *
   * Note on incremental parsing: The `request.previous` tree is part of the core contract
   * but is not utilized for edit-based incremental reparsing in this technical chunk.
   * Full document parsing is performed safely without mutating or disposing `request.previous`.
   */
  async parse(request: ParseRequest, signal?: AbortSignal): Promise<ParsedDocument> {
    if (this.isDisposed) {
      throw new TreeSitterRuntimeError("TreeSitterParserAdapter has been disposed.");
    }

    signal?.throwIfAborted();

    const { document } = request;
    const resolvedLanguage = this.registry.resolveLanguage(document.languageId, document.uri);

    if (!resolvedLanguage) {
      throw new UnsupportedLanguageError(document.languageId || document.uri);
    }

    signal?.throwIfAborted();

    // Ensure runtime is initialized
    if (!this.runtime.isInitialized()) {
      await this.runtime.init();
    }

    signal?.throwIfAborted();

    // Load language grammar (cached after first compilation)
    const language = await this.registry.getLanguage(resolvedLanguage);

    signal?.throwIfAborted();

    // Create parser instance tracked by runtime
    const parser = this.runtime.createParser(language);

    let tree: Parser.Tree;
    try {
      tree = parser.parse(document.text);
    } catch (err) {
      this.runtime.disposeParser(parser);
      throw new TreeSitterRuntimeError(
        `Failed to parse document '${document.uri}': ${
          err instanceof Error ? err.message : String(err)
        }`,
        err
      );
    }

    // Cancellation boundary: if aborted after tree creation, release tree and parser immediately
    if (signal?.aborted) {
      try {
        tree.delete();
      } finally {
        this.runtime.disposeParser(parser);
      }
      signal.throwIfAborted();
    }

    const mapper = new PositionMapper(document.text, document.uri);
    const root = new SyntaxNodeFacade(tree.rootNode, mapper);
    const issues = this.collectParseIssues(tree.rootNode, mapper, document.uri);

    let docDisposed = false;
    return {
      source: document,
      root,
      issues,
      dispose: () => {
        if (docDisposed) {
          return;
        }
        docDisposed = true;
        try {
          tree.delete();
        } finally {
          this.runtime.disposeParser(parser);
        }
      }
    };
  }

  /**
   * Disposes the parser adapter and releases any owned runtime or grammar registry resources.
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;

    if (this.ownsRegistry) {
      this.registry.dispose();
    }
    if (this.ownsRuntime) {
      this.runtime.dispose();
    }
  }

  /**
   * Recursively traverses nodes with errors to collect ParseIssue records without redundant inner error reporting.
   */
  private collectParseIssues(
    rootNode: Parser.SyntaxNode,
    mapper: PositionMapper,
    uri: DocumentUri
  ): ParseIssue[] {
    const issues: ParseIssue[] = [];

    const traverse = (node: Parser.SyntaxNode): void => {
      if (!node.hasError()) {
        return;
      }

      if (node.isMissing()) {
        let source: SourceSpan | undefined;
        try {
          source = mapper.toSourceSpanForNode(node, uri);
        } catch {
          // Fall back gracefully if offset cannot be mapped
        }
        issues.push({
          message: `Syntax error: missing '${node.type}'`,
          source,
          isError: true
        });
        return;
      }

      if (node.type === "ERROR") {
        let source: SourceSpan | undefined;
        try {
          source = mapper.toSourceSpanForNode(node, uri);
        } catch {
          // Fall back gracefully if offset cannot be mapped
        }
        const snippet = node.text ? `: '${node.text.slice(0, 30)}'` : "";
        issues.push({
          message: `Syntax error: unexpected token${snippet}`,
          source,
          isError: true
        });
        return; // Do not recurse into children of ERROR node to avoid duplicates
      }

      for (const child of node.children) {
        if (child.hasError()) {
          traverse(child);
        }
      }
    };

    traverse(rootNode);
    return issues;
  }
}
