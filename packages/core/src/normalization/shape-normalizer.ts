// Shape and payload normalization as specified in LLD.md Section 4.6, 4.7, and 9.3.
// Canonicalizes request shapes, response shapes, object fields, and shape observations
// without losing uncertainty, evidence, or completeness state.

import type {
  FieldShape,
  RequestShapeObservation,
  ResponseShapeObservation,
  ShapeObservation
} from "../domain/observation";
import type { CompletenessStatus } from "../domain/types";
import { areTypeShapesEqual, normalizeFieldShape, normalizeType } from "./type-normalizer";

// Re-export type-normalizer primitives, types, and functions for a unified surface
export * from "./type-normalizer";

/**
 * Normalizes a ShapeObservation according to LLD.md Section 4.6:
 *
 * 1. Canonicalizes the underlying TypeShape recursively.
 * 2. Preserves completeness status exactly ("complete" | "partial" | "unknown") without
 *    falsely promoting partial shapes or assuming absent fields are forbidden.
 * 3. Preserves evidence references faithfully without mutation.
 *
 * @param observation Raw or partially extracted ShapeObservation.
 * @param visited Optional cycle-detection set for circular type graphs.
 * @returns Canonical ShapeObservation.
 */
export function normalizeShapeObservation(
  observation: unknown,
  visited: Set<object> = new Set()
): ShapeObservation {
  if (typeof observation !== "object" || observation === null) {
    return {
      shape: { kind: "unknown", reason: "not-observed" },
      completeness: "unknown",
      evidence: []
    };
  }

  const candidate = observation as Partial<ShapeObservation>;
  const completeness: CompletenessStatus =
    candidate.completeness === "complete" ||
    candidate.completeness === "partial" ||
    candidate.completeness === "unknown"
      ? candidate.completeness
      : "unknown";

  const shape = normalizeType(candidate.shape, visited);
  const evidence = Array.isArray(candidate.evidence)
    ? candidate.evidence.map((ev) => ({ ...ev }))
    : [];

  return {
    shape,
    completeness,
    evidence
  };
}

/**
 * Normalizes an observed request shape structure across path parameters,
 * query parameters, headers, and request body as specified in LLD.md Section 4.7.
 *
 * Returns undefined if request is undefined or non-object.
 */
export function normalizeRequestShape(
  request: unknown,
  visited: Set<object> = new Set()
): RequestShapeObservation | undefined {
  if (typeof request !== "object" || request === null) {
    return undefined;
  }

  const req = request as Partial<RequestShapeObservation>;

  const pathParams = req.pathParams
    ? normalizeShapeObservation(req.pathParams, visited)
    : undefined;
  const queryParams = req.queryParams
    ? normalizeShapeObservation(req.queryParams, visited)
    : undefined;
  const headers = req.headers ? normalizeShapeObservation(req.headers, visited) : undefined;
  const body = req.body ? normalizeShapeObservation(req.body, visited) : undefined;

  return {
    ...(pathParams !== undefined ? { pathParams } : {}),
    ...(queryParams !== undefined ? { queryParams } : {}),
    ...(headers !== undefined ? { headers } : {}),
    ...(body !== undefined ? { body } : {})
  };
}

/**
 * Normalizes an observed response shape structure including status code,
 * body shape observation, and source provenance spans as specified in LLD.md Section 4.7.
 */
export function normalizeResponseShape(
  response: unknown,
  visited: Set<object> = new Set()
): ResponseShapeObservation {
  if (typeof response !== "object" || response === null) {
    return {
      source: []
    };
  }

  const res = response as Partial<ResponseShapeObservation>;
  const statusCode = res.statusCode ? { ...res.statusCode } : undefined;
  const body = res.body ? normalizeShapeObservation(res.body, visited) : undefined;
  const source = Array.isArray(res.source) ? res.source.map((s) => ({ ...s })) : [];

  return {
    ...(statusCode !== undefined ? { statusCode } : {}),
    ...(body !== undefined ? { body } : {}),
    source
  };
}

/**
 * Checks structural equality between two normalized FieldShape instances.
 */
export function areFieldShapesEqual(a: FieldShape, b: FieldShape): boolean {
  if (a === b) {
    return true;
  }
  return (
    a.name === b.name &&
    a.presence === b.presence &&
    a.nullable === b.nullable &&
    areTypeShapesEqual(a.type, b.type)
  );
}

/**
 * Checks structural equality between two normalized ShapeObservation instances.
 */
export function areShapeObservationsEqual(a: ShapeObservation, b: ShapeObservation): boolean {
  if (a === b) {
    return true;
  }
  return a.completeness === b.completeness && areTypeShapesEqual(a.shape, b.shape);
}
