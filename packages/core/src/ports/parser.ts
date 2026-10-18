// Parser port, parse request/result contracts, parse issue, and binding-neutral syntax-node facade
// as specified in LLD.md Section 5.1.

import type { ByteRange, SourceSpan, TextRange } from "../domain/evidence";
import type { DocumentUri, SourceDocument } from "../domain/types";

/**
 * Diagnostic issue or syntax error encountered during document parsing.
 */
export interface ParseIssue {
  /** Human-readable message describing the parse issue. */
  message: string;
  /** Source location in the parsed document where the issue occurred, if available. */
  source?: SourceSpan;
  /** Whether this issue represents a hard syntax error or a recoverable warning/missing node. */
  isError: boolean;
}

/**
 * Binding-neutral syntax-node facade exposing essential structural navigation
 * and source coordinates without leaking Tree-sitter or WASM runtime objects.
 */
export interface SyntaxNode {
  /** Grammar node type/kind (e.g., 'call_expression', 'identifier'). */
  readonly kind: string;
  /** Normalized source range in absolute UTF-16 code units. */
  readonly range: TextRange;
  /** Optional parser-native byte range for internal mapping and debugging. */
  readonly byteRange?: ByteRange;

  /** Retrieves the exact source text spanned by this syntax node. */
  text(): string;
  /** Returns all child syntax nodes. */
  children(): readonly SyntaxNode[];
  /** Returns only named child syntax nodes, omitting anonymous punctuation/tokens. */
  namedChildren(): readonly SyntaxNode[];
  /** Looks up a child node corresponding to a specific grammar field name. */
  childForField(name: string): SyntaxNode | undefined;
  /** Navigates to the parent syntax node, if available. */
  parent(): SyntaxNode | undefined;
}

/**
 * Immutable abstraction of a successfully parsed document snapshot.
 * Encapsulates the root syntax facade, any non-fatal parse issues, and resource disposal.
 */
export interface ParsedDocument {
  /** The exact source document snapshot that was parsed. */
  source: SourceDocument;
  /** The root syntax node facade of the parse tree. */
  root: SyntaxNode;
  /** Non-fatal parser warnings, missing nodes, or syntax issues encountered during parsing. */
  issues: ParseIssue[];
  /**
   * Releases binding-level parse tree resources and memory according to the
   * underlying runtime lifecycle.
   */
  dispose(): void;
}

/**
 * Request payload passed to a parser port.
 */
export interface ParseRequest {
  /** The exact source document snapshot to parse. */
  document: SourceDocument;
  /**
   * Optional previous parsed document used for incremental reparsing
   * when supported by the underlying parser binding.
   */
  previous?: ParsedDocument;
}

/**
 * Core port for language syntax parsing.
 * Implemented by parser adapters (e.g. `@undrift/parser-tree-sitter`) to supply
 * binding-neutral parsed documents to the analysis engine and extractors.
 */
export interface ParserPort {
  /** Stable identifier for this parser implementation. */
  readonly id: string;
  /** Determines if this parser supports the given language and document URI. */
  supports(languageId: string, uri: DocumentUri): boolean;
  /**
   * Asynchronously parses the requested source document snapshot into a ParsedDocument.
   * Accepts an optional AbortSignal for cancellation.
   */
  parse(request: ParseRequest, signal?: AbortSignal): Promise<ParsedDocument>;
  /**
   * Disposes the parser and releases any shared runtime/grammar resources.
   */
  dispose(): void;
}
