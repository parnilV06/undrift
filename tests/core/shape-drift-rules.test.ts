import { describe, expect, it } from "vitest";
import type {
  AnalysisWarning,
  ApiObservation,
  FieldShape,
  HttpMethod,
  ObservationRole,
  RequestShapeObservation,
  ResponseShapeObservation,
  RoutePattern,
  ShapeObservation,
  SourceSpan,
  TypeShape
} from "../../packages/core/src/index";
import {
  checkTypeCompatibility,
  compareShapes,
  createRelationshipId,
  evaluateRules,
  evaluateShapeRules,
  normalizeHttpMethod,
  normalizeRoute,
  RuleEngine,
  SHAPE_RULE_IDS
} from "../../packages/core/src/index";

describe("Phase 3, Chunk 3.6: Directional Shape Comparison & Shape Drift Rules", () => {
  // Helper to construct a FieldShape fixture
  function createField(
    name: string,
    type: TypeShape,
    options?: {
      presence?: "required" | "optional" | "unknown";
      nullable?: "yes" | "no" | "unknown";
    }
  ): FieldShape {
    return {
      name,
      type,
      presence: options?.presence ?? "required",
      nullable: options?.nullable ?? "no",
      evidence: []
    };
  }

  // Helper to construct an object ShapeObservation fixture
  function createObjectObservation(
    properties: FieldShape[],
    options?: {
      completeness?: "complete" | "partial" | "unknown";
      additionalProperties?: "allowed" | "forbidden" | "unknown";
    }
  ): ShapeObservation {
    return {
      shape: {
        kind: "object",
        properties,
        additionalProperties: options?.additionalProperties ?? "unknown"
      },
      completeness: options?.completeness ?? "complete",
      evidence: []
    };
  }

  // Helper to construct realistic ApiObservation fixtures with request and response shapes
  function createShapeObs(
    id: string,
    role: ObservationRole,
    methodStr: string,
    pathInput: string | RoutePattern,
    options?: {
      request?: RequestShapeObservation;
      responses?: ResponseShapeObservation[];
      limitations?: AnalysisWarning[];
      line?: number;
    }
  ): ApiObservation {
    const line = options?.line ?? 10;
    const normMethod = normalizeHttpMethod(methodStr);
    const normPath = typeof pathInput === "string" ? normalizeRoute(pathInput) : pathInput;

    const span: SourceSpan = {
      uri: `file:///${role}/${id}.ts`,
      range: { start: 100, end: 150 },
      start: { line, character: 1 },
      end: { line, character: 25 }
    };

    return {
      id,
      role,
      languageId: "typescript",
      extractorId: role === "consumer" ? "fetch-extractor" : "express-extractor",
      source: [span],
      snapshot: { uri: `file:///${role}/${id}.ts`, contentHash: "hash123" },
      endpoint: {
        method: {
          state: "known",
          value: normMethod!,
          strength: "direct",
          evidence: []
        },
        path: {
          state: "known",
          value: normPath,
          strength: "direct",
          evidence: []
        },
        request: options?.request,
        responses: options?.responses
      },
      limitations: options?.limitations ?? []
    };
  }

  // ==========================================================================
  // 1. Comparator Behavior (LLD §11.4)
  // ==========================================================================
  describe("1. Pure Shape Comparator Behavior", () => {
    const dummyContext = (depth = 0, maxDepth = 5) => ({
      depth,
      maxDepth,
      visitedPairs: new Set<string>()
    });

    it("1. primitive type compatibility and incompatibility according to LLD §11.4", () => {
      const num: TypeShape = { kind: "primitive", name: "number" };
      const str: TypeShape = { kind: "primitive", name: "string" };
      const bool: TypeShape = { kind: "primitive", name: "boolean" };

      expect(checkTypeCompatibility(num, num, "request", dummyContext()).state).toBe("compatible");
      expect(checkTypeCompatibility(str, str, "response", dummyContext()).state).toBe("compatible");
      expect(checkTypeCompatibility(num, str, "request", dummyContext()).state).toBe(
        "incompatible"
      );
      expect(checkTypeCompatibility(bool, num, "response", dummyContext()).state).toBe(
        "incompatible"
      );
    });

    it("2. literal types compared directionally without losing literal information", () => {
      const literalReady: TypeShape = { kind: "literal", value: "ready" };
      const literalActive: TypeShape = { kind: "literal", value: "active" };
      const stringPrim: TypeShape = { kind: "primitive", name: "string" };

      // Literal matches exact literal
      expect(
        checkTypeCompatibility(literalReady, literalReady, "request", dummyContext()).state
      ).toBe("compatible");
      expect(
        checkTypeCompatibility(literalReady, literalActive, "request", dummyContext()).state
      ).toBe("incompatible");

      // Producer supplies literal, receiver accepts broad primitive (valid directional match)
      expect(
        checkTypeCompatibility(literalReady, stringPrim, "request", dummyContext()).state
      ).toBe("compatible");
      expect(
        checkTypeCompatibility(literalReady, stringPrim, "response", dummyContext()).state
      ).toBe("compatible");

      // Producer supplies broad primitive, receiver expects narrow literal (incompatible)
      expect(
        checkTypeCompatibility(stringPrim, literalReady, "request", dummyContext()).state
      ).toBe("incompatible");
      expect(
        checkTypeCompatibility(stringPrim, literalReady, "response", dummyContext()).state
      ).toBe("incompatible");
    });

    it("3. array element types compared recursively", () => {
      const strArray: TypeShape = { kind: "array", element: { kind: "primitive", name: "string" } };
      const numArray: TypeShape = { kind: "array", element: { kind: "primitive", name: "number" } };

      expect(checkTypeCompatibility(strArray, strArray, "request", dummyContext()).state).toBe(
        "compatible"
      );
      expect(checkTypeCompatibility(strArray, numArray, "request", dummyContext()).state).toBe(
        "incompatible"
      );
      expect(
        checkTypeCompatibility(
          strArray,
          { kind: "primitive", name: "string" },
          "request",
          dummyContext()
        ).state
      ).toBe("incompatible");
    });

    it("4. nested object properties compared deterministically", () => {
      const sourceObj = createObjectObservation([
        createField("user", {
          kind: "object",
          properties: [createField("id", { kind: "primitive", name: "number" })],
          additionalProperties: "unknown"
        })
      ]);

      const targetObjMismatch = createObjectObservation([
        createField("user", {
          kind: "object",
          properties: [createField("id", { kind: "primitive", name: "string" })],
          additionalProperties: "unknown"
        })
      ]);

      const diffs = compareShapes(sourceObj, targetObjMismatch, "request");
      expect(diffs).toHaveLength(1);
      expect(diffs[0].kind).toBe("type-mismatch");
      expect(diffs[0].path).toBe("user.id");
      expect(diffs[0].expectedDescription).toBe("string");
      expect(diffs[0].observedDescription).toBe("number");
    });

    it("5. union members handled according to specified conservative compatibility rules", () => {
      const strOrNum: TypeShape = {
        kind: "union",
        members: [
          { kind: "primitive", name: "string" },
          { kind: "primitive", name: "number" }
        ]
      };
      const stringOnly: TypeShape = { kind: "primitive", name: "string" };

      // Source is union (string | number), target expects string -> incompatible because number cannot be accepted
      expect(checkTypeCompatibility(strOrNum, stringOnly, "request", dummyContext()).state).toBe(
        "incompatible"
      );

      // Source is string, target accepts union (string | number) -> compatible because string is an accepted member
      expect(checkTypeCompatibility(stringOnly, strOrNum, "request", dummyContext()).state).toBe(
        "compatible"
      );
    });

    it("6. unknown and unresolved types do not produce confident mismatch results", () => {
      const unknownType: TypeShape = { kind: "unknown", reason: "dynamic-expression" };
      const unresolvedRef: TypeShape = {
        kind: "reference",
        displayName: "UserDto",
        resolution: "unresolved"
      };
      const stringPrim: TypeShape = { kind: "primitive", name: "string" };

      const resUnknown = checkTypeCompatibility(unknownType, stringPrim, "request", dummyContext());
      expect(resUnknown.state).toBe("unknown");

      const resUnresolved = checkTypeCompatibility(
        unresolvedRef,
        stringPrim,
        "request",
        dummyContext()
      );
      expect(resUnresolved.state).toBe("unknown");

      // Compare shapes does not emit a mismatch difference for unknown types
      const sourceObs = createObjectObservation([createField("field", unknownType)]);
      const targetObs = createObjectObservation([createField("field", stringPrim)]);
      expect(compareShapes(sourceObs, targetObs, "request")).toHaveLength(0);
    });

    it("7. recursive references terminate safely without infinite recursion loops", () => {
      const nodeA: Extract<TypeShape, { kind: "reference" }> = {
        kind: "reference",
        displayName: "Node",
        resolution: "resolved"
      };
      const nodeB: Extract<TypeShape, { kind: "reference" }> = {
        kind: "reference",
        displayName: "Node",
        resolution: "resolved"
      };

      // Cyclic references
      nodeA.resolvedShape = {
        kind: "object",
        properties: [
          { name: "next", type: nodeA, presence: "optional", nullable: "yes", evidence: [] }
        ],
        additionalProperties: "unknown"
      };
      nodeB.resolvedShape = {
        kind: "object",
        properties: [
          { name: "next", type: nodeB, presence: "optional", nullable: "yes", evidence: [] }
        ],
        additionalProperties: "unknown"
      };

      const result = checkTypeCompatibility(nodeA, nodeB, "request", dummyContext());
      expect(result.state).toBe("compatible");
    });

    it("8. depth-limit behavior is deterministic and does not fabricate a mismatch", () => {
      const deeplyNested = (levels: number): TypeShape => {
        if (levels <= 0) return { kind: "primitive", name: "string" };
        return {
          kind: "object",
          properties: [createField("child", deeplyNested(levels - 1))],
          additionalProperties: "unknown"
        };
      };

      const shapeA = deeplyNested(8);
      const shapeB = deeplyNested(8);

      // Context with maxDepth: 3
      const ctx = dummyContext(0, 3);
      const diffs = compareShapes(
        { shape: shapeA, completeness: "complete", evidence: [] },
        { shape: shapeB, completeness: "complete", evidence: [] },
        "request",
        { maxDepth: 3 }
      );

      // Should terminate safely at depth 3 and NOT fabricate a mismatch difference
      expect(diffs).toHaveLength(0);
    });

    it("9. optionality and nullability remain strictly separate", () => {
      const optNonNull = createField(
        "field",
        { kind: "primitive", name: "string" },
        { presence: "optional", nullable: "no" }
      );
      const reqNullable = createField(
        "field",
        { kind: "primitive", name: "string" },
        { presence: "required", nullable: "yes" }
      );

      const sourceObs = createObjectObservation([optNonNull]);
      const targetObs = createObjectObservation([reqNullable]);

      const diffs = compareShapes(sourceObs, targetObs, "request");
      // Consumer marks optional, provider requires -> optionality conflict
      // Consumer is non-nullable, provider is nullable -> consumer sending non-null satisfies nullable provider (no nullability conflict)
      expect(diffs).toHaveLength(1);
      expect(diffs[0].kind).toBe("optionality-conflict");
      expect(diffs[0].expectedDescription).toBe("required");
      expect(diffs[0].observedDescription).toBe("optional");
    });

    it("10. additional-property semantics are respected (tolerated by default, flagged when forbidden)", () => {
      const consumerPayload = createObjectObservation([
        createField("id", { kind: "primitive", name: "number" }),
        createField("extraField", { kind: "primitive", name: "string" })
      ]);

      const providerAllowed = createObjectObservation(
        [createField("id", { kind: "primitive", name: "number" })],
        { additionalProperties: "allowed" }
      );

      const providerUnknown = createObjectObservation(
        [createField("id", { kind: "primitive", name: "number" })],
        { additionalProperties: "unknown" }
      );

      const providerForbidden = createObjectObservation(
        [createField("id", { kind: "primitive", name: "number" })],
        { additionalProperties: "forbidden" }
      );

      // Tolerated when allowed or unknown
      expect(compareShapes(consumerPayload, providerAllowed, "request")).toHaveLength(0);
      expect(compareShapes(consumerPayload, providerUnknown, "request")).toHaveLength(0);

      // Flagged when forbidden
      const forbiddenDiffs = compareShapes(consumerPayload, providerForbidden, "request");
      expect(forbiddenDiffs).toHaveLength(1);
      expect(forbiddenDiffs[0].kind).toBe("forbidden-extra-field");
      expect(forbiddenDiffs[0].path).toBe("extraField");
    });
  });

  // ==========================================================================
  // 2. Request-Shape Drift Rules (UND200, UND210, UND220)
  // ==========================================================================
  describe("2. Request-Shape Drift Rules (UND200–UND220)", () => {
    it("11. emits UND200 when a required provider request field is missing from a complete consumer request", () => {
      const consumer = createShapeObs("c1", "consumer", "POST", "/api/users", {
        request: {
          body: createObjectObservation(
            [createField("username", { kind: "primitive", name: "string" })],
            {
              completeness: "complete"
            }
          )
        }
      });

      const provider = createShapeObs("p1", "provider", "POST", "/api/users", {
        request: {
          body: createObjectObservation([
            createField("username", { kind: "primitive", name: "string" }),
            createField("email", { kind: "primitive", name: "string" }, { presence: "required" })
          ])
        }
      });

      const findings = evaluateShapeRules({ observations: [consumer, provider] });
      expect(findings).toHaveLength(1);

      const f = findings[0];
      expect(f.ruleId).toBe(SHAPE_RULE_IDS.UND200);
      expect(f.category).toBe("request-shape");
      expect(f.severity).toBe("error");
      expect(f.title).toBe("Required request field not supplied/observed");
      expect(f.expected).toBe("required");
      expect(f.observed).toBeUndefined();
      expect(f.id).toContain("UND200");
      expect(f.explanation).toContain("email");
      expect(f.explanation).toContain("/api/users");
    });

    it("12. does NOT emit UND200 when the consumer request payload is partial or unknown", () => {
      const consumerPartial = createShapeObs("c1", "consumer", "POST", "/api/users", {
        request: {
          body: createObjectObservation(
            [createField("username", { kind: "primitive", name: "string" })],
            {
              completeness: "partial" // Incomplete extractor observation
            }
          )
        }
      });

      const provider = createShapeObs("p1", "provider", "POST", "/api/users", {
        request: {
          body: createObjectObservation([
            createField("username", { kind: "primitive", name: "string" }),
            createField("email", { kind: "primitive", name: "string" }, { presence: "required" })
          ])
        }
      });

      const findings = evaluateShapeRules({ observations: [consumerPartial, provider] });
      // Missing field MUST NOT be asserted when consumer payload is partial
      expect(findings.filter((f) => f.ruleId === "UND200")).toHaveLength(0);
    });

    it("13. emits UND210 when known request field types are incompatible", () => {
      const consumer = createShapeObs("c1", "consumer", "POST", "/api/orders", {
        request: {
          body: createObjectObservation([
            createField("quantity", { kind: "primitive", name: "string" })
          ])
        }
      });

      const provider = createShapeObs("p1", "provider", "POST", "/api/orders", {
        request: {
          body: createObjectObservation([
            createField("quantity", { kind: "primitive", name: "number" })
          ])
        }
      });

      const findings = evaluateShapeRules({ observations: [consumer, provider] });
      expect(findings).toHaveLength(1);

      const f = findings[0];
      expect(f.ruleId).toBe(SHAPE_RULE_IDS.UND210);
      expect(f.category).toBe("request-shape");
      expect(f.severity).toBe("error");
      expect(f.title).toBe("Request field type mismatch");
      expect(f.expected).toBe("number");
      expect(f.observed).toBe("string");
      expect(f.explanation).toContain("quantity");
    });

    it("14. does NOT emit UND210 when either request field type is unknown or unresolved", () => {
      const consumer = createShapeObs("c1", "consumer", "POST", "/api/orders", {
        request: {
          body: createObjectObservation([
            createField("metadata", { kind: "unknown", reason: "complex-type" })
          ])
        }
      });

      const provider = createShapeObs("p1", "provider", "POST", "/api/orders", {
        request: {
          body: createObjectObservation([
            createField("metadata", { kind: "primitive", name: "string" })
          ])
        }
      });

      const findings = evaluateShapeRules({ observations: [consumer, provider] });
      expect(findings.filter((f) => f.ruleId === "UND210")).toHaveLength(0);
    });

    it("15. emits UND220 when provider requires a field that consumer marks optional", () => {
      const consumer = createShapeObs("c1", "consumer", "PUT", "/api/settings", {
        request: {
          body: createObjectObservation([
            createField("theme", { kind: "primitive", name: "string" }, { presence: "optional" })
          ])
        }
      });

      const provider = createShapeObs("p1", "provider", "PUT", "/api/settings", {
        request: {
          body: createObjectObservation([
            createField("theme", { kind: "primitive", name: "string" }, { presence: "required" })
          ])
        }
      });

      const findings = evaluateShapeRules({ observations: [consumer, provider] });
      expect(findings).toHaveLength(1);

      const f = findings[0];
      expect(f.ruleId).toBe(SHAPE_RULE_IDS.UND220);
      expect(f.category).toBe("request-shape");
      expect(f.severity).toBe("warning");
      expect(f.title).toBe("Request nullability/optionality conflict");
      expect(f.expected).toBe("required");
      expect(f.observed).toBe("optional");
    });

    it("16. emits UND220 when consumer may send null for a non-nullable provider field", () => {
      const consumer = createShapeObs("c1", "consumer", "POST", "/api/profile", {
        request: {
          body: createObjectObservation([
            createField("bio", { kind: "primitive", name: "string" }, { nullable: "yes" })
          ])
        }
      });

      const provider = createShapeObs("p1", "provider", "POST", "/api/profile", {
        request: {
          body: createObjectObservation([
            createField("bio", { kind: "primitive", name: "string" }, { nullable: "no" })
          ])
        }
      });

      const findings = evaluateShapeRules({ observations: [consumer, provider] });
      expect(findings).toHaveLength(1);

      const f = findings[0];
      expect(f.ruleId).toBe(SHAPE_RULE_IDS.UND220);
      expect(f.category).toBe("request-shape");
      expect(f.severity).toBe("warning");
      expect(f.expected).toBe("non-nullable");
      expect(f.observed).toBe("nullable");
    });

    it("17. tolerates extra consumer request fields by default without error", () => {
      const consumer = createShapeObs("c1", "consumer", "POST", "/api/data", {
        request: {
          body: createObjectObservation([
            createField("id", { kind: "primitive", name: "number" }),
            createField("extra", { kind: "primitive", name: "string" })
          ])
        }
      });

      const provider = createShapeObs("p1", "provider", "POST", "/api/data", {
        request: {
          body: createObjectObservation(
            [createField("id", { kind: "primitive", name: "number" })],
            {
              additionalProperties: "unknown" // Typical Express endpoint
            }
          )
        }
      });

      const findings = evaluateShapeRules({ observations: [consumer, provider] });
      expect(findings).toHaveLength(0);
    });

    it("18. does not invent fake rule codes when additional properties are forbidden", () => {
      const consumer = createShapeObs("c1", "consumer", "POST", "/api/data", {
        request: {
          body: createObjectObservation([
            createField("id", { kind: "primitive", name: "number" }),
            createField("extra", { kind: "primitive", name: "string" })
          ])
        }
      });

      const provider = createShapeObs("p1", "provider", "POST", "/api/data", {
        request: {
          body: createObjectObservation(
            [createField("id", { kind: "primitive", name: "number" })],
            {
              additionalProperties: "forbidden"
            }
          )
        }
      });

      // No fake rule code should be invented in canonical catalog
      const findings = evaluateShapeRules({ observations: [consumer, provider] });
      expect(findings).toHaveLength(0);
    });
  });

  // ==========================================================================
  // 3. Response-Shape Drift Rules (UND300, UND310, UND320, UND330)
  // ==========================================================================
  describe("3. Response-Shape Drift Rules (UND300–UND330)", () => {
    it("19. emits UND300 when expected response field is missing from complete provider response", () => {
      const consumer = createShapeObs("c1", "consumer", "GET", "/api/user", {
        responses: [
          {
            statusCode: { state: "known", value: 200, strength: "direct", evidence: [] },
            body: createObjectObservation([
              createField("id", { kind: "primitive", name: "number" }),
              createField("name", { kind: "primitive", name: "string" })
            ]),
            source: []
          }
        ]
      });

      const provider = createShapeObs("p1", "provider", "GET", "/api/user", {
        responses: [
          {
            statusCode: { state: "known", value: 200, strength: "direct", evidence: [] },
            body: createObjectObservation(
              [createField("id", { kind: "primitive", name: "number" })],
              {
                completeness: "complete"
              }
            ),
            source: []
          }
        ]
      });

      const findings = evaluateShapeRules({ observations: [consumer, provider] });
      expect(findings).toHaveLength(1);

      const f = findings[0];
      expect(f.ruleId).toBe(SHAPE_RULE_IDS.UND300);
      expect(f.category).toBe("response-shape");
      expect(f.severity).toBe("error");
      expect(f.title).toBe("Provider response lacks expected field");
      expect(f.observed).toBeUndefined();
      expect(f.explanation).toContain("name");
    });

    it("20. does NOT emit UND300 when the provider response shape is partial", () => {
      const consumer = createShapeObs("c1", "consumer", "GET", "/api/user", {
        responses: [
          {
            statusCode: { state: "known", value: 200, strength: "direct", evidence: [] },
            body: createObjectObservation([
              createField("id", { kind: "primitive", name: "number" }),
              createField("name", { kind: "primitive", name: "string" })
            ]),
            source: []
          }
        ]
      });

      const provider = createShapeObs("p1", "provider", "GET", "/api/user", {
        responses: [
          {
            statusCode: { state: "known", value: 200, strength: "direct", evidence: [] },
            body: createObjectObservation(
              [createField("id", { kind: "primitive", name: "number" })],
              {
                completeness: "partial" // Partial provider observation
              }
            ),
            source: []
          }
        ]
      });

      const findings = evaluateShapeRules({ observations: [consumer, provider] });
      expect(findings.filter((f) => f.ruleId === "UND300")).toHaveLength(0);
    });

    it("21. emits UND310 when provider response field type is incompatible with consumer expectation", () => {
      const consumer = createShapeObs("c1", "consumer", "GET", "/api/stats", {
        responses: [
          {
            statusCode: { state: "known", value: 200, strength: "direct", evidence: [] },
            body: createObjectObservation([
              createField("count", { kind: "primitive", name: "number" })
            ]),
            source: []
          }
        ]
      });

      const provider = createShapeObs("p1", "provider", "GET", "/api/stats", {
        responses: [
          {
            statusCode: { state: "known", value: 200, strength: "direct", evidence: [] },
            body: createObjectObservation([
              createField("count", { kind: "primitive", name: "string" })
            ]),
            source: []
          }
        ]
      });

      const findings = evaluateShapeRules({ observations: [consumer, provider] });
      expect(findings).toHaveLength(1);

      const f = findings[0];
      expect(f.ruleId).toBe(SHAPE_RULE_IDS.UND310);
      expect(f.category).toBe("response-shape");
      expect(f.severity).toBe("error");
      expect(f.title).toBe("Response field type mismatch");
      expect(f.expected).toBe("number");
      expect(f.observed).toBe("string");
    });

    it("22. does NOT emit UND310 when response field type is unknown", () => {
      const consumer = createShapeObs("c1", "consumer", "GET", "/api/data", {
        responses: [
          {
            body: createObjectObservation([
              createField("payload", { kind: "primitive", name: "string" })
            ]),
            source: []
          }
        ]
      });

      const provider = createShapeObs("p1", "provider", "GET", "/api/data", {
        responses: [
          {
            body: createObjectObservation([
              createField("payload", { kind: "unknown", reason: "dynamic-expression" })
            ]),
            source: []
          }
        ]
      });

      const findings = evaluateShapeRules({ observations: [consumer, provider] });
      expect(findings.filter((f) => f.ruleId === "UND310")).toHaveLength(0);
    });

    it("23. emits UND320 when provider may omit a response field that consumer requires", () => {
      const consumer = createShapeObs("c1", "consumer", "GET", "/api/items", {
        responses: [
          {
            body: createObjectObservation([
              createField("sku", { kind: "primitive", name: "string" }, { presence: "required" })
            ]),
            source: []
          }
        ]
      });

      const provider = createShapeObs("p1", "provider", "GET", "/api/items", {
        responses: [
          {
            body: createObjectObservation([
              createField("sku", { kind: "primitive", name: "string" }, { presence: "optional" })
            ]),
            source: []
          }
        ]
      });

      const findings = evaluateShapeRules({ observations: [consumer, provider] });
      expect(findings).toHaveLength(1);

      const f = findings[0];
      expect(f.ruleId).toBe(SHAPE_RULE_IDS.UND320);
      expect(f.category).toBe("response-shape");
      expect(f.severity).toBe("warning");
      expect(f.title).toBe("Response optionality conflict");
      expect(f.expected).toBe("required");
      expect(f.observed).toBe("optional");
    });

    it("24. emits UND330 when provider may return null for a response field consumer disallows", () => {
      const consumer = createShapeObs("c1", "consumer", "GET", "/api/config", {
        responses: [
          {
            body: createObjectObservation([
              createField("version", { kind: "primitive", name: "string" }, { nullable: "no" })
            ]),
            source: []
          }
        ]
      });

      const provider = createShapeObs("p1", "provider", "GET", "/api/config", {
        responses: [
          {
            body: createObjectObservation([
              createField("version", { kind: "primitive", name: "string" }, { nullable: "yes" })
            ]),
            source: []
          }
        ]
      });

      const findings = evaluateShapeRules({ observations: [consumer, provider] });
      expect(findings).toHaveLength(1);

      const f = findings[0];
      expect(f.ruleId).toBe(SHAPE_RULE_IDS.UND330);
      expect(f.category).toBe("response-shape");
      expect(f.severity).toBe("warning");
      expect(f.title).toBe("Response nullability conflict");
      expect(f.expected).toBe("non-nullable");
      expect(f.observed).toBe("nullable");
    });

    it("25. null, undefined, and field absence remain distinguishable without conflation", () => {
      // Test field presence vs nullability
      const fieldRequiredNonNull = createField(
        "f",
        { kind: "primitive", name: "string" },
        { presence: "required", nullable: "no" }
      );
      const fieldRequiredNullable = createField(
        "f",
        { kind: "primitive", name: "string" },
        { presence: "required", nullable: "yes" }
      );
      const fieldOptionalNonNull = createField(
        "f",
        { kind: "primitive", name: "string" },
        { presence: "optional", nullable: "no" }
      );

      // Comparing optional non-null vs required nullable
      const diffs = compareShapes(
        createObjectObservation([fieldOptionalNonNull]),
        createObjectObservation([fieldRequiredNullable]),
        "response"
      );

      // Only optionality differs (provider optional, consumer required), NOT nullability (provider non-null, consumer nullable is allowed)
      expect(diffs).toHaveLength(1);
      expect(diffs[0].kind).toBe("optionality-conflict");
      expect(diffs[0].kind).not.toBe("nullability-conflict");
    });
  });

  // ==========================================================================
  // 4. Integration, Deduplication, and Stable Identity
  // ==========================================================================
  describe("4. Integration, Deduplication, and Stable Identity", () => {
    it("26. shape rules execute through RuleEngine coordinating protocol and shape findings", () => {
      // c1 and p1 have exact route and method, but request type mismatch (UND210)
      const c1 = createShapeObs("c1", "consumer", "POST", "/api/auth", {
        request: {
          body: createObjectObservation([
            createField("token", { kind: "primitive", name: "string" })
          ])
        }
      });
      const p1 = createShapeObs("p1", "provider", "POST", "/api/auth", {
        request: {
          body: createObjectObservation([
            createField("token", { kind: "primitive", name: "number" })
          ])
        }
      });

      // c2 is an unmatched consumer under complete backend scan (UND100)
      const c2 = createShapeObs("c2", "consumer", "GET", "/api/missing");

      const engine = new RuleEngine();
      const findings = engine.evaluate({
        observations: [c1, p1, c2],
        backendScanComplete: true
      });

      const ruleIds = findings.map((f) => f.ruleId);
      expect(ruleIds).toContain("UND210");
      expect(ruleIds).toContain("UND100");
    });

    it("27. protocol and limitation findings still appear when applicable alongside shape findings", () => {
      const c1 = createShapeObs("c1", "consumer", "POST", "/api/users", {
        request: {
          body: createObjectObservation([createField("age", { kind: "primitive", name: "string" })])
        }
      });
      const p1 = createShapeObs("p1", "provider", "POST", "/api/users", {
        request: {
          body: createObjectObservation([createField("age", { kind: "primitive", name: "number" })])
        }
      });

      const warning: AnalysisWarning = {
        code: "UNSUPPORTED_PATTERN",
        message: "Dynamic header skipped",
        affectsCompleteness: false
      };

      const findings = evaluateRules({
        observations: [c1, p1],
        warnings: [warning]
      });

      const ruleIds = findings.map((f) => f.ruleId);
      expect(ruleIds).toContain("UND210");
      expect(ruleIds).toContain("UND900");
    });

    it("28. shape rules do not produce findings for ineligible, method-conflict, or ambiguous relationships", () => {
      // Consumer and provider with method conflict (GET vs POST)
      const consumer = createShapeObs("c1", "consumer", "GET", "/api/users", {
        request: {
          body: createObjectObservation([createField("x", { kind: "primitive", name: "string" })])
        }
      });
      const provider = createShapeObs("p1", "provider", "POST", "/api/users", {
        request: {
          body: createObjectObservation([createField("x", { kind: "primitive", name: "number" })])
        }
      });

      const findings = evaluateShapeRules({ observations: [consumer, provider] });
      // Ineligible because relationship is method-conflict, not exact match
      expect(findings).toHaveLength(0);
    });

    it("29. multiple affected nested properties produce distinct findings with stable property paths", () => {
      const consumer = createShapeObs("c1", "consumer", "POST", "/api/nested", {
        request: {
          body: createObjectObservation([
            createField("user", {
              kind: "object",
              properties: [
                createField("id", { kind: "primitive", name: "string" }),
                createField("email", { kind: "primitive", name: "string" })
              ],
              additionalProperties: "unknown"
            })
          ])
        }
      });

      const provider = createShapeObs("p1", "provider", "POST", "/api/nested", {
        request: {
          body: createObjectObservation([
            createField("user", {
              kind: "object",
              properties: [
                createField("id", { kind: "primitive", name: "number" }),
                createField("email", { kind: "primitive", name: "number" })
              ],
              additionalProperties: "unknown"
            })
          ])
        }
      });

      const findings = evaluateShapeRules({ observations: [consumer, provider] });
      expect(findings).toHaveLength(2);

      const fId = findings.find((f) => f.explanation.includes("user.id"));
      const fEmail = findings.find((f) => f.explanation.includes("user.email"));

      expect(fId).toBeDefined();
      expect(fEmail).toBeDefined();
      expect(fId!.id).not.toBe(fEmail!.id);
    });

    it("30. finding IDs are stable across input ordering and source-position shifts", () => {
      const cLine10 = createShapeObs("c1", "consumer", "POST", "/api/profile", {
        line: 10,
        request: {
          body: createObjectObservation([createField("age", { kind: "primitive", name: "string" })])
        }
      });
      const cLine999 = createShapeObs("c1", "consumer", "POST", "/api/profile", {
        line: 999,
        request: {
          body: createObjectObservation([createField("age", { kind: "primitive", name: "string" })])
        }
      });
      const provider = createShapeObs("p1", "provider", "POST", "/api/profile", {
        request: {
          body: createObjectObservation([createField("age", { kind: "primitive", name: "number" })])
        }
      });

      const findings1 = evaluateShapeRules({ observations: [cLine10, provider] });
      const findings2 = evaluateShapeRules({ observations: [provider, cLine999] });

      expect(findings1[0].id).toBe(findings2[0].id);
    });

    it("31. trailing-slash metadata and relevant limitations remain preserved", () => {
      const routeWithSlash: RoutePattern = {
        segments: [
          { kind: "static", value: "api" },
          { kind: "static", value: "users" }
        ],
        trailingSlash: "present",
        queryHandling: "excluded-from-path",
        rawPath: "/api/users/"
      };

      const warning: AnalysisWarning = {
        code: "PARTIAL_SHAPE",
        message: "Some properties unextracted",
        affectsCompleteness: false
      };

      const consumer = createShapeObs("c1", "consumer", "POST", routeWithSlash, {
        limitations: [warning],
        request: {
          body: createObjectObservation([
            createField("name", { kind: "primitive", name: "string" })
          ])
        }
      });

      const provider = createShapeObs("p1", "provider", "POST", routeWithSlash, {
        request: {
          body: createObjectObservation([
            createField("name", { kind: "primitive", name: "number" })
          ])
        }
      });

      const findings = evaluateShapeRules({ observations: [consumer, provider] });
      expect(findings).toHaveLength(1);
      expect(findings[0].limitations).toHaveLength(1);
      expect(findings[0].limitations[0].code).toBe("PARTIAL_SHAPE");
    });

    it("32. repeated rule evaluation produces deterministic, deduplicated findings", () => {
      const consumer = createShapeObs("c1", "consumer", "POST", "/api/test", {
        request: {
          body: createObjectObservation([
            createField("flag", { kind: "primitive", name: "string" })
          ])
        }
      });
      const provider = createShapeObs("p1", "provider", "POST", "/api/test", {
        request: {
          body: createObjectObservation([
            createField("flag", { kind: "primitive", name: "boolean" })
          ])
        }
      });

      const run1 = evaluateShapeRules({ observations: [consumer, provider] });
      const run2 = evaluateShapeRules({ observations: [consumer, provider] });

      expect(run1.map((f) => f.id)).toEqual(run2.map((f) => f.id));
    });

    it("33. empty inputs behave safely and return empty array", () => {
      expect(evaluateShapeRules({ observations: [] })).toEqual([]);
      expect(evaluateShapeRules({ observations: [], relationships: [] })).toEqual([]);
      expect(new RuleEngine().evaluate({ observations: [] })).toEqual([]);
    });
  });
});
