// Directional shape comparator as specified in LLD.md Section 4.6, 9.3, 11.2, 11.3, and 11.4.
// Compares request and response shapes conservatively without manufacturing false conflicts.

import type { EvidenceRef } from "../domain/evidence";
import type { FieldShape, ShapeObservation, TypeShape } from "../domain/observation";
import type { CompletenessStatus } from "../domain/types";
import { formatTypeShape, getTypeShapeKey } from "../normalization/type-normalizer";

/**
 * Direction of contract comparison as defined in LLD.md Section 11.2 and 11.3:
 * - "request": consumer supplies values, provider accepts/validates values.
 * - "response": provider produces values, consumer expects/uses values.
 */
export type ComparisonDirection = "request" | "response";

/**
 * Configuration options for the shape comparator.
 */
export interface ShapeComparatorOptions {
  /**
   * Maximum recursion depth for nested objects and arrays.
   * Defaults to 5 per LLD.md Section 11.4.
   */
  maxDepth?: number;
}

/**
 * Categorization of detected shape differences.
 */
export type ShapeDriftKind =
  | "missing-field"
  | "type-mismatch"
  | "optionality-conflict"
  | "nullability-conflict"
  | "forbidden-extra-field";

/**
 * Structured factual difference detected during directional shape comparison.
 */
export interface ShapeDifference {
  kind: ShapeDriftKind;
  path: string;
  direction: ComparisonDirection;
  expectedDescription: string;
  observedDescription: string;
  sourceEvidence?: EvidenceRef[];
  targetEvidence?: EvidenceRef[];
  sourceType?: TypeShape;
  targetType?: TypeShape;
  sourcePresence?: "required" | "optional" | "unknown";
  targetPresence?: "required" | "optional" | "unknown";
  sourceNullable?: "yes" | "no" | "unknown";
  targetNullable?: "yes" | "no" | "unknown";
}

/**
 * Internal recursive comparison context.
 */
interface ComparisonContext {
  depth: number;
  maxDepth: number;
  visitedPairs: Set<string>;
}

export type CompatibilityState = "compatible" | "incompatible" | "unknown";

export interface TypeCompatibilityResult {
  state: CompatibilityState;
  reason?: string;
}

/**
 * Checks directional type compatibility between a producer (source) and a receiver (target)
 * according to the 8-step algorithm in LLD.md Section 11.4:
 *
 * 1. Treat identical supported primitive types as compatible.
 * 2. Treat a literal as compatible with its corresponding primitive where valid (e.g. literal "ready" satisfies string).
 * 3. Compare arrays recursively up to configured maximum depth.
 * 4. Compare object fields by name; evaluate presence/nullability separately from base type.
 * 5. Compare unions conservatively. If compatibility cannot be established, report unknown.
 * 6. Resolve supported references before comparison; unresolved references remain unknown.
 * 7. Track visited reference pairs to avoid recursion loops.
 * 8. Stop at the configured depth and mark remaining structure unknown without fabricating a mismatch.
 */
export function checkTypeCompatibility(
  source: TypeShape,
  target: TypeShape,
  direction: ComparisonDirection,
  context: ComparisonContext
): TypeCompatibilityResult {
  // Rule 8: Depth-limit check
  if (context.depth > context.maxDepth) {
    return { state: "unknown", reason: "depth-limit-reached" };
  }

  // Rule 7: Cycle detection / recursion loop prevention
  const pairKey = `${getTypeShapeKey(source)}<=>${getTypeShapeKey(target)}`;
  if (context.visitedPairs.has(pairKey)) {
    return { state: "compatible" };
  }

  // Rule 6: Unwrap resolved references; keep unresolved references unknown
  if (source.kind === "reference") {
    if (source.resolution === "resolved" && source.resolvedShape) {
      context.visitedPairs.add(pairKey);
      return checkTypeCompatibility(source.resolvedShape, target, direction, context);
    }
    return { state: "unknown", reason: `unresolved-reference:${source.displayName}` };
  }

  if (target.kind === "reference") {
    if (target.resolution === "resolved" && target.resolvedShape) {
      context.visitedPairs.add(pairKey);
      return checkTypeCompatibility(source, target.resolvedShape, direction, context);
    }
    return { state: "unknown", reason: `unresolved-reference:${target.displayName}` };
  }

  // Unknown types remain indeterminate
  if (source.kind === "unknown" || target.kind === "unknown") {
    return {
      state: "unknown",
      reason: source.kind === "unknown" ? source.reason : (target as { reason: string }).reason
    };
  }

  // Rule 5: Unions
  // If source is a union (producer may emit any member): every member must be compatible with target
  if (source.kind === "union") {
    let hasUnknown = false;
    for (const member of source.members) {
      const res = checkTypeCompatibility(member, target, direction, context);
      if (res.state === "incompatible") {
        return {
          state: "incompatible",
          reason: `union-member-incompatible:${formatTypeShape(member)}`
        };
      }
      if (res.state === "unknown") {
        hasUnknown = true;
      }
    }
    return hasUnknown
      ? { state: "unknown", reason: "union-member-uncertain" }
      : { state: "compatible" };
  }

  // If target is a union (receiver accepts any member): source must be compatible with at least one member
  if (target.kind === "union") {
    let hasCompatible = false;
    let allIncompatible = true;
    for (const member of target.members) {
      const res = checkTypeCompatibility(source, member, direction, context);
      if (res.state === "compatible") {
        hasCompatible = true;
        allIncompatible = false;
        break;
      }
      if (res.state === "unknown") {
        allIncompatible = false;
      }
    }
    if (hasCompatible) {
      return { state: "compatible" };
    }
    if (allIncompatible) {
      return { state: "incompatible", reason: "no-union-member-matched" };
    }
    return { state: "unknown", reason: "union-membership-uncertain" };
  }

  // Rule 1: Primitive types
  if (source.kind === "primitive" && target.kind === "primitive") {
    if (source.name === target.name) {
      return { state: "compatible" };
    }
    if (source.name === "unknown" || target.name === "unknown") {
      return { state: "unknown", reason: "primitive-unknown" };
    }
    return { state: "incompatible", reason: `primitive-mismatch:${source.name}-vs-${target.name}` };
  }

  // Rule 2: Literals vs Primitives
  // A literal source satisfies its corresponding primitive target (e.g. "ready" satisfies string)
  if (source.kind === "literal" && target.kind === "primitive") {
    const literalPrimitive = getLiteralPrimitiveName(source.value);
    if (literalPrimitive === target.name) {
      return { state: "compatible" };
    }
    return {
      state: "incompatible",
      reason: `literal-${literalPrimitive}-does-not-satisfy-${target.name}`
    };
  }

  // A primitive source does NOT satisfy a specific literal target (producer may emit other values)
  if (source.kind === "primitive" && target.kind === "literal") {
    return {
      state: "incompatible",
      reason: `primitive-${source.name}-cannot-satisfy-literal-${String(target.value)}`
    };
  }

  // Literals vs Literals
  if (source.kind === "literal" && target.kind === "literal") {
    if (source.value === target.value) {
      return { state: "compatible" };
    }
    return {
      state: "incompatible",
      reason: `literal-mismatch:${String(source.value)}-vs-${String(target.value)}`
    };
  }

  // Rule 3: Arrays
  if (source.kind === "array" && target.kind === "array") {
    context.visitedPairs.add(pairKey);
    return checkTypeCompatibility(source.element, target.element, direction, {
      ...context,
      depth: context.depth + 1
    });
  }

  // Objects compared at type-level
  if (source.kind === "object" && target.kind === "object") {
    return { state: "compatible" };
  }

  // Different top-level kinds (e.g. array vs object, object vs primitive)
  return {
    state: "incompatible",
    reason: `kind-mismatch:${source.kind}-vs-${target.kind}`
  };
}

/**
 * Derives the corresponding primitive type name for a literal value.
 */
function getLiteralPrimitiveName(value: string | number | boolean | null): string {
  if (value === null) return "null";
  return typeof value;
}

/**
 * Recursively compares object properties directionally.
 */
function compareObjectProperties(
  sourceProps: readonly FieldShape[],
  targetProps: readonly FieldShape[],
  sourceCompleteness: CompletenessStatus,
  targetAdditionalProperties: "allowed" | "forbidden" | "unknown",
  direction: ComparisonDirection,
  basePath: string,
  context: ComparisonContext,
  options: ShapeComparatorOptions
): ShapeDifference[] {
  const differences: ShapeDifference[] = [];
  const sourceMap = new Map<string, FieldShape>();
  for (const p of sourceProps) {
    sourceMap.set(p.name, p);
  }

  const targetMap = new Map<string, FieldShape>();
  for (const p of targetProps) {
    targetMap.set(p.name, p);
  }

  // 1. Iterate over target properties to find missing fields or property-level mismatches
  for (const targetProp of targetProps) {
    const propPath = basePath ? `${basePath}.${targetProp.name}` : targetProp.name;
    const sourceProp = sourceMap.get(targetProp.name);

    if (!sourceProp) {
      // Field is missing in source
      // Completeness gate: absence finding emitted ONLY when source is complete
      if (sourceCompleteness === "complete") {
        if (direction === "request") {
          // UND200: Provider requires field, consumer payload does not supply it
          if (targetProp.presence === "required") {
            differences.push({
              kind: "missing-field",
              path: propPath,
              direction,
              expectedDescription: "required",
              observedDescription: "missing",
              targetEvidence: targetProp.evidence,
              targetType: targetProp.type,
              targetPresence: targetProp.presence
            });
          }
        } else {
          // UND300: Consumer expects field, provider complete response does not produce it
          if (targetProp.presence === "required" || targetProp.presence === "optional") {
            differences.push({
              kind: "missing-field",
              path: propPath,
              direction,
              expectedDescription: "present",
              observedDescription: "missing",
              targetEvidence: targetProp.evidence,
              targetType: targetProp.type,
              targetPresence: targetProp.presence
            });
          }
        }
      }
      // If source is partial or unknown, omission is not asserted as a missing-field drift
      continue;
    }

    // Field is present on both sides: check modifiers and type compatibility
    // Optionality check
    if (direction === "request") {
      // UND220: Provider requires field, but consumer marks it optional
      if (targetProp.presence === "required" && sourceProp.presence === "optional") {
        differences.push({
          kind: "optionality-conflict",
          path: propPath,
          direction,
          expectedDescription: "required",
          observedDescription: "optional",
          sourceEvidence: sourceProp.evidence,
          targetEvidence: targetProp.evidence,
          sourcePresence: sourceProp.presence,
          targetPresence: targetProp.presence
        });
      }
    } else {
      // UND320: Provider may omit field (optional), but consumer expects it required
      if (sourceProp.presence === "optional" && targetProp.presence === "required") {
        differences.push({
          kind: "optionality-conflict",
          path: propPath,
          direction,
          expectedDescription: "required",
          observedDescription: "optional",
          sourceEvidence: sourceProp.evidence,
          targetEvidence: targetProp.evidence,
          sourcePresence: sourceProp.presence,
          targetPresence: targetProp.presence
        });
      }
    }

    // Nullability check
    if (direction === "request") {
      // UND220: Provider requires non-nullable, but consumer may send null
      if (targetProp.nullable === "no" && sourceProp.nullable === "yes") {
        differences.push({
          kind: "nullability-conflict",
          path: propPath,
          direction,
          expectedDescription: "non-nullable",
          observedDescription: "nullable",
          sourceEvidence: sourceProp.evidence,
          targetEvidence: targetProp.evidence,
          sourceNullable: sourceProp.nullable,
          targetNullable: targetProp.nullable
        });
      }
    } else {
      // UND330: Provider may return null, but consumer disallows null
      if (sourceProp.nullable === "yes" && targetProp.nullable === "no") {
        differences.push({
          kind: "nullability-conflict",
          path: propPath,
          direction,
          expectedDescription: "non-nullable",
          observedDescription: "nullable",
          sourceEvidence: sourceProp.evidence,
          targetEvidence: targetProp.evidence,
          sourceNullable: sourceProp.nullable,
          targetNullable: targetProp.nullable
        });
      }
    }

    // Type compatibility check
    const typeCompat = checkTypeCompatibility(sourceProp.type, targetProp.type, direction, context);
    if (typeCompat.state === "incompatible") {
      // UND210 or UND310: Field type mismatch
      differences.push({
        kind: "type-mismatch",
        path: propPath,
        direction,
        expectedDescription: formatTypeShape(targetProp.type),
        observedDescription: formatTypeShape(sourceProp.type),
        sourceEvidence: sourceProp.evidence,
        targetEvidence: targetProp.evidence,
        sourceType: sourceProp.type,
        targetType: targetProp.type
      });
    } else if (typeCompat.state === "compatible") {
      // If both are nested objects, recurse
      if (sourceProp.type.kind === "object" && targetProp.type.kind === "object") {
        const nestedDiffs = compareObjectProperties(
          sourceProp.type.properties,
          targetProp.type.properties,
          sourceCompleteness,
          targetProp.type.additionalProperties,
          direction,
          propPath,
          { ...context, depth: context.depth + 1 },
          options
        );
        differences.push(...nestedDiffs);
      } else if (
        sourceProp.type.kind === "array" &&
        targetProp.type.kind === "array" &&
        sourceProp.type.element.kind === "object" &&
        targetProp.type.element.kind === "object"
      ) {
        // Nested array of objects: compare element properties
        const nestedDiffs = compareObjectProperties(
          sourceProp.type.element.properties,
          targetProp.type.element.properties,
          sourceCompleteness,
          targetProp.type.element.additionalProperties,
          direction,
          `${propPath}[]`,
          { ...context, depth: context.depth + 1 },
          options
        );
        differences.push(...nestedDiffs);
      }
    }
  }

  // 2. Extra consumer fields check in request direction
  if (direction === "request" && targetAdditionalProperties === "forbidden") {
    for (const sourceProp of sourceProps) {
      if (!targetMap.has(sourceProp.name)) {
        differences.push({
          kind: "forbidden-extra-field",
          path: basePath ? `${basePath}.${sourceProp.name}` : sourceProp.name,
          direction,
          expectedDescription: "forbidden",
          observedDescription: "present",
          sourceEvidence: sourceProp.evidence
        });
      }
    }
  }

  return differences;
}

/**
 * Directional shape comparator evaluating contract compatibility between a producer and receiver.
 *
 * @param sourceProducer Observed producer shape (consumer in request, provider in response).
 * @param targetReceiver Observed receiver shape (provider in request, consumer in response).
 * @param direction "request" or "response".
 * @param options Optional configuration including maxDepth (defaults to 5).
 * @returns Array of detected structural differences.
 */
export function compareShapes(
  sourceProducer: ShapeObservation | TypeShape,
  targetReceiver: ShapeObservation | TypeShape,
  direction: ComparisonDirection,
  options: ShapeComparatorOptions = {}
): ShapeDifference[] {
  const maxDepth = options.maxDepth ?? 5;
  const context: ComparisonContext = {
    depth: 0,
    maxDepth,
    visitedPairs: new Set()
  };

  const sourceShape: TypeShape = "shape" in sourceProducer ? sourceProducer.shape : sourceProducer;
  const sourceCompleteness: CompletenessStatus =
    "completeness" in sourceProducer ? sourceProducer.completeness : "complete";

  const targetShape: TypeShape = "shape" in targetReceiver ? targetReceiver.shape : targetReceiver;

  // 1. Both shapes are objects: compare property-by-property
  if (sourceShape.kind === "object" && targetShape.kind === "object") {
    return compareObjectProperties(
      sourceShape.properties,
      targetShape.properties,
      sourceCompleteness,
      targetShape.additionalProperties,
      direction,
      "",
      context,
      options
    );
  }

  // 2. Top-level non-object types (primitives, literals, arrays, unions)
  const compat = checkTypeCompatibility(sourceShape, targetShape, direction, context);
  if (compat.state === "incompatible") {
    return [
      {
        kind: "type-mismatch",
        path: "",
        direction,
        expectedDescription: formatTypeShape(targetShape),
        observedDescription: formatTypeShape(sourceShape)
      }
    ];
  }

  return [];
}
