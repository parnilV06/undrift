// JavaScript and TypeScript analyzer package entry point.
// Exports analyzer registry, support matrix contracts, and pattern definitions.

export * from "./support-matrix";
export { AnalyzerRegistry, AnalyzerRegistrationError } from "./registry/analyzer-registry";
export type { IAnalyzerRegistry } from "./registry/analyzer-registry";
