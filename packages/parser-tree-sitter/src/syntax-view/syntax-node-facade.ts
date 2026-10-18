// Binding-neutral SyntaxNode facade implementation wrapping web-tree-sitter SyntaxNode
// as specified in LLD.md Section 6.2 and the core SyntaxNode interface.

import type { ByteRange, SyntaxNode, TextRange } from "@undrift/core";
import type Parser from "web-tree-sitter";
import type { PositionMapper } from "../position-mapping";

/**
 * Binding-neutral syntax-node facade wrapping a concrete web-tree-sitter SyntaxNode.
 * Encapsulates Tree-sitter and WASM runtime details and exposes normalized UTF-16 coordinates.
 */
export class SyntaxNodeFacade implements SyntaxNode {
  readonly kind: string;
  readonly range: TextRange;
  readonly byteRange?: ByteRange;

  private readonly inner: Parser.SyntaxNode;
  private readonly mapper: PositionMapper;

  constructor(inner: Parser.SyntaxNode, mapper: PositionMapper) {
    this.inner = inner;
    this.mapper = mapper;
    this.kind = inner.type;

    // In web-tree-sitter, inner.startIndex and inner.endIndex represent UTF-16 code-unit
    // string indices because web-tree-sitter parses JavaScript strings via UTF-16 buffers.
    // In native C bindings or byte-based runtimes, they represent UTF-8 byte offsets.
    // We normalize both transparently:
    if (
      inner.endIndex <= mapper.utf16Length &&
      inner.text === mapper.text.slice(inner.startIndex, inner.endIndex)
    ) {
      // The inner node already carries normalized UTF-16 code-unit offsets
      this.range = {
        start: inner.startIndex,
        end: inner.endIndex
      };
      try {
        this.byteRange = mapper.toByteRange(inner.startIndex, inner.endIndex);
      } catch {
        this.byteRange = {
          start: inner.startIndex,
          end: inner.endIndex
        };
      }
    } else {
      // The inner node carries parser-native UTF-8 byte offsets
      this.byteRange = {
        start: inner.startIndex,
        end: inner.endIndex
      };
      this.range = mapper.toTextRange(inner.startIndex, inner.endIndex);
    }
  }

  /**
   * Retrieves the exact source text spanned by this syntax node.
   */
  text(): string {
    return this.mapper.text.slice(this.range.start, this.range.end);
  }

  /**
   * Returns all child syntax nodes, wrapped in SyntaxNodeFacade instances.
   */
  children(): readonly SyntaxNode[] {
    return this.inner.children.map((child) => new SyntaxNodeFacade(child, this.mapper));
  }

  /**
   * Returns only named child syntax nodes, omitting anonymous punctuation and tokens.
   */
  namedChildren(): readonly SyntaxNode[] {
    return this.inner.namedChildren.map((child) => new SyntaxNodeFacade(child, this.mapper));
  }

  /**
   * Looks up a child node corresponding to a specific grammar field name.
   */
  childForField(name: string): SyntaxNode | undefined {
    const child = this.inner.childForFieldName(name);
    return child ? new SyntaxNodeFacade(child, this.mapper) : undefined;
  }

  /**
   * Navigates to the parent syntax node, if available.
   */
  parent(): SyntaxNode | undefined {
    const p = this.inner.parent;
    return p ? new SyntaxNodeFacade(p, this.mapper) : undefined;
  }
}
