// API observation domain contracts as specified in LLD.md Section 4.5, 4.6, 4.7, and 4.8.
// Defines normalized route patterns, type and shape models, request/response observations,
// and canonical API observations extracted from source code.

import type { EvidenceRef, ObservedValue, SourceSnapshotRef, SourceSpan } from "./evidence";
import type { AnalysisWarning } from "./finding";
import type { CompletenessStatus, HttpMethod, ObservationId } from "./types";

/**
 * Route pattern segment distinguishing static path literals from parameters,
 * wildcards, and dynamic/unresolved expressions as specified in LLD.md Section 4.5.
 */
export type RouteSegment =
  | { kind: "static"; value: string }
  | { kind: "parameter"; name?: string }
  | { kind: "wildcard"; name?: string }
  | { kind: "unresolved"; sourceText: string };

/**
 * Structural route representation capturing parsed path segments,
 * trailing slash presence, and query parameter handling as specified in LLD.md Section 4.5.
 */
export interface RoutePattern {
  segments: RouteSegment[];
  trailingSlash: "present" | "absent" | "unknown";
  queryHandling: "excluded-from-path" | "unknown";
  rawPath: string;
}

/**
 * Supported primitive type names in the normalized shape model as specified in LLD.md Section 4.6.
 */
export type PrimitiveTypeName =
  | "string"
  | "number"
  | "boolean"
  | "bigint"
  | "symbol"
  | "null"
  | "undefined"
  | "void"
  | "unknown"
  | "never";

/**
 * Recursive structural type shape model preserving complete, partial,
 * union, reference, and unknown knowledge states as specified in LLD.md Section 4.6.
 */
export type TypeShape =
  | {
      kind: "primitive";
      name: PrimitiveTypeName;
    }
  | {
      kind: "literal";
      value: string | number | boolean | null;
    }
  | {
      kind: "array";
      element: TypeShape;
    }
  | {
      kind: "object";
      properties: FieldShape[];
      additionalProperties: "allowed" | "forbidden" | "unknown";
    }
  | {
      kind: "union";
      members: TypeShape[];
    }
  | {
      kind: "reference";
      displayName: string;
      resolution: "resolved" | "unresolved";
      targetId?: string;
      resolvedShape?: TypeShape;
    }
  | {
      kind: "unknown";
      reason:
        | "dynamic-expression"
        | "unsupported-syntax"
        | "unresolved-reference"
        | "incomplete-source"
        | "complex-type"
        | "not-observed";
    };

/**
 * Named field within an object type shape as specified in LLD.md Section 4.6.
 * Distinguishes field presence (required vs optional) from type nullability.
 */
export interface FieldShape {
  name: string;
  type: TypeShape;
  presence: "required" | "optional" | "unknown";
  nullable: "yes" | "no" | "unknown";
  evidence: EvidenceRef[];
}

/**
 * Observed type shape bound to extraction completeness and supporting evidence
 * as specified in LLD.md Section 4.6.
 */
export interface ShapeObservation {
  shape: TypeShape;
  completeness: CompletenessStatus;
  evidence: EvidenceRef[];
}

/**
 * Observed request parameters and body shapes as specified in LLD.md Section 4.7.
 */
export interface RequestShapeObservation {
  pathParams?: ShapeObservation;
  queryParams?: ShapeObservation;
  headers?: ShapeObservation;
  body?: ShapeObservation;
}

/**
 * Observed response status and body shape as specified in LLD.md Section 4.7.
 */
export interface ResponseShapeObservation {
  statusCode?: ObservedValue<number>;
  body?: ShapeObservation;
  source: SourceSpan[];
}

/**
 * Observed endpoint method, route pattern, and associated request/response shapes
 * as specified in LLD.md Section 4.7.
 */
export interface EndpointObservation {
  method: ObservedValue<HttpMethod>;
  path: ObservedValue<RoutePattern>;
  request?: RequestShapeObservation;
  responses?: ResponseShapeObservation[];
}

/**
 * Architectural role of an observed API interaction as specified in LLD.md Section 4.8.
 * - consumer: client call (frontend fetch/Axios) with expected inputs/outputs
 * - provider: server endpoint (backend Express route) with accepted inputs/outputs
 */
export type ObservationRole = "consumer" | "provider";

/**
 * First-class extracted API fact anchoring observed client calls or server routes
 * to source locations, snapshot versions, and limitations as specified in LLD.md Section 4.8.
 */
export interface ApiObservation {
  id: ObservationId;
  role: ObservationRole;
  languageId: string;
  framework?: string;
  extractorId: string;
  source: SourceSpan[];
  snapshot: SourceSnapshotRef;
  endpoint: EndpointObservation;
  limitations: AnalysisWarning[];
}
