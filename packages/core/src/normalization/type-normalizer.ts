// Type normalization as specified in LLD.md Section 4.6 and Section 9.3.
// Canonicalizes supported primitives, literal values, arrays, unions, references, and unknown shapes
// while preserving knowledge states and uncertainty.

import type { FieldShape, PrimitiveTypeName, TypeShape } from "../domain/observation";

/**
 * Master catalog of supported primitive type names as defined in LLD.md Section 4.6.
 */
export const SUPPORTED_PRIMITIVES: readonly PrimitiveTypeName[] = [
  "string",
  "number",
  "boolean",
  "bigint",
  "symbol",
  "null",
  "undefined",
  "void",
  "unknown",
  "never"
] as const;

const SUPPORTED_PRIMITIVES_SET: ReadonlySet<string> = new Set(SUPPORTED_PRIMITIVES);

/**
 * Type guard verifying if a value is an exact supported PrimitiveTypeName.
 */
export function isPrimitiveTypeName(value: unknown): value is PrimitiveTypeName {
  return typeof value === "string" && SUPPORTED_PRIMITIVES_SET.has(value);
}

/**
 * Normalizes a primitive type name string according to LLD.md Section 4.6.
 * Exact case-sensitive match against the supported PrimitiveTypeName catalog is required.
 * Returns the canonical PrimitiveTypeName if matched, or undefined if the name is unsupported
 * or differently cased (e.g. "String", "NUMBER").
 */
export function normalizePrimitiveTypeName(name: unknown): PrimitiveTypeName | undefined {
  return isPrimitiveTypeName(name) ? name : undefined;
}

/**
 * Type guard verifying if an unknown value satisfies the TypeShape discriminated union contract.
 */
export function isTypeShape(value: unknown): value is TypeShape {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.kind === "string";
}

/**
 * Generates a deterministic structural key for a TypeShape used for sorting union members
 * and evaluating structural equivalence without lossy conversions.
 */
export function getTypeShapeKey(shape: TypeShape): string {
  switch (shape.kind) {
    case "primitive":
      return `0_primitive:${shape.name}`;
    case "literal": {
      const valType = shape.value === null ? "null" : typeof shape.value;
      return `1_literal:${valType}:${String(shape.value)}`;
    }
    case "array":
      return `2_array:${getTypeShapeKey(shape.element)}`;
    case "object": {
      const propKeys = (shape.properties ?? []).map(
        (p) => `${p.name}:${p.presence}:${p.nullable}:${getTypeShapeKey(p.type)}`
      );
      propKeys.sort();
      return `3_object:${shape.additionalProperties}:[${propKeys.join(",")}]`;
    }
    case "reference":
      return `4_reference:${shape.displayName}:${shape.resolution}:${shape.targetId ?? ""}`;
    case "union": {
      const memberKeys = (shape.members ?? []).map((m) => getTypeShapeKey(m));
      memberKeys.sort();
      return `5_union:[${memberKeys.join(",")}]`;
    }
    case "unknown":
      return `6_unknown:${shape.reason}`;
  }
}

/**
 * Checks structural identity between two normalized TypeShape instances.
 */
export function areTypeShapesEqual(a: TypeShape, b: TypeShape): boolean {
  if (a === b) {
    return true;
  }
  return getTypeShapeKey(a) === getTypeShapeKey(b);
}

/**
 * Normalizes an individual field within an object type shape as specified in LLD.md Section 4.6.
 * Recursively normalizes the field's type while preserving presence, nullability, and evidence.
 * Keeps field presence and type nullability strictly separate without inferring one from the other.
 */
export function normalizeFieldShape(field: unknown, visited: Set<object> = new Set()): FieldShape {
  if (typeof field !== "object" || field === null) {
    return {
      name: "",
      type: { kind: "unknown", reason: "not-observed" },
      presence: "unknown",
      nullable: "unknown",
      evidence: []
    };
  }

  const candidate = field as Partial<FieldShape>;
  const name = typeof candidate.name === "string" ? candidate.name : "";
  const presence: "required" | "optional" | "unknown" =
    candidate.presence === "required" ||
    candidate.presence === "optional" ||
    candidate.presence === "unknown"
      ? candidate.presence
      : "unknown";

  const nullable: "yes" | "no" | "unknown" =
    candidate.nullable === "yes" || candidate.nullable === "no" || candidate.nullable === "unknown"
      ? candidate.nullable
      : "unknown";

  const type = normalizeType(candidate.type, visited);
  const evidence = Array.isArray(candidate.evidence)
    ? candidate.evidence.map((ev) => ({ ...ev }))
    : [];

  return {
    name,
    type,
    presence,
    nullable,
    evidence
  };
}

/**
 * Normalizes a TypeShape into a canonical representation according to LLD.md Section 4.6 and Section 9.3:
 *
 * 1. Canonicalizes primitive names (case-insensitive lowercase matching supported set).
 * 2. Normalizes literal representations deterministically without collapsing literals to primitives.
 * 3. Recursively normalizes array element shapes.
 * 4. Recursively normalizes object properties and sorts them alphabetically by property name.
 * 5. Flattens nested unions, deduplicates equivalent members, and orders members deterministically.
 * 6. Preserves reference resolution states and normalizes resolved shapes without infinite recursion loops.
 * 7. Preserves unknown type reasons conservatively without guessing.
 *
 * @param shape Raw or partially constructed TypeShape.
 * @param visited Optional cycle-detection set for circular reference graphs.
 * @returns Canonical TypeShape representation.
 */
export function normalizeType(shape: unknown, visited: Set<object> = new Set()): TypeShape {
  if (!isTypeShape(shape)) {
    return {
      kind: "unknown",
      reason: "not-observed"
    };
  }

  // Prevent recursion loops in cyclic type references
  if (visited.has(shape)) {
    if (shape.kind === "reference") {
      return {
        kind: "reference",
        displayName: shape.displayName,
        resolution: shape.resolution,
        targetId: shape.targetId
      };
    }
    return shape;
  }

  visited.add(shape);

  switch (shape.kind) {
    case "primitive": {
      const normName = normalizePrimitiveTypeName(shape.name);
      if (normName) {
        return {
          kind: "primitive",
          name: normName
        };
      }
      return {
        kind: "unknown",
        reason: "unsupported-syntax"
      };
    }

    case "literal": {
      if (shape.value === null) {
        return { kind: "literal", value: null };
      }
      if (
        typeof shape.value === "string" ||
        typeof shape.value === "boolean" ||
        (typeof shape.value === "number" && Number.isFinite(shape.value))
      ) {
        return {
          kind: "literal",
          value: shape.value
        };
      }
      return {
        kind: "unknown",
        reason: "unsupported-syntax"
      };
    }

    case "array": {
      return {
        kind: "array",
        element: normalizeType(shape.element, visited)
      };
    }

    case "object": {
      const rawProps = Array.isArray(shape.properties) ? shape.properties : [];
      const normalizedProps: FieldShape[] = rawProps.map((p) => normalizeFieldShape(p, visited));

      // Sort properties alphabetically by name for deterministic shape comparison.
      // If names match, use presence, nullability, and type structural key for total order determinism.
      normalizedProps.sort((a, b) => {
        const nameCmp = a.name.localeCompare(b.name);
        if (nameCmp !== 0) {
          return nameCmp;
        }
        const presenceCmp = a.presence.localeCompare(b.presence);
        if (presenceCmp !== 0) {
          return presenceCmp;
        }
        const nullableCmp = a.nullable.localeCompare(b.nullable);
        if (nullableCmp !== 0) {
          return nullableCmp;
        }
        return getTypeShapeKey(a.type).localeCompare(getTypeShapeKey(b.type));
      });

      const additionalProperties =
        shape.additionalProperties === "allowed" ||
        shape.additionalProperties === "forbidden" ||
        shape.additionalProperties === "unknown"
          ? shape.additionalProperties
          : "unknown";

      return {
        kind: "object",
        properties: normalizedProps,
        additionalProperties
      };
    }

    case "union": {
      const rawMembers = Array.isArray(shape.members) ? shape.members : [];

      // 1. Flatten nested unions
      const flattened: TypeShape[] = [];
      for (const m of rawMembers) {
        const normalizedMember = normalizeType(m, visited);
        if (normalizedMember.kind === "union") {
          flattened.push(...normalizedMember.members);
        } else {
          flattened.push(normalizedMember);
        }
      }

      // 2. Deduplicate equivalent members
      const deduped: TypeShape[] = [];
      for (const member of flattened) {
        if (!deduped.some((existing) => areTypeShapesEqual(existing, member))) {
          deduped.push(member);
        }
      }

      // 3. Sort members deterministically using structural key
      deduped.sort((a, b) => getTypeShapeKey(a).localeCompare(getTypeShapeKey(b)));

      return {
        kind: "union",
        members: deduped
      };
    }

    case "reference": {
      const displayName = typeof shape.displayName === "string" ? shape.displayName : "unknown";
      const resolution = shape.resolution === "resolved" ? "resolved" : "unresolved";
      const targetId = typeof shape.targetId === "string" ? shape.targetId : undefined;
      const resolvedShape =
        shape.resolvedShape && resolution === "resolved"
          ? normalizeType(shape.resolvedShape, visited)
          : undefined;

      return {
        kind: "reference",
        displayName,
        resolution,
        targetId,
        resolvedShape
      };
    }

    case "unknown": {
      const validReasons = new Set([
        "dynamic-expression",
        "unsupported-syntax",
        "unresolved-reference",
        "incomplete-source",
        "complex-type",
        "not-observed"
      ]);
      const reason = validReasons.has(shape.reason) ? shape.reason : "unsupported-syntax";
      return {
        kind: "unknown",
        reason
      };
    }

    default:
      return {
        kind: "unknown",
        reason: "unsupported-syntax"
      };
  }
}

/**
 * Reconstructs a readable type annotation string from a normalized TypeShape.
 */
export function formatTypeShape(shape: TypeShape): string {
  switch (shape.kind) {
    case "primitive":
      return shape.name;
    case "literal":
      return typeof shape.value === "string" ? `"${shape.value}"` : String(shape.value);
    case "array":
      return `${formatTypeShape(shape.element)}[]`;
    case "object": {
      if (shape.properties.length === 0) {
        return "{}";
      }
      const props = shape.properties.map((p) => {
        const opt = p.presence === "optional" ? "?" : "";
        const nullStr = p.nullable === "yes" ? " | null" : "";
        return `${p.name}${opt}: ${formatTypeShape(p.type)}${nullStr}`;
      });
      return `{ ${props.join(", ")} }`;
    }
    case "union":
      return shape.members.map((m) => formatTypeShape(m)).join(" | ");
    case "reference":
      return shape.displayName;
    case "unknown":
      return `unknown(${shape.reason})`;
  }
}
