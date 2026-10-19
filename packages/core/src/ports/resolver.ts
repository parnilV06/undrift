// Semantic resolver port, resolution request/result contracts, and status
// as specified in LLD.md Section 5.3.

import type { EvidenceRef, SourceSpan, TextRange } from "../domain/evidence";
import type { TypeShape } from "../domain/observation";
import type { SourceDocument } from "../domain/types";
import type { ProjectIndexView } from "./analyzer";

/**
 * Request supplied to a semantic resolver for resolving a type or symbol reference
 * within document and workspace context as specified in LLD.md Section 5.3.
 */
export interface SemanticResolutionRequest {
  /** The source document snapshot where the reference occurs. */
  document: SourceDocument;
  /** Name of the reference or identifier to resolve. */
  referenceName: string;
  /** Exact text range where the reference appears in the source document. */
  fromRange: TextRange;
  /** Read-only query view of the workspace project index. */
  projectIndex: ProjectIndexView;
}

/**
 * Result produced by a semantic resolver for a symbol or type reference
 * as specified in LLD.md Section 5.3.
 */
export type SemanticResolutionResult =
  | {
      state: "resolved";
      shape?: TypeShape;
      declaration?: SourceSpan;
      evidence: EvidenceRef[];
    }
  | {
      state: "ambiguous" | "unresolved" | "unsupported";
      reason: string;
      evidence: EvidenceRef[];
    };

/**
 * Optional semantic resolver port providing resolved type information and evidence
 * as specified in LLD.md Section 5.3.
 */
export interface SemanticResolverPort {
  readonly id: string;
  resolveType(
    request: SemanticResolutionRequest,
    signal?: AbortSignal
  ): Promise<SemanticResolutionResult>;
}
