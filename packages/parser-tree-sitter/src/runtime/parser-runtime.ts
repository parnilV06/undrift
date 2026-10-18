// ParserRuntime for managing web-tree-sitter lifecycle, WASM initialization,
// and parser instance lifecycle as specified in LLD.md Section 6.2.

import * as fs from "fs";
import * as path from "path";
import Parser from "web-tree-sitter";
import { TreeSitterRuntimeError } from "../errors";

/**
 * Configuration options for Tree-sitter WebAssembly runtime initialization.
 */
export interface ParserRuntimeOptions {
  /**
   * Explicit filesystem path to the `tree-sitter.wasm` binary file.
   * If omitted, searches in `wasmDirectory` or resolves via `web-tree-sitter/tree-sitter.wasm`.
   */
  wasmBinaryPath?: string;

  /**
   * Directory containing WASM assets (including `tree-sitter.wasm`).
   * Used in packaged VS Code extension layouts where assets live in `<extensionDir>/dist/wasm/`.
   */
  wasmDirectory?: string;
}

/**
 * Handle returned when parsing a source snippet, ensuring safe resource disposal.
 */
export interface ParsedSnippetHandle {
  /** The parsed syntax tree. */
  tree: Parser.Tree;
  /** Disposes both the syntax tree and its backing parser instance. */
  dispose(): void;
}

/**
 * Manages the Tree-sitter WebAssembly runtime lifecycle and parser instance creation.
 */
export class ParserRuntime {
  private static globalInitialized = false;
  private static globalInitPromise: Promise<void> | null = null;
  private initialized = false;
  private readonly activeParsers = new Set<Parser>();
  private resolvedWasmPath: string | null = null;

  /**
   * Asynchronously initializes the web-tree-sitter WebAssembly module.
   * Resolves the required `tree-sitter.wasm` file from explicit paths, directories,
   * or the package environment.
   */
  async init(options?: ParserRuntimeOptions): Promise<void> {
    const wasmPath = this.resolveWasmPath(options);

    if (ParserRuntime.globalInitialized) {
      this.initialized = true;
      this.resolvedWasmPath = wasmPath;
      return;
    }

    if (!ParserRuntime.globalInitPromise) {
      ParserRuntime.globalInitPromise = (async () => {
        try {
          await Parser.init({
            locateFile: (scriptName: string) => {
              if (scriptName === "tree-sitter.wasm") {
                return wasmPath;
              }
              return scriptName;
            }
          });
          ParserRuntime.globalInitialized = true;
        } catch (err) {
          ParserRuntime.globalInitPromise = null;
          ParserRuntime.globalInitialized = false;
          throw new TreeSitterRuntimeError(
            `Failed to initialize web-tree-sitter runtime with '${wasmPath}': ${
              err instanceof Error ? err.message : String(err)
            }`,
            err
          );
        }
      })();
    }

    try {
      await ParserRuntime.globalInitPromise;
      this.initialized = true;
      this.resolvedWasmPath = wasmPath;
    } catch (err) {
      this.initialized = false;
      throw err;
    }
  }

  /**
   * Whether this runtime instance is initialized and ready to create parsers.
   */
  isInitialized(): boolean {
    return this.initialized && ParserRuntime.globalInitialized;
  }

  /**
   * Returns the filesystem path to the `tree-sitter.wasm` asset used by this runtime.
   */
  getWasmPath(): string | null {
    return this.resolvedWasmPath;
  }

  /**
   * Creates a new Parser instance, optionally configured with the provided language.
   * Registers the parser for tracked disposal.
   */
  createParser(language?: Parser.Language): Parser {
    if (!this.isInitialized()) {
      throw new TreeSitterRuntimeError(
        "Cannot create Parser: Tree-sitter runtime has not been initialized. Call init() first."
      );
    }

    const parser = new Parser();
    if (language) {
      parser.setLanguage(language);
    }
    this.activeParsers.add(parser);
    return parser;
  }

  /**
   * Disposes a specific parser instance and removes it from active tracking.
   */
  disposeParser(parser: Parser): void {
    if (this.activeParsers.has(parser)) {
      this.activeParsers.delete(parser);
      try {
        parser.delete();
      } catch {
        // Suppress errors during disposal
      }
    }
  }

  /**
   * Convenience method to parse a source text snippet and return a handle with an explicit disposal hook.
   * Enables clean deterministic syntax tree inspection in tests and POC harnesses.
   */
  parseSnippet(sourceText: string, language: Parser.Language): ParsedSnippetHandle {
    const parser = this.createParser(language);
    const tree = parser.parse(sourceText);
    return {
      tree,
      dispose: () => {
        try {
          tree.delete();
        } finally {
          this.disposeParser(parser);
        }
      }
    };
  }

  /**
   * Disposes all active parsers tracked by this runtime.
   */
  dispose(): void {
    for (const parser of this.activeParsers) {
      try {
        parser.delete();
      } catch {
        // Suppress individual deletion errors
      }
    }
    this.activeParsers.clear();
    this.initialized = false;
  }

  /**
   * Resolves the filesystem path to `tree-sitter.wasm` based on options and environment.
   */
  private resolveWasmPath(options?: ParserRuntimeOptions): string {
    if (options?.wasmBinaryPath) {
      const resolved = path.resolve(options.wasmBinaryPath);
      if (!fs.existsSync(resolved)) {
        throw new TreeSitterRuntimeError(
          `Tree-sitter WASM binary not found at specified path: ${resolved}`
        );
      }
      return resolved;
    }

    if (options?.wasmDirectory) {
      const candidate = path.join(path.resolve(options.wasmDirectory), "tree-sitter.wasm");
      if (!fs.existsSync(candidate)) {
        throw new TreeSitterRuntimeError(
          `Tree-sitter WASM binary not found in specified directory: ${candidate}`
        );
      }
      return candidate;
    }

    // Default resolution: try require.resolve from web-tree-sitter
    try {
      const resolved = require.resolve("web-tree-sitter/tree-sitter.wasm");
      if (fs.existsSync(resolved)) {
        return resolved;
      }
    } catch {
      // Fall through to packaged candidates
    }

    // Try packaged layout candidates relative to __dirname
    const candidates = [
      path.resolve(__dirname, "../wasm/tree-sitter.wasm"),
      path.resolve(__dirname, "wasm/tree-sitter.wasm"),
      path.resolve(__dirname, "../../apps/vscode-extension/dist/wasm/tree-sitter.wasm")
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    throw new TreeSitterRuntimeError(
      "Could not locate 'tree-sitter.wasm' binary. Please specify wasmBinaryPath or wasmDirectory in options."
    );
  }
}
