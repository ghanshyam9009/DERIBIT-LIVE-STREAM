
import { getAllSymbolDataByDate, getSymbolDataByDate } from './symbolStore.js';
import config from '../config/index.js';

const userSubscriptions = new Map(); // Map<userId, Map<category, Set<symbol>>>

function getSymbolsForOptionChain(currency, date) {
  const symbolMap = getAllSymbolDataByDate(currency, date);
  const symbols = Object.keys(symbolMap);
  console.log(`🧾 Symbols for ${currency} on ${date}:`, symbols);
  return symbols;
}

function getOrInitCategorySet(userId, category) {
  if (!userSubscriptions.has(userId)) userSubscriptions.set(userId, new Map());
  const catMap = userSubscriptions.get(userId);
  if (!catMap.has(category)) catMap.set(category, new Set());
  return catMap.get(category);
}

export function handleSubscribe(req, res) {
  const { userId, category, symbols = [], currency, date } = req.body;
  const ws = req.app.get('userConnections').get(userId);

  if (!ws || ws.readyState !== 1) return res.status(400).send('User WebSocket not connected');

  const symbolSet = getOrInitCategorySet(userId, category);
  let finalSymbols = [];

  if (category === 'option_chain') {
    if (!currency || !date) return res.status(400).send('Currency and date required for option_chain');
    finalSymbols = getSymbolsForOptionChain(currency, date);
    if (finalSymbols.length === 0) return res.status(400).send('No symbols available for this currency and date');
  } else {
    if (!symbols.length) return res.status(400).send('Symbols required for non-option_chain categories');
    finalSymbols = symbols;
  }

  finalSymbols.forEach(s => symbolSet.add(s));

  finalSymbols.forEach(symbol => {
    const data = getSymbolDataByDate(currency, date, symbol);
    if (data) {
      ws.send(JSON.stringify({
        type: 'initial-data',
        symbol,
        currency,
        date,
        category,
        data
      }));
    }
  });

  res.send(`Subscribed ${finalSymbols.length} symbols for user ${userId}`);
}

export function handleUnsubscribe(req, res) {
  const { userId, category, symbols = [], currency, date } = req.body;

  if (!userSubscriptions.has(userId)) return res.send('No subscriptions');
  const catMap = userSubscriptions.get(userId);
  if (!catMap.has(category)) return res.send('No such category');

  const set = catMap.get(category);
  const targetSymbols = category === 'option_chain'
    ? getSymbolsForOptionChain(currency, date)
    : symbols;

  targetSymbols.forEach(s => set.delete(s));
  res.send(`Unsubscribed ${targetSymbols.length} symbols for user ${userId}`);
}

export function handleCancelWs(req, res) {
  const { userId } = req.body;
  const ws = req.app.get('userConnections').get(userId);
  if (ws) ws.close();
  req.app.get('userConnections').delete(userId);
  userSubscriptions.delete(userId);
  res.send(`WebSocket closed for user ${userId}`);
}

export function broadcastToUsers(userConnections, currency, date, symbol, symbolData) {
  for (const [userId, ws] of userConnections) {
    if (ws.readyState !== 1) continue;

    const catMap = userSubscriptions.get(userId);
    if (!catMap) continue;

    for (const [category, symbolSet] of catMap.entries()) {
      const shouldSend =
        (category === 'option_chain' && symbolSet.has(symbol)) ||
        symbolSet.has(symbol);

      if (shouldSend) {
        ws.send(JSON.stringify({
          type: 'symbol-update',
          currency,
          date,
          symbol,
          category,
          data: symbolData
        }));
        break;
      }
    }
  }
}
