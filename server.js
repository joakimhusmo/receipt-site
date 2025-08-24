const express = require("express");
const { printDirect, getDefaultPrinterName, getPrinters } = require("@thiagoelg/node-printer");
const iconv = require("iconv-lite");
const { PNG } = require("pngjs"); // <— NEW: decode PNGs

const app = express();
app.use(express.json({ limit: "5mb" }));     // allow small PNG payloads
app.use(express.static("public"));

const PRINTER = process.env.PRINTER || getDefaultPrinterName();

// Debug: list printers
app.get("/printers", (_req, res) => res.json(getPrinters()));

// -------------------------- Plain text print ------------------------------
app.post("/print", (req, res) => {
  const text = String(req.body?.text ?? "").slice(0, 2000);
  if (!text.trim()) return res.status(400).json({ error: "Empty text" });

  const ESC_INIT = Buffer.from([0x1b, 0x40]);       // ESC @
  const FEED     = Buffer.from([0x0a, 0x0a]);       // LF x2
  const CUT      = Buffer.from([0x1d, 0x56, 0x00]); // GS V 0 (full cut)

  // Try "win1252" or "cp865" if æ/ø/å look wrong
  const CONTENT  = iconv.encode(text + "\n", "cp850");
  const data     = Buffer.concat([ESC_INIT, CONTENT, FEED, CUT]);

  printDirect({
    data,
    printer: PRINTER,
    type: "RAW",
    success: () => res.json({ ok: true, printer: PRINTER }),
    error: (err) => res.status(500).json({ error: String(err) }),
  });
});

// ----------------------- Image print (custom font) ------------------------
// Frontend should POST { png: "data:image/png;base64,..." }
app.post("/print-image", (req, res) => {
  try {
    const dataURL = String(req.body?.png || "");
    if (!dataURL.startsWith("data:image/png;base64,")) {
      return res.status(400).json({ error: "Invalid PNG dataURL" });
    }

    // Decode the PNG to RGBA pixels
    const base64 = dataURL.replace(/^data:image\/png;base64,/, "");
    const pngBuf = Buffer.from(base64, "base64");
    const png = PNG.sync.read(pngBuf); // { width, height, data: RGBA }

    // Convert to ESC/POS raster (GS v 0)
    const threshold = 160; // lower = darker; tweak 120–190 to taste
    const raster = rgbaToEscPosRaster(png.data, png.width, png.height, threshold);

    const init   = Buffer.from([0x1b, 0x40]);       // ESC @
    const center = Buffer.from([0x1b, 0x61, 0x01]); // ESC a 1 (center)
    const feed   = Buffer.from([0x0a, 0x0a]);
    const cut    = Buffer.from([0x1d, 0x56, 0x00]); // full cut
    const data   = Buffer.concat([init, center, raster, feed, cut]);

    printDirect({
      data,
      printer: PRINTER,
      type: "RAW",
      success: () => res.json({ ok: true, printer: PRINTER }),
      error: (err) => res.status(500).json({ error: String(err) }),
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * Convert RGBA pixels to ESC/POS raster format (GS v 0).
 * threshold: 0..255; pixels darker than threshold are printed black.
 */
function rgbaToEscPosRaster(rgba, width, height, threshold = 160) {
  const bytesPerRow = Math.ceil(width / 8);
  const out = Buffer.alloc(bytesPerRow * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], a = rgba[i + 3];

      // Composite over white background
      const rr = (a * r + (255 - a) * 255) / 255;
      const gg = (a * g + (255 - a) * 255) / 255;
      const bb = (a * b + (255 - a) * 255) / 255;

      // Luminance -> 1-bit
      const lum = 0.299 * rr + 0.587 * gg + 0.114 * bb;
      const bit = (lum < threshold) ? 1 : 0;

      const byteIndex = y * bytesPerRow + (x >> 3);
      const bitPos = 7 - (x & 7); // MSB is leftmost pixel
      if (bit) out[byteIndex] |= (1 << bitPos);
    }
  }

  // ESC/POS GS v 0 m xL xH yL yH [data]
  const m  = 0x00; // normal density
  const xL =  bytesPerRow        & 0xff;
  const xH = (bytesPerRow >> 8)  & 0xff;
  const yL =  height             & 0xff;
  const yH = (height     >> 8)   & 0xff;
  const header = Buffer.from([0x1d, 0x76, 0x30, m, xL, xH, yL, yH]);
  return Buffer.concat([header, out]);
}

const PORT = 3000;
app.listen(PORT, () =>
  console.log(`Server running at http://localhost:${PORT}\nUse GET /printers to list installed printers.`)
);