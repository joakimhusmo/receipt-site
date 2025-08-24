// receipt-site/agent.js
const { io } = require("socket.io-client");
const { printDirect, getDefaultPrinterName } = require("@thiagoelg/node-printer");
const iconv = require("iconv-lite");
const { PNG } = require("pngjs");

const SERVER = "https://lettertotheforestandthesun.onrender.com";
const LOCATION_ID = "oslo-gallery-1";          // must match index.html
const SECRET = "dev-secret";                   // any string for local test
const PRINTER = getDefaultPrinterName();       // or your printer name

console.log("[agent] starting…", { SERVER, LOCATION_ID, PRINTER });

function rgbaToEscPosRaster(rgba, width, height, threshold = 160) {
  const bytesPerRow = Math.ceil(width / 8);
  const out = Buffer.alloc(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = rgba[i], g = rgba[i+1], b = rgba[i+2], a = rgba[i+3];
      const rr = (a * r + (255 - a) * 255) / 255;
      const gg = (a * g + (255 - a) * 255) / 255;
      const bb = (a * b + (255 - a) * 255) / 255;
      const lum = 0.299*rr + 0.587*gg + 0.114*bb;
      const bit = lum < 160 ? 1 : 0;
      const byteIndex = y * bytesPerRow + (x >> 3);
      const bitPos = 7 - (x & 7);
      if (bit) out[byteIndex] |= (1 << bitPos);
    }
  }
  const xL = bytesPerRow & 0xff, xH = (bytesPerRow >> 8) & 0xff;
  const yL = height & 0xff,      yH = (height >> 8) & 0xff;
  const header = Buffer.from([0x1d, 0x76, 0x30, 0x00, xL, xH, yL, yH]);
  return Buffer.concat([header, out]);
}

function printText(text) {
  const ESC_INIT = Buffer.from([0x1b, 0x40]);
  const FEED     = Buffer.from([0x0a, 0x0a]);
  const CUT      = Buffer.from([0x1d, 0x56, 0x00]);
  const CONTENT  = iconv.encode((text || "") + "\n", "cp850");
  const data     = Buffer.concat([ESC_INIT, CONTENT, FEED, CUT]);
  return new Promise((resolve, reject) => {
    printDirect({ data, printer: PRINTER, type: "RAW", success: resolve, error: reject });
  });
}

function printImage(dataURL) {
  const base64 = dataURL.replace(/^data:image\/png;base64,/, "");
  const buf = Buffer.from(base64, "base64");
  const png = PNG.sync.read(buf);

  console.log(`[agent] PNG size: ${png.width} x ${png.height}`);
  console.log(`[agent] PNG bytes: ${buf.length}`);

  const raster = rgbaToEscPosRaster(png.data, png.width, png.height, 160);
  const init = Buffer.from([0x1b, 0x40]);
  const center = Buffer.from([0x1b, 0x61, 0x01]);
  const feed = Buffer.from([0x0a, 0x0a]);
  const cut = Buffer.from([0x1d, 0x56, 0x00]);
  const data = Buffer.concat([init, center, raster, feed, cut]);

  return new Promise((resolve, reject) => {
    printDirect({ data, printer: PRINTER, type: "RAW", success: resolve, error: reject });
  });
}

function run() {
  const socket = io(SERVER, { transports: ["websocket"] });
  socket.on("connect", () => {
    console.log("[agent] connected to cloud");
    socket.emit("agent:hello", { locationId: LOCATION_ID, secret: SECRET });
  });
  socket.on("agent:ack", () => console.log("[agent] registered with cloud"));
  socket.on("job:print", async ({ text, png }) => {
  console.log("[agent] job received", { hasText: !!text, hasPng: !!png });
  try {
    if (png) await printImage(png);
    else     await printText(text || "");
    console.log("[agent] printed");
    socket.emit("job:done", { ok: true });
  } catch (e) {
    console.error("[agent] print error:", e);
    socket.emit("job:done", { ok: false, error: String(e) });
  }
});
  socket.on("disconnect", () => console.log("[agent] disconnected"));
}

run();