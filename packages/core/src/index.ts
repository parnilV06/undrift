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

export type {
  WarningCode,
  AnalysisWarning,
  FindingSeverity,
  FindingState,
  FindingCategory,
  FindingExplanation,
  Finding,
  FindingIdentityInput
} from "./domain/finding";

export { createFindingId, canonicalizeFindingIdentity } from "./domain/finding";

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

export {
  SUPPORTED_HTTP_METHODS,
  isSupportedHttpMethod,
  parseHttpMethod,
  normalizeHttpMethod,
  resolveFetchDefaultMethod
} from "./normalization/method-normalizer";

export type {
  MethodNormalizationState,
  MethodNormalizationResult
} from "./normalization/method-normalizer";

export {
  isRoutePattern,
  parseRouteSegment,
  normalizeRoute,
  formatRoutePattern
} from "./normalization/route-normalizer";

export type { RouteNormalizationOptions } from "./normalization/route-normalizer";

export {
  SUPPORTED_PRIMITIVES,
  isPrimitiveTypeName,
  normalizePrimitiveTypeName,
  isTypeShape,
  getTypeShapeKey,
  areTypeShapesEqual,
  normalizeFieldShape,
  normalizeType,
  formatTypeShape
} from "./normalization/type-normalizer";

export {
  normalizeShapeObservation,
  normalizeRequestShape,
  normalizeResponseShape,
  areFieldShapesEqual,
  areShapeObservationsEqual
} from "./normalization/shape-normalizer";

export type { RelationshipState, MatchKind, ContractRelationship } from "./domain/relationship";

export { createRelationshipId } from "./domain/relationship";

export {
  ContractMatcher,
  matchCandidates,
  areRouteShapesEqual,
  assessTrailingSlashCompatibility
} from "./matching/contract-matcher";

export type { TrailingSlashAssessment } from "./matching/contract-matcher";

export { explainFinding, formatExplanationText } from "./explaining/finding-explainer";

export type { ExplainFindingInput } from "./explaining/finding-explainer";

export {
  LIMITATION_RULE_IDS,
  evaluateLimitationWarning,
  evaluateLimitationRules
} from "./rules/limitation-rules";

export type { LimitationRuleId, LimitationWarningContext } from "./rules/limitation-rules";

export {
  PROTOCOL_RULE_IDS,
  evaluateProtocolRules,
  evaluateMethodConflictRule,
  evaluateSuspectedRouteMismatchRule,
  evaluateMissingProviderRule,
  evaluateNoKnownConsumerRule,
  resolveScopeCompleteness
} from "./rules/protocol-rules";

export type {
  ProtocolRuleId,
  ProtocolRuleContext,
  ProtocolRuleEvaluationInput
} from "./rules/protocol-rules";

export { compareShapes, checkTypeCompatibility } from "./comparison/shape-comparator";

export type {
  ComparisonDirection,
  ShapeComparatorOptions,
  ShapeDriftKind,
  ShapeDifference,
  CompatibilityState,
  TypeCompatibilityResult
} from "./comparison/shape-comparator";

export { SHAPE_RULE_IDS, evaluateShapeRules } from "./rules/shape-rules";

export type { ShapeRuleId, ShapeRuleEvaluationInput } from "./rules/shape-rules";

export { RuleEngine, evaluateRules } from "./rules/rule-engine";

export type { RuleEngineEvaluationInput } from "./rules/rule-engine";

export { AnalysisEngine } from "./engine/analysis-engine";

export type {
  AnalysisRequest,
  AnalysisResult,
  AnalysisStatistics,
  PipelineDependencies,
  AnalysisEngineDependencies,
  AnalysisPipeline,
  AnalysisEnginePort
} from "./ports/engine";

export {
  SNAPSHOT_SCHEMA_VERSION,
  LIFECYCLE_HISTORY_SCHEMA_VERSION,
  toPersistedFindingRecord
} from "./domain/snapshot";

export type {
  PersistedFindingRecord,
  AnalysisSnapshot,
  FindingLifecycleTransition,
  FindingLifecycleState,
  FindingLifecycleContext,
  FindingLifecycleEvent,
  FindingLifecycleHistory,
  StateReconciliationOptions,
  ReconciliationResult
} from "./domain/snapshot";

export type {
  HistoryFilter,
  RetentionPolicy,
  StatePersistencePort,
  StateReconciliationPort
} from "./ports/persistence";

export {
  reconcileState,
  StateReconciler,
  extractCoverageSummary
} from "./reconciliation/state-reconciler";
