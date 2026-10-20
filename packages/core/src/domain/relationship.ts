// Contract relationship domain model as specified in LLD.md Section 4.9 and ERD.md Section 3.7.
// Represents candidate, confirmed, and unmatched relationships between consumer and provider observations.

import type { EvidenceRef } from "./evidence";
import type { AnalysisWarning } from "./finding";
import type { FindingId, ObservationId, RelationshipId } from "./types";

/**
 * Lifecycle and verification states of a contract relationship as specified in LLD.md Section 4.9.
 * - discovered: newly identified candidate relationship.
 * - waiting: queued or waiting for downstream verification.
 * - matched: candidate successfully matched across consumer and provider.
 * - verified: contract verification rules passed without unresolved mismatch.
 * - drifted: drift or contract violation detected for this relationship.
 * - orphaned: provider has no known consumer in the analyzed scope.
 * - unresolved: candidate relationship is ambiguous or cannot be resolved.
 * - ignored: relationship is suppressed or ignored by configuration.
 */
export type RelationshipState =
  | "discovered"
  | "waiting"
  | "matched"
  | "verified"
  | "drifted"
  | "orphaned"
  | "unresolved"
  | "ignored";

/**
 * Candidate matching classification as specified in LLD.md Section 4.9 and Section 10.2.
 * - exact: identical normalized method and structurally matching route.
 * - method-conflict: same unique route shape with conflicting known methods.
 * - suspected-route-conflict: same known method with one static segment difference and mutual uniqueness.
 * - ambiguous: multiple competing candidates where certainty cannot be established.
 * - unmatched: observation with no counterpart candidate in the analyzed scope.
 */
export type MatchKind =
  "exact" | "method-conflict" | "suspected-route-conflict" | "ambiguous" | "unmatched";

/**
 * First-class contract relationship connecting an observed consumer to an observed provider,
 * or representing an unmatched/orphaned observation as specified in LLD.md Section 4.9.
 */
export interface ContractRelationship {
  id: RelationshipId;
  consumerId?: ObservationId;
  providerId?: ObservationId;
  state: RelationshipState;
  matchKind: MatchKind;
  evidence: EvidenceRef[];
  reasons: string[];
  limitations: AnalysisWarning[];
  findingIds: FindingId[];
}

/**
 * Generates a stable, deterministic RelationshipId based on the match kind and involved observations
 * as specified in ERD.md Section 3.7.
 */
export function createRelationshipId(
  matchKind: MatchKind,
  consumerId?: ObservationId,
  providerId?: ObservationId
): RelationshipId {
  return `rel:${matchKind}:${consumerId ?? "none"}:${providerId ?? "none"}`;
}
