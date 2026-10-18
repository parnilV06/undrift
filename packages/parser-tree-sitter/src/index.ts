// Tree-sitter parser package entry point.
// Exports runtime lifecycle management, grammar registry, and error classes.

export {
  ParserRuntime,
  type ParserRuntimeOptions,
  type ParsedSnippetHandle
} from "./runtime/parser-runtime";

export {
  GrammarRegistry,
  type GrammarRegistryOptions,
  type SupportedLanguageId
} from "./grammar-registry/grammar-registry";

export { TreeSitterParserAdapter, type TreeSitterParserAdapterOptions } from "./parser";

export { PositionMapper } from "./position-mapping";
export { SyntaxNodeFacade } from "./syntax-view/syntax-node-facade";

export {
  TreeSitterRuntimeError,
  GrammarLoadError,
  UnsupportedLanguageError,
  PositionMappingError
} from "./errors";
