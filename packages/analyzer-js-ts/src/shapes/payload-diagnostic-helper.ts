// Unified payload limitation diagnostic classifier as specified in Phase 6.3 Task 5.
// Classifies the exact static analysis reason why a request payload cannot be fully inferred.

import type {
  AnalysisWarning,
  DocumentUri,
  ParsedDocument,
  PartialShapeReasonCode,
  SourceSpan,
  SyntaxNode
} from "@undrift/core";
import type { PositionMapper } from "@undrift/parser-tree-sitter";
import {
  findEnclosingParameter,
  analyzeWrapperCallsites,
  type FormDataAnalysisResult,
  type WrapperCallsitesResult,
  type ShapeFieldResolver
} from "./shape-extractor";
import { findEnclosingFunction } from "../frontend/route-helper-resolver";

export interface PayloadLimitationAnalysis {
  readonly reasonCode: PartialShapeReasonCode;
  readonly message: string;
  readonly evidenceDescription: string;
  readonly evidenceReason: "dynamic-expression" | "unresolved-reference" | "unsupported-syntax";
}

export interface PayloadLimitationOptions {
  readonly isMultipart: boolean;
  readonly formDataAnalysis?: FormDataAnalysisResult;
  readonly parsed?: ParsedDocument;
  readonly documentUri: DocumentUri;
  readonly mapper: PositionMapper;
  readonly resolver?: ShapeFieldResolver;
  readonly wrapperCallsites?: WrapperCallsitesResult;
}

/**
 * Classifies an unresolvable payload node into an evidence-backed reason code and message.
 */
export function classifyPayloadLimitation(
  payloadNode: SyntaxNode,
  options: PayloadLimitationOptions
): PayloadLimitationAnalysis {
  // 1. Multipart FormData cases
  if (options.isMultipart) {
    const formAnalysis = options.formDataAnalysis;
    if (formAnalysis && formAnalysis.fields.length > 0 && formAnalysis.hasDynamicAppends) {
      const fieldList = formAnalysis.fields.map((f) => `'${f.name}'`).join(", ");
      return {
        reasonCode: "multipart-partial-field-evidence",
        message: `Multipart form data has ${formAnalysis.fields.length} statically discovered field(s) (${fieldList}), but contains dynamic append operations that cannot be fully evaluated.`,
        evidenceDescription: `Multipart form data with partially dynamic append operations`,
        evidenceReason: "dynamic-expression"
      };
    }

    if (
      formAnalysis &&
      formAnalysis.fields.length === 0 &&
      !formAnalysis.hasAppends &&
      !formAnalysis.hasConstruction
    ) {
      return {
        reasonCode: "multipart-no-construction-evidence",
        message: `Multipart form data payload cannot be fully statically inferred: ${payloadNode.text()}. Parameter is forwarded without discoverable FormData construction or append/set operations in the analyzed source scope.`,
        evidenceDescription: `Multipart form data parameter without discoverable construction or operations`,
        evidenceReason: "dynamic-expression"
      };
    }

    if (formAnalysis && formAnalysis.fields.length === 0 && formAnalysis.hasDynamicAppends) {
      return {
        reasonCode: "multipart-partial-field-evidence",
        message: `Multipart form data payload cannot be fully statically inferred: ${payloadNode.text()}. Append operations use dynamic or non-literal field names.`,
        evidenceDescription: `Multipart form data with dynamic append operations`,
        evidenceReason: "dynamic-expression"
      };
    }

    return {
      reasonCode: "multipart-no-construction-evidence",
      message: `Multipart form data payload cannot be fully statically inferred: ${payloadNode.text()}. Parameter is forwarded without discoverable FormData construction or append/set operations in the analyzed source scope.`,
      evidenceDescription: `Multipart form data payload in API call: ${payloadNode.text()}`,
      evidenceReason: "dynamic-expression"
    };
  }

  // 2. Identifier payload node
  if (payloadNode.kind === "identifier") {
    const identName = payloadNode.text();
    const paramInfo = findEnclosingParameter(payloadNode, identName);

    if (paramInfo) {
      // 2a. Explicit TypeScript type annotation check
      if (paramInfo.innerTypeNode) {
        const typeText = paramInfo.innerTypeNode.text().trim();
        const typeKind = paramInfo.innerTypeNode.kind;

        if (typeText === "unknown" || typeText === "any") {
          return {
            reasonCode: "explicit-unknown-type",
            message: `Request payload parameter '${identName}' is explicitly typed as '${typeText}'. No statically usable object shape is available at this request site.`,
            evidenceDescription: `Request payload parameter '${identName}' has explicit '${typeText}' type annotation`,
            evidenceReason: "unresolved-reference"
          };
        }

        if (typeKind === "type_identifier") {
          return {
            reasonCode: "unresolved-reference",
            message: `Request payload parameter '${identName}' has type '${typeText}', which cannot be resolved to a local declaration in the analyzed scope.`,
            evidenceDescription: `Unresolved type annotation '${typeText}' for payload parameter '${identName}'`,
            evidenceReason: "unresolved-reference"
          };
        }
      }

      // 2b. Unannotated parameter check (plain JS or untyped TS)
      const enclosingFn = options.parsed
        ? findEnclosingFunction(payloadNode, options.parsed.root)
        : undefined;

      if (enclosingFn?.isExported) {
        return {
          reasonCode: "unannotated-parameter",
          message: `Payload parameter '${identName}' is forwarded into this exported API function. Its object shape is not declared locally, and cross-module caller data is not included in the current shape inference scope.`,
          evidenceDescription: `Unannotated payload parameter '${identName}' in exported API function`,
          evidenceReason: "unresolved-reference"
        };
      }

      // Unexported helper function: check same-file callsites
      let callsites = options.wrapperCallsites;
      if (!callsites && options.parsed && enclosingFn?.fnName) {
        callsites = analyzeWrapperCallsites(
          options.parsed.root,
          enclosingFn.fnName,
          paramInfo.paramIndex,
          options.documentUri,
          options.mapper,
          options.resolver
        );
      }

      if (callsites?.foundCallsites) {
        return {
          reasonCode: "cross-module-forwarding",
          message: `Payload parameter '${identName}' is forwarded from outer function callers. Its object shape is constructed upstream across modules and cannot be inferred within the local file scope.`,
          evidenceDescription: `Payload parameter '${identName}' forwarded across local helper callsites`,
          evidenceReason: "unresolved-reference"
        };
      }

      return {
        reasonCode: "no-caller-evidence",
        message: `Payload parameter '${identName}' is received by a helper function without same-file caller evidence. Its object shape cannot be statically determined.`,
        evidenceDescription: `Payload parameter '${identName}' in helper without same-file callsites`,
        evidenceReason: "unresolved-reference"
      };
    }

    // Not a formal parameter of an enclosing function: unresolved local variable or imported reference
    return {
      reasonCode: "unresolved-reference",
      message: `Payload identifier '${identName}' cannot be resolved to a local declaration or object literal in the analyzed scope.`,
      evidenceDescription: `Unresolved payload identifier '${identName}'`,
      evidenceReason: "unresolved-reference"
    };
  }

  // 3. Non-identifier expressions
  if (payloadNode.kind === "object") {
    return {
      reasonCode: "dynamic-property",
      message: `Payload object contains dynamic or computed properties that cannot be statically evaluated: ${payloadNode.text()}`,
      evidenceDescription: `Dynamic or computed property in payload object`,
      evidenceReason: "dynamic-expression"
    };
  }

  return {
    reasonCode: "unsupported-expression",
    message: `Non-literal payload expression in request body cannot be statically resolved: ${payloadNode.text()}`,
    evidenceDescription: `Unsupported payload expression in request body`,
    evidenceReason: "unsupported-syntax"
  };
}

/**
 * Creates an AnalysisWarning with code PARTIAL_SHAPE and the evidence-backed reason metadata.
 */
export function createPayloadWarning(
  analysis: PayloadLimitationAnalysis,
  sourceSpan?: SourceSpan
): AnalysisWarning {
  return {
    code: "PARTIAL_SHAPE",
    message: analysis.message,
    source: sourceSpan,
    analyzerId: "analyzer-js-ts",
    scope: "consumer",
    targetDimension: "request-shape",
    affectsCompleteness: false,
    reasonCode: analysis.reasonCode
  };
}
