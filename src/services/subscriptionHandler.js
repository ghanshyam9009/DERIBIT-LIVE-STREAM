// utils/symbolTypeUtils.js
import { getDeltaSymbolData } from './deltaSymbolStore.js';
import { getSymbolDataByDate } from './symbolStore.js';
import { getCurrencyAndDateFromSymbol, isFuturesSymbol, isOptionSymbol } from '../utils/symbolUtils.js';




export const userSubscriptions = new Map();

export function handleSubscribe1(req, res) {
    const { userId, category, symbols = [] } = req.body;
    const ws = req.app.get('positionConnections').get(userId);
    // console.log(ws)
  
    if (!ws || ws.readyState !== 1) {
      console.log('WebSocket not open or not connected for user:', userId);
      return res.status(400).send('User WebSocket not connected');
    }
  
    const catMap = userSubscriptions.get(userId) || new Map();
    userSubscriptions.set(userId, catMap);
  
    const symbolSet = catMap.get(category) || new Set();
    catMap.set(category, symbolSet);
  
    if (!symbols.length) return res.status(400).send('Symbols required');
    symbols.forEach(symbol => symbolSet.add(symbol));
  
    symbols.forEach(symbol => {
      let data;
  
      if (isFuturesSymbol(symbol)) {
        data = getDeltaSymbolData(symbol);
      } else if (isOptionSymbol(symbol)) {
        const [currency, date] = getCurrencyAndDateFromSymbol(symbol);
        data = getSymbolDataByDate(currency, date, symbol);
      }
  
      if (data) {
        ws.send(JSON.stringify({
          type: 'initial-data',
          symbol,
          data,
          category,
        }));
      }
    });
  
    res.send(`Subscribed to ${symbols.length} symbols for user ${userId}`);
  }
  







export function handleUnsubscribe2(req, res) {
  const { userId, category, symbols = [] } = req.body;
  const ws = req.app.get('userConnections').get(userId);

  if (!userSubscriptions.has(userId)) return res.send('No subscriptions for user');
  const catMap = userSubscriptions.get(userId);
  if (!catMap.has(category)) return res.send('No such category');

  const symbolSet = catMap.get(category);
  symbols.forEach(symbol => symbolSet.delete(symbol));

  if (ws && ws.readyState === 1) {
    symbols.forEach(symbol => {
      ws.send(JSON.stringify({
        type: 'unsubscribed',
        symbol,
        category
      }));
    });
  }

  if (symbolSet.size === 0) catMap.delete(category);
  if (catMap.size === 0) userSubscriptions.delete(userId);

  res.send(`Unsubscribed ${symbols.length} symbols for user ${userId}`);
}













export function broadcastPositionData(positionConnections, symbol, symbolData, category) {
  for (const [userId, ws] of positionConnections) {
    if (ws.readyState !== 1) continue;

    const catMap = userSubscriptions.get(userId);
    if (!catMap || !catMap.has(category)) continue;

    const subscribedSymbols = catMap.get(category);
    if (!subscribedSymbols.has(symbol)) continue;

    ws.send(JSON.stringify({
      type: 'symbol-update',
      symbol,
      category,
      data: symbolData,
    }));

    console.log(`[${category}] Broadcasting ${symbol} to user ${userId}`);
  }
}










export function handleCancelPositionWs(req, res) {
  const { userId } = req.body;
  const positionConnections = req.app.get('positionConnections');
  
  const ws = positionConnections.get(userId);
  if (ws) ws.close();
  
  positionConnections.delete(userId);
  res.send(`Position WebSocket closed for user ${userId}`);
}
