import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

// 1. PNG Decoder using pure Node.js
function decodePng(buf) {
  let offset = 8;
  let width, height, bitDepth, colorType;
  const idatChunks = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + len;
  }
  const decompressed = zlib.inflateSync(Buffer.concat(idatChunks));
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = 1 + width * bpp;
  const rgba = Buffer.alloc(width * height * 4);

  let prevScanline = Buffer.alloc(width * bpp);
  for (let y = 0; y < height; y++) {
    const lineOffset = y * stride;
    const filter = decompressed[lineOffset];
    const rawLine = decompressed.subarray(lineOffset + 1, lineOffset + stride);
    const scanline = Buffer.alloc(width * bpp);

    for (let i = 0; i < scanline.length; i++) {
      const raw = rawLine[i];
      const a = i >= bpp ? scanline[i - bpp] : 0;
      const b = prevScanline[i];
      const c = i >= bpp ? prevScanline[i - bpp] : 0;
      let val = raw;
      if (filter === 1) val = (raw + a) & 0xff;
      else if (filter === 2) val = (raw + b) & 0xff;
      else if (filter === 3) val = (raw + Math.floor((a + b) / 2)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        val = (raw + pr) & 0xff;
      }
      scanline[i] = val;
    }
    prevScanline = scanline;

    for (let x = 0; x < width; x++) {
      const outIdx = (y * width + x) * 4;
      if (colorType === 6) {
        rgba[outIdx] = scanline[x * 4];
        rgba[outIdx + 1] = scanline[x * 4 + 1];
        rgba[outIdx + 2] = scanline[x * 4 + 2];
        rgba[outIdx + 3] = scanline[x * 4 + 3];
      }
    }
  }
  return { width, height, rgba };
}

// 2. PNG Encoder using pure Node.js
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);

  const crcPayload = Buffer.concat([typeBuf, data]);
  const crcVal = crc32(crcPayload);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crcVal, 0);

  return Buffer.concat([len, crcPayload, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type RGBA
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdrChunk = makeChunk("IHDR", ihdrData);

  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const scanlineOffset = y * (1 + width * 4);
    scanlines[scanlineOffset] = 0; // Filter None
    rgba.copy(scanlines, scanlineOffset + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = zlib.deflateSync(scanlines, { level: 9 });
  const idatChunk = makeChunk("IDAT", compressed);
  const iendChunk = makeChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

// 3. Resampler for 128x128 icon with bilinear interpolation
function resampleRgba(srcRgba, srcW, srcH, cropMinX, cropMinY, cropMaxX, cropMaxY, targetSize) {
  const targetRgba = Buffer.alloc(targetSize * targetSize * 4);
  const cropW = cropMaxX - cropMinX + 1;
  const cropH = cropMaxY - cropMinY + 1;

  // Preserve aspect ratio and center inside targetSize x targetSize with ~6% margin
  const margin = Math.round(targetSize * 0.06);
  const availSize = targetSize - margin * 2;
  const scale = Math.min(availSize / cropW, availSize / cropH);
  const drawW = Math.round(cropW * scale);
  const drawH = Math.round(cropH * scale);
  const offsetX = Math.round((targetSize - drawW) / 2);
  const offsetY = Math.round((targetSize - drawH) / 2);

  for (let ty = 0; ty < targetSize; ty++) {
    for (let tx = 0; tx < targetSize; tx++) {
      const outIdx = (ty * targetSize + tx) * 4;
      const relX = tx - offsetX;
      const relY = ty - offsetY;
      if (relX < 0 || relX >= drawW || relY < 0 || relY >= drawH) {
        // Outside drawn area: fully transparent
        targetRgba[outIdx] = 0;
        targetRgba[outIdx + 1] = 0;
        targetRgba[outIdx + 2] = 0;
        targetRgba[outIdx + 3] = 0;
        continue;
      }

      // Continuous coordinates in crop area
      const srcCoordX = cropMinX + (relX / drawW) * cropW;
      const srcCoordY = cropMinY + (relY / drawH) * cropH;

      const x0 = Math.floor(srcCoordX);
      const x1 = Math.min(x0 + 1, srcW - 1);
      const y0 = Math.floor(srcCoordY);
      const y1 = Math.min(y0 + 1, srcH - 1);
      const dx = srcCoordX - x0;
      const dy = srcCoordY - y0;

      // Sample 4 neighbors
      const idx00 = (y0 * srcW + x0) * 4;
      const idx10 = (y0 * srcW + x1) * 4;
      const idx01 = (y1 * srcW + x0) * 4;
      const idx11 = (y1 * srcW + x1) * 4;

      for (let c = 0; c < 4; c++) {
        const val =
          (1 - dx) * (1 - dy) * srcRgba[idx00 + c] +
          dx * (1 - dy) * srcRgba[idx10 + c] +
          (1 - dx) * dy * srcRgba[idx01 + c] +
          dx * dy * srcRgba[idx11 + c];
        targetRgba[outIdx + c] = Math.round(val);
      }
    }
  }
  return targetRgba;
}

// 4. Main script execution
const rootPngPath = path.resolve("UNDRIFT.png");
if (!fs.existsSync(rootPngPath)) {
  console.error("UNDRIFT.png not found at root!");
  process.exit(1);
}

const masterBuf = fs.readFileSync(rootPngPath);
const { width, height, rgba } = decodePng(masterBuf);
console.log(`Decoded UNDRIFT.png: ${width}x${height}, buffer size: ${masterBuf.length}`);

// Find bounding box where alpha > 10
let minX = width,
  minY = height,
  maxX = 0,
  maxY = 0;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    // If x < 60 and y < 60 and alpha < 15, clear it (the tiny corner compression artifact)
    const idx = (y * width + x) * 4;
    if (x < 60 && y < 60 && rgba[idx + 3] < 15) {
      rgba[idx + 3] = 0;
    }
    const a = rgba[idx + 3];
    if (a > 10) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
}
console.log(
  `Cleaned BBox: x=[${minX}, ${maxX}], y=[${minY}, ${maxY}], w=${maxX - minX + 1}, h=${maxY - minY + 1}`
);

const resDir = path.resolve("apps/vscode-extension/resources");
if (!fs.existsSync(resDir)) {
  fs.mkdirSync(resDir, { recursive: true });
}

// A. undrift-master.png (copy of original source image)
fs.writeFileSync(path.join(resDir, "undrift-master.png"), masterBuf);
console.log("Saved undrift-master.png");

// B. undrift-light.png (recolored to pure white #ffffff preserving exact alpha)
const lightRgba = Buffer.alloc(width * height * 4);
for (let i = 0; i < width * height; i++) {
  const a = rgba[i * 4 + 3];
  lightRgba[i * 4] = 255;
  lightRgba[i * 4 + 1] = 255;
  lightRgba[i * 4 + 2] = 255;
  lightRgba[i * 4 + 3] = a;
}
const lightPngBuf = encodePng(width, height, lightRgba);
fs.writeFileSync(path.join(resDir, "undrift-light.png"), lightPngBuf);
console.log(`Saved undrift-light.png (${lightPngBuf.length} bytes)`);

// C. undrift-dark.png (recolored to dark #1f2328 preserving exact alpha)
const darkRgba = Buffer.alloc(width * height * 4);
for (let i = 0; i < width * height; i++) {
  const a = rgba[i * 4 + 3];
  darkRgba[i * 4] = 31; // #1f
  darkRgba[i * 4 + 1] = 35; // #23
  darkRgba[i * 4 + 2] = 40; // #28
  darkRgba[i * 4 + 3] = a;
}
const darkPngBuf = encodePng(width, height, darkRgba);
fs.writeFileSync(path.join(resDir, "undrift-dark.png"), darkPngBuf);
console.log(`Saved undrift-dark.png (${darkPngBuf.length} bytes)`);

// D. undrift-icon.png (128x128 extension icon)
// We create a crisp high-res 128x128 icon with dark mark (or balanced)
const iconRgba = resampleRgba(darkRgba, width, height, minX, minY, maxX, maxY, 128);
const iconPngBuf = encodePng(128, 128, iconRgba);
fs.writeFileSync(path.join(resDir, "undrift-icon.png"), iconPngBuf);
console.log(`Saved undrift-icon.png (${iconPngBuf.length} bytes)`);

// E. undrift.svg (24x24 single-color Activity Bar icon from vector paths)
const undriftSvgPath = path.resolve("UNDRIFT.svg");
if (fs.existsSync(undriftSvgPath)) {
  const content = fs.readFileSync(undriftSvgPath, "utf8");
  const paths = [...content.matchAll(/<path fill="([^"]+)" d="([^"]+)"/g)].map((m) => ({
    fill: m[1],
    d: m[2]
  }));
  const darkPaths = paths.filter((p) => p.fill !== "#ffffff");

  // BBox of dark paths: x: [32.015625, 365.414062], y: [44.890625, 324.042969]
  // width: 333.398437, height: 279.152344
  // Target width = 20.5 inside 24x24 canvas
  const scale = 20.5 / 333.398437;
  const targetH = 279.152344 * scale;
  const offsetX = (24 - 20.5) / 2; // 1.75
  const offsetY = (24 - targetH) / 2; // ~3.42

  const svg24 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <g fill="currentColor" transform="translate(${offsetX.toFixed(2)}, ${offsetY.toFixed(2)}) scale(${scale.toFixed(6)}) translate(-32.015625, -44.890625)">
${darkPaths.map((p) => `    <path d="${p.d}" />`).join("\n")}
  </g>
</svg>
`;

  fs.writeFileSync(path.join(resDir, "undrift.svg"), svg24);
  console.log(`Saved undrift.svg (${svg24.length} bytes)`);
}

console.log("All brand assets successfully generated in apps/vscode-extension/resources!");
