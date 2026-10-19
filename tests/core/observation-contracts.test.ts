// Phase 2, Chunk 2.1: API Observation Domain Contracts Unit Tests.
// Verifies structural integrity, discriminated union exhaustiveness,
// and state distinction for route models, type shapes, and API observations.

import { describe, expect, it } from "vitest";
import type {
  ApiObservation,
  CompletenessStatus,
  EndpointObservation,
  EvidenceRef,
  FieldShape,
  HttpMethod,
  ObservationRole,
  ObservedValue,
  PrimitiveTypeName,
  RequestShapeObservation,
  ResponseShapeObservation,
  RoutePattern,
  RouteSegment,
  ShapeObservation,
  SourceSnapshotRef,
  SourceSpan,
  TypeShape
} from "../../packages/core/src/index";

describe("API Observation Domain Contracts (Chunk 2.1)", () => {
  const dummySpan: SourceSpan = {
    uri: "file:///workspace/src/api.ts",
    range: { start: 10, end: 50 },
    start: { line: 1, character: 10 },
    end: { line: 1, character: 50 }
  };

  const dummySnapshot: SourceSnapshotRef = {
    uri: "file:///workspace/src/api.ts",
    contentHash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    documentVersion: 3
  };

  const dummyEvidence: EvidenceRef = {
    id: "ev-1",
    kind: "literal-syntax",
    strength: "direct",
    source: dummySpan,
    description: "Extracted literal path '/users/:id'"
  };

  describe("1. Route Model (LLD Section 4.5)", () => {
    it("discriminates static, parameter, wildcard, and unresolved route segments", () => {
      const staticSeg: RouteSegment = { kind: "static", value: "api" };
      const paramSeg: RouteSegment = { kind: "parameter", name: "userId" };
      const anonParamSeg: RouteSegment = { kind: "parameter" };
      const wildcardSeg: RouteSegment = { kind: "wildcard", name: "rest" };
      const anonWildcardSeg: RouteSegment = { kind: "wildcard" };
      const unresolvedSeg: RouteSegment = { kind: "unresolved", sourceText: "BASE_URL + '/items'" };

      const segments: RouteSegment[] = [
        staticSeg,
        paramSeg,
        anonParamSeg,
        wildcardSeg,
        anonWildcardSeg,
        unresolvedSeg
      ];

      expect(segments).toHaveLength(6);
      expect(segments[0].kind).toBe("static");
      expect(segments[1].kind).toBe("parameter");
      expect(segments[2].kind).toBe("parameter");
      expect(segments[3].kind).toBe("wildcard");
      expect(segments[4].kind).toBe("wildcard");
      expect(segments[5].kind).toBe("unresolved");
    });

    it("constructs a valid RoutePattern preserving trailing slash and query handling metadata", () => {
      const pattern: RoutePattern = {
        segments: [
          { kind: "static", value: "users" },
          { kind: "parameter", name: "id" }
        ],
        trailingSlash: "absent",
        queryHandling: "excluded-from-path",
        rawPath: "/users/:id"
      };

      expect(pattern.segments).toHaveLength(2);
      expect(pattern.trailingSlash).toBe("absent");
      expect(pattern.queryHandling).toBe("excluded-from-path");
      expect(pattern.rawPath).toBe("/users/:id");
    });
  });

  describe("2. Type and Shape Model (LLD Section 4.6)", () => {
    it("supports all documented PrimitiveTypeName values", () => {
      const primitiveNames: PrimitiveTypeName[] = [
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
      ];

      for (const name of primitiveNames) {
        const shape: TypeShape = { kind: "primitive", name };
        expect(shape.kind).toBe("primitive");
        if (shape.kind === "primitive") {
          expect(shape.name).toBe(name);
        }
      }
    });

    it("constructs literal, array, object, union, reference, and unknown TypeShape variants", () => {
      // Literal
      const stringLit: TypeShape = { kind: "literal", value: "active" };
      const numberLit: TypeShape = { kind: "literal", value: 42 };
      const boolLit: TypeShape = { kind: "literal", value: true };
      const nullLit: TypeShape = { kind: "literal", value: null };

      // Array
      const arrayShape: TypeShape = {
        kind: "array",
        element: { kind: "primitive", name: "string" }
      };

      // Object with fields
      const objectShape: TypeShape = {
        kind: "object",
        properties: [
          {
            name: "id",
            type: { kind: "primitive", name: "string" },
            presence: "required",
            nullable: "no",
            evidence: [dummyEvidence]
          },
          {
            name: "nickname",
            type: { kind: "primitive", name: "string" },
            presence: "optional",
            nullable: "yes",
            evidence: []
          }
        ],
        additionalProperties: "forbidden"
      };

      // Union
      const unionShape: TypeShape = {
        kind: "union",
        members: [stringLit, numberLit]
      };

      // Reference (resolved and unresolved)
      const resolvedRef: TypeShape = {
        kind: "reference",
        displayName: "UserDto",
        resolution: "resolved",
        targetId: "model-1",
        resolvedShape: objectShape
      };

      const unresolvedRef: TypeShape = {
        kind: "reference",
        displayName: "ExternalType",
        resolution: "unresolved"
      };

      // Unknown with distinct reasons
      const unknownShapes: TypeShape[] = [
        { kind: "unknown", reason: "dynamic-expression" },
        { kind: "unknown", reason: "unsupported-syntax" },
        { kind: "unknown", reason: "unresolved-reference" },
        { kind: "unknown", reason: "incomplete-source" },
        { kind: "unknown", reason: "complex-type" },
        { kind: "unknown", reason: "not-observed" }
      ];

      expect(stringLit.kind).toBe("literal");
      expect(numberLit.kind).toBe("literal");
      expect(boolLit.kind).toBe("literal");
      expect(nullLit.kind).toBe("literal");
      expect(arrayShape.kind).toBe("array");
      expect(objectShape.kind).toBe("object");
      expect(unionShape.kind).toBe("union");
      expect(resolvedRef.kind).toBe("reference");
      expect(unresolvedRef.kind).toBe("reference");
      expect(unknownShapes).toHaveLength(6);
    });

    it("clearly distinguishes field presence (required vs optional) from type nullability", () => {
      // Required and non-nullable
      const field1: FieldShape = {
        name: "id",
        type: { kind: "primitive", name: "string" },
        presence: "required",
        nullable: "no",
        evidence: [dummyEvidence]
      };

      // Required but nullable (e.g. { middleName: string | null })
      const field2: FieldShape = {
        name: "middleName",
        type: { kind: "primitive", name: "string" },
        presence: "required",
        nullable: "yes",
        evidence: []
      };

      // Optional and non-nullable (e.g. { age?: number })
      const field3: FieldShape = {
        name: "age",
        type: { kind: "primitive", name: "number" },
        presence: "optional",
        nullable: "no",
        evidence: []
      };

      expect(field1.presence).toBe("required");
      expect(field1.nullable).toBe("no");
      expect(field2.presence).toBe("required");
      expect(field2.nullable).toBe("yes");
      expect(field3.presence).toBe("optional");
      expect(field3.nullable).toBe("no");
    });

    it("captures shape observation with extraction completeness", () => {
      const statuses: CompletenessStatus[] = ["complete", "partial", "unknown"];

      for (const status of statuses) {
        const observation: ShapeObservation = {
          shape: { kind: "primitive", name: "string" },
          completeness: status,
          evidence: [dummyEvidence]
        };

        expect(observation.completeness).toBe(status);
        expect(observation.evidence).toHaveLength(1);
      }
    });
  });

  describe("3. Request and Response Observations (LLD Section 4.7)", () => {
    it("constructs structured request shape observations for path, query, headers, and body", () => {
      const req: RequestShapeObservation = {
        pathParams: {
          shape: {
            kind: "object",
            properties: [
              {
                name: "id",
                type: { kind: "primitive", name: "string" },
                presence: "required",
                nullable: "no",
                evidence: []
              }
            ],
            additionalProperties: "forbidden"
          },
          completeness: "complete",
          evidence: [dummyEvidence]
        },
        queryParams: {
          shape: {
            kind: "object",
            properties: [
              {
                name: "page",
                type: { kind: "primitive", name: "number" },
                presence: "optional",
                nullable: "no",
                evidence: []
              }
            ],
            additionalProperties: "unknown"
          },
          completeness: "partial",
          evidence: []
        },
        body: {
          shape: {
            kind: "object",
            properties: [],
            additionalProperties: "allowed"
          },
          completeness: "unknown",
          evidence: []
        }
      };

      expect(req.pathParams?.completeness).toBe("complete");
      expect(req.queryParams?.completeness).toBe("partial");
      expect(req.body?.completeness).toBe("unknown");
      expect(req.headers).toBeUndefined();
    });

    it("constructs response shape observations with observed status codes", () => {
      const resp200: ResponseShapeObservation = {
        statusCode: {
          state: "known",
          value: 200,
          evidence: dummyEvidence
        },
        body: {
          shape: {
            kind: "object",
            properties: [
              {
                name: "success",
                type: { kind: "primitive", name: "boolean" },
                presence: "required",
                nullable: "no",
                evidence: []
              }
            ],
            additionalProperties: "forbidden"
          },
          completeness: "complete",
          evidence: [dummyEvidence]
        },
        source: [dummySpan]
      };

      const respDynamic: ResponseShapeObservation = {
        statusCode: {
          state: "dynamic",
          expression: "res.statusCode",
          evidence: dummyEvidence
        },
        source: [dummySpan]
      };

      expect(resp200.statusCode?.state).toBe("known");
      if (resp200.statusCode?.state === "known") {
        expect(resp200.statusCode.value).toBe(200);
      }
      expect(respDynamic.statusCode?.state).toBe("dynamic");
      expect(resp200.source).toHaveLength(1);
    });

    it("constructs complete EndpointObservation combining method, route pattern, and shapes", () => {
      const endpoint: EndpointObservation = {
        method: {
          state: "known",
          value: "POST",
          evidence: dummyEvidence
        },
        path: {
          state: "known",
          value: {
            segments: [
              { kind: "static", value: "api" },
              { kind: "static", value: "v1" },
              { kind: "static", value: "users" }
            ],
            trailingSlash: "absent",
            queryHandling: "excluded-from-path",
            rawPath: "/api/v1/users"
          },
          evidence: dummyEvidence
        },
        request: {
          body: {
            shape: {
              kind: "object",
              properties: [
                {
                  name: "email",
                  type: { kind: "primitive", name: "string" },
                  presence: "required",
                  nullable: "no",
                  evidence: []
                }
              ],
              additionalProperties: "forbidden"
            },
            completeness: "complete",
            evidence: [dummyEvidence]
          }
        },
        responses: [
          {
            statusCode: {
              state: "known",
              value: 201,
              evidence: dummyEvidence
            },
            source: [dummySpan]
          }
        ]
      };

      expect(endpoint.method.state).toBe("known");
      if (endpoint.method.state === "known") {
        expect(endpoint.method.value).toBe<HttpMethod>("POST");
      }
      expect(endpoint.path.state).toBe("known");
      expect(endpoint.request?.body).toBeDefined();
      expect(endpoint.responses).toHaveLength(1);
    });
  });

  describe("4. API Observation Contract (LLD Section 4.8)", () => {
    it("constructs consumer and provider ApiObservations preserving provenance and limitations", () => {
      const consumerRole: ObservationRole = "consumer";
      const providerRole: ObservationRole = "provider";

      const consumerObs: ApiObservation = {
        id: "obs-consumer-1",
        role: consumerRole,
        languageId: "typescript",
        framework: "axios",
        extractorId: "extractor-axios-client",
        source: [dummySpan],
        snapshot: dummySnapshot,
        endpoint: {
          method: { state: "known", value: "GET", evidence: dummyEvidence },
          path: {
            state: "known",
            value: {
              segments: [
                { kind: "static", value: "api" },
                { kind: "static", value: "users" }
              ],
              trailingSlash: "absent",
              queryHandling: "excluded-from-path",
              rawPath: "/api/users"
            },
            evidence: dummyEvidence
          }
        },
        limitations: []
      };

      const providerObs: ApiObservation = {
        id: "obs-provider-1",
        role: providerRole,
        languageId: "typescript",
        framework: "express",
        extractorId: "extractor-express-route",
        source: [dummySpan],
        snapshot: dummySnapshot,
        endpoint: {
          method: { state: "known", value: "GET", evidence: dummyEvidence },
          path: {
            state: "known",
            value: {
              segments: [
                { kind: "static", value: "api" },
                { kind: "static", value: "users" }
              ],
              trailingSlash: "absent",
              queryHandling: "excluded-from-path",
              rawPath: "/api/users"
            },
            evidence: dummyEvidence
          }
        },
        limitations: [
          {
            code: "UNRESOLVED_REFERENCE",
            message: "Response shape depends on unresolvable external type 'ExternalResponse'",
            source: dummySpan,
            analyzerId: "extractor-express-route",
            affectsCompleteness: true
          }
        ]
      };

      expect(consumerObs.role).toBe("consumer");
      expect(consumerObs.extractorId).toBe("extractor-axios-client");
      expect(consumerObs.limitations).toHaveLength(0);

      expect(providerObs.role).toBe("provider");
      expect(providerObs.extractorId).toBe("extractor-express-route");
      expect(providerObs.limitations).toHaveLength(1);
      expect(providerObs.limitations[0].code).toBe("UNRESOLVED_REFERENCE");
      expect(providerObs.limitations[0].affectsCompleteness).toBe(true);
    });

    it("correctly models unknown method and unresolved dynamic route expressions", () => {
      const dynamicObs: ApiObservation = {
        id: "obs-dynamic-1",
        role: "consumer",
        languageId: "javascript",
        extractorId: "extractor-fetch",
        source: [dummySpan],
        snapshot: dummySnapshot,
        endpoint: {
          method: {
            state: "unknown",
            reason: "Non-literal method expression",
            evidence: dummyEvidence
          },
          path: {
            state: "dynamic",
            expression: "config.apiBase + '/items/' + itemId",
            evidence: dummyEvidence
          }
        },
        limitations: [
          {
            code: "DYNAMIC_ROUTE",
            message: "Fetch target URL is computed from dynamic variables",
            source: dummySpan,
            affectsCompleteness: true
          }
        ]
      };

      expect(dynamicObs.endpoint.method.state).toBe("unknown");
      expect(dynamicObs.endpoint.path.state).toBe("dynamic");
      expect(dynamicObs.limitations).toHaveLength(1);
      expect(dynamicObs.limitations[0].code).toBe("DYNAMIC_ROUTE");
    });
  });
});
