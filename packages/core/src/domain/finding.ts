// Foundational finding and analysis warning domain models as specified in LLD.md Section 4.10, 4.11, 11.1, and 16.3.
// Represents detected drift findings, analysis limitations, deterministic finding identity,
// and structured explanations.

import * as crypto from "crypto";
import type { EvidenceStrength, SourceSpan } from "./evidence";
import type { RoutePattern } from "./observation";
import type {
  DocumentUri,
  FindingId,
  FixProposalId,
  ObservationId,
  RelationshipId,
  RuleId
} from "./types";
import { formatRoutePattern, normalizeRoute } from "../normalization/route-normalizer";

/**
 * Well-defined warning codes indicating limits, syntax errors, or unresolved patterns
 * encountered during analysis as specified in LLD.md Section 4.11.
 */
export type WarningCode =
  | "PARSE_ERROR"
  | "UNSUPPORTED_PATTERN"
  | "UNRESOLVED_REFERENCE"
  | "DYNAMIC_ROUTE"
  | "PARTIAL_SHAPE"
  | "INCOMPLETE_SCOPE"
  | "CONFIGURATION_ERROR"
  | "ANALYZER_FAILURE";

/**
 * Scope classification for an analysis warning indicating whether it affects
 * consumer (frontend), provider (backend), a specific contract dimension, or the entire workspace.
 */
export type WarningScope = "consumer" | "provider" | "workspace" | "unknown";

/**
 * Specific API contract dimension affected by a warning.
 */
export type WarningTargetDimension =
  "route" | "method" | "request-shape" | "response-shape" | "all";

/**
 * Analysis warning indicating a limitation or failure during extraction.
 * Analysis warnings are NOT automatically drift findings and must not all
 * become error-level diagnostics.
 */
export interface AnalysisWarning {
  code: WarningCode;
  message: string;
  source?: SourceSpan;
  analyzerId?: string;
  affectsCompleteness: boolean;
  scope?: WarningScope;
  targetDimension?: WarningTargetDimension;
}

/**
 * Severity level of a drift or limitation finding as specified in LLD.md Section 4.10.
 */
export type FindingSeverity = "error" | "warning" | "info";

/**
 * Lifecycle state of a finding as specified in LLD.md Section 4.10.
 */
export type FindingState = "active" | "suppressed" | "resolved";

/**
 * Classification category of a finding as specified in LLD.md Section 4.10.
 */
export type FindingCategory =
  "existence" | "route" | "request-shape" | "response-shape" | "type" | "analysis-limit";

/**
 * Structured explanation model for a finding as specified in LLD.md Section 12.2.
 */
export interface FindingExplanation {
  headline: string;
  summary: string;
  expectedDescription?: string;
  observedDescription?: string;
  reason: string;
  possibleImpact?: string;
  evidenceStrength: EvidenceStrength;
  sourceLocations: SourceSpan[];
  limitations: AnalysisWarning[];
  suggestedNextSteps: string[];
}

/**
 * First-class finding entity representing a contract discrepancy or analysis limit
 * as specified in LLD.md Section 4.10 and ERD.md Section 3.8.
 */
export interface Finding {
  id: FindingId;
  ruleId: RuleId;
  category: FindingCategory;
  severity: FindingSeverity;
  state: FindingState;
  title: string;
  summary: string;
  explanation: string;
  evidenceStrength: EvidenceStrength;
  relationshipId?: RelationshipId;
  observationIds: ObservationId[];
  sourceLocations: SourceSpan[];
  expected?: unknown;
  observed?: unknown;
  impactStatement?: string;
  limitations: AnalysisWarning[];
  fixProposalIds: FixProposalId[];
  structuredExplanation?: FindingExplanation;
}

/**
 * Canonical semantic inputs used to derive deterministic finding identity
 * as specified in LLD.md Section 16.3 and ERD.md Section 3.8.
 */
export interface FindingIdentityInput {
  ruleId: RuleId;
  method?: string | null;
  route?: string | RoutePattern | null;
  trailingSlash?: "present" | "absent" | "unknown" | null;
  targetKey?: string | null;
  consumerId?: ObservationId | null;
  providerId?: ObservationId | null;
  observationIds?: readonly ObservationId[] | null;
  scopeUri?: DocumentUri | null;
  warningCode?: WarningCode | null;
}

/**
 * Serializes finding identity inputs into a canonical, unambiguous JSON representation
 * where key order and observation arrays are strictly sorted to prevent delimiter collisions.
 * Preserves route trailing-slash certainty ('present' | 'absent' | 'unknown').
 */
export function canonicalizeFindingIdentity(input: FindingIdentityInput): string {
  const sortedObs = input.observationIds
    ? [...input.observationIds].sort((a, b) => a.localeCompare(b))
    : [];

  let routeStr: string | null = null;
  let trailingSlash: "present" | "absent" | "unknown" | null = null;

  if (input.route !== undefined && input.route !== null) {
    if (typeof input.route === "string") {
      const normalized = normalizeRoute(input.route);
      routeStr = formatRoutePattern(normalized);
      trailingSlash = input.trailingSlash ?? normalized.trailingSlash;
    } else {
      routeStr = formatRoutePattern(input.route);
      trailingSlash = input.trailingSlash ?? input.route.trailingSlash ?? null;
    }
  } else if (input.trailingSlash !== undefined) {
    trailingSlash = input.trailingSlash ?? null;
  }

  const payload = {
    consumer: input.consumerId ?? null,
    method: input.method ? input.method.trim().toUpperCase() : null,
    observations: sortedObs,
    provider: input.providerId ?? null,
    route: routeStr,
    ruleId: input.ruleId,
    scopeUri: input.scopeUri ?? null,
    targetKey: input.targetKey ?? null,
    trailingSlash,
    warningCode: input.warningCode ?? null
  };

  const keys = Object.keys(payload).sort() as Array<keyof typeof payload>;
  const canonicalEntries = keys.map((k) => [k, payload[k]]);
  return JSON.stringify(canonicalEntries);
}

/**
 * Derives a deterministic, line-number invariant FindingId from semantic finding inputs
 * as specified in LLD.md Section 16.3.
 */
export function createFindingId(input: FindingIdentityInput): FindingId {
  const canonical = canonicalizeFindingIdentity(input);
  const hash = crypto.createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 16);
  return `find:${input.ruleId}:${hash}`;
}
