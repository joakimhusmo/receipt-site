const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors({ origin: "*" }));

// Accept JSON + large Data URLs + optional text/plain
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ limit: "20mb", extended: true }));
app.use(express.text({ type: "text/plain" }));

// serve the website
const webPath = path.join(__dirname, "..", "web");
app.use(express.static(webPath));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Connected agents by locationId
const agents = new Map();

io.on("connection", (socket) => {
  socket.on("agent:hello", ({ locationId, secret }) => {
    if (!locationId || !secret) return socket.disconnect(true);
    agents.set(locationId, socket);
    console.log(`[cloud] agent online: ${locationId}`);
    socket.emit("agent:ack", { ok: true });
    socket.on("disconnect", () => {
      agents.delete(locationId);
      console.log(`[cloud] agent offline: ${locationId}`);
    });
  });
});

// ---------- helpers ----------
function getLocationId(req) {
  return (
    req.params.locationId ||
    req.body.locationId ||
    req.query.locationId
  );
}

function forwardToAgent(req, res) {
  const locationId = getLocationId(req);
  const sock = locationId ? agents.get(locationId) : null;

  // build payload once; accept either text or png
  const payload = {};
  if (typeof req.body?.text === "string")
    payload.text = req.body.text.slice(0, 2000);
  if (typeof req.body?.png === "string")
    payload.png = req.body.png;

  console.log("=== Print Request ===");
  console.log("Location:", locationId || "(missing)");
  console.log("Has Text:", !!payload.text);
  console.log("Has PNG:", !!payload.png);
  console.log("=====================");

  if (!payload.text && !payload.png) {
    return res.status(400).json({ error: "No text or png" });
  }
  if (!sock) {
    return res.status(404).json({ error: "Printer agent not online" });
  }

  sock.emit("job:print", payload);
  return res.json({ ok: true });
}

// ---------- routes ----------
// Accept either shape the web might call:
app.post("/print", forwardToAgent);
app.post("/print/:locationId", forwardToAgent);

// Alias for “image only” (we still accept both text/png for simplicity)
app.post("/print-image", forwardToAgent);
app.post("/print-image/:locationId", forwardToAgent);

app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Cloud server on http://localhost:${PORT}`);
});