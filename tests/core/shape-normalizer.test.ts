import { describe, expect, it } from "vitest";
import type {
  EvidenceRef,
  FieldShape,
  RequestShapeObservation,
  ResponseShapeObservation,
  ShapeObservation,
  TypeShape
} from "../../packages/core/src/domain/observation";
import {
  areFieldShapesEqual,
  areShapeObservationsEqual,
  areTypeShapesEqual,
  formatTypeShape,
  getTypeShapeKey,
  isPrimitiveTypeName,
  isTypeShape,
  normalizeFieldShape,
  normalizePrimitiveTypeName,
  normalizeRequestShape,
  normalizeResponseShape,
  normalizeShapeObservation,
  normalizeType,
  SUPPORTED_PRIMITIVES
} from "../../packages/core/src/index";

describe("Phase 3, Chunk 3.2: Type & Shape Normalizer", () => {
  const sampleEvidence: EvidenceRef = {
    source: {
      snapshot: { uri: "file:///test/api.ts", contentHash: "hash1" },
      range: {
        start: { line: 1, character: 1 },
        end: { line: 1, character: 10 }
      }
    },
    kind: "type-annotation",
    strength: "direct"
  };

  // --------------------------------------------------------------------------
  // 1. Primitive names canonicalize deterministically
  // --------------------------------------------------------------------------
  describe("1. Primitive types canonicalization", () => {
    it("recognizes all 10 supported primitives in the domain catalog", () => {
      expect(SUPPORTED_PRIMITIVES).toEqual([
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
      ]);

      for (const prim of SUPPORTED_PRIMITIVES) {
        expect(isPrimitiveTypeName(prim)).toBe(true);
        expect(normalizePrimitiveTypeName(prim)).toBe(prim);
      }
    });

    it("rejects differently cased or padded names without coercing them to primitives", () => {
      // Differently cased names must not be recognized as PrimitiveTypeName
      expect(isPrimitiveTypeName("String")).toBe(false);
      expect(isPrimitiveTypeName("NUMBER")).toBe(false);
      expect(isPrimitiveTypeName("Boolean")).toBe(false);
      expect(isPrimitiveTypeName("BigInt")).toBe(false);
      expect(isPrimitiveTypeName("SYMBOL")).toBe(false);
      expect(isPrimitiveTypeName("Null")).toBe(false);
      expect(isPrimitiveTypeName("UNDEFINED")).toBe(false);
      expect(isPrimitiveTypeName("Void")).toBe(false);
      expect(isPrimitiveTypeName("Unknown")).toBe(false);
      expect(isPrimitiveTypeName("Never")).toBe(false);

      // normalizePrimitiveTypeName returns undefined for differently cased or padded names
      expect(normalizePrimitiveTypeName("String")).toBeUndefined();
      expect(normalizePrimitiveTypeName("NUMBER")).toBeUndefined();
      expect(normalizePrimitiveTypeName("  number  ")).toBeUndefined();
      expect(normalizePrimitiveTypeName("BOOLEAN")).toBeUndefined();
      expect(normalizePrimitiveTypeName("BigInt")).toBeUndefined();
      expect(normalizePrimitiveTypeName("SYMBOL")).toBeUndefined();
      expect(normalizePrimitiveTypeName("Null")).toBeUndefined();
      expect(normalizePrimitiveTypeName("UNDEFINED")).toBeUndefined();
      expect(normalizePrimitiveTypeName("Void")).toBeUndefined();
      expect(normalizePrimitiveTypeName("Unknown")).toBeUndefined();
      expect(normalizePrimitiveTypeName("Never")).toBeUndefined();
    });

    it("normalizes exact lowercase primitive TypeShape objects deterministically", () => {
      for (const prim of SUPPORTED_PRIMITIVES) {
        const normalized = normalizeType({
          kind: "primitive",
          name: prim
        });
        expect(normalized).toEqual({
          kind: "primitive",
          name: prim
        });
      }
    });

    it("normalizes differently cased primitive shapes conservatively as unknown", () => {
      const stringWrapped = normalizeType({
        kind: "primitive",
        name: "String" as unknown as PrimitiveTypeName
      });
      expect(stringWrapped).toEqual({
        kind: "unknown",
        reason: "unsupported-syntax"
      });

      const numberUpper = normalizeType({
        kind: "primitive",
        name: "NUMBER" as unknown as PrimitiveTypeName
      });
      expect(numberUpper).toEqual({
        kind: "unknown",
        reason: "unsupported-syntax"
      });
    });
  });

  // --------------------------------------------------------------------------
  // 2. Literal shapes normalize without collapsing into broader primitive types
  // --------------------------------------------------------------------------
  describe("2. Literal types preservation", () => {
    it("preserves string literals without widening to primitive string", () => {
      const shape: TypeShape = { kind: "literal", value: "active" };
      const normalized = normalizeType(shape);
      expect(normalized).toEqual({ kind: "literal", value: "active" });
      expect(normalized.kind).toBe("literal");
    });

    it("preserves number literals without widening to primitive number", () => {
      const shape: TypeShape = { kind: "literal", value: 42 };
      const normalized = normalizeType(shape);
      expect(normalized).toEqual({ kind: "literal", value: 42 });
      expect(normalized.kind).toBe("literal");
    });

    it("preserves boolean literals without widening to primitive boolean", () => {
      const trueShape: TypeShape = { kind: "literal", value: true };
      const falseShape: TypeShape = { kind: "literal", value: false };
      expect(normalizeType(trueShape)).toEqual({ kind: "literal", value: true });
      expect(normalizeType(falseShape)).toEqual({ kind: "literal", value: false });
    });

    it("preserves null literal without conversion", () => {
      const shape: TypeShape = { kind: "literal", value: null };
      const normalized = normalizeType(shape);
      expect(normalized).toEqual({ kind: "literal", value: null });
    });
  });

  // --------------------------------------------------------------------------
  // 3. Equivalent object shapes with different property ordering produce equivalent canonical output
  // --------------------------------------------------------------------------
  describe("3. Object properties deterministic sorting", () => {
    it("sorts properties alphabetically by name", () => {
      const unsorted: TypeShape = {
        kind: "object",
        additionalProperties: "forbidden",
        properties: [
          {
            name: "zebra",
            type: { kind: "primitive", name: "string" },
            presence: "required",
            nullable: "no",
            evidence: []
          },
          {
            name: "apple",
            type: { kind: "primitive", name: "number" },
            presence: "required",
            nullable: "no",
            evidence: []
          },
          {
            name: "banana",
            type: { kind: "primitive", name: "boolean" },
            presence: "optional",
            nullable: "yes",
            evidence: []
          }
        ]
      };

      const normalized = normalizeType(unsorted);
      expect(normalized.kind).toBe("object");
      if (normalized.kind === "object") {
        expect(normalized.properties.map((p) => p.name)).toEqual(["apple", "banana", "zebra"]);
      }
    });

    it("produces identical canonical output for differently ordered objects", () => {
      const objA: TypeShape = {
        kind: "object",
        additionalProperties: "unknown",
        properties: [
          {
            name: "id",
            type: { kind: "primitive", name: "string" },
            presence: "required",
            nullable: "no",
            evidence: []
          },
          {
            name: "email",
            type: { kind: "primitive", name: "string" },
            presence: "optional",
            nullable: "no",
            evidence: []
          }
        ]
      };

      const objB: TypeShape = {
        kind: "object",
        additionalProperties: "unknown",
        properties: [
          {
            name: "email",
            type: { kind: "primitive", name: "string" },
            presence: "optional",
            nullable: "no",
            evidence: []
          },
          {
            name: "id",
            type: { kind: "primitive", name: "string" },
            presence: "required",
            nullable: "no",
            evidence: []
          }
        ]
      };

      const normA = normalizeType(objA);
      const normB = normalizeType(objB);

      expect(normA).toEqual(normB);
      expect(areTypeShapesEqual(normA, normB)).toBe(true);
      expect(getTypeShapeKey(normA)).toBe(getTypeShapeKey(normB));
    });
  });

  // --------------------------------------------------------------------------
  // 4. Nested object properties normalize recursively
  // --------------------------------------------------------------------------
  describe("4. Nested object recursive normalization", () => {
    it("recursively sorts properties across nested object hierarchies", () => {
      const nested: TypeShape = {
        kind: "object",
        additionalProperties: "allowed",
        properties: [
          {
            name: "user",
            presence: "required",
            nullable: "no",
            evidence: [],
            type: {
              kind: "object",
              additionalProperties: "unknown",
              properties: [
                {
                  name: "profile",
                  presence: "required",
                  nullable: "no",
                  evidence: [],
                  type: {
                    kind: "object",
                    additionalProperties: "forbidden",
                    properties: [
                      {
                        name: "lastName",
                        type: { kind: "primitive", name: "string" },
                        presence: "required",
                        nullable: "no",
                        evidence: []
                      },
                      {
                        name: "firstName",
                        type: { kind: "primitive", name: "string" },
                        presence: "required",
                        nullable: "no",
                        evidence: []
                      }
                    ]
                  }
                },
                {
                  name: "age",
                  type: { kind: "primitive", name: "number" },
                  presence: "optional",
                  nullable: "no",
                  evidence: []
                }
              ]
            }
          }
        ]
      };

      const normalized = normalizeType(nested);
      expect(normalized.kind).toBe("object");
      if (normalized.kind === "object") {
        expect(normalized.properties[0].name).toBe("user");
        const userType = normalized.properties[0].type;
        expect(userType.kind).toBe("object");
        if (userType.kind === "object") {
          expect(userType.properties.map((p: FieldShape) => p.name)).toEqual(["age", "profile"]);
          const profileType = userType.properties[1].type;
          expect(profileType.kind).toBe("object");
          if (profileType.kind === "object") {
            expect(profileType.properties.map((p: FieldShape) => p.name)).toEqual([
              "firstName",
              "lastName"
            ]);
          }
        }
      }
    });
  });

  // --------------------------------------------------------------------------
  // 5. Supported union shapes flatten and deduplicate equivalent members without merging distinct types
  // --------------------------------------------------------------------------
  describe("5. Union shapes flattening, deduplication, and ordering", () => {
    it("flattens nested union members", () => {
      const union: TypeShape = {
        kind: "union",
        members: [
          { kind: "primitive", name: "string" },
          {
            kind: "union",
            members: [
              { kind: "primitive", name: "number" },
              { kind: "primitive", name: "boolean" }
            ]
          }
        ]
      };

      const normalized = normalizeType(union);
      expect(normalized.kind).toBe("union");
      if (normalized.kind === "union") {
        expect(normalized.members).toHaveLength(3);
        const names = normalized.members.map((m) => (m.kind === "primitive" ? m.name : ""));
        expect(names).toContain("string");
        expect(names).toContain("number");
        expect(names).toContain("boolean");
      }
    });

    it("deduplicates identical union members deterministically", () => {
      const union: TypeShape = {
        kind: "union",
        members: [
          { kind: "primitive", name: "string" },
          { kind: "primitive", name: "number" },
          { kind: "primitive", name: "string" },
          { kind: "primitive", name: "number" }
        ]
      };

      const normalized = normalizeType(union);
      expect(normalized.kind).toBe("union");
      if (normalized.kind === "union") {
        expect(normalized.members).toHaveLength(2);
        expect(normalized.members).toEqual([
          { kind: "primitive", name: "number" },
          { kind: "primitive", name: "string" }
        ]);
      }
    });

    it("does not merge distinct types such as null and undefined", () => {
      const union: TypeShape = {
        kind: "union",
        members: [
          { kind: "primitive", name: "string" },
          { kind: "primitive", name: "null" },
          { kind: "primitive", name: "undefined" }
        ]
      };

      const normalized = normalizeType(union);
      expect(normalized.kind).toBe("union");
      if (normalized.kind === "union") {
        expect(normalized.members).toHaveLength(3);
        const names = normalized.members.map((m) => (m.kind === "primitive" ? m.name : ""));
        expect(names).toEqual(["null", "string", "undefined"].sort());
      }
    });

    it("does not merge distinct literal types into a broader primitive", () => {
      const union: TypeShape = {
        kind: "union",
        members: [
          { kind: "literal", value: "GET" },
          { kind: "literal", value: "POST" }
        ]
      };

      const normalized = normalizeType(union);
      expect(normalized.kind).toBe("union");
      if (normalized.kind === "union") {
        expect(normalized.members).toEqual([
          { kind: "literal", value: "GET" },
          { kind: "literal", value: "POST" }
        ]);
      }
    });

    it("orders union members consistently regardless of input order", () => {
      const unionA: TypeShape = {
        kind: "union",
        members: [
          { kind: "primitive", name: "string" },
          { kind: "primitive", name: "number" }
        ]
      };
      const unionB: TypeShape = {
        kind: "union",
        members: [
          { kind: "primitive", name: "number" },
          { kind: "primitive", name: "string" }
        ]
      };

      const normA = normalizeType(unionA);
      const normB = normalizeType(unionB);
      expect(normA).toEqual(normB);
      expect(areTypeShapesEqual(normA, normB)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 6. Supported array element shapes normalize recursively
  // --------------------------------------------------------------------------
  describe("6. Array element recursive normalization", () => {
    it("normalizes array element types recursively", () => {
      const arrayShape: TypeShape = {
        kind: "array",
        element: {
          kind: "object",
          additionalProperties: "unknown",
          properties: [
            {
              name: "z",
              type: { kind: "primitive", name: "string" },
              presence: "required",
              nullable: "no",
              evidence: []
            },
            {
              name: "a",
              type: { kind: "primitive", name: "number" },
              presence: "required",
              nullable: "no",
              evidence: []
            }
          ]
        }
      };

      const normalized = normalizeType(arrayShape);
      expect(normalized.kind).toBe("array");
      if (normalized.kind === "array" && normalized.element.kind === "object") {
        expect(normalized.element.properties.map((p) => p.name)).toEqual(["a", "z"]);
      }
    });

    it("normalizes multi-dimensional nested arrays", () => {
      const matrix: TypeShape = {
        kind: "array",
        element: {
          kind: "array",
          element: {
            kind: "primitive",
            name: "number"
          }
        }
      };

      const normalized = normalizeType(matrix);
      expect(normalized).toEqual({
        kind: "array",
        element: {
          kind: "array",
          element: {
            kind: "primitive",
            name: "number"
          }
        }
      });
    });
  });

  // --------------------------------------------------------------------------
  // 7. Required versus optional fields remain distinct
  // --------------------------------------------------------------------------
  describe("7. Required vs optional distinctness", () => {
    it("distinguishes required and optional fields clearly", () => {
      const reqField: FieldShape = {
        name: "status",
        type: { kind: "primitive", name: "string" },
        presence: "required",
        nullable: "no",
        evidence: []
      };

      const optField: FieldShape = {
        name: "status",
        type: { kind: "primitive", name: "string" },
        presence: "optional",
        nullable: "no",
        evidence: []
      };

      const normReq = normalizeFieldShape(reqField);
      const normOpt = normalizeFieldShape(optField);

      expect(normReq.presence).toBe("required");
      expect(normOpt.presence).toBe("optional");
      expect(areFieldShapesEqual(normReq, normOpt)).toBe(false);
    });

    it("preserves presence: unknown when field presence is uncertain", () => {
      const unkField: FieldShape = {
        name: "tag",
        type: { kind: "primitive", name: "string" },
        presence: "unknown",
        nullable: "no",
        evidence: []
      };

      const norm = normalizeFieldShape(unkField);
      expect(norm.presence).toBe("unknown");
    });
  });

  // --------------------------------------------------------------------------
  // 8. Nullable versus non-nullable fields remain distinct
  // --------------------------------------------------------------------------
  describe("8. Nullable vs non-nullable distinctness (4 distinct contracts)", () => {
    it("preserves every supported combination of presence and nullability strictly", () => {
      // Contract 1: Required, not null
      const c1 = normalizeFieldShape({
        name: "age",
        type: { kind: "primitive", name: "number" },
        presence: "required",
        nullable: "no",
        evidence: []
      });

      // Contract 2: Optional, not null
      const c2 = normalizeFieldShape({
        name: "age",
        type: { kind: "primitive", name: "number" },
        presence: "optional",
        nullable: "no",
        evidence: []
      });

      // Contract 3: Required, may be null
      const c3 = normalizeFieldShape({
        name: "age",
        type: { kind: "primitive", name: "number" },
        presence: "required",
        nullable: "yes",
        evidence: []
      });

      // Contract 4: Optional, may be null
      const c4 = normalizeFieldShape({
        name: "age",
        type: { kind: "primitive", name: "number" },
        presence: "optional",
        nullable: "yes",
        evidence: []
      });

      expect(c1.presence).toBe("required");
      expect(c1.nullable).toBe("no");

      expect(c2.presence).toBe("optional");
      expect(c2.nullable).toBe("no");

      expect(c3.presence).toBe("required");
      expect(c3.nullable).toBe("yes");

      expect(c4.presence).toBe("optional");
      expect(c4.nullable).toBe("yes");

      // Verify all 4 contracts are mutually non-equal
      expect(areFieldShapesEqual(c1, c2)).toBe(false);
      expect(areFieldShapesEqual(c1, c3)).toBe(false);
      expect(areFieldShapesEqual(c1, c4)).toBe(false);
      expect(areFieldShapesEqual(c2, c3)).toBe(false);
      expect(areFieldShapesEqual(c2, c4)).toBe(false);
      expect(areFieldShapesEqual(c3, c4)).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 9. ShapeObservation.completeness is preserved for complete, partial, and unknown inputs
  // --------------------------------------------------------------------------
  describe("9. Completeness status preservation", () => {
    it("preserves 'complete' status", () => {
      const obs: ShapeObservation = {
        shape: { kind: "primitive", name: "string" },
        completeness: "complete",
        evidence: [sampleEvidence]
      };
      const normalized = normalizeShapeObservation(obs);
      expect(normalized.completeness).toBe("complete");
    });

    it("preserves 'partial' status without promoting to complete", () => {
      const obs: ShapeObservation = {
        shape: {
          kind: "object",
          additionalProperties: "unknown",
          properties: [
            {
              name: "id",
              type: { kind: "primitive", name: "number" },
              presence: "required",
              nullable: "no",
              evidence: []
            }
          ]
        },
        completeness: "partial",
        evidence: [sampleEvidence]
      };

      const normalized = normalizeShapeObservation(obs);
      expect(normalized.completeness).toBe("partial");
    });

    it("preserves 'unknown' completeness status", () => {
      const obs: ShapeObservation = {
        shape: { kind: "unknown", reason: "incomplete-source" },
        completeness: "unknown",
        evidence: []
      };

      const normalized = normalizeShapeObservation(obs);
      expect(normalized.completeness).toBe("unknown");
    });
  });

  // --------------------------------------------------------------------------
  // 10. Unknown or unsupported type constructs remain conservative
  // --------------------------------------------------------------------------
  describe("10. Conservative unknown/unsupported handling", () => {
    it("does not map unsupported or differently cased primitive names to known primitives", () => {
      const anyShape = normalizeType({
        kind: "primitive",
        name: "any" as unknown as PrimitiveTypeName
      });
      expect(anyShape).toEqual({
        kind: "unknown",
        reason: "unsupported-syntax"
      });

      const intShape = normalizeType({
        kind: "primitive",
        name: "int" as unknown as PrimitiveTypeName
      });
      expect(intShape).toEqual({
        kind: "unknown",
        reason: "unsupported-syntax"
      });

      const stringShape = normalizeType({
        kind: "primitive",
        name: "String" as unknown as PrimitiveTypeName
      });
      expect(stringShape).toEqual({
        kind: "unknown",
        reason: "unsupported-syntax"
      });

      const numberShape = normalizeType({
        kind: "primitive",
        name: "NUMBER" as unknown as PrimitiveTypeName
      });
      expect(numberShape).toEqual({
        kind: "unknown",
        reason: "unsupported-syntax"
      });
    });

    it("handles non-finite number literals conservatively as unknown", () => {
      const nanShape = normalizeType({
        kind: "literal",
        value: Number.NaN
      });
      expect(nanShape).toEqual({
        kind: "unknown",
        reason: "unsupported-syntax"
      });

      const infShape = normalizeType({
        kind: "literal",
        value: Number.POSITIVE_INFINITY
      });
      expect(infShape).toEqual({
        kind: "unknown",
        reason: "unsupported-syntax"
      });
    });

    it("preserves all documented unknown reasons", () => {
      const reasons = [
        "dynamic-expression",
        "unsupported-syntax",
        "unresolved-reference",
        "incomplete-source",
        "complex-type",
        "not-observed"
      ] as const;

      for (const reason of reasons) {
        const shape = normalizeType({ kind: "unknown", reason });
        expect(shape).toEqual({ kind: "unknown", reason });
      }
    });

    it("normalizes unrecognized unknown reason to 'unsupported-syntax'", () => {
      const shape = normalizeType({
        kind: "unknown",
        reason: "arbitrary-custom-reason" as unknown as "unsupported-syntax"
      });
      expect(shape).toEqual({
        kind: "unknown",
        reason: "unsupported-syntax"
      });
    });
  });

  // --------------------------------------------------------------------------
  // 11. Normalization is deterministic and idempotent for supported inputs
  // --------------------------------------------------------------------------
  describe("11. Determinism and idempotence", () => {
    it("is strictly idempotent on complex TypeShape structures", () => {
      const complex: TypeShape = {
        kind: "object",
        additionalProperties: "forbidden",
        properties: [
          {
            name: "tags",
            presence: "optional",
            nullable: "no",
            evidence: [sampleEvidence],
            type: {
              kind: "array",
              element: { kind: "primitive", name: "string" }
            }
          },
          {
            name: "id",
            presence: "required",
            nullable: "no",
            evidence: [],
            type: { kind: "primitive", name: "number" }
          },
          {
            name: "status",
            presence: "required",
            nullable: "yes",
            evidence: [],
            type: {
              kind: "union",
              members: [
                { kind: "literal", value: "active" },
                { kind: "literal", value: "pending" },
                { kind: "literal", value: "active" }
              ]
            }
          }
        ]
      };

      const firstPass = normalizeType(complex);
      const secondPass = normalizeType(firstPass);
      const thirdPass = normalizeType(secondPass);

      expect(firstPass).toEqual(secondPass);
      expect(secondPass).toEqual(thirdPass);
      expect(areTypeShapesEqual(firstPass, secondPass)).toBe(true);
    });

    it("is idempotent on ShapeObservation", () => {
      const obs: ShapeObservation = {
        shape: {
          kind: "object",
          additionalProperties: "allowed",
          properties: [
            {
              name: "z",
              presence: "required",
              nullable: "no",
              evidence: [],
              type: { kind: "primitive", name: "string" }
            },
            {
              name: "a",
              presence: "optional",
              nullable: "yes",
              evidence: [],
              type: { kind: "primitive", name: "number" }
            }
          ]
        },
        completeness: "partial",
        evidence: [sampleEvidence]
      };

      const pass1 = normalizeShapeObservation(obs);
      const pass2 = normalizeShapeObservation(pass1);

      expect(pass1).toEqual(pass2);
      expect(areShapeObservationsEqual(pass1, pass2)).toBe(true);
    });

    it("is idempotent on RequestShapeObservation and ResponseShapeObservation", () => {
      const req: RequestShapeObservation = {
        pathParams: {
          shape: {
            kind: "object",
            additionalProperties: "forbidden",
            properties: [
              {
                name: "id",
                type: { kind: "primitive", name: "string" },
                presence: "required",
                nullable: "no",
                evidence: []
              }
            ]
          },
          completeness: "complete",
          evidence: []
        },
        body: {
          shape: { kind: "primitive", name: "string" },
          completeness: "complete",
          evidence: []
        }
      };

      const req1 = normalizeRequestShape(req);
      const req2 = normalizeRequestShape(req1);
      expect(req1).toEqual(req2);

      const res: ResponseShapeObservation = {
        statusCode: {
          value: 200,
          confidence: "exact",
          source: []
        },
        body: {
          shape: { kind: "primitive", name: "boolean" },
          completeness: "complete",
          evidence: []
        },
        source: []
      };

      const res1 = normalizeResponseShape(res);
      const res2 = normalizeResponseShape(res1);
      expect(res1).toEqual(res2);
    });
  });

  // --------------------------------------------------------------------------
  // 12. Existing evidence, provenance, or other required fields are not lost
  // --------------------------------------------------------------------------
  describe("12. Evidence and provenance preservation", () => {
    it("preserves evidence array and metadata on FieldShape", () => {
      const field: FieldShape = {
        name: "count",
        type: { kind: "primitive", name: "number" },
        presence: "required",
        nullable: "no",
        evidence: [sampleEvidence]
      };

      const normalized = normalizeFieldShape(field);
      expect(normalized.evidence).toHaveLength(1);
      expect(normalized.evidence[0]).toEqual(sampleEvidence);
      // Ensure defensive copy
      expect(normalized.evidence).not.toBe(field.evidence);
    });

    it("preserves evidence array on ShapeObservation", () => {
      const obs: ShapeObservation = {
        shape: { kind: "primitive", name: "string" },
        completeness: "complete",
        evidence: [sampleEvidence]
      };

      const normalized = normalizeShapeObservation(obs);
      expect(normalized.evidence).toHaveLength(1);
      expect(normalized.evidence[0]).toEqual(sampleEvidence);
      expect(normalized.evidence).not.toBe(obs.evidence);
    });

    it("preserves source spans and status code on ResponseShapeObservation", () => {
      const res: ResponseShapeObservation = {
        statusCode: {
          value: 204,
          confidence: "exact",
          source: [
            {
              snapshot: { uri: "file:///server.ts", contentHash: "hash" },
              range: {
                start: { line: 10, character: 5 },
                end: { line: 10, character: 15 }
              }
            }
          ]
        },
        source: [
          {
            snapshot: { uri: "file:///server.ts", contentHash: "hash" },
            range: {
              start: { line: 10, character: 1 },
              end: { line: 12, character: 1 }
            }
          }
        ]
      };

      const normalized = normalizeResponseShape(res);
      expect(normalized.statusCode?.value).toBe(204);
      expect(normalized.statusCode?.source).toHaveLength(1);
      expect(normalized.source).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------------------
  // 13. Empty or malformed structures follow explicit contract behavior
  // --------------------------------------------------------------------------
  describe("13. Empty or malformed structures", () => {
    it("returns conservative unknown shape for non-object or null input", () => {
      expect(normalizeType(null)).toEqual({
        kind: "unknown",
        reason: "not-observed"
      });
      expect(normalizeType(undefined)).toEqual({
        kind: "unknown",
        reason: "not-observed"
      });
      expect(normalizeType("not-an-object")).toEqual({
        kind: "unknown",
        reason: "not-observed"
      });
    });

    it("returns empty object shape with default unknown additionalProperties without fabricating fields", () => {
      const emptyObj = normalizeType({
        kind: "object",
        properties: []
      });
      expect(emptyObj).toEqual({
        kind: "object",
        properties: [],
        additionalProperties: "unknown"
      });
    });

    it("preserves empty union members without fabricating 'never' or other primitive types", () => {
      const emptyUnion = normalizeType({
        kind: "union",
        members: []
      });
      expect(emptyUnion).toEqual({
        kind: "union",
        members: []
      });
    });

    it("returns conservative default field shape for malformed field input", () => {
      const malformedField = normalizeFieldShape(null);
      expect(malformedField).toEqual({
        name: "",
        type: { kind: "unknown", reason: "not-observed" },
        presence: "unknown",
        nullable: "unknown",
        evidence: []
      });
    });

    it("returns undefined for null or non-object RequestShapeObservation", () => {
      expect(normalizeRequestShape(null)).toBeUndefined();
      expect(normalizeRequestShape(undefined)).toBeUndefined();
      expect(normalizeRequestShape(123)).toBeUndefined();
    });

    it("returns empty response shape for null ResponseShapeObservation", () => {
      expect(normalizeResponseShape(null)).toEqual({ source: [] });
      expect(normalizeResponseShape(undefined)).toEqual({ source: [] });
    });
  });

  // --------------------------------------------------------------------------
  // 14. References and circular graphs
  // --------------------------------------------------------------------------
  describe("14. Reference types and cycle handling", () => {
    it("normalizes resolved references recursively", () => {
      const ref: TypeShape = {
        kind: "reference",
        displayName: "UserDto",
        resolution: "resolved",
        targetId: "dto:123",
        resolvedShape: {
          kind: "object",
          additionalProperties: "forbidden",
          properties: [
            {
              name: "id",
              type: { kind: "primitive", name: "number" },
              presence: "required",
              nullable: "no",
              evidence: []
            }
          ]
        }
      };

      const normalized = normalizeType(ref);
      expect(normalized).toEqual(ref);
    });

    it("normalizes unresolved references without fabricating shapes", () => {
      const ref: TypeShape = {
        kind: "reference",
        displayName: "ExternalModel",
        resolution: "unresolved"
      };

      const normalized = normalizeType(ref);
      expect(normalized).toEqual({
        kind: "reference",
        displayName: "ExternalModel",
        resolution: "unresolved",
        targetId: undefined,
        resolvedShape: undefined
      });
    });

    it("prevents infinite recursion loops in circular reference graphs", () => {
      interface MutableReference {
        kind: "reference";
        displayName: string;
        resolution: "resolved" | "unresolved";
        targetId?: string;
        resolvedShape?: TypeShape;
      }

      const cyclicRef: MutableReference = {
        kind: "reference",
        displayName: "TreeNode",
        resolution: "resolved",
        targetId: "node:1"
      };
      // Create cycle
      cyclicRef.resolvedShape = {
        kind: "object",
        additionalProperties: "forbidden",
        properties: [
          {
            name: "parent",
            type: cyclicRef,
            presence: "optional",
            nullable: "yes",
            evidence: []
          }
        ]
      };

      // Normalization must terminate safely without stack overflow
      const normalized = normalizeType(cyclicRef);
      expect(normalized.kind).toBe("reference");
      if (normalized.kind === "reference") {
        expect(normalized.displayName).toBe("TreeNode");
      }
    });
  });

  // --------------------------------------------------------------------------
  // 15. TypeShape formatting utility
  // --------------------------------------------------------------------------
  describe("15. formatTypeShape", () => {
    it("formats primitives, literals, arrays, and objects into readable signatures", () => {
      expect(formatTypeShape({ kind: "primitive", name: "string" })).toBe("string");
      expect(formatTypeShape({ kind: "literal", value: "active" })).toBe('"active"');
      expect(formatTypeShape({ kind: "literal", value: 42 })).toBe("42");
      expect(
        formatTypeShape({
          kind: "array",
          element: { kind: "primitive", name: "number" }
        })
      ).toBe("number[]");
      expect(
        formatTypeShape({
          kind: "object",
          additionalProperties: "forbidden",
          properties: [
            {
              name: "id",
              type: { kind: "primitive", name: "string" },
              presence: "required",
              nullable: "no",
              evidence: []
            },
            {
              name: "age",
              type: { kind: "primitive", name: "number" },
              presence: "optional",
              nullable: "yes",
              evidence: []
            }
          ]
        })
      ).toBe("{ id: string, age?: number | null }");
      expect(
        formatTypeShape({
          kind: "union",
          members: [
            { kind: "primitive", name: "string" },
            { kind: "primitive", name: "number" }
          ]
        })
      ).toBe("string | number");
      expect(
        formatTypeShape({
          kind: "reference",
          displayName: "User",
          resolution: "unresolved"
        })
      ).toBe("User");
      expect(
        formatTypeShape({
          kind: "unknown",
          reason: "dynamic-expression"
        })
      ).toBe("unknown(dynamic-expression)");
    });
  });

  // --------------------------------------------------------------------------
  // 16. Type guard utilities
  // --------------------------------------------------------------------------
  describe("16. Type guards", () => {
    it("isTypeShape identifies valid shapes and rejects non-shapes", () => {
      expect(isTypeShape({ kind: "primitive", name: "string" })).toBe(true);
      expect(isTypeShape({ kind: "literal", value: 123 })).toBe(true);
      expect(isTypeShape(null)).toBe(false);
      expect(isTypeShape(undefined)).toBe(false);
      expect(isTypeShape("string")).toBe(false);
      expect(isTypeShape({})).toBe(false);
    });
  });
});
