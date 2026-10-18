import { describe, it, expect } from "vitest";
import { PositionMapper, PositionMappingError } from "../src/index";

describe("PositionMapper Unit Tests", () => {
  describe("1. ASCII-only source", () => {
    const source = "const x = 42;\nconst y = 'hello';\n";
    const mapper = new PositionMapper(source, "file:///app.js");

    it("identifies ASCII source and reports matching lengths", () => {
      expect(mapper.isAscii()).toBe(true);
      expect(mapper.byteLength).toBe(source.length);
      expect(mapper.utf16Length).toBe(source.length);
      expect(mapper.uri).toBe("file:///app.js");
      expect(mapper.text).toBe(source);
      expect(mapper.lineCount).toBe(3); // Line 0, Line 1, Line 2 (empty EOF line)
    });

    it("maps 1:1 byte offsets to UTF-16 offsets", () => {
      expect(mapper.byteOffsetToUtf16(0)).toBe(0);
      expect(mapper.byteOffsetToUtf16(6)).toBe(6); // 'x'
      expect(mapper.byteOffsetToUtf16(14)).toBe(14); // start of line 1
      expect(mapper.byteOffsetToUtf16(source.length)).toBe(source.length);
    });

    it("maps UTF-16 offsets back to byte offsets", () => {
      expect(mapper.utf16OffsetToByte(0)).toBe(0);
      expect(mapper.utf16OffsetToByte(6)).toBe(6);
      expect(mapper.utf16OffsetToByte(source.length)).toBe(source.length);
    });

    it("extracts correct line text", () => {
      expect(mapper.getLine(0)).toBe("const x = 42;\n");
      expect(mapper.getLine(1)).toBe("const y = 'hello';\n");
      expect(mapper.getLine(2)).toBe("");
    });
  });

  describe("2. Multiline source with LF line endings", () => {
    const source = "line1\nline2\nline3";
    const mapper = new PositionMapper(source);

    it("maps start, middle, and end of lines correctly", () => {
      // Line 0: "line1\n" (indices 0..5)
      expect(mapper.utf16ToPosition(0)).toEqual({ line: 0, character: 0 });
      expect(mapper.utf16ToPosition(4)).toEqual({ line: 0, character: 4 }); // '1'
      expect(mapper.utf16ToPosition(5)).toEqual({ line: 0, character: 5 }); // '\n'

      // Line 1: "line2\n" (indices 6..11)
      expect(mapper.utf16ToPosition(6)).toEqual({ line: 1, character: 0 }); // 'l'
      expect(mapper.utf16ToPosition(10)).toEqual({ line: 1, character: 4 }); // '2'
      expect(mapper.utf16ToPosition(11)).toEqual({ line: 1, character: 5 }); // '\n'

      // Line 2: "line3" (indices 12..16)
      expect(mapper.utf16ToPosition(12)).toEqual({ line: 2, character: 0 }); // 'l'
      expect(mapper.utf16ToPosition(16)).toEqual({ line: 2, character: 4 }); // '3'
      expect(mapper.utf16ToPosition(17)).toEqual({ line: 2, character: 5 }); // EOF
    });

    it("converts byte offsets directly to Position", () => {
      expect(mapper.byteOffsetToPosition(0)).toEqual({ line: 0, character: 0 });
      expect(mapper.byteOffsetToPosition(6)).toEqual({ line: 1, character: 0 });
      expect(mapper.byteOffsetToPosition(12)).toEqual({ line: 2, character: 0 });
    });
  });

  describe("3. Multiline source with CRLF and mixed line endings", () => {
    const source = "alpha\r\nbeta\r\ngamma\nomega\rdelta";
    // Line 0: "alpha\r\n" -> indices 0..6 (len 7)
    // Line 1: "beta\r\n"  -> indices 7..12 (len 6)
    // Line 2: "gamma\n"  -> indices 13..18 (len 6)
    // Line 3: "omega\r"  -> indices 19..24 (len 6)
    // Line 4: "delta"   -> indices 25..29 (len 5)
    const mapper = new PositionMapper(source);

    it("correctly identifies all 5 lines across CRLF, LF, and lone CR", () => {
      expect(mapper.lineCount).toBe(5);
      expect(mapper.getLine(0)).toBe("alpha\r\n");
      expect(mapper.getLine(1)).toBe("beta\r\n");
      expect(mapper.getLine(2)).toBe("gamma\n");
      expect(mapper.getLine(3)).toBe("omega\r");
      expect(mapper.getLine(4)).toBe("delta");
    });

    it("maps CRLF positions accurately", () => {
      // Line 0
      expect(mapper.utf16ToPosition(0)).toEqual({ line: 0, character: 0 }); // 'a'
      expect(mapper.utf16ToPosition(5)).toEqual({ line: 0, character: 5 }); // '\r'
      expect(mapper.utf16ToPosition(6)).toEqual({ line: 0, character: 6 }); // '\n'

      // Line 1 (starts immediately after \r\n at index 7)
      expect(mapper.utf16ToPosition(7)).toEqual({ line: 1, character: 0 }); // 'b'
      expect(mapper.utf16ToPosition(10)).toEqual({ line: 1, character: 3 }); // 'a'
      expect(mapper.utf16ToPosition(11)).toEqual({ line: 1, character: 4 }); // '\r'
      expect(mapper.utf16ToPosition(12)).toEqual({ line: 1, character: 5 }); // '\n'

      // Line 2 (starts at index 13)
      expect(mapper.utf16ToPosition(13)).toEqual({ line: 2, character: 0 }); // 'g'
      expect(mapper.utf16ToPosition(18)).toEqual({ line: 2, character: 5 }); // '\n'

      // Line 3 (starts at index 19 after lone \r)
      expect(mapper.utf16ToPosition(19)).toEqual({ line: 3, character: 0 }); // 'o'
      expect(mapper.utf16ToPosition(24)).toEqual({ line: 3, character: 5 }); // '\r'

      // Line 4 (starts at index 25)
      expect(mapper.utf16ToPosition(25)).toEqual({ line: 4, character: 0 }); // 'd'
      expect(mapper.utf16ToPosition(30)).toEqual({ line: 4, character: 5 }); // EOF
    });
  });

  describe("4. Non-ASCII BMP characters (2-byte and 3-byte UTF-8)", () => {
    // 'é' is 2 UTF-8 bytes (0xC3 0xA9) and 1 UTF-16 code unit
    // '日' is 3 UTF-8 bytes (0xE6 0x97 0xA5) and 1 UTF-16 code unit
    // '€' is 3 UTF-8 bytes (0xE2 0x82 0xAC) and 1 UTF-16 code unit
    const source = "const café = '€5'; // 日本\nconst ok = true;";
    const mapper = new PositionMapper(source);

    it("marks source as non-ASCII and computes correct byteLength vs utf16Length", () => {
      expect(mapper.isAscii()).toBe(false);
      expect(mapper.utf16Length).toBe(source.length); // 43
      expect(mapper.byteLength).toBe(Buffer.byteLength(source, "utf8")); // 51 bytes
      expect(mapper.byteLength).toBeGreaterThan(mapper.utf16Length);
    });

    it("maps offsets before and after 2-byte character 'é'", () => {
      // "const caf" -> 9 ASCII characters = 9 bytes (indices 0..8, byte offsets 0..8)
      expect(mapper.byteOffsetToUtf16(0)).toBe(0);
      expect(mapper.byteOffsetToUtf16(9)).toBe(9); // start of 'é'

      // 'é' occupies 2 bytes (offsets 9 and 10), and UTF-16 index 9
      // Byte offset 11 is ' ' (space), UTF-16 index 10
      expect(mapper.byteOffsetToUtf16(11)).toBe(10);
      expect(source[mapper.byteOffsetToUtf16(11)]).toBe(" ");
    });

    it("maps offsets before and after 3-byte characters '€' and '日本'", () => {
      // Find '€' in source: index 14
      const euroUtf16 = source.indexOf("€");
      const euroByte = mapper.utf16OffsetToByte(euroUtf16);
      expect(source[euroUtf16]).toBe("€");

      // Verify euro maps back to same UTF-16 index
      expect(mapper.byteOffsetToUtf16(euroByte)).toBe(euroUtf16);

      // '5' is immediately after '€': UTF-16 index euroUtf16 + 1
      // Byte offset should be euroByte + 3
      expect(mapper.byteOffsetToUtf16(euroByte + 3)).toBe(euroUtf16 + 1);
      expect(source[mapper.byteOffsetToUtf16(euroByte + 3)]).toBe("5");

      // Find '日本' in source: index 22
      const nihonUtf16 = source.indexOf("日本");
      const nihonByte = mapper.utf16OffsetToByte(nihonUtf16);
      expect(mapper.byteOffsetToUtf16(nihonByte)).toBe(nihonUtf16);

      // '本' is 3 bytes after '日'
      expect(mapper.byteOffsetToUtf16(nihonByte + 3)).toBe(nihonUtf16 + 1);
      expect(
        source.slice(mapper.byteOffsetToUtf16(nihonByte), mapper.byteOffsetToUtf16(nihonByte + 6))
      ).toBe("日本");
    });

    it("ensures subsequent line offsets are mapped accurately despite preceding multi-byte characters", () => {
      // Line 1: "const ok = true;" starts immediately after \n
      const line1Utf16 = source.indexOf("const ok");
      const line1Byte = mapper.utf16OffsetToByte(line1Utf16);

      expect(mapper.byteOffsetToPosition(line1Byte)).toEqual({ line: 1, character: 0 });
      expect(mapper.byteOffsetToUtf16(line1Byte)).toBe(line1Utf16);
      expect(source.slice(mapper.byteOffsetToUtf16(line1Byte))).toBe("const ok = true;");
    });
  });

  describe("5. Supplementary Unicode characters (Surrogate pairs / Emoji)", () => {
    // 🚀 (U+1F680): 4 UTF-8 bytes (F0 9F 9A 80), 2 UTF-16 code units (\uD83D\uDE80)
    // 🎉 (U+1F389): 4 UTF-8 bytes (F0 9F 8E 89), 2 UTF-16 code units (\uD83C\uDF89)
    const source = 'const msg = "Rocket 🚀 Launch 🎉!";\r\nconst done = true;';
    const mapper = new PositionMapper(source);

    it("identifies surrogate pairs and maps 4 bytes to 2 UTF-16 code units", () => {
      const rocketUtf16 = source.indexOf("🚀");
      expect(source.charCodeAt(rocketUtf16)).toBeGreaterThanOrEqual(0xd800); // High surrogate
      expect(source.charCodeAt(rocketUtf16 + 1)).toBeGreaterThanOrEqual(0xdc00); // Low surrogate

      const rocketByte = mapper.utf16OffsetToByte(rocketUtf16);
      expect(mapper.byteOffsetToUtf16(rocketByte)).toBe(rocketUtf16);

      // End of 🚀 is rocketByte + 4 in bytes, and rocketUtf16 + 2 in UTF-16
      const afterRocketByte = rocketByte + 4;
      const afterRocketUtf16 = rocketUtf16 + 2;
      expect(mapper.byteOffsetToUtf16(afterRocketByte)).toBe(afterRocketUtf16);

      // Range for rocket sliced from source text
      const range = mapper.toTextRange(rocketByte, afterRocketByte);
      expect(range).toEqual({ start: rocketUtf16, end: afterRocketUtf16 });
      expect(source.slice(range.start, range.end)).toBe("🚀");
    });

    it("computes correct character columns after surrogate pairs", () => {
      // In VS Code / LSP, character positions are measured in UTF-16 code units.
      // "const msg = \"Rocket " has 19 code units (indices 0..18)
      // 🚀 is at indices 19 and 20 (2 code units)
      // " Launch " starts at index 21
      const rocketUtf16 = source.indexOf("🚀");
      expect(mapper.utf16ToPosition(rocketUtf16)).toEqual({ line: 0, character: 20 });

      const spaceAfterRocket = rocketUtf16 + 2;
      expect(mapper.utf16ToPosition(spaceAfterRocket)).toEqual({ line: 0, character: 22 });
    });

    it("preserves correct positions on subsequent line with CRLF after emojis", () => {
      const line1Utf16 = source.indexOf("const done");
      const line1Byte = mapper.utf16OffsetToByte(line1Utf16);

      expect(mapper.byteOffsetToPosition(line1Byte)).toEqual({ line: 1, character: 0 });
      expect(mapper.byteOffsetToUtf16(line1Byte)).toBe(line1Utf16);
      expect(source.slice(line1Utf16)).toBe("const done = true;");
    });
  });

  describe("6. Line starts, line ends, and End-of-File", () => {
    it("handles an empty source string", () => {
      const mapper = new PositionMapper("", "file:///empty.ts");
      expect(mapper.byteLength).toBe(0);
      expect(mapper.utf16Length).toBe(0);
      expect(mapper.lineCount).toBe(1);
      expect(mapper.byteOffsetToUtf16(0)).toBe(0);
      expect(mapper.utf16OffsetToByte(0)).toBe(0);
      expect(mapper.byteOffsetToPosition(0)).toEqual({ line: 0, character: 0 });
      expect(mapper.toTextRange(0, 0)).toEqual({ start: 0, end: 0 });
      expect(mapper.toSourceSpan(0, 0)).toEqual({
        uri: "file:///empty.ts",
        range: { start: 0, end: 0 },
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
        byteRange: { start: 0, end: 0 }
      });
    });

    it("handles source ending with a newline", () => {
      const mapper = new PositionMapper("foo\n");
      expect(mapper.lineCount).toBe(2);
      expect(mapper.utf16ToPosition(3)).toEqual({ line: 0, character: 3 }); // '\n'
      expect(mapper.utf16ToPosition(4)).toEqual({ line: 1, character: 0 }); // EOF line 1
      expect(mapper.byteOffsetToPosition(4)).toEqual({ line: 1, character: 0 });
    });

    it("handles source ending with CRLF", () => {
      const mapper = new PositionMapper("bar\r\n");
      expect(mapper.lineCount).toBe(2);
      expect(mapper.utf16ToPosition(3)).toEqual({ line: 0, character: 3 }); // '\r'
      expect(mapper.utf16ToPosition(4)).toEqual({ line: 0, character: 4 }); // '\n'
      expect(mapper.utf16ToPosition(5)).toEqual({ line: 1, character: 0 }); // EOF line 1
      expect(mapper.byteOffsetToPosition(5)).toEqual({ line: 1, character: 0 });
    });
  });

  describe("7. Range conversion and SourceSpan creation", () => {
    const source = "function greet(name: string): string {\n  return `Hello ${name}!`;\n}\n";
    const mapper = new PositionMapper(source, "file:///greet.ts");

    it("converts byte range to TextRange and slices exact source substring", () => {
      const funcNameStart = source.indexOf("greet");
      const funcNameEnd = funcNameStart + "greet".length;

      const range = mapper.toTextRange(funcNameStart, funcNameEnd);
      expect(range).toEqual({ start: funcNameStart, end: funcNameEnd });
      expect(source.slice(range.start, range.end)).toBe("greet");
    });

    it("builds a complete, normalized SourceSpan", () => {
      // Slicing "return `Hello ${name}!`;" on line 1
      const retStart = source.indexOf("return");
      const retEnd = source.indexOf(";", retStart) + 1;

      const span = mapper.toSourceSpan(retStart, retEnd);
      expect(span.uri).toBe("file:///greet.ts");
      expect(span.range).toEqual({ start: retStart, end: retEnd });
      expect(span.start).toEqual({ line: 1, character: 2 });
      expect(span.end).toEqual({ line: 1, character: 26 });
      expect(span.byteRange).toEqual({ start: retStart, end: retEnd });

      expect(source.slice(span.range.start, span.range.end)).toBe("return `Hello ${name}!`;");
    });

    it("allows URI override in toSourceSpan", () => {
      const span = mapper.toSourceSpan(0, 8, "file:///override.ts");
      expect(span.uri).toBe("file:///override.ts");
    });
  });

  describe("8. Round-trip conversions", () => {
    const complexSource =
      "// Greeting: 👋 Welcome!\r\nconst items = ['🍎', '🍌', '🍒'];\nconst total = items.length;\n";
    const mapper = new PositionMapper(complexSource);

    it("round-trips between UTF-16 offset and Position for every valid offset", () => {
      for (let offset = 0; offset <= mapper.utf16Length; offset++) {
        const pos = mapper.utf16ToPosition(offset);
        const roundTripOffset = mapper.positionToUtf16(pos);
        expect(roundTripOffset).toBe(offset);
      }
    });

    it("round-trips between byte offset and UTF-16 offset for all valid character boundaries", () => {
      for (let byteOffset = 0; byteOffset <= mapper.byteLength; byteOffset++) {
        try {
          const utf16Offset = mapper.byteOffsetToUtf16(byteOffset);
          const roundTripByte = mapper.utf16OffsetToByte(utf16Offset);
          expect(roundTripByte).toBe(byteOffset);
        } catch (err) {
          // Expected for continuation bytes in multi-byte sequences
          expect(err).toBeInstanceOf(PositionMappingError);
        }
      }
    });

    it("round-trips TextRange and ByteRange", () => {
      const textRange = mapper.toTextRange(0, mapper.byteLength);
      const byteRange = mapper.toByteRange(textRange.start, textRange.end);
      expect(byteRange).toEqual({ start: 0, end: mapper.byteLength });
    });
  });

  describe("9. Out-of-bounds and invalid input handling", () => {
    const source = "const 🚀 = 'rocket';";
    const mapper = new PositionMapper(source);

    it("throws PositionMappingError on negative byte offset", () => {
      expect(() => mapper.byteOffsetToUtf16(-1)).toThrow(PositionMappingError);
      expect(() => mapper.byteOffsetToUtf16(-1)).toThrow(/out of bounds/);
    });

    it("throws PositionMappingError on byte offset exceeding document length", () => {
      expect(() => mapper.byteOffsetToUtf16(mapper.byteLength + 1)).toThrow(PositionMappingError);
      expect(() => mapper.byteOffsetToUtf16(mapper.byteLength + 1)).toThrow(/out of bounds/);
    });

    it("throws PositionMappingError when byte offset lands on a continuation byte", () => {
      const rocketUtf16 = source.indexOf("🚀");
      const rocketByte = mapper.utf16OffsetToByte(rocketUtf16);

      // rocket is 4 bytes: rocketByte, rocketByte + 1, rocketByte + 2, rocketByte + 3
      // Continuation bytes 1, 2, 3 should throw
      expect(() => mapper.byteOffsetToUtf16(rocketByte + 1)).toThrow(PositionMappingError);
      expect(() => mapper.byteOffsetToUtf16(rocketByte + 1)).toThrow(/continuation byte/);
      expect(() => mapper.byteOffsetToUtf16(rocketByte + 2)).toThrow(PositionMappingError);
      expect(() => mapper.byteOffsetToUtf16(rocketByte + 3)).toThrow(PositionMappingError);
    });

    it("throws PositionMappingError on negative UTF-16 offset", () => {
      expect(() => mapper.utf16OffsetToByte(-1)).toThrow(PositionMappingError);
      expect(() => mapper.utf16OffsetToByte(-1)).toThrow(/out of bounds/);
    });

    it("throws PositionMappingError on UTF-16 offset exceeding length", () => {
      expect(() => mapper.utf16OffsetToByte(mapper.utf16Length + 1)).toThrow(PositionMappingError);
      expect(() => mapper.utf16OffsetToByte(mapper.utf16Length + 1)).toThrow(/out of bounds/);
    });

    it("throws PositionMappingError when UTF-16 offset points to a low surrogate", () => {
      const rocketUtf16 = source.indexOf("🚀");
      // rocketUtf16 + 1 is the low surrogate
      expect(() => mapper.utf16OffsetToByte(rocketUtf16 + 1)).toThrow(PositionMappingError);
      expect(() => mapper.utf16OffsetToByte(rocketUtf16 + 1)).toThrow(/low surrogate/);
    });

    it("throws PositionMappingError when startByte > endByte", () => {
      expect(() => mapper.toTextRange(10, 5)).toThrow(PositionMappingError);
      expect(() => mapper.toTextRange(10, 5)).toThrow(/startByte.*cannot be greater than endByte/);
      expect(() => mapper.toSourceSpan(10, 5)).toThrow(PositionMappingError);
    });

    it("throws PositionMappingError when startUtf16 > endUtf16 in toByteRange", () => {
      expect(() => mapper.toByteRange(10, 5)).toThrow(PositionMappingError);
      expect(() => mapper.toByteRange(10, 5)).toThrow(
        /startUtf16.*cannot be greater than endUtf16/
      );
    });

    it("throws PositionMappingError on out-of-bounds line or character in positionToUtf16", () => {
      expect(() => mapper.positionToUtf16({ line: -1, character: 0 })).toThrow(
        PositionMappingError
      );
      expect(() => mapper.positionToUtf16({ line: 100, character: 0 })).toThrow(
        PositionMappingError
      );
      expect(() => mapper.positionToUtf16({ line: 0, character: -1 })).toThrow(
        PositionMappingError
      );
      expect(() => mapper.positionToUtf16({ line: 0, character: 1000 })).toThrow(
        PositionMappingError
      );
    });

    it("throws PositionMappingError on out-of-bounds line in getLine", () => {
      expect(() => mapper.getLine(-1)).toThrow(PositionMappingError);
      expect(() => mapper.getLine(mapper.lineCount + 1)).toThrow(PositionMappingError);
    });
  });
});
