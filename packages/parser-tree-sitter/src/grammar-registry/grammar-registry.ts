// GrammarRegistry for resolving, loading, and caching language grammar WASM binaries
// (JavaScript, TypeScript, TSX) as specified in LLD.md Section 6.1 and 6.2.

import * as fs from "fs";
import * as path from "path";
import Parser from "web-tree-sitter";
import { GrammarLoadError, TreeSitterRuntimeError, UnsupportedLanguageError } from "../errors";
import type { ParserRuntime } from "../runtime/parser-runtime";

/**
 * Languages supported by the initial Tree-sitter parser adapter.
 */
export type SupportedLanguageId = "javascript" | "typescript" | "tsx";

/**
 * Configuration options for grammar asset resolution.
 */
export interface GrammarRegistryOptions {
  /**
   * Directory containing grammar WASM files (e.g. `tree-sitter-javascript.wasm`).
   * Used in packaged VS Code extension layouts where assets live in `<extensionDir>/dist/wasm/`.
   */
  wasmDirectory?: string;

  /**
   * Explicit custom file paths for individual language grammars.
   */
  grammarPaths?: Partial<Record<SupportedLanguageId, string>>;

  /**
   * Optional ParserRuntime instance. If provided, GrammarRegistry ensures
   * the runtime is initialized before loading grammar assets.
   */
  runtime?: ParserRuntime;
}

const EXTENSION_MAP: Record<string, SupportedLanguageId> = {
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascript",
  ".ts": "typescript",
  ".tsx": "tsx"
};

const LANGUAGE_ID_MAP: Record<string, SupportedLanguageId> = {
  javascript: "javascript",
  javascriptreact: "javascript",
  typescript: "typescript",
  typescriptreact: "tsx",
  jsx: "javascript",
  ts: "typescript",
  tsx: "tsx"
};

const GRAMMAR_WASM_FILES: Record<SupportedLanguageId, string> = {
  javascript: "tree-sitter-javascript.wasm",
  typescript: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm"
};

/**
 * Registry responsible for resolving file extensions and language IDs to
 * compatible Tree-sitter WebAssembly grammar assets and loading them lazily.
 */
export class GrammarRegistry {
  private readonly options: GrammarRegistryOptions;
  private readonly runtime?: ParserRuntime;
  private readonly loadedLanguages = new Map<SupportedLanguageId, Parser.Language>();
  private readonly loadingPromises = new Map<SupportedLanguageId, Promise<Parser.Language>>();

  constructor(options?: GrammarRegistryOptions) {
    this.options = options ?? {};
    this.runtime = this.options.runtime;
  }

  /**
   * Checks whether the given language ID is supported.
   */
  supportsLanguage(languageId: string): boolean {
    return LANGUAGE_ID_MAP[languageId.toLowerCase()] !== undefined;
  }

  /**
   * Checks whether the given file extension (e.g. '.ts' or 'ts') is supported.
   */
  supportsExtension(extension: string): boolean {
    const ext = extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
    return EXTENSION_MAP[ext] !== undefined;
  }

  /**
   * Checks whether a language ID or file URI/path is supported by the registry.
   */
  supports(languageId: string, uriOrPath?: string): boolean {
    if (this.supportsLanguage(languageId)) {
      return true;
    }
    if (uriOrPath) {
      const ext = path.extname(uriOrPath).toLowerCase();
      if (ext && this.supportsExtension(ext)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Resolves a language ID or file path to its canonical SupportedLanguageId.
   */
  resolveLanguage(
    languageIdOrExtension: string,
    uriOrPath?: string
  ): SupportedLanguageId | undefined {
    const fromId = LANGUAGE_ID_MAP[languageIdOrExtension.toLowerCase()];
    if (fromId) {
      return fromId;
    }

    const fromExt =
      EXTENSION_MAP[
        languageIdOrExtension.startsWith(".")
          ? languageIdOrExtension.toLowerCase()
          : `.${languageIdOrExtension.toLowerCase()}`
      ];
    if (fromExt) {
      return fromExt;
    }

    if (uriOrPath) {
      const ext = path.extname(uriOrPath).toLowerCase();
      if (ext && EXTENSION_MAP[ext]) {
        return EXTENSION_MAP[ext];
      }
    }

    return undefined;
  }

  /**
   * Returns whether the grammar for the specified language is already loaded into memory.
   */
  isLoaded(id: SupportedLanguageId): boolean {
    return this.loadedLanguages.has(id);
  }

  /**
   * Asynchronously loads and returns the Tree-sitter Language grammar for the specified language ID.
   * Caches loaded languages so each grammar is compiled into WebAssembly at most once.
   */
  async getLanguage(id: SupportedLanguageId): Promise<Parser.Language> {
    const existing = this.loadedLanguages.get(id);
    if (existing) {
      return existing;
    }

    const inFlight = this.loadingPromises.get(id);
    if (inFlight) {
      return inFlight;
    }

    const loadPromise = (async () => {
      // Ensure runtime initialization
      if (this.runtime && !this.runtime.isInitialized()) {
        await this.runtime.init();
      }

      if (typeof Parser.Language?.load !== "function") {
        throw new TreeSitterRuntimeError(
          `Cannot load grammar '${id}': Tree-sitter runtime has not been initialized. Call ParserRuntime.init() before loading grammars.`
        );
      }

      const wasmPath = this.resolveWasmPath(id);

      try {
        const language = await Parser.Language.load(wasmPath);
        this.loadedLanguages.set(id, language);
        return language;
      } catch (err) {
        throw new GrammarLoadError(
          id,
          wasmPath,
          `Failed to load Tree-sitter grammar '${id}' from '${wasmPath}': ${
            err instanceof Error ? err.message : String(err)
          }`,
          err
        );
      } finally {
        this.loadingPromises.delete(id);
      }
    })();

    this.loadingPromises.set(id, loadPromise);
    return loadPromise;
  }

  /**
   * Resolves the language for a file path or URI and loads its corresponding grammar.
   * Throws UnsupportedLanguageError if the file type is not supported.
   */
  async getLanguageForFile(filePathOrUri: string, languageId?: string): Promise<Parser.Language> {
    const resolvedId = this.resolveLanguage(languageId ?? "", filePathOrUri);
    if (!resolvedId) {
      throw new UnsupportedLanguageError(
        languageId || path.extname(filePathOrUri) || filePathOrUri
      );
    }
    return this.getLanguage(resolvedId);
  }

  /**
   * Resolves the filesystem path to the WASM binary for a supported grammar.
   */
  resolveWasmPath(id: SupportedLanguageId): string {
    const wasmFileName = GRAMMAR_WASM_FILES[id];
    if (!wasmFileName) {
      throw new UnsupportedLanguageError(id);
    }

    // 1. Check explicit custom grammar path
    if (this.options.grammarPaths?.[id]) {
      const explicit = path.resolve(this.options.grammarPaths[id]!);
      if (!fs.existsSync(explicit)) {
        throw new GrammarLoadError(
          id,
          explicit,
          `Configured grammar path for '${id}' not found: ${explicit}`
        );
      }
      return explicit;
    }

    // 2. Check explicit wasmDirectory
    if (this.options.wasmDirectory) {
      const candidate = path.join(path.resolve(this.options.wasmDirectory), wasmFileName);
      if (!fs.existsSync(candidate)) {
        throw new GrammarLoadError(
          id,
          candidate,
          `Grammar WASM binary '${wasmFileName}' not found in specified directory: ${candidate}`
        );
      }
      return candidate;
    }

    // 3. Try standard node_modules resolution via tree-sitter-wasms
    try {
      const resolved = require.resolve(`tree-sitter-wasms/out/${wasmFileName}`);
      if (fs.existsSync(resolved)) {
        return resolved;
      }
    } catch {
      // Fall through to packaged candidates
    }

    // 4. Try packaged layout candidates relative to __dirname
    const candidates = [
      path.resolve(__dirname, "../wasm", wasmFileName),
      path.resolve(__dirname, "wasm", wasmFileName),
      path.resolve(__dirname, "../../apps/vscode-extension/dist/wasm", wasmFileName)
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    throw new GrammarLoadError(
      id,
      wasmFileName,
      `Could not locate WASM binary for grammar '${id}' (${wasmFileName}). Please specify wasmDirectory or grammarPaths in options.`
    );
  }

  /**
   * Clears all cached grammar Language instances.
   */
  dispose(): void {
    this.loadedLanguages.clear();
    this.loadingPromises.clear();
  }
}
