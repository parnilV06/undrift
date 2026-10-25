// Local reference resolver for JavaScript and TypeScript source documents
// as specified in LLD.md Section 5.3, Section 7.6, and Section 8.4.
// Resolves local references to statically knowable constant declarations,
// distinguishing direct literals, resolved references, dynamic values, and deferred POC gates.

import type {
  DocumentUri,
  EvidenceRef,
  FieldShape,
  ObservedValue,
  PrimitiveTypeName,
  SemanticResolutionRequest,
  SemanticResolutionResult,
  SemanticResolverPort,
  SourceSpan,
  TextRange
} from "@undrift/core";
import { PositionMapper } from "@undrift/parser-tree-sitter";
import type {
  LocalDeclaration,
  LocalDeclarationIndex,
  LocalVariableDeclaration
} from "./local-declaration-index";

/**
 * Status of a local reference resolution attempt.
 */
export type LocalResolutionState = "resolved" | "ambiguous" | "unresolved" | "unsupported";

/**
 * Result of resolving a reference to a local declaration.
 */
export type LocalReferenceResult<T = string | number | boolean | null> =
  | {
      readonly state: "resolved";
      readonly value: T;
      readonly declaration: LocalDeclaration;
      readonly evidence: EvidenceRef[];
    }
  | {
      readonly state: "ambiguous";
      readonly reason: string;
      readonly candidates: LocalDeclaration[];
      readonly evidence: EvidenceRef[];
    }
  | {
      readonly state: "unresolved";
      readonly reason: string;
      readonly declaration?: LocalDeclaration;
      readonly evidence: EvidenceRef[];
    }
  | {
      readonly state: "unsupported";
      readonly reason: string;
      readonly declaration?: LocalDeclaration;
      readonly evidence: EvidenceRef[];
    };

/**
 * Resolver evaluating local identifier references against a LocalDeclarationIndex.
 * Implements SemanticResolverPort from LLD.md Section 5.3.
 */
export class LocalReferenceResolver implements SemanticResolverPort {
  readonly id = "local-reference-resolver";

  constructor(readonly index: LocalDeclarationIndex) {}

  /**
   * Resolves a local constant reference to its statically knowable literal value (string, number, boolean, null).
   * Complies with LLD Section 7.6 and Section 8.4.
   */
  resolveConstant<T = string | number | boolean | null>(
    referenceName: string,
    documentUri: DocumentUri,
    fromRange?: TextRange
  ): LocalReferenceResult<T> {
    const candidates = this.index.lookupSymbols(referenceName, documentUri);
    const localCandidates = candidates.filter((c) => c.documentUri === documentUri);

    // 1. Missing Reference
    if (localCandidates.length === 0) {
      if (candidates.length > 0) {
        // Symbol exists in another document -> cross-file reference
        return {
          state: "unsupported",
          reason: `Cross-file symbol resolution for '${referenceName}' is deferred (POC GATE)`,
          evidence: []
        };
      }

      return {
        state: "unresolved",
        reason: `Reference '${referenceName}' does not match any declaration in '${documentUri}'`,
        evidence: []
      };
    }

    // 2. Ambiguous Reference: Multiple declarations with the same name in the same file
    if (localCandidates.length > 1) {
      return {
        state: "ambiguous",
        reason: `Reference '${referenceName}' has ${localCandidates.length} conflicting declarations in '${documentUri}'`,
        candidates: localCandidates,
        evidence: []
      };
    }

    const decl = localCandidates[0];

    // Compute reference source span if fromRange is provided and document is cached
    let refSpan: SourceSpan | undefined;
    const doc = this.index.getDocument(documentUri);
    if (doc && fromRange) {
      const mapper = new PositionMapper(doc.text, doc.uri);
      refSpan = mapper.toSourceSpanFromUtf16(fromRange.start, fromRange.end, doc.uri);
    }

    const resolutionEvidence: EvidenceRef = {
      id: `ev-resolve-${referenceName}-${fromRange ? fromRange.start : decl.source.range.start}`,
      kind: "local-declaration",
      strength: "resolved",
      source: refSpan ?? decl.source,
      description: `Resolved reference '${referenceName}' to local declaration at ${decl.source.range.start}:${decl.source.range.end}`
    };

    // 3. Variable Declaration Evaluation
    if (decl.kind === "variable") {
      const varDecl = decl as LocalVariableDeclaration;

      // Mutable variable (let, var): cannot be statically verified without data-flow analysis
      if (varDecl.declarationType !== "const") {
        return {
          state: "unresolved",
          reason: `Reference '${referenceName}' is declared with mutable '${varDecl.declarationType}', which cannot be statically guaranteed constant`,
          declaration: decl,
          evidence: [resolutionEvidence, decl.evidence]
        };
      }

      // Const variable with literal value
      if (varDecl.literalValue !== undefined) {
        return {
          state: "resolved",
          value: varDecl.literalValue as T,
          declaration: decl,
          evidence: [resolutionEvidence, decl.evidence]
        };
      }

      // Const variable with dynamic initializer
      if (varDecl.initializerText) {
        return {
          state: "unresolved",
          reason: `Constant '${referenceName}' is initialized with dynamic expression '${varDecl.initializerText}'`,
          declaration: decl,
          evidence: [resolutionEvidence, decl.evidence]
        };
      }

      // Const variable without initializer
      return {
        state: "unresolved",
        reason: `Constant '${referenceName}' has no initializer`,
        declaration: decl,
        evidence: [resolutionEvidence, decl.evidence]
      };
    }

    // 4. Import Declaration: Cross-file import dereferencing is a documented POC GATE
    if (decl.kind === "import") {
      return {
        state: "unsupported",
        reason: `Cross-file import dereferencing for module '${decl.moduleSpecifier}' is deferred (POC GATE)`,
        declaration: decl,
        evidence: [resolutionEvidence, decl.evidence]
      };
    }

    // 5. Function Declaration
    if (decl.kind === "function") {
      return {
        state: "unsupported",
        reason: `Reference '${referenceName}' refers to a function declaration, not a static constant value`,
        declaration: decl,
        evidence: [resolutionEvidence, decl.evidence]
      };
    }

    // 6. Type or Interface Declaration
    if (decl.kind === "type-alias" || decl.kind === "interface") {
      return {
        state: "unsupported",
        reason: `Reference '${referenceName}' refers to a type declaration, not a static value`,
        declaration: decl,
        evidence: [resolutionEvidence, decl.evidence]
      };
    }

    // 7. Export Declaration
    return {
      state: "unsupported",
      reason: `Reference '${referenceName}' refers to an export declaration, not a local constant value`,
      declaration: decl,
      evidence: [resolutionEvidence, decl.evidence]
    };
  }

  /**
   * Resolves a local reference to an object literal declaration and its extracted fields.
   */
  resolveObjectLiteral(
    referenceName: string,
    documentUri: DocumentUri,
    fromRange?: TextRange
  ): LocalReferenceResult<readonly FieldShape[]> {
    const candidates = this.index.lookupSymbols(referenceName, documentUri);
    const localCandidates = candidates.filter((c) => c.documentUri === documentUri);

    if (localCandidates.length === 0) {
      if (candidates.length > 0) {
        return {
          state: "unsupported",
          reason: `Cross-file symbol resolution for '${referenceName}' is deferred (POC GATE)`,
          evidence: []
        };
      }
      return {
        state: "unresolved",
        reason: `Reference '${referenceName}' does not match any declaration in '${documentUri}'`,
        evidence: []
      };
    }

    if (localCandidates.length > 1) {
      return {
        state: "ambiguous",
        reason: `Reference '${referenceName}' has ${localCandidates.length} conflicting declarations in '${documentUri}'`,
        candidates: localCandidates,
        evidence: []
      };
    }

    const decl = localCandidates[0];
    let refSpan: SourceSpan | undefined;
    const doc = this.index.getDocument(documentUri);
    if (doc && fromRange) {
      const mapper = new PositionMapper(doc.text, doc.uri);
      refSpan = mapper.toSourceSpanFromUtf16(fromRange.start, fromRange.end, doc.uri);
    }

    const resolutionEvidence: EvidenceRef = {
      id: `ev-resolve-${referenceName}-${fromRange ? fromRange.start : decl.source.range.start}`,
      kind: "local-declaration",
      strength: "resolved",
      source: refSpan ?? decl.source,
      description: `Resolved reference '${referenceName}' to local declaration at ${decl.source.range.start}:${decl.source.range.end}`
    };

    if (decl.kind === "variable") {
      const varDecl = decl as LocalVariableDeclaration;
      if (varDecl.declarationType !== "const") {
        return {
          state: "unresolved",
          reason: `Reference '${referenceName}' is declared with mutable '${varDecl.declarationType}', which cannot be statically guaranteed constant`,
          declaration: decl,
          evidence: [resolutionEvidence, decl.evidence]
        };
      }

      if (varDecl.objectFields !== undefined) {
        return {
          state: "resolved",
          value: varDecl.objectFields,
          declaration: decl,
          evidence: [resolutionEvidence, decl.evidence]
        };
      }

      return {
        state: "unresolved",
        reason: `Constant '${referenceName}' was not initialized with a static object literal`,
        declaration: decl,
        evidence: [resolutionEvidence, decl.evidence]
      };
    }

    return {
      state: "unsupported",
      reason: `Reference '${referenceName}' refers to a ${decl.kind} declaration, not a local constant object`,
      declaration: decl,
      evidence: [resolutionEvidence, decl.evidence]
    };
  }

  /**
   * Resolves a reference and transforms the outcome into a canonical ObservedValue<T>.
   */
  resolveObservedConstant<T = string | number | boolean | null>(
    referenceName: string,
    documentUri: DocumentUri,
    fromRange?: TextRange
  ): ObservedValue<T> {
    const result = this.resolveConstant<T>(referenceName, documentUri, fromRange);

    if (result.state === "resolved") {
      return {
        state: "known",
        value: result.value,
        strength: "resolved",
        evidence: result.evidence
      };
    }

    if (result.state === "unsupported") {
      return {
        state: "dynamic",
        expression: referenceName,
        reason: result.reason,
        evidence: result.evidence
      };
    }

    return {
      state: "unknown",
      reason: result.reason,
      evidence: result.evidence
    };
  }

  /**
   * Resolves a type reference according to SemanticResolverPort from LLD.md Section 5.3.
   */
  async resolveType(
    request: SemanticResolutionRequest,
    signal?: AbortSignal
  ): Promise<SemanticResolutionResult> {
    signal?.throwIfAborted();

    const candidates = this.index.lookupSymbols(request.referenceName, request.document.uri);
    const localCandidates = candidates.filter((c) => c.documentUri === request.document.uri);

    if (localCandidates.length === 0) {
      return {
        state: "unresolved",
        reason: `Type '${request.referenceName}' not found in local declarations for '${request.document.uri}'`,
        evidence: []
      };
    }

    if (localCandidates.length > 1) {
      return {
        state: "ambiguous",
        reason: `Type '${request.referenceName}' has ${localCandidates.length} conflicting declarations in '${request.document.uri}'`,
        evidence: []
      };
    }

    const decl = localCandidates[0];

    if (decl.kind === "interface") {
      return {
        state: "resolved",
        shape: {
          kind: "reference",
          displayName: decl.name,
          resolution: "resolved",
          targetId: decl.name
        },
        declaration: decl.source,
        evidence: [decl.evidence]
      };
    }

    if (decl.kind === "type-alias") {
      const typeText = decl.typeText?.trim();
      if (
        typeText === "string" ||
        typeText === "number" ||
        typeText === "boolean" ||
        typeText === "null"
      ) {
        return {
          state: "resolved",
          shape: {
            kind: "primitive",
            name: typeText === "null" ? "null" : (typeText as PrimitiveTypeName)
          },
          declaration: decl.source,
          evidence: [decl.evidence]
        };
      }

      return {
        state: "resolved",
        shape: {
          kind: "reference",
          displayName: decl.name,
          resolution: "resolved"
        },
        declaration: decl.source,
        evidence: [decl.evidence]
      };
    }

    return {
      state: "unsupported",
      reason: `Symbol '${request.referenceName}' is a ${decl.kind} declaration, not a type or interface`,
      evidence: [decl.evidence]
    };
  }
}

/**
 * Helper function to create a LocalReferenceResolver from an existing LocalDeclarationIndex.
 */
export function createLocalReferenceResolver(index: LocalDeclarationIndex): LocalReferenceResolver {
  return new LocalReferenceResolver(index);
}
