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
