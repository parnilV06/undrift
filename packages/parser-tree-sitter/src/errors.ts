/**
 * Base error for Tree-sitter runtime and lifecycle failures.
 */
export class TreeSitterRuntimeError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "TreeSitterRuntimeError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error thrown when a grammar WASM file cannot be located or loaded.
 */
export class GrammarLoadError extends TreeSitterRuntimeError {
  constructor(
    public readonly languageId: string,
    public readonly wasmPath: string,
    message: string,
    cause?: unknown
  ) {
    super(message, cause);
    this.name = "GrammarLoadError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error thrown when an unsupported language or file extension is requested.
 */
export class UnsupportedLanguageError extends TreeSitterRuntimeError {
  constructor(
    public readonly requested: string,
    message?: string
  ) {
    super(
      message ??
        `Language or file extension '${requested}' is not supported by the Tree-sitter parser adapter. Supported extensions: .js, .mjs, .cjs, .jsx, .ts, .tsx.`
    );
    this.name = "UnsupportedLanguageError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error thrown when an invalid byte offset, range, or position is encountered
 * during position mapping.
 */
export class PositionMappingError extends TreeSitterRuntimeError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "PositionMappingError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
