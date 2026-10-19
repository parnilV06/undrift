// Core package entry point for foundational domain contracts.
// Public domain models, ports, normalizers, rule engine, and analysis engine
// will be exported as subsequent implementation chunks are completed.

export type {
  WorkspaceId,
  DocumentUri,
  ObservationId,
  RelationshipId,
  FindingId,
  FixProposalId,
  RuleId,
  HttpMethod,
  SourceDocument,
  CompletenessStatus,
  AnalysisCompleteness,
  AnalysisStatus,
  ParseStatus,
  AnalysisCoverageSummary
} from "./domain/types";

export type {
  TextRange,
  Position,
  ByteRange,
  SourceSpan,
  SourceSnapshotRef,
  EvidenceStrength,
  EvidenceSourceKind,
  EvidenceRef,
  ObservedValue
} from "./domain/evidence";

export type { WarningCode, AnalysisWarning } from "./domain/finding";

export type {
  RouteSegment,
  RoutePattern,
  PrimitiveTypeName,
  TypeShape,
  FieldShape,
  ShapeObservation,
  RequestShapeObservation,
  ResponseShapeObservation,
  EndpointObservation,
  ObservationRole,
  ApiObservation
} from "./domain/observation";

export type {
  ParseIssue,
  SyntaxNode,
  ParsedDocument,
  ParseRequest,
  ParserPort
} from "./ports/parser";

export type {
  ProjectIndexView,
  AnalyzerInput,
  AnalyzerOutput,
  LanguageAnalyzerPort,
  AnalyzerPort,
  ResolvedUndriftConfig
} from "./ports/analyzer";

export type {
  SemanticResolutionRequest,
  SemanticResolutionResult,
  SemanticResolverPort
} from "./ports/resolver";
