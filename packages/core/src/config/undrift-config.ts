// Project configuration contracts as specified in LLD.md Section 4.4 and Section 14.

/**
 * Fully resolved and validated UNDRIFT project configuration as specified in LLD.md Section 4.4 and Section 14.
 */
export interface ResolvedUndriftConfig {
  readonly version?: number;
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  readonly analyzers?: {
    readonly [name: string]: boolean | undefined;
  };
  readonly [key: string]: unknown;
}
