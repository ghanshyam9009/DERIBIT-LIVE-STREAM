

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

  } else if (category === 'dashboard') {
    // 6 hardcoded futures symbols
    finalSymbols = ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "BNBUSD", "ADAUSD"];
  } else {
    if (!symbols.length) return res.status(400).send('Symbols required for this category');
    finalSymbols = symbols;
  }

  finalSymbols.forEach(s => symbolSet.add(s));

  finalSymbols.forEach(symbol => {
    let data;

    if (category === 'futures_symbol' || category === 'dashboard') {
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
        currency: currency || data?.currency || null,
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
  const ws = req.app.get('userConnections').get(userId);

  if (!userSubscriptions.has(userId)) return res.send('No subscriptions');
  const catMap = userSubscriptions.get(userId);
  if (!catMap.has(category)) return res.send('No such category');

  const symbolSet = catMap.get(category);
  let finalSymbols = [];

  if (category === 'option_chain') {
    if (!currency || !date) return res.status(400).send('Currency and date required for option_chain');
    finalSymbols = getSymbolsForOptionChain(currency, date);
    if (!finalSymbols.length) return res.status(400).send('No symbols available for this currency and date');

  } else if (category === 'option_chain_symbol') {
    if (!currency) return res.status(400).send('Currency required for option_chain_symbol');
    if (!symbols.length) return res.status(400).send('Symbols required for option_chain_symbol');
    finalSymbols = symbols;

  } else if (category === 'futures') {
    const allFuturesSymbols = getAllDeltaSymbols();
    if (!allFuturesSymbols.length) return res.status(400).send('No futures data available');
    finalSymbols = allFuturesSymbols;

  } else if (category === 'dashboard') {
    finalSymbols = ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "BNBUSD", "ADAUSD"];

  } else {
    if (!symbols.length) return res.status(400).send('Symbols required for this category');
    finalSymbols = symbols;
  }

  // Remove symbols from the user's subscription set
  finalSymbols.forEach(s => symbolSet.delete(s));

  // Optionally notify the client of the unsubscription
  if (ws && ws.readyState === 1) {
    finalSymbols.forEach(symbol => {
      ws.send(JSON.stringify({
        type: 'unsubscribed',
        symbol,
        currency: currency || null,
        date: date || null,
        category
      }));
    });
  }

  // Cleanup if empty
  if (symbolSet.size === 0) catMap.delete(category);
  if (catMap.size === 0) userSubscriptions.delete(userId);

  res.send(`Unsubscribed ${finalSymbols.length} symbols for user ${userId}`);
}

export function handleCancelWs(req, res) {
  const { userId } = req.body;
  const ws = req.app.get('userConnections').get(userId);
  if (ws) ws.close();
  req.app.get('userConnections').delete(userId);
  userSubscriptions.delete(userId);
  res.send(`WebSocket closed for user ${userId}`);
}



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

    const filteredData = {
      high: symbolData?.high,
      low: symbolData?.low,
      underlying_asset_symbol: symbolData?.underlying_asset_symbol,
      mark_price: symbolData?.mark_price,
      mark_change_24h: symbolData?.mark_change_24h,
      description: symbolData?.description?.replace(/Perpetual/gi, '').trim()
    };

    ws.send(JSON.stringify({
      type: 'symbol-update',
      category: 'futures',
      symbol,
      data: filteredData
    }));

    console.log(`[futures] Broadcasting ${symbol} to user ${userId}`);
  }
}

const DASHBOARD_SYMBOLS = ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "BNBUSD", "ADAUSD"];

export function broadcastDashboardDataToUsers(userConnections, symbol, symbolData) {
  if (!DASHBOARD_SYMBOLS.includes(symbol)) return; // ✅ Skip if not a dashboard symbol

  for (const [userId, ws] of userConnections) {
    if (ws.readyState !== 1) continue;

    const catMap = userSubscriptions.get(userId);
    if (!catMap || !catMap.has('dashboard')) continue;

    const selectedData = {
      high: symbolData?.high,
      low: symbolData?.low,
      mark_price: symbolData?.mark_price,
      mark_change_24h: symbolData?.mark_change_24h,
      volume: symbolData?.volume,
    };

    ws.send(JSON.stringify({
      type: 'symbol-update',
      category: 'dashboard',
      symbol,
      data: selectedData
    }));

    console.log(`[dashboard] Broadcasting ${symbol} to user ${userId}`);
  }
}




















// // ✅ Helper Function for Normalization
// function normalizeToBinanceSymbol(symbol) {
//   if (!symbol) return '';
//   return symbol.endsWith('USDT') ? symbol : symbol.replace('USD', 'USDT');
// }

// import { getAllSymbolDataByDate, getSymbolDataByDate, getAllDates } from './symbolStore.js';
// import { getDeltaSymbolData, storeDeltaSymbolData, getAllDeltaSymbols } from './deltaSymbolStore.js';
// import config from '../config/index.js';

// const userSubscriptions = new Map(); // Map<userId, Map<category, Set<symbol>>>

// function getSymbolsForOptionChain(currency, date) {
//   const symbolMap = getAllSymbolDataByDate(currency, date);
//   const symbols = Object.keys(symbolMap).map(normalizeToBinanceSymbol);
//   console.log(`🧾 Symbols for ${currency} on ${date}:`, symbols);
//   return symbols;
// }

// function getOrInitCategorySet(userId, category) {
//   if (!userSubscriptions.has(userId)) userSubscriptions.set(userId, new Map());
//   const catMap = userSubscriptions.get(userId);
//   if (!catMap.has(category)) catMap.set(category, new Set());
//   return catMap.get(category);
// }

// export function handleSubscribe(req, res) {
//   const { userId, category, symbols = [], currency, date } = req.body;
//   const ws = req.app.get('userConnections').get(userId);

//   if (!ws || ws.readyState !== 1) return res.status(400).send('User WebSocket not connected');

//   const symbolSet = getOrInitCategorySet(userId, category);
//   let finalSymbols = [];

//   if (category === 'option_chain') {
//     if (!currency || !date) return res.status(400).send('Currency and date required for option_chain');
//     finalSymbols = getSymbolsForOptionChain(currency, date);
//     if (finalSymbols.length === 0) return res.status(400).send('No symbols available for this currency and date');
//   } else if (category === 'option_chain_symbol') {
//     if (!currency) return res.status(400).send('Currency required for option_chain_symbol');
//     if (!symbols.length) return res.status(400).send('Symbols required for option_chain_symbol');
//     finalSymbols = symbols.map(normalizeToBinanceSymbol);
//   } else if (category === 'futures') {
//     const allFuturesSymbols = getAllDeltaSymbols();
//     if (!allFuturesSymbols.length) return res.status(400).send('No futures data available');
//     finalSymbols = allFuturesSymbols.map(normalizeToBinanceSymbol);
//   } else if (category === 'dashboard') {
//     finalSymbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "ADAUSDT"];
//   } else {
//     if (!symbols.length) return res.status(400).send('Symbols required for this category');
//     finalSymbols = symbols.map(normalizeToBinanceSymbol);
//   }

//   finalSymbols.forEach(s => symbolSet.add(s));

//   finalSymbols.forEach(symbol => {
//     let data;

//     if (category === 'futures_symbol' || category === 'dashboard') {
//       data = getDeltaSymbolData(symbol);
//     } else if (category === 'option_chain') {
//       data = getSymbolDataByDate(currency, date, symbol);
//     } else if (category === 'option_chain_symbol') {
//       const allDates = getAllDates(currency);
//       for (const d of allDates) {
//         const foundData = getSymbolDataByDate(currency, d, symbol);
//         if (foundData) {
//           data = foundData;
//           break;
//         }
//       }
//     }

//     if (data) {
//       console.log(`📤 Broadcasting initial-data for ${symbol}:`, data);
//       ws.send(JSON.stringify({
//         type: 'initial-data',
//         symbol,
//         currency: currency || data?.currency || null,
//         date: data?.date || null,
//         category,
//         data
//       }));
//     }
//   });

//   res.send(`Subscribed ${finalSymbols.length} symbols for user ${userId}`);
// }

// export function handleUnsubscribe(req, res) {
//   const { userId, category, symbols = [], currency, date } = req.body;
//   const ws = req.app.get('userConnections').get(userId);

//   if (!userSubscriptions.has(userId)) return res.send('No subscriptions');
//   const catMap = userSubscriptions.get(userId);
//   if (!catMap.has(category)) return res.send('No such category');

//   const symbolSet = catMap.get(category);
//   let finalSymbols = [];

//   if (category === 'option_chain') {
//     if (!currency || !date) return res.status(400).send('Currency and date required for option_chain');
//     finalSymbols = getSymbolsForOptionChain(currency, date);
//     if (!finalSymbols.length) return res.status(400).send('No symbols available for this currency and date');
//   } else if (category === 'option_chain_symbol') {
//     if (!currency) return res.status(400).send('Currency required for option_chain_symbol');
//     if (!symbols.length) return res.status(400).send('Symbols required for option_chain_symbol');
//     finalSymbols = symbols.map(normalizeToBinanceSymbol);
//   } else if (category === 'futures') {
//     const allFuturesSymbols = getAllDeltaSymbols();
//     if (!allFuturesSymbols.length) return res.status(400).send('No futures data available');
//     finalSymbols = allFuturesSymbols.map(normalizeToBinanceSymbol);
//   } else if (category === 'dashboard') {
//     finalSymbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "ADAUSDT"];
//   } else {
//     if (!symbols.length) return res.status(400).send('Symbols required for this category');
//     finalSymbols = symbols.map(normalizeToBinanceSymbol);
//   }

//   finalSymbols.forEach(s => symbolSet.delete(s));

//   if (ws && ws.readyState === 1) {
//     finalSymbols.forEach(symbol => {
//       ws.send(JSON.stringify({
//         type: 'unsubscribed',
//         symbol,
//         currency: currency || null,
//         date: date || null,
//         category
//       }));
//     });
//   }

//   if (symbolSet.size === 0) catMap.delete(category);
//   if (catMap.size === 0) userSubscriptions.delete(userId);

//   res.send(`Unsubscribed ${finalSymbols.length} symbols for user ${userId}`);
// }

// export function handleCancelWs(req, res) {
//   const { userId } = req.body;
//   const ws = req.app.get('userConnections').get(userId);
//   if (ws) ws.close();
//   req.app.get('userConnections').delete(userId);
//   userSubscriptions.delete(userId);
//   res.send(`WebSocket closed for user ${userId}`);
// }

// export function broadcastToUsers(userConnections, currency, date, symbol, symbolData, forcedCategory = null) {
//   const normalizedSymbol = normalizeToBinanceSymbol(symbol);

//   for (const [userId, ws] of userConnections) {
//     if (ws.readyState !== 1) continue;
//     const catMap = userSubscriptions.get(userId);
//     if (!catMap) continue;

//     for (const [category, symbolSet] of catMap.entries()) {
//       const shouldSend = (forcedCategory ? category === forcedCategory : true) && symbolSet.has(normalizedSymbol);
//       if (shouldSend) {
//         console.log(`[📤 symbol-update] ${symbol} to ${userId}:`, symbolData);
//         ws.send(JSON.stringify({
//           type: 'symbol-update', currency, date, symbol, category: forcedCategory || category, data: symbolData
//         }));
//         break;
//       }
//     }
//   }
// }

// export function broadcastFuturesSymbolDataToUsers(userConnections, symbol, symbolData) {
//   const normalizedSymbol = normalizeToBinanceSymbol(symbol);

//   for (const [userId, ws] of userConnections) {
//     if (ws.readyState !== 1) continue;
//     const catMap = userSubscriptions.get(userId);
//     if (!catMap || !catMap.has('futures_symbol')) continue;
//     const subscribedSymbols = catMap.get('futures_symbol');
//     if (!subscribedSymbols.has(normalizedSymbol)) continue;

//     const filteredData = {
//       high: symbolData?.high,
//       low: symbolData?.low,
//       underlying_asset_symbol: symbolData?.underlying_asset_symbol,
//       mark_price: symbolData?.mark_price,
//       mark_change_24h: symbolData?.mark_change_24h,
//       volume: symbolData?.volume,
//       description: symbolData?.description?.replace(/Perpetual/gi, '').trim()
//     };

//     console.log(`[📤 futures_symbol] ${symbol} to ${userId}:`, filteredData);
//     ws.send(JSON.stringify({
//       type: 'symbol-update', category: 'futures_symbol', symbol, data: filteredData
//     }));
//   }
// }

// export function broadcastAllFuturesDataToUsers(userConnections, symbol, symbolData) {
//   const normalizedSymbol = normalizeToBinanceSymbol(symbol);

//   for (const [userId, ws] of userConnections) {
//     if (ws.readyState !== 1) continue;
//     const catMap = userSubscriptions.get(userId);
//     if (!catMap || !catMap.has('futures')) continue;

//     const filteredData = {
//       high: symbolData?.high,
//       low: symbolData?.low,
//       underlying_asset_symbol: symbolData?.underlying_asset_symbol,
//       mark_price: symbolData?.mark_price,
//       mark_change_24h: symbolData?.mark_change_24h,
//       description: symbolData?.description?.replace(/Perpetual/gi, '').trim()
//     };

//     console.log(`[📤 futures] ${symbol} to ${userId}:`, filteredData);
//     ws.send(JSON.stringify({
//       type: 'symbol-update', category: 'futures', symbol, data: filteredData
//     }));
//   }
// }

// const DASHBOARD_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT", "ADAUSDT"];

// export function broadcastDashboardDataToUsers(userConnections, symbol, symbolData) {
//   const normalizedSymbol = normalizeToBinanceSymbol(symbol);
//   if (!DASHBOARD_SYMBOLS.includes(normalizedSymbol)) return;

//   for (const [userId, ws] of userConnections) {
//     if (ws.readyState !== 1) continue;
//     const catMap = userSubscriptions.get(userId);
//     if (!catMap || !catMap.has('dashboard')) continue;

//     const selectedData = {
//       high: symbolData?.high,
//       low: symbolData?.low,
//       mark_price: symbolData?.mark_price,
//       mark_change_24h: symbolData?.mark_change_24h,
//       volume: symbolData?.volume
//     };

//     console.log(`[📤 dashboard] ${symbol} to ${userId}:`, selectedData);
//     ws.send(JSON.stringify({
//       type: 'symbol-update', category: 'dashboard', symbol, data: selectedData
//     }));
//   }
// }