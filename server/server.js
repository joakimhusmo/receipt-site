// receipt-site/server/server.js
const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "5mb" }));

// serve the website
const webPath = path.join(__dirname, "..", "web");
app.use(express.static(webPath));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// agents connected here by locationId
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

// website posts here → forward to agent
app.post("/print/:locationId", (req, res) => {
  const { locationId } = req.params;
  const sock = agents.get(locationId);

  const payload = {};
  if (typeof req.body.text === "string") payload.text = req.body.text.slice(0, 2000);
  if (typeof req.body.png === "string")  payload.png  = req.body.png;

  if (!payload.text && !payload.png) {
    return res.status(400).json({ error: "No text or png" });
  }

  if (!sock) {
    return res.status(404).json({ error: "Printer agent not online" });
  }

  sock.emit("job:print", payload);
  res.json({ ok: true });
});

app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Cloud server on http://localhost:${PORT}`));