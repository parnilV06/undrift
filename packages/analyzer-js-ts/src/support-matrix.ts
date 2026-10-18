// Support matrix definitions and pattern catalog for JavaScript/TypeScript analyzers
// as specified in LLD.md Section 7.2, Section 7.3, and Section 7.7.

/**
 * Role of the source component in the API integration contract.
 */
export type PatternRole = "consumer" | "provider";

/**
 * Current implementation and verification status of a pattern in the support matrix.
 * Distinguishes planned target patterns from implemented and verified patterns.
 */
export type PatternTestStatus = "planned" | "implemented" | "tested";

/**
 * Kind of evidence resolution associated with the pattern extraction.
 */
export type PatternEvidenceKind = "direct" | "resolved";

/**
 * Documented pattern in the UNDRIFT support matrix as specified in LLD.md Section 7.7.
 */
export interface SupportMatrixEntry {
  /** Unique stable pattern identifier. */
  readonly patternId: string;
  /** Role in the contract: consumer (frontend client call) or provider (backend route). */
  readonly sourceRole: PatternRole;
  /** Supported language ID (e.g. 'javascript', 'typescript'). */
  readonly supportedLanguage: string;
  /** Supported framework or library (e.g. 'fetch', 'axios', 'express'). */
  readonly supportedFramework: string;
  /** Representative code examples or fixture identifiers illustrating the pattern. */
  readonly examples: readonly string[];
  /** Contract fields reliably extracted from this pattern (e.g. ['method', 'path']). */
  readonly fieldsReliablyExtracted: readonly string[];
  /** Explicit extraction limitations or unsupported edge cases for this pattern. */
  readonly knownLimitations: readonly string[];
  /** Whether evidence extracted from this pattern is direct syntax or resolved cross-file. */
  readonly evidenceKind: PatternEvidenceKind;
  /** Current implementation and test status. */
  readonly testStatus: PatternTestStatus;
}

/**
 * Master catalog of planned and implemented patterns for the JavaScript/TypeScript ecosystem
 * as documented in LLD.md Section 7.2, Section 7.3, and Section 7.7.
 *
 * NOTE: As of Chunk 2.6, standard fetch, axios, and express route patterns are implemented and tested.
 */
export const SUPPORT_MATRIX: readonly SupportMatrixEntry[] = [
  {
    patternId: "fetch-standard-call",
    sourceRole: "consumer",
    supportedLanguage: "javascript",
    supportedFramework: "fetch",
    examples: [
      'fetch("/api/users")',
      'fetch("/api/users", { method: "POST", body: JSON.stringify(payload) })'
    ],
    fieldsReliablyExtracted: ["method", "path"],
    knownLimitations: [
      "Dynamic URL expressions without string literals or resolvable local constants are marked unresolved",
      "Wrapper function aliases require explicit support",
      "Request body shape extraction limited to direct JSON.stringify of object literals"
    ],
    evidenceKind: "direct",
    testStatus: "tested"
  },
  {
    patternId: "fetch-standard-call-ts",
    sourceRole: "consumer",
    supportedLanguage: "typescript",
    supportedFramework: "fetch",
    examples: ['fetch("/api/users")', 'fetch("/api/users", { method: "GET" })'],
    fieldsReliablyExtracted: ["method", "path"],
    knownLimitations: [
      "Generic type parameters on custom fetch wrappers require local declaration resolution",
      "Dynamic method options expressions marked unresolved"
    ],
    evidenceKind: "direct",
    testStatus: "tested"
  },
  {
    patternId: "axios-method-call",
    sourceRole: "consumer",
    supportedLanguage: "javascript",
    supportedFramework: "axios",
    examples: ['axios.get("/api/users")', 'axios.post("/api/users", payload)'],
    fieldsReliablyExtracted: ["method", "path"],
    knownLimitations: [
      "Dynamic URL expressions without string literals or resolvable local constants are marked unresolved",
      "Custom axios instance creators require import evidence",
      "Dynamic HTTP method dispatch marked unresolved",
      "Config object base URLs require project index resolution"
    ],
    evidenceKind: "direct",
    testStatus: "tested"
  },
  {
    patternId: "axios-method-call-ts",
    sourceRole: "consumer",
    supportedLanguage: "typescript",
    supportedFramework: "axios",
    examples: ['axios.get<User[]>("/api/users")', 'api.get<User>("/api/users/:id")'],
    fieldsReliablyExtracted: ["method", "path", "responseType"],
    knownLimitations: [
      "Custom generic client wrappers require declaration indexing",
      "Complex type arguments with mapped or conditional types marked partial"
    ],
    evidenceKind: "direct",
    testStatus: "tested"
  },
  {
    patternId: "express-route-declaration",
    sourceRole: "provider",
    supportedLanguage: "javascript",
    supportedFramework: "express",
    examples: [
      'app.get("/api/users", handler)',
      'router.post("/api/users", handler)',
      'app.patch("/api/users/:id", handler)'
    ],
    fieldsReliablyExtracted: ["method", "path"],
    knownLimitations: [
      "Router mount prefixes (app.use('/api', router)) require cross-file resolution",
      "Regex routes or array path declarations marked unsupported",
      "Dynamic route definitions through loops or factories marked unresolved"
    ],
    evidenceKind: "direct",
    testStatus: "tested"
  },
  {
    patternId: "express-route-declaration-ts",
    sourceRole: "provider",
    supportedLanguage: "typescript",
    supportedFramework: "express",
    examples: [
      'app.get("/api/users", (req: Request, res: Response) => res.json(users))',
      'router.post("/api/users", handler)'
    ],
    fieldsReliablyExtracted: ["method", "path"],
    knownLimitations: [
      "TypeScript typed request/response generic handlers require type extractor",
      "Imported router instances require project index resolution"
    ],
    evidenceKind: "direct",
    testStatus: "tested"
  }
];

/**
 * Returns the entire support matrix.
 */
export function getSupportMatrix(): readonly SupportMatrixEntry[] {
  return SUPPORT_MATRIX;
}

/**
 * Queries the support matrix for patterns matching the specified framework.
 */
export function getPatternsByFramework(framework: string): readonly SupportMatrixEntry[] {
  const normalized = framework.toLowerCase().trim();
  return SUPPORT_MATRIX.filter((entry) => entry.supportedFramework.toLowerCase() === normalized);
}

/**
 * Queries the support matrix for patterns matching the specified role ('consumer' or 'provider').
 */
export function getPatternsByRole(role: PatternRole): readonly SupportMatrixEntry[] {
  return SUPPORT_MATRIX.filter((entry) => entry.sourceRole === role);
}

/**
 * Returns all currently implemented and verified patterns in the matrix.
 * At Chunk 2.3, returns an empty array as extraction implementations begin in Chunk 2.4.
 */
export function getImplementedPatterns(): readonly SupportMatrixEntry[] {
  return SUPPORT_MATRIX.filter(
    (entry) => entry.testStatus === "implemented" || entry.testStatus === "tested"
  );
}

/**
 * Returns all planned patterns in the matrix that have not yet been implemented.
 */
export function getPlannedPatterns(): readonly SupportMatrixEntry[] {
  return SUPPORT_MATRIX.filter((entry) => entry.testStatus === "planned");
}
