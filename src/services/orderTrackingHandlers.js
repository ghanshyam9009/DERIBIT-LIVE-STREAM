
import { getDeltaSymbolData } from './deltaSymbolStore.js';
import { getSymbolDataByDate } from './symbolStore.js';
import { getCurrencyAndDateFromSymbol, isFuturesSymbol, isOptionSymbol } from '../utils/symbolUtils.js';

// Global Set of tracked symbols
export const trackedSymbols = new Set();


function normalizeToBinanceSymbol(symbol) {
  if (!symbol) return '';
  return symbol.endsWith('USDT') ? symbol : symbol.replace('USD', 'USDT');
}

// Subscribe a symbol globally
export function subscribeSymbol(req, res) {
  const { symbol } = req.body;
  const connections = req.app.get('orderTrackingConnections'); // Assume Set of WS clients

  if (!symbol || typeof symbol !== 'string') {
    return res.status(400).send("Missing or invalid symbol");
  }

  trackedSymbols.add(symbol);

  // Immediately broadcast data for this symbol to all connected clients
  broadcastOrderTracking(symbol, connections);

  res.send(`Subscribed to symbol ${symbol}`);
}

// Unsubscribe a symbol globally
export function unsubscribeSymbol(req, res) {
  const { symbol } = req.body;
  const connections = req.app.get('orderTrackingConnections');

  if (!symbol || typeof symbol !== 'string') {
    return res.status(400).send("Missing or invalid symbol");
  }

  if (!trackedSymbols.has(symbol)) {
    return res.status(400).send(`Symbol ${symbol} not currently subscribed`);
  }

  trackedSymbols.delete(symbol);

  // Broadcast to all clients that this symbol is unsubscribed
  broadcastSymbolUpdate(connections, 'unsubscribed', symbol, null);

  res.send(`Unsubscribed from symbol ${symbol}`);
}

// Close all order tracking WebSocket connections
export function cancelOrderTrackingWss(req, res) {
    const connections = req.app.get('orderTrackingConnections');
    console.log(`Closing ${connections.size} orderTracking WebSocket connections...`);
  
    for (const ws of connections) {
      ws.close();
  
      ws.on('close', () => {
        connections.delete(ws);
      });
    }
  
    // Clear the tracked symbols (reset the tracking state)
    trackedSymbols.clear();
  
    // Clear connections after some delay to ensure all closed properly
    setTimeout(() => {
      connections.clear();
      console.log('All order tracking connections and tracked symbols cleared.');
    }, 2000);
  
    res.send("All OrderTracking WebSocket connections closed and tracking data cleared.");
  }

// Get count of active order tracking WS connections
export function getOrderTrackingWss(req, res) {
  const connections = req.app.get('orderTrackingConnections');
  res.send({ activeConnections: connections.size });
}


// Global state: collected mark prices for all symbols
export const latestBroadcastData = {};

export function broadcastOrderTracking(symbol, connections, symbolData = null) {
  if (!symbol || !trackedSymbols.has(symbol)) return;

  // const rawData = symbolData || (
  //   isFuturesSymbol(symbol)
  //     ? getDeltaSymbolData(symbol)
  //     : getSymbolDataByDate(...getCurrencyAndDateFromSymbol(symbol), symbol)
  // );

  const normalizedSymbol = normalizeToBinanceSymbol(symbol);

  const rawData = symbolData || (
    isFuturesSymbol(normalizedSymbol)
      ? getDeltaSymbolData(normalizedSymbol) // ✅ switch later to getBinanceFuturesData(normalizedSymbol)
      : getSymbolDataByDate(...getCurrencyAndDateFromSymbol(symbol), symbol)
  );  



  if (!rawData || typeof rawData !== 'object') return;

  // Normalize mark price
  let markPrice;

  if (isFuturesSymbol(symbol)) {
    markPrice = parseFloat(rawData.mark_price || rawData?.quotes?.mark_price || 0);
  } else if (isOptionSymbol(symbol)) {
    // Try calculated.best_ask_price.value first, then fallback to originalData.mark_price
    markPrice = parseFloat(
      rawData.calculated?.mark_price?.value ??
      rawData.originalData?.mark_price ??
      rawData.originalData?.last_price ??
      0
    );
  }  

  if (!markPrice || isNaN(markPrice)) return;

  // Update global object
  latestBroadcastData[symbol] = { mark_price: markPrice };

  const message = JSON.stringify({
    type: 'order-tracking-data',
    data: latestBroadcastData
  });

  for (const ws of connections) {
    if (ws.readyState === 1) {
      try {
        ws.send(message);
      } catch (err) {
        console.error(`[WS Error] Failed to send for ${symbol}`, err);
      }
    }
  }
}


// Internal function to send JSON data to all connected clients
function broadcastSymbolUpdate(connections, type, symbol, data) {
  for (const ws of connections) {
    if (ws.readyState === 1) { // OPEN state
      try {
        ws.send(JSON.stringify({
          type,
          symbol,
          data
        }));
      } catch (e) {
        console.error(`Failed to send WS message for symbol ${symbol}`, e);
      }
    }
  }
}

// Broadcast all currently tracked symbols to all clients (optional)
export function broadcastAllTrackedSymbols(req, res) {
  const connections = req.app.get('orderTrackingConnections');

  if (trackedSymbols.size === 0) {
    return res.send('No tracked symbols to broadcast.');
  }

  for (const symbol of trackedSymbols) {
    broadcastOrderTracking(symbol, connections);
  }

  res.send(`Broadcasted all tracked symbols data to ${connections.size} connections`);
}
