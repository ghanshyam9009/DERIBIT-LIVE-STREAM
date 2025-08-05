

import { getDeltaSymbolData } from './deltaSymbolStore.js';
import { getSymbolDataByDate } from './symbolStore.js';
import {
  getCurrencyAndDateFromSymbol,
  isOptionSymbol,
} from '../utils/symbolUtils.js';

// -------------------------
// Global State
// -------------------------
export const trackedSymbols = new Set();
export const latestBroadcastData = {};

// -------------------------
// Helpers
// -------------------------
function normalizeToBinanceSymbol(symbol) {
  if (!symbol) return '';
  return symbol.endsWith('USDT') ? symbol : symbol.replace('USD', 'USDT');
}

function getInternalSymbol(symbol) {
  return normalizeToBinanceSymbol(symbol);
}

function isBinanceFuturesSymbol(symbol) {
  return typeof symbol === 'string' && symbol.endsWith('USDT');
}

// -------------------------
// WebSocket Broadcast Helpers
// -------------------------
function broadcastSymbolUpdate(connections, type, symbol, data) {
  for (const ws of connections) {
    if (ws.readyState === 1) {
      try {
        ws.send(JSON.stringify({ type, symbol, data }));
      } catch (e) {
        console.error(`Failed to send WS message for symbol ${symbol}`, e);
      }
    }
  }
}

// -------------------------
// Public Functions
// -------------------------
export function subscribeSymbol(req, res) {
  let { symbol } = req.body;
  const connections = req.app.get('orderTrackingConnections');

  if (!symbol || typeof symbol !== 'string') {
    return res.status(400).send('Missing or invalid symbol');
  }

  symbol = normalizeToBinanceSymbol(symbol); // Ensure normalized

  trackedSymbols.add(symbol);
  broadcastOrderTracking(symbol, connections);

  res.send(`Subscribed to symbol ${symbol}`);
}

export function unsubscribeSymbol(req, res) {
  let { symbol } = req.body;
  const connections = req.app.get('orderTrackingConnections');

  if (!symbol || typeof symbol !== 'string') {
    return res.status(400).send('Missing or invalid symbol');
  }

  symbol = normalizeToBinanceSymbol(symbol);

  if (!trackedSymbols.has(symbol)) {
    return res.status(400).send(`Symbol ${symbol} not currently subscribed`);
  }

  trackedSymbols.delete(symbol);
  broadcastSymbolUpdate(connections, 'unsubscribed', symbol, null);

  res.send(`Unsubscribed from symbol ${symbol}`);
}

export function cancelOrderTrackingWss(req, res) {
  const connections = req.app.get('orderTrackingConnections');
  console.log(`Closing ${connections.size} orderTracking WebSocket connections...`);

  for (const ws of connections) {
    ws.close();
    ws.on('close', () => connections.delete(ws));
  }

  trackedSymbols.clear();

  setTimeout(() => {
    connections.clear();
    console.log('All order tracking connections and tracked symbols cleared.');
  }, 2000);

  res.send('All OrderTracking WebSocket connections closed and tracking data cleared.');
}

export function getOrderTrackingWss(req, res) {
  const connections = req.app.get('orderTrackingConnections');
  res.send({ activeConnections: connections.size });
}

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




export function broadcastOrderTracking(symbol, connections, symbolData = null) {
  const normalized = normalizeToBinanceSymbol(symbol);

  if (!trackedSymbols.has(normalized)) return;

  const isFutures = isBinanceFuturesSymbol(normalized);
  const isOption = isOptionSymbol(normalized);

  const rawData =
    symbolData ||
    (isFutures
      ? getDeltaSymbolData(normalized)
      : getSymbolDataByDate(...getCurrencyAndDateFromSymbol(normalized), normalized));

  if (!rawData || typeof rawData !== 'object') {
    console.log(`[OrderTracking] No valid data for symbol: ${normalized}`);
    return;
  }

  let markPrice = 0;

  if (isFutures) {
    markPrice = parseFloat(rawData.mark_price || rawData?.quotes?.mark_price || 0);
  } else if (isOption) {
    markPrice = parseFloat(
      rawData.calculated?.mark_price?.value ??
      rawData.originalData?.mark_price ??
      rawData.originalData?.last_price ??
      0
    );
  } else {
    console.log(`[OrderTracking] Unknown symbol type for: ${normalized}`);
    return;
  }

  if (!markPrice || isNaN(markPrice)) {
    console.log(`[OrderTracking] Invalid markPrice for symbol: ${normalized}`, rawData);
    return;
  }

  // ✅ Rename key if it's a futures symbol (e.g., BTCUSDT → BTCUSD)
  const broadcastKey = isFutures && normalized.endsWith('USDT')
    ? normalized.replace('USDT', 'USD')
    : normalized;

  latestBroadcastData[broadcastKey] = { mark_price: markPrice };

  const message = JSON.stringify({
    type: 'order-tracking-data',
    data: latestBroadcastData,
  });

  for (const ws of connections) {
    if (ws.readyState === 1) {
      try {
        ws.send(message);
      } catch (err) {
        console.error(`[WS Error] Failed to send for ${broadcastKey}`, err);
      }
    }
  }
}
