// Fix generator port and context contracts as specified in LLD.md Section 5.9 and Section 13.1.

import type { FixProposal, FixTargetRole } from "../domain/fix";
import type { Finding } from "../domain/finding";
import type { ApiObservation } from "../domain/observation";
import type { ContractRelationship } from "../domain/relationship";
import type {
  DocumentUri,
  ObservationId,
  RelationshipId,
  RuleId,
  SourceDocument,
  WorkspaceId
} from "../domain/types";

/**
 * Context provided to a FixGeneratorPort implementation during proposal generation.
 * Contains sufficient finding, relationship, observation, and source evidence
 * without coupling the core domain to VS Code APIs.
 */
export interface FixGenerationContext {
  /** Extracted API observations indexed by ObservationId. */
  readonly observations: ReadonlyMap<ObservationId, ApiObservation>;
  /** Optional matched contract relationships indexed by RelationshipId. */
  readonly relationships?: ReadonlyMap<RelationshipId, ContractRelationship>;
  /** Optional source document snapshots indexed by DocumentUri. */
  readonly sourceDocuments?: ReadonlyMap<DocumentUri, SourceDocument>;
  /** Optional current analysis generation number. */
  readonly generation?: number;
  /** Optional target role filter if caller requests proposals for a specific side. */
  readonly targetRole?: FixTargetRole;
  /** Optional originating workspace identifier. */
  readonly workspaceId?: WorkspaceId;
}

/**
 * Pure TypeScript port for generating deterministic, reviewable repair proposals
 * for detected contract drift findings as specified in LLD.md Section 13.1.
 */
export interface FixGeneratorPort {
  /** Unique identifier of this fix generator. */
  readonly id: string;
  /** Rule IDs for which this generator can propose repairs. */
  readonly supportedRuleIds: readonly RuleId[];
  /**
   * Generates candidate fix proposals for a finding.
   * Returns an empty array if evidence is insufficient, ambiguous, or unsupported.
   * Generation must be deterministic, pure, and side-effect-free.
   */
  generateProposals(finding: Finding, context: FixGenerationContext): FixProposal[];
}
