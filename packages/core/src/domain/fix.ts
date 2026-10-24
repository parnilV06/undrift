// Foundational fix proposal and proposed edit domain models as specified in LLD.md Section 13,
// PRD.md Section 13, and ERD.md Section 3.10, 3.11, and 6.4.

import * as crypto from "crypto";
import type { Position, TextRange } from "./evidence";
import type { DocumentUri, FindingId, FixProposalId, WorkspaceId } from "./types";

/**
 * Risk classification of a fix proposal as specified in PRD.md Section 13.1.
 * - mechanical: localized, high-confidence source edit (e.g. method or field rename).
 * - review-required: multi-file or structural edit requiring developer inspection.
 * - manual: guidance for manual resolution when multiple interpretations are plausible.
 */
export type FixRiskLevel = "mechanical" | "review-required" | "manual";

/**
 * Lifecycle state of a fix proposal as specified in ERD.md Section 6.4.
 *
 * PROPOSED -> ACCEPTED / REJECTED / STALE -> APPLIED -> VERIFIED / STILL_ACTIVE / UNRESOLVED
 */
export type FixProposalStatus =
  | "proposed"
  | "accepted"
  | "rejected"
  | "stale"
  | "applied"
  | "verified"
  | "still_active"
  | "unresolved";

/**
 * Architectural target role of a repair edit distinguishing consumer and provider sides.
 */
export type FixTargetRole = "consumer" | "provider";

/**
 * Proposed text edit bound to a specific document snapshot, range, and expected hash
 * as specified in ERD.md Section 3.11 and LLD.md Section 13.2.
 */
export interface ProposedEdit {
  /** Unique identifier of the edit within its proposal. */
  readonly id: string;
  /** Parent proposal identifier. */
  readonly proposalId: FixProposalId;
  /** Target source document URI. */
  readonly documentUri: DocumentUri;
  /** Absolute UTF-16 code-unit start and end offsets. */
  readonly range: TextRange;
  /** Zero-based line and character start position. */
  readonly start: Position;
  /** Zero-based line and character end position. */
  readonly end: Position;
  /** Replacement source text. */
  readonly newText: string;
  /** Expected content hash of the target document snapshot for staleness verification. */
  readonly expectedContentHash: string;
  /** Expected editor document version when available. */
  readonly expectedDocumentVersion?: number;
}

/**
 * Structured candidate repair proposal addressing a contract drift finding
 * as specified in PRD.md Section 13.2, LLD.md Section 13.1, and ERD.md Section 3.10.
 */
export interface FixProposal {
  /** Stable proposal identity scoped to the finding, target role, and edit payload. */
  readonly id: FixProposalId;
  /** Drift finding addressed by this proposal. */
  readonly findingId: FindingId;
  /** Originating workspace identifier to bind proposal validity. */
  readonly workspaceId?: WorkspaceId;
  /** Analysis generation during which this proposal was generated. */
  readonly generation?: number;
  /** Concise human-readable title of the proposed repair. */
  readonly title: string;
  /** Detailed rationale explaining why this change is recommended. */
  readonly rationale: string;
  /** Explicit assumptions made by this proposal (e.g. backend is authoritative). */
  readonly assumptions: readonly string[];
  /** Qualitative risk classification. */
  readonly risk: FixRiskLevel;
  /** Architectural role of the targeted source code. */
  readonly targetRole: FixTargetRole;
  /** Concrete source text edits to apply if accepted. */
  readonly edits: readonly ProposedEdit[];
  /** Current proposal lifecycle status. */
  readonly status: FixProposalStatus;
  /** Explanation of how post-edit analysis will verify resolution. */
  readonly verificationDescription?: string;
}

/**
 * Inputs used to derive deterministic, line-number invariant proposal identities.
 */
export interface FixProposalIdentityInput {
  findingId: FindingId;
  targetRole: FixTargetRole;
  targetUri: DocumentUri;
  rangeStart: number;
  rangeEnd: number;
  newText: string;
}

/**
 * Derives a deterministic FixProposalId from semantic proposal inputs.
 * Does not depend on timestamps, random values, or array indexes.
 */
export function createFixProposalId(input: FixProposalIdentityInput): FixProposalId {
  const payload = [
    input.findingId,
    input.targetRole,
    input.targetUri,
    input.rangeStart,
    input.rangeEnd,
    input.newText
  ];
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex")
    .slice(0, 16);
  return `prop:${input.targetRole}:${hash}`;
}

/**
 * Generates a deterministic ProposedEdit identifier within a proposal.
 */
export function createProposedEditId(proposalId: FixProposalId, index = 0): string {
  return `${proposalId}:edit:${index}`;
}
