// Analyzer registry for registering, selecting, and managing language analyzers
// as specified in LLD.md Section 7.1 and Section 8.2/8.3.

import type { DocumentUri, LanguageAnalyzerPort } from "@undrift/core";

/**
 * Error thrown when an invalid analyzer registration is attempted or when
 * an analyzer with a duplicate ID is registered.
 */
export class AnalyzerRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyzerRegistrationError";
  }
}

/**
 * Registry interface for managing LanguageAnalyzerPort instances.
 */
export interface IAnalyzerRegistry {
  register(analyzer: LanguageAnalyzerPort): void;
  deregister(id: string): boolean;
  get(id: string): LanguageAnalyzerPort | undefined;
  has(id: string): boolean;
  getAll(): readonly LanguageAnalyzerPort[];
  getAnalyzersFor(languageId: string, uri: DocumentUri): readonly LanguageAnalyzerPort[];
  clear(): void;
  readonly count: number;
}

/**
 * Registry responsible for maintaining registered LanguageAnalyzerPort implementations
 * and selecting applicable analyzers for a source document by language ID and URI.
 * Preserves deterministic registration order when querying or selecting analyzers.
 */
export class AnalyzerRegistry implements IAnalyzerRegistry {
  private readonly analyzers = new Map<string, LanguageAnalyzerPort>();

  constructor(initialAnalyzers?: readonly LanguageAnalyzerPort[]) {
    if (initialAnalyzers) {
      for (const analyzer of initialAnalyzers) {
        this.register(analyzer);
      }
    }
  }

  /**
   * Registers a LanguageAnalyzerPort implementation.
   * Throws AnalyzerRegistrationError if the analyzer is invalid or if an analyzer
   * with the same identifier is already registered.
   */
  register(analyzer: LanguageAnalyzerPort): void {
    if (!analyzer || typeof analyzer !== "object") {
      throw new AnalyzerRegistrationError("Analyzer must be a non-null object.");
    }
    if (typeof analyzer.id !== "string" || analyzer.id.trim() === "") {
      throw new AnalyzerRegistrationError(
        "Analyzer must have a valid non-empty string identifier ('id')."
      );
    }
    if (typeof analyzer.supports !== "function") {
      throw new AnalyzerRegistrationError(
        `Analyzer '${analyzer.id}' must implement a 'supports(languageId, uri)' method.`
      );
    }
    if (typeof analyzer.analyze !== "function") {
      throw new AnalyzerRegistrationError(
        `Analyzer '${analyzer.id}' must implement an 'analyze(input, signal)' method.`
      );
    }
    if (this.analyzers.has(analyzer.id)) {
      throw new AnalyzerRegistrationError(
        `Analyzer with id '${analyzer.id}' is already registered.`
      );
    }
    this.analyzers.set(analyzer.id, analyzer);
  }

  /**
   * Unregisters an analyzer by its identifier.
   * Returns true if the analyzer was found and removed, false otherwise.
   */
  deregister(id: string): boolean {
    return this.analyzers.delete(id);
  }

  /**
   * Retrieves a registered analyzer by its identifier, or undefined if not found.
   */
  get(id: string): LanguageAnalyzerPort | undefined {
    return this.analyzers.get(id);
  }

  /**
   * Checks whether an analyzer with the specified identifier is registered.
   */
  has(id: string): boolean {
    return this.analyzers.has(id);
  }

  /**
   * Returns all registered analyzers in their deterministic registration order.
   */
  getAll(): readonly LanguageAnalyzerPort[] {
    return Array.from(this.analyzers.values());
  }

  /**
   * Selects all registered analyzers that support the given language ID and document URI.
   * Returns an array in deterministic registration order.
   * If no registered analyzer supports the document, returns an empty array.
   */
  getAnalyzersFor(languageId: string, uri: DocumentUri): readonly LanguageAnalyzerPort[] {
    const selected: LanguageAnalyzerPort[] = [];
    for (const analyzer of this.analyzers.values()) {
      if (analyzer.supports(languageId, uri)) {
        selected.push(analyzer);
      }
    }
    return selected;
  }

  /**
   * Removes all registered analyzers.
   */
  clear(): void {
    this.analyzers.clear();
  }

  /**
   * The number of registered analyzers.
   */
  get count(): number {
    return this.analyzers.size;
  }
}
