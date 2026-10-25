// JavaScript and TypeScript language analyzer coordinating sub-extractors
// as specified in LLD.md Section 7.1 and Section 5.2.

import type {
  AnalyzerInput,
  AnalyzerOutput,
  DocumentUri,
  LanguageAnalyzerPort
} from "@undrift/core";
import { extractFetchObservations } from "../frontend/fetch-extractor";
import { extractAxiosObservations } from "../frontend/axios-extractor";
import { extractExpressObservations } from "../backend/express-extractor";
import { extractNextJsObservations } from "../backend/nextjs-extractor";
import {
  LocalDeclarationIndex,
  isLocalDeclarationIndex,
  createLocalDeclarationIndex
} from "../project-index/local-declaration-index";
import {
  LocalReferenceResolver,
  createLocalReferenceResolver
} from "../project-index/local-reference-resolver";
import { ExpressMountRegistry } from "../backend/express-mount-resolver";

const SUPPORTED_LANGUAGES = new Set([
  "javascript",
  "javascriptreact",
  "typescript",
  "typescriptreact",
  "jsx",
  "ts",
  "tsx"
]);

const SUPPORTED_EXTENSIONS = [".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx"];

/**
 * Concrete LanguageAnalyzerPort for JavaScript and TypeScript source documents
 * as specified in LLD.md Section 7.1. Coordinates frontend and backend sub-extractors.
 */
export class JsTsAnalyzer implements LanguageAnalyzerPort {
  readonly id = "analyzer-js-ts";

  constructor(
    private readonly resolver?: LocalReferenceResolver,
    private readonly mountRegistry?: ExpressMountRegistry
  ) {}

  /**
   * Determines if this analyzer supports the given language and document URI.
   */
  supports(languageId: string, uri: DocumentUri): boolean {
    const lowerUri = uri.toLowerCase();
    if (lowerUri.endsWith(".d.ts") || lowerUri.endsWith(".d.cts") || lowerUri.endsWith(".d.mts")) {
      return false;
    }
    if (SUPPORTED_LANGUAGES.has(languageId.toLowerCase())) {
      return true;
    }
    return SUPPORTED_EXTENSIONS.some((ext) => lowerUri.endsWith(ext));
  }

  /**
   * Analyzes the supplied parsed document and returns extracted API observations and warnings.
   */
  async analyze(input: AnalyzerInput, signal?: AbortSignal): Promise<AnalyzerOutput> {
    signal?.throwIfAborted();

    let resolver = this.resolver;
    if (!resolver && input.projectIndex) {
      if (isLocalDeclarationIndex(input.projectIndex)) {
        resolver = createLocalReferenceResolver(input.projectIndex);
      } else if (
        "resolver" in input.projectIndex &&
        input.projectIndex.resolver instanceof LocalReferenceResolver
      ) {
        resolver = input.projectIndex.resolver;
      } else if (
        "declarationIndex" in input.projectIndex &&
        isLocalDeclarationIndex(input.projectIndex.declarationIndex)
      ) {
        resolver = createLocalReferenceResolver(input.projectIndex.declarationIndex);
      } else if (typeof input.projectIndex.getAllParsedDocuments === "function") {
        const allParsed = input.projectIndex.getAllParsedDocuments();
        if (allParsed.length > 0) {
          const declIndex = createLocalDeclarationIndex(allParsed);
          resolver = createLocalReferenceResolver(declIndex);
          (input.projectIndex as { resolver?: LocalReferenceResolver }).resolver = resolver;
        }
      }
    }

    // Run frontend extractors with resolver
    const fetchResult = extractFetchObservations(input.document, input.parsed, signal, resolver);
    const axiosResult = extractAxiosObservations(input.document, input.parsed, signal, resolver);

    let mountRegistry = this.mountRegistry;
    if (!mountRegistry && input.projectIndex) {
      if (
        "expressMountRegistry" in input.projectIndex &&
        input.projectIndex.expressMountRegistry instanceof ExpressMountRegistry
      ) {
        mountRegistry = input.projectIndex.expressMountRegistry;
      } else if (typeof input.projectIndex.getAllParsedDocuments === "function") {
        const allParsed = input.projectIndex.getAllParsedDocuments();
        if (allParsed.length > 0) {
          mountRegistry = ExpressMountRegistry.build(allParsed);
          (
            input.projectIndex as { expressMountRegistry?: ExpressMountRegistry }
          ).expressMountRegistry = mountRegistry;
        }
      }
    }

    // Run backend extractors
    const expressResult = extractExpressObservations(
      input.document,
      input.parsed,
      signal,
      mountRegistry
    );
    const nextjsResult = extractNextJsObservations(input.document, input.parsed, signal);

    return {
      observations: [
        ...fetchResult.observations,
        ...axiosResult.observations,
        ...expressResult.observations,
        ...nextjsResult.observations
      ],
      warnings: [
        ...fetchResult.warnings,
        ...axiosResult.warnings,
        ...expressResult.warnings,
        ...nextjsResult.warnings
      ]
    };
  }
}
