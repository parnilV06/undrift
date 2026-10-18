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

  /**
   * Determines if this analyzer supports the given language and document URI.
   */
  supports(languageId: string, uri: DocumentUri): boolean {
    if (SUPPORTED_LANGUAGES.has(languageId.toLowerCase())) {
      return true;
    }
    const lowerUri = uri.toLowerCase();
    return SUPPORTED_EXTENSIONS.some((ext) => lowerUri.endsWith(ext));
  }

  /**
   * Analyzes the supplied parsed document and returns extracted API observations and warnings.
   */
  async analyze(input: AnalyzerInput, signal?: AbortSignal): Promise<AnalyzerOutput> {
    signal?.throwIfAborted();

    // Run frontend extractors
    const fetchResult = extractFetchObservations(input.document, input.parsed, signal);
    const axiosResult = extractAxiosObservations(input.document, input.parsed, signal);

    // Run backend extractors
    const expressResult = extractExpressObservations(input.document, input.parsed, signal);

    return {
      observations: [
        ...fetchResult.observations,
        ...axiosResult.observations,
        ...expressResult.observations
      ],
      warnings: [...fetchResult.warnings, ...axiosResult.warnings, ...expressResult.warnings]
    };
  }
}
