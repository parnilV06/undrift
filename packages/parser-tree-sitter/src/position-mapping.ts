// PositionMapper for mapping Tree-sitter UTF-8 byte offsets to UTF-16 code-unit offsets,
// zero-based line/character positions, and normalized SourceSpans as specified in LLD.md Section 6.4.

import type { ByteRange, DocumentUri, Position, SourceSpan, TextRange } from "@undrift/core";
import { PositionMappingError } from "./errors";

/**
 * Utility responsible for accurate bidirectional coordinate mapping between
 * parser-native UTF-8 byte offsets, UTF-16 string code units, and zero-based
 * line/character positions.
 *
 * Implements strict UTF-8/UTF-16 boundary checks, CRLF/LF line-break handling,
 * and multi-byte / surrogate-pair Unicode support (including supplementary planes and emoji).
 */
export class PositionMapper {
  private readonly sourceText: string;
  private readonly documentUri: DocumentUri;
  private readonly isAllAscii: boolean;
  private readonly lineStarts: number[];
  private readonly byteToUtf16Table?: Int32Array;
  private readonly utf16ToByteTable?: Int32Array;
  private readonly totalBytes: number;

  constructor(sourceText: string, uri: DocumentUri = "") {
    this.sourceText = sourceText;
    this.documentUri = uri;

    const textLen = sourceText.length;
    const lineStarts: number[] = [0];
    let isAllAscii = true;

    // First pass: locate line breaks and determine whether source is pure ASCII.
    for (let i = 0; i < textLen; i++) {
      const code = sourceText.charCodeAt(i);
      if (code > 0x7f) {
        isAllAscii = false;
      }
      if (code === 0x0a) {
        // \n
        lineStarts.push(i + 1);
      } else if (code === 0x0d) {
        // \r or \r\n
        if (i + 1 < textLen && sourceText.charCodeAt(i + 1) === 0x0a) {
          lineStarts.push(i + 2);
          i++; // Consume \n
        } else {
          lineStarts.push(i + 1);
        }
      }
    }

    this.lineStarts = lineStarts;
    this.isAllAscii = isAllAscii;

    if (isAllAscii) {
      this.totalBytes = textLen;
    } else {
      this.totalBytes = Buffer.byteLength(sourceText, "utf8");
      const byteToUtf16Table = new Int32Array(this.totalBytes + 1).fill(-1);
      const utf16ToByteTable = new Int32Array(textLen + 1).fill(-1);

      let byteOffset = 0;
      for (let utf16Offset = 0; utf16Offset < textLen;) {
        const code = sourceText.charCodeAt(utf16Offset);

        if (code <= 0x7f) {
          // 1-byte ASCII (1 UTF-16 code unit)
          byteToUtf16Table[byteOffset] = utf16Offset;
          utf16ToByteTable[utf16Offset] = byteOffset;
          byteOffset += 1;
          utf16Offset += 1;
        } else if (code <= 0x7ff) {
          // 2-byte sequence (1 UTF-16 code unit)
          byteToUtf16Table[byteOffset] = utf16Offset;
          utf16ToByteTable[utf16Offset] = byteOffset;
          // Continuation byte (byteOffset + 1) remains -1
          byteOffset += 2;
          utf16Offset += 1;
        } else if (code >= 0xd800 && code <= 0xdbff) {
          // High surrogate
          if (utf16Offset + 1 < textLen) {
            const next = sourceText.charCodeAt(utf16Offset + 1);
            if (next >= 0xdc00 && next <= 0xdfff) {
              // Valid surrogate pair: 4 UTF-8 bytes, 2 UTF-16 code units
              byteToUtf16Table[byteOffset] = utf16Offset;
              utf16ToByteTable[utf16Offset] = byteOffset;
              // Continuation bytes (byteOffset + 1..3) remain -1
              // Low surrogate (utf16Offset + 1) remains -1
              byteOffset += 4;
              utf16Offset += 2;
              continue;
            }
          }
          // Unpaired high surrogate: encoded as U+FFFD (3 UTF-8 bytes)
          byteToUtf16Table[byteOffset] = utf16Offset;
          utf16ToByteTable[utf16Offset] = byteOffset;
          byteOffset += 3;
          utf16Offset += 1;
        } else if (code >= 0xdc00 && code <= 0xdfff) {
          // Unpaired low surrogate: encoded as U+FFFD (3 UTF-8 bytes)
          byteToUtf16Table[byteOffset] = utf16Offset;
          utf16ToByteTable[utf16Offset] = byteOffset;
          byteOffset += 3;
          utf16Offset += 1;
        } else {
          // 3-byte BMP sequence (1 UTF-16 code unit)
          byteToUtf16Table[byteOffset] = utf16Offset;
          utf16ToByteTable[utf16Offset] = byteOffset;
          // Continuation bytes (byteOffset + 1..2) remain -1
          byteOffset += 3;
          utf16Offset += 1;
        }
      }

      // End-of-file mapping
      byteToUtf16Table[byteOffset] = textLen;
      utf16ToByteTable[textLen] = byteOffset;

      this.byteToUtf16Table = byteToUtf16Table;
      this.utf16ToByteTable = utf16ToByteTable;
    }
  }

  /**
   * Returns the exact source document text snapshot.
   */
  get text(): string {
    return this.sourceText;
  }

  /**
   * Returns the document URI associated with this position mapper.
   */
  get uri(): DocumentUri {
    return this.documentUri;
  }

  /**
   * Total length of the document in UTF-8 bytes.
   */
  get byteLength(): number {
    return this.totalBytes;
  }

  /**
   * Total length of the document in UTF-16 code units.
   */
  get utf16Length(): number {
    return this.sourceText.length;
  }

  /**
   * Number of lines in the document (1-indexed count).
   */
  get lineCount(): number {
    return this.lineStarts.length;
  }

  /**
   * Whether the document consists entirely of ASCII characters (allowing O(1) mappings).
   */
  isAscii(): boolean {
    return this.isAllAscii;
  }

  /**
   * Converts a 0-based UTF-8 byte offset to an absolute 0-based UTF-16 code-unit offset.
   *
   * @throws PositionMappingError if the offset is out of bounds or falls on a UTF-8 continuation byte.
   */
  byteOffsetToUtf16(byteOffset: number): number {
    if (byteOffset < 0 || byteOffset > this.totalBytes) {
      throw new PositionMappingError(
        `Byte offset ${byteOffset} is out of bounds (document length: ${this.totalBytes} bytes)`
      );
    }

    if (this.isAllAscii) {
      return byteOffset;
    }

    const utf16Offset = this.byteToUtf16Table![byteOffset];
    if (utf16Offset === -1) {
      throw new PositionMappingError(
        `Byte offset ${byteOffset} does not point to a valid UTF-8 character boundary (continuation byte)`
      );
    }

    return utf16Offset;
  }

  /**
   * Converts a 0-based UTF-16 code-unit offset to a 0-based UTF-8 byte offset.
   *
   * @throws PositionMappingError if the offset is out of bounds or points to a low surrogate.
   */
  utf16OffsetToByte(utf16Offset: number): number {
    if (utf16Offset < 0 || utf16Offset > this.sourceText.length) {
      throw new PositionMappingError(
        `UTF-16 offset ${utf16Offset} is out of bounds (document length: ${this.sourceText.length} code units)`
      );
    }

    if (this.isAllAscii) {
      return utf16Offset;
    }

    const byteOffset = this.utf16ToByteTable![utf16Offset];
    if (byteOffset === -1) {
      throw new PositionMappingError(
        `UTF-16 offset ${utf16Offset} points to a low surrogate or continuation code unit`
      );
    }

    return byteOffset;
  }

  /**
   * Maps an absolute UTF-16 code-unit offset to zero-based line and character positions.
   *
   * Character positions represent UTF-16 code units from the start of the line,
   * matching VS Code and Language Server Protocol semantics.
   *
   * @throws PositionMappingError if the offset is out of bounds.
   */
  utf16ToPosition(utf16Offset: number): Position {
    if (utf16Offset < 0 || utf16Offset > this.sourceText.length) {
      throw new PositionMappingError(
        `UTF-16 offset ${utf16Offset} is out of bounds (document length: ${this.sourceText.length} code units)`
      );
    }

    // Binary search in precomputed line start offsets
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this.lineStarts[mid] <= utf16Offset) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const line = high;
    const character = utf16Offset - this.lineStarts[line];
    return { line, character };
  }

  /**
   * Maps a zero-based line and character position back to an absolute UTF-16 code-unit offset.
   *
   * @throws PositionMappingError if the line or character is out of bounds.
   */
  positionToUtf16(position: Position): number {
    const { line, character } = position;
    if (line < 0 || line >= this.lineStarts.length) {
      throw new PositionMappingError(
        `Line ${line} is out of bounds (document has ${this.lineStarts.length} lines)`
      );
    }
    if (character < 0) {
      throw new PositionMappingError(
        `Character ${character} is out of bounds (must be non-negative)`
      );
    }

    const lineStart = this.lineStarts[line];
    const nextLineStart =
      line + 1 < this.lineStarts.length ? this.lineStarts[line + 1] : this.sourceText.length;
    const maxCharacter = nextLineStart - lineStart;

    if (character > maxCharacter) {
      throw new PositionMappingError(
        `Character ${character} is out of bounds for line ${line} (line length: ${maxCharacter})`
      );
    }

    return lineStart + character;
  }

  /**
   * Converts a 0-based UTF-8 byte offset to zero-based line and UTF-16 character positions.
   *
   * @throws PositionMappingError if the byte offset is out of bounds or on a continuation byte.
   */
  byteOffsetToPosition(byteOffset: number): Position {
    const utf16Offset = this.byteOffsetToUtf16(byteOffset);
    return this.utf16ToPosition(utf16Offset);
  }

  /**
   * Converts a zero-based line and UTF-16 character position to a 0-based UTF-8 byte offset.
   *
   * @throws PositionMappingError if the position is out of bounds.
   */
  positionToByteOffset(position: Position): number {
    const utf16Offset = this.positionToUtf16(position);
    return this.utf16OffsetToByte(utf16Offset);
  }

  /**
   * Converts a UTF-8 byte range to an absolute UTF-16 TextRange.
   *
   * @throws PositionMappingError if either offset is invalid or startByte > endByte.
   */
  toTextRange(startByte: number, endByte: number): TextRange {
    if (startByte > endByte) {
      throw new PositionMappingError(
        `Invalid byte range: startByte (${startByte}) cannot be greater than endByte (${endByte})`
      );
    }

    return {
      start: this.byteOffsetToUtf16(startByte),
      end: this.byteOffsetToUtf16(endByte)
    };
  }

  /**
   * Converts an absolute UTF-16 range to a parser-native ByteRange.
   *
   * @throws PositionMappingError if either offset is invalid or startUtf16 > endUtf16.
   */
  toByteRange(startUtf16: number, endUtf16: number): ByteRange {
    if (startUtf16 > endUtf16) {
      throw new PositionMappingError(
        `Invalid UTF-16 range: startUtf16 (${startUtf16}) cannot be greater than endUtf16 (${endUtf16})`
      );
    }

    return {
      start: this.utf16OffsetToByte(startUtf16),
      end: this.utf16OffsetToByte(endUtf16)
    };
  }

  /**
   * Constructs a fully normalized SourceSpan from parser-native byte offsets.
   *
   * @param startByte Native UTF-8 start byte offset
   * @param endByte Native UTF-8 end byte offset
   * @param uri Optional document URI override
   * @throws PositionMappingError if offsets are invalid or startByte > endByte
   */
  toSourceSpan(startByte: number, endByte: number, uri?: DocumentUri): SourceSpan {
    if (startByte > endByte) {
      throw new PositionMappingError(
        `Invalid byte range: startByte (${startByte}) cannot be greater than endByte (${endByte})`
      );
    }

    const startUtf16 = this.byteOffsetToUtf16(startByte);
    const endUtf16 = this.byteOffsetToUtf16(endByte);

    return {
      uri: uri ?? this.documentUri,
      range: {
        start: startUtf16,
        end: endUtf16
      },
      start: this.utf16ToPosition(startUtf16),
      end: this.utf16ToPosition(endUtf16),
      byteRange: {
        start: startByte,
        end: endByte
      }
    };
  }

  /**
   * Retrieves the raw content of the specified line (including any trailing newline characters).
   *
   * @param lineIndex Zero-based line index
   * @throws PositionMappingError if lineIndex is out of bounds
   */
  getLine(lineIndex: number): string {
    if (lineIndex < 0 || lineIndex >= this.lineStarts.length) {
      throw new PositionMappingError(
        `Line index ${lineIndex} is out of bounds (total lines: ${this.lineStarts.length})`
      );
    }

    const start = this.lineStarts[lineIndex];
    const end =
      lineIndex + 1 < this.lineStarts.length
        ? this.lineStarts[lineIndex + 1]
        : this.sourceText.length;

    return this.sourceText.slice(start, end);
  }
}
