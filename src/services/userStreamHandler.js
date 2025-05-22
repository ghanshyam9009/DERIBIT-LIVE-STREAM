

import { getAllSymbolDataByDate, getSymbolDataByDate, getAllDates } from './symbolStore.js';
// import { getDeltaSymbolData, storeDeltaSymbolData } from './deltaSymbolStore.js';
import { getDeltaSymbolData, storeDeltaSymbolData, getAllDeltaSymbols } from './deltaSymbolStore.js';

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

  } else if (category === 'option_chain_symbol') {
    if (!currency) return res.status(400).send('Currency required for option_chain_symbol');
    if (!symbols.length) return res.status(400).send('Symbols required for option_chain_symbol');
    finalSymbols = symbols;

  } else if (category === 'futures') {
    const allFuturesSymbols = getAllDeltaSymbols();
    if (!allFuturesSymbols.length) return res.status(400).send('No futures data available');
    finalSymbols = allFuturesSymbols;

  } else {
    if (!symbols.length) return res.status(400).send('Symbols required for this category');
    finalSymbols = symbols;
  }

  finalSymbols.forEach(s => symbolSet.add(s));

  finalSymbols.forEach(symbol => {
    let data;

    if (category === 'futures_symbol') {
      data = getDeltaSymbolData(symbol);

    } else if (category === 'option_chain') {
      data = getSymbolDataByDate(currency, date, symbol);

    } else if (category === 'option_chain_symbol') {
      const allDates = getAllDates(currency);
      for (const d of allDates) {
        const foundData = getSymbolDataByDate(currency, d, symbol);
        if (foundData) {
          data = foundData;
          break;
        }
      }
    }

    if (data) {
      ws.send(JSON.stringify({
        type: 'initial-data',
        symbol,
        currency,
        date: data?.date || null,
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

// export function broadcastToUsers(userConnections, currency, date, symbol, symbolData) {
//   for (const [userId, ws] of userConnections) {
//     if (ws.readyState !== 1) continue;

//     const catMap = userSubscriptions.get(userId);
//     if (!catMap) continue;

//     for (const [category, symbolSet] of catMap.entries()) {
//       const shouldSend =
//         (category === 'option_chain' && symbolSet.has(symbol)) ||
//         (category === 'futures' && symbolSet.has(symbol)) ||
//         symbolSet.has(symbol);

//       if (shouldSend) {
//         ws.send(JSON.stringify({
//           type: 'symbol-update',
//           currency,
//           date,
//           symbol,
//           category,
//           data: symbolData
//         }));
//         break;
//       }
//     }
//   }
// }


export function broadcastToUsers(userConnections, currency, date, symbol, symbolData, forcedCategory = null) {
  for (const [userId, ws] of userConnections) {
    if (ws.readyState !== 1) continue;

    const catMap = userSubscriptions.get(userId);
    if (!catMap) continue;

    for (const [category, symbolSet] of catMap.entries()) {
      const shouldSend =
        (forcedCategory ? category === forcedCategory : true) &&
        symbolSet.has(symbol);

      if (shouldSend) {
        ws.send(JSON.stringify({
          type: 'symbol-update',
          currency,
          date,
          symbol,
          category: forcedCategory || category,
          data: symbolData
        }));

        // console.log(`[SENT] data update sent to user ${userId}`);
        break;
      }
    }
  }
}

export function broadcastFuturesSymbolDataToUsers(userConnections, symbol, symbolData) {
  for (const [userId, ws] of userConnections) {
    if (ws.readyState !== 1) continue;

    const catMap = userSubscriptions.get(userId);
    if (!catMap || !catMap.has('futures_symbol')) continue;

    const subscribedSymbols = catMap.get('futures_symbol');
    if (!subscribedSymbols.has(symbol)) continue;

    ws.send(JSON.stringify({
      type: 'symbol-update',
      category: 'futures_symbol',
      symbol,
      data: symbolData
    }));

    console.log(`[futures_symbol] Broadcasting ${symbol} to user ${userId}`);
  }
}


export function broadcastAllFuturesDataToUsers(userConnections, symbol, symbolData) {
  for (const [userId, ws] of userConnections) {
    if (ws.readyState !== 1) continue;

    const catMap = userSubscriptions.get(userId);
    if (!catMap || !catMap.has('futures')) continue;

    ws.send(JSON.stringify({
      type: 'symbol-update',
      category: 'futures',
      symbol,
      data: symbolData
    }));

    console.log(`[futures] Broadcasting ${symbol} to user ${userId}`);
  }
}



