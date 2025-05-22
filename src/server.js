import express from 'express';
import http from 'http';
import cors from 'cors'; // ✅ Import CORS
import { WebSocketServer } from 'ws';
import bodyParser from 'body-parser';
import userWsRouter from './userWsRouter.js';
import { fetchAndSaveSymbolsByCurrency, readSymbolsFromCSVsByCurrency } from './services/fetchSymbols.js';
import { startDeltaWebSocket } from './services/deltaWsHandler.js';

import { startWebSocketForCurrency } from './services/wsHandler.js';
import config from './config/index.js';

const app = express();

app.use(cors()); // ✅ Enable CORS for all origins

app.use(bodyParser.json());
app.use('/', userWsRouter);
//raw

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const userConnections = new Map(); // Map<userId, WebSocket>

// Function to start the symbol fetching and WebSocket initialization
async function initializeSymbolAndWebSocket() {
  try {
    console.log('🚀 Starting Deribit Symbol Service...');

    for (const currency of config.currencies) {
      // Fetch and save symbols by currency
      await fetchAndSaveSymbolsByCurrency(currency);

      // Read symbols from CSV files
      const symbols = await readSymbolsFromCSVsByCurrency(currency);

      // Start WebSocket for the given currency and symbols
      startWebSocketForCurrency(currency, symbols);
    }

    
    // ✅ Start Delta WebSocket after Deribit setup
    await startDeltaWebSocket();
    
  } catch (err) {
    console.error('❌ Error initializing symbols and WebSocket:', err);
  }
}

// Call the function to initialize symbol and WebSocket logic on server startup
initializeSymbolAndWebSocket();

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const userId = url.searchParams.get('userId');

  if (!userId) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, ws => {
    userConnections.set(userId, ws);
    console.log(`🔗 [User ${userId}] WebSocket connected`);

    ws.on('close', () => {
      userConnections.delete(userId);
      console.log(`❌ [User ${userId}] WebSocket closed`);
    });
  });
});

app.set('userConnections', userConnections);

// Start the server
server.listen(3000, () => {
  console.log('🚀 Server running on http://localhost:3000');
});


export { userConnections };
