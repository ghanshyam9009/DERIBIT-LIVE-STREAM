
import express from 'express';
import http from 'http';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import bodyParser from 'body-parser';
import userWsRouter from './userWsRouter.js';
import { fetchAndSaveSymbolsByCurrency, readSymbolsFromCSVsByCurrency } from './services/fetchSymbols.js';
import { startDeltaWebSocket } from './services/deltaWsHandler.js';
import { startWebSocketForCurrency } from './services/wsHandler.js';
import config from './config/index.js';

const app = express();

app.use(cors());
app.use(bodyParser.json());
app.use('/', userWsRouter);

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const positionWss = new WebSocketServer({ noServer: true });
const limitOrderWss = new WebSocketServer({ noServer: true });

const userConnections = new Map(); // Main user connections map
const positionConnections = new Map(); // Position WebSocket connections
const limitOrderConnections = new Map(); // Limit Order WebSocket connections

// Function to initialize symbol and WebSocket logic for each category
async function initializeSymbolAndWebSocket() {
  try {
    console.log('🚀 Starting Deribit Symbol Service...');
    for (const currency of config.currencies) {
      await fetchAndSaveSymbolsByCurrency(currency);
      const symbols = await readSymbolsFromCSVsByCurrency(currency);
      startWebSocketForCurrency(currency, symbols);
    }
    await startDeltaWebSocket();
  } catch (err) {
    console.error('❌ Error initializing symbols and WebSocket:', err);
  }
}

initializeSymbolAndWebSocket();

// Handle WebSocket connections for the main connection, position, and limitorder categories
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const userId = url.searchParams.get('userId');
  const category = url.searchParams.get('category');

  if (!userId || !category) {
    socket.destroy();
    return;
  }

  if (category === 'position') {
    positionWss.handleUpgrade(req, socket, head, (ws) => {
      positionConnections.set(userId, ws);
      console.log(`🔗 [Position - User ${userId}] WebSocket connected`);

      ws.on('close', () => {
        positionConnections.delete(userId);
        console.log(`❌ [Position - User ${userId}] WebSocket closed`);
      });
    });
  } else if (category === 'limitorder') {
    limitOrderWss.handleUpgrade(req, socket, head, (ws) => {
      limitOrderConnections.set(userId, ws);
      console.log(`🔗 [LimitOrder - User ${userId}] WebSocket connected`);

      ws.on('close', () => {
        limitOrderConnections.delete(userId);
        console.log(`❌ [LimitOrder - User ${userId}] WebSocket closed`);
      });
    });
  } else {
    wss.handleUpgrade(req, socket, head, (ws) => {
      userConnections.set(userId, ws);
      console.log(`🔗 [User ${userId}] WebSocket connected`);

      ws.on('close', () => {
        userConnections.delete(userId);
        console.log(`❌ [User ${userId}] WebSocket closed`);
      });
    });
  }
});

app.set('userConnections', userConnections);
app.set('positionConnections', positionConnections);


// Start the server
server.listen(3000, () => {
  console.log('🚀 Server running on http://localhost:3000');
});




export { userConnections };
export {positionConnections};





