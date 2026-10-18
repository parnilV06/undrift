// Foundational source spans, positions, snapshots, and evidence provenance as specified in LLD.md Section 4.2 and 4.3.

import type { DocumentUri } from "./types";

/**
 * Absolute UTF-16 code-unit offsets into the exact source snapshot.
 * Coordinates MUST NOT be confused with parser-native byte offsets.
 */
export interface TextRange {
  /** Absolute UTF-16 code-unit start offset (0-based, inclusive). */
  start: number;
  /** Absolute UTF-16 code-unit end offset (0-based, exclusive). */
  end: number;
}

/**
 * Line and character position within a source document.
 * Follows zero-based indexing compatible with VS Code and language servers.
 */
export interface Position {
  /** Zero-based line number. */
  line: number;
  /** Zero-based UTF-16 character offset within the line. */
  character: number;
}

/**
 * Byte-offset range reported natively by Tree-sitter parsers.
 */
export interface ByteRange {
  /** Parser-native byte start offset. */
  start: number;
  /** Parser-native byte end offset. */
  end: number;
}

/**
 * Source span locating a construct within a specific document snapshot.
 * Carries both UTF-16 character/line positions and optional parser-native byte offsets.
 */
export interface SourceSpan {
  uri: DocumentUri;
  range: TextRange;
  start: Position;
  end: Position;
  /** Optional parser-native byte offsets for internal mapping/debugging. */
  byteRange?: ByteRange;
}

/**
 * Reference to a source document snapshot at a specific point in time.
 * Captures content hash and optional editor document version for stale-analysis checks.
 */
export interface SourceSnapshotRef {
  uri: DocumentUri;
  contentHash: string;
  /** Present for editor buffers; absent for disk-only input. */
  documentVersion?: number;
}

/**
 * Qualitative classification of evidence strength.
 * - direct: value is visible in a literal or direct supported construct.
 * - resolved: value is obtained through a supported local/imported reference or deterministic framework rule.
 * - inferred: value or relationship depends on a conservative inference.
 * - unknown: represented as the state of an observation, never as proof that a value is absent.
 */
export type EvidenceStrength = "direct" | "resolved" | "inferred" | "unknown";

/**
 * Categorization of the origin of evidence.
 */
export type EvidenceSourceKind =
  | "literal-syntax"
  | "explicit-annotation"
  | "local-declaration"
  | "imported-declaration"
  | "framework-convention"
  | "project-configuration"
  | "semantic-adapter"
  | "heuristic";

/**
 * Concrete evidence record anchoring an observation or fact to source code.
 */
export interface EvidenceRef {
  id: string;
  kind: EvidenceSourceKind;
  strength: EvidenceStrength;
  source: SourceSpan;
  description?: string;
}

/**
 * Tagged union representing a value whose knowledge state matters for analysis decisions.
 * Prevents confusing an unresolved or dynamic expression with a known or absent value.
 */
export type ObservedValue<T> =
  | {
      state: "known";
      value: T;
      strength: Exclude<EvidenceStrength, "unknown">;
      evidence: EvidenceRef[];
    }
  | {
      state: "dynamic";
      expression?: string;
      reason: string;
      evidence: EvidenceRef[];
    }
  | {
      state: "unknown";
      reason: string;
      evidence: EvidenceRef[];
    };
