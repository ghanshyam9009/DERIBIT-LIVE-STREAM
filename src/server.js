import express from "express";
import http from "http";
import cors from "cors";
import { WebSocketServer } from "ws";
import bodyParser from "body-parser";
import userWsRouter from "./userWsRouter.js";
import {
  fetchAndSaveSymbolsByCurrency,
  readSymbolsFromCSVsByCurrency,
} from "./services/fetchSymbols.js";
import { startDeltaWebSocket } from "./services/deltaWsHandler.js";
import { startWebSocketForCurrency } from "./services/wsHandler.js";
import config from "./config/index.js";
import { clearCSVs } from "./utils/fileUtils.js";
import path from "path";
import dotenv from "dotenv";

// ⬇️ new imports
import {
  createQueueWebSocket,
  queueConnections,
  resendPendingMessages,
} from "./services/queueWs.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use("/", userWsRouter);

const server = http.createServer(app);

// ──────────────────────────
// Existing WebSocket servers
// ──────────────────────────
const wss = new WebSocketServer({ noServer: true });            // user
const positionWss = new WebSocketServer({ noServer: true });    // position
const orderTrackingWss = new WebSocketServer({ noServer: true });// order tracking

// ✅ NEW: completely independent queue socket
const queueWss = createQueueWebSocket();

const userConnections = new Map();
const positionConnections = new Map();
const orderTrackingConnections = new Set();

app.set("userConnections", userConnections);
app.set("positionConnections", positionConnections);
app.set("orderTrackingConnections", orderTrackingConnections);

// ──────────────────────────
// Symbol + Deribit startup
// ──────────────────────────
async function initializeSymbolAndWebSocket() {
  try {
    console.log("🧹 Clearing CSV files...");
    const csvFolderPath = path.resolve("./data");
    clearCSVs(csvFolderPath);

    console.log("🚀 Starting Deribit Symbol Service...");
    for (const currency of config.currencies) {
      await fetchAndSaveSymbolsByCurrency(currency);
      const symbols = await readSymbolsFromCSVsByCurrency(currency);
      startWebSocketForCurrency(currency, symbols);
    }
    await startDeltaWebSocket();
  } catch (err) {
    console.error("❌ Error initializing symbols and WebSocket:", err);
  }
}

initializeSymbolAndWebSocket();

// ──────────────────────────
// WebSocket upgrade handler
// ──────────────────────────


server.on("upgrade", async (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const userId = url.searchParams.get("userId");
  const category = url.searchParams.get("category");
  if (!category) return socket.destroy();

  // ✅ Queue WS (independent)
  if (["web", "mobile", "audit"].includes(category)) {
    if (!userId) return socket.destroy();
    queueWss.handleUpgrade(req, socket, head, async (ws) => {
      const key = `${userId}:${category}`;
      queueConnections.set(key, ws);
      console.log(`🔗 [Queue ${category}] User ${userId} connected`);

      // send undelivered (<24 hrs) pending messages on connect
      await resendPendingMessages(userId, category, ws);

      ws.on("message", (msg) => {
        try {
          const data = JSON.parse(msg.toString());
          if (data.type === "ping") {
            ws.send(JSON.stringify({ type: "pong" }));
          }
        } catch (err) {
          console.error("Invalid message on queue socket:", err);
        }
      });

      ws.on("close", () => {
        queueConnections.delete(key);
        console.log(`❌ [Queue ${category}] User ${userId} disconnected`);
      });
    });
    return;
  }

  // ✅ Existing sockets
  if (category === "position") {
    if (!userId) return socket.destroy();
    positionWss.handleUpgrade(req, socket, head, (ws) => {
      positionConnections.set(userId, ws);
      console.log(`🔗 [Position] User ${userId} connected`);

      ws.on("message", (msg) => {
        try {
          const data = JSON.parse(msg.toString());
          if (data.type === "ping") {
            ws.send(JSON.stringify({ type: "pong" }));
          }
        } catch (err) {
          console.error("Invalid message:", err);
        }
      });

      ws.on("close", () => {
        positionConnections.delete(userId);
        console.log(`❌ [Position] User ${userId} closed`);
      });
    });
  } else if (category === "ordertracking") {
    orderTrackingWss.handleUpgrade(req, socket, head, (ws) => {
      orderTrackingConnections.add(ws);
      console.log("🔗 [OrderTracking] connection established");

      ws.on("close", () => {
        orderTrackingConnections.delete(ws);
        console.log("❌ [OrderTracking] connection closed");
      });
    });
  } else {
    if (!userId) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => {
      userConnections.set(userId, ws);
      console.log(`🔗 [User] ${userId} connected`);

      ws.on("message", (msg) => {
        try {
          const data = JSON.parse(msg.toString());
          if (data.type === "ping") {
            ws.send(JSON.stringify({ type: "pong" }));
          }
        } catch (err) {
          console.error("Invalid message:", err);
        }
      });

      ws.on("close", () => {
        userConnections.delete(userId);
        console.log(`❌ [User] ${userId} closed`);
      });
    });
  }
});

// 🔁 Restart endpoint
app.post("/restart-server", async (_req, res) => {
  try {
    console.log("♻️ Restart requested via API");
    setTimeout(() => process.exit(1), 2000); // Let PM2/EC2 restart
    res.json({ status: "restarting" });
  } catch (err) {
    console.error("❌ Restart failed:", err);
    res.status(500).json({ error: "Failed to restart server" });
  }
});

server.listen(3000, () => {
  console.log("🚀 Server running on http://localhost:3000");
});

export { userConnections, positionConnections, orderTrackingConnections };


