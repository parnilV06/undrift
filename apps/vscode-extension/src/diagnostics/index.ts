// Public exports for UNDRIFT VS Code diagnostics integration.

export {
  DIAGNOSTIC_COLLECTION_NAME,
  DIAGNOSTIC_SOURCE,
  type DiagnosticCollectionLike,
  type DiagnosticFindingSource,
  type DriftDiagnosticProviderOptions,
  DriftDiagnosticProvider,
  InMemoryDiagnosticCollection,
  formatDiagnosticMessage,
  mapFindingSeverityToDiagnosticSeverity,
  parseDocumentUri,
  sourceSpanToVsCodeRange
} from "./diagnostic-provider";
