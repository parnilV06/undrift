// JavaScript and TypeScript analyzer package entry point.
// Exports analyzer registry, JsTsAnalyzer, fetch extractor, and support matrix definitions.

export * from "./support-matrix";
export { AnalyzerRegistry, AnalyzerRegistrationError } from "./registry/analyzer-registry";
export type { IAnalyzerRegistry } from "./registry/analyzer-registry";
export { JsTsAnalyzer } from "./registry/js-ts-analyzer";
export {
  FetchExtractor,
  extractFetchObservations,
  type FetchExtractionResult
} from "./frontend/fetch-extractor";
export {
  AxiosExtractor,
  extractAxiosObservations,
  type AxiosExtractionResult
} from "./frontend/axios-extractor";
export {
  ExpressExtractor,
  extractExpressObservations,
  type ExpressExtractionResult
} from "./backend/express-extractor";
export {
  LocalDeclarationIndex,
  indexLocalDeclarations,
  createLocalDeclarationIndex,
  type LocalDeclaration,
  type LocalDeclarationBase,
  type LocalDeclarationKind,
  type LocalVariableDeclaration,
  type LocalFunctionDeclaration,
  type LocalTypeAliasDeclaration,
  type LocalInterfaceDeclaration,
  type LocalImportDeclaration,
  type LocalExportDeclaration
} from "./project-index/local-declaration-index";
export {
  LocalReferenceResolver,
  createLocalReferenceResolver,
  type LocalResolutionState,
  type LocalReferenceResult
} from "./project-index/local-reference-resolver";
