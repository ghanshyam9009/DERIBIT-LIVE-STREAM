// utils/symbolTypeUtils.js
import { getDeltaSymbolData } from './deltaSymbolStore.js';
import { getSymbolDataByDate } from './symbolStore.js';
import { getCurrencyAndDateFromSymbol, isFuturesSymbol, isOptionSymbol } from '../utils/symbolUtils.js';
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import dayjs from 'dayjs';

// const dynamoClient = new DynamoDBClient({ region: "ap-southeast-1" });

export const userSubscriptions = new Map();
const userActivePositions = new Map(); // Top-level cache







import {  ListTablesCommand } from "@aws-sdk/client-dynamodb";

const dynamoClient = new DynamoDBClient({ region: "ap-southeast-1" });


export async function checkDynamoConnection() {
  try {
    const command = new ListTablesCommand({});
    const response = await dynamoClient.send(command);
    console.log("✅ DynamoDB Connected.");
    console.log("📋 Available Tables:", response.TableNames);
  } catch (err) {
    console.error("❌ DynamoDB connection failed:", err);
  }
}

// Call this function anywhere you want to check
checkDynamoConnection();




// export function handleSubscribe1(req, res) {
//     const { userId, category, symbols = [] } = req.body;
//     const ws = req.app.get('positionConnections').get(userId);
//     // console.log(ws)
  
//     if (!ws || ws.readyState !== 1) {
//       console.log('WebSocket not open or not connected for user:', userId);
//       return res.status(400).send('User WebSocket not connected');
//     }
  
//     const catMap = userSubscriptions.get(userId) || new Map();
//     userSubscriptions.set(userId, catMap);
  
//     const symbolSet = catMap.get(category) || new Set();
//     catMap.set(category, symbolSet);
  
//     if (!symbols.length) return res.status(400).send('Symbols required');
//     symbols.forEach(symbol => symbolSet.add(symbol));
  
//     symbols.forEach(symbol => {
//       let data;
  
//       if (isFuturesSymbol(symbol)) {
//         data = getDeltaSymbolData(symbol);
//       } else if (isOptionSymbol(symbol)) {
//         const [currency, date] = getCurrencyAndDateFromSymbol(symbol);
//         data = getSymbolDataByDate(currency, date, symbol);
//       }
  
//       if (data) {
//         ws.send(JSON.stringify({
//           type: 'initial-data',
//           symbol,
//           data,
//           category,
//         }));
//       }
//     });
  
//     res.send(`Subscribed to ${symbols.length} symbols for user ${userId}`);
//   }
  

//////////////////////////////////////////////


// export async function handleSubscribe1(req, res) {
//   const { userId, category } = req.body;
//   const ws = req.app.get('positionConnections').get(userId);

//   if (!ws || ws.readyState !== 1) {
//     console.log('WebSocket not open or not connected for user:', userId);
//     return res.status(400).send('User WebSocket not connected');
//   }

//   const catMap = userSubscriptions.get(userId) || new Map();
//   userSubscriptions.set(userId, catMap);

//   const dynamoCommand = new QueryCommand({
//     TableName: "incrypto-dev-positions",
//     IndexName: "UserIndex",
//     KeyConditionExpression: "userId = :uid",
//     ExpressionAttributeValues: {
//       ":uid": { S: userId }
//     }
//   });

//   let userPositions = [];
//   try {
//     const { Items } = await dynamoClient.send(dynamoCommand);
  
//     if (!Items || !Items.length) {
//       console.log("No items returned from DynamoDB.");
//       return res.status(400).send("No data found.");
//     }
  
//     userPositions = Items.map(item => unmarshall(item));
  
//     // ✅ Cache for streaming enrichment
//     userActivePositions.set(userId, userPositions);
  
//   } catch (err) {
//     console.error("DynamoDB query failed", err);
//     return res.status(500).send("Failed to fetch positions");
//   }
  

//   const symbols = userPositions.map(pos => pos.assetSymbol).filter(Boolean);
//   if (!symbols.length) return res.status(400).send('No active asset symbols found');

//   const symbolSet = catMap.get(category) || new Set();
//   catMap.set(category, symbolSet);
//   symbols.forEach(symbol => symbolSet.add(symbol));

//   let totalPNL = 0;
//   let totalInvested = 0;

//   symbols.forEach(symbol => {
//     let data;

//     if (isFuturesSymbol(symbol)) {
//       data = getDeltaSymbolData(symbol);
//     } else if (isOptionSymbol(symbol)) {
//       const [currency, date] = getCurrencyAndDateFromSymbol(symbol);
//       data = getSymbolDataByDate(currency, date, symbol);
//     }

//     const userPos = userPositions.find(p => p.assetSymbol === symbol);
    
//     if (data && userPos) {
//       // 👇 Check both camelCase and snake_case
//       const markPrice = parseFloat(data.markPrice ?? data.mark_price);

//       if (!markPrice || isNaN(markPrice)) return;

//       const {
//         quantity,
//         leverage,
//         positionType,
//         entryPrice
//         // assetSymbol
//       } = userPos;

//       if (!markPrice || isNaN(markPrice) || !entryPrice || !quantity) {
//         console.warn(`Invalid data for ${symbol}`, { markPrice, entryPrice, quantity });
//         return;
//       }

//       const invested = entryPrice * quantity;
//       let pnl = 0;

//       if (positionType === "LONG") {
//         pnl = (markPrice - entryPrice) * quantity * leverage;
//       } else if (positionType === "SHORT") {
//         pnl = (entryPrice - markPrice) * quantity * leverage;
//       }

//       const pnlPercentage = invested ? (pnl / invested) * 100 : 0;

//       totalPNL += pnl;
//       totalInvested += invested;

//       console.log(pnl,pnlPercentage,totalPNL)
//       data.pnl = Number(pnl.toFixed(2));
      
//       data.pnlPercentage = Number(pnlPercentage.toFixed(2));
//       data.quantity = quantity;
//       data.leverage = leverage;
//       data.positionType = positionType;
//       data.entryPrice = entryPrice;
//       data.markPrice = markPrice; // Add it explicitly for frontend usage
//       // data.status=assetSymbol
//     }

//     if (data) {
//       ws.send(JSON.stringify({
//         type: 'initial-data',
//         symbol,
//         data,
//         category,
//       }));
//     }
//   });

//   res.send(`Subscribed to ${symbols.length} symbols for user ${userId}`);
// }


// export function broadcastPositionData(positionConnections, symbol, symbolData, category) {
//   for (const [userId, ws] of positionConnections) {
//     if (ws.readyState !== 1) continue;

//     const catMap = userSubscriptions.get(userId);
//     if (!catMap || !catMap.has(category)) continue;

//     const subscribedSymbols = catMap.get(category);
//     if (!subscribedSymbols.has(symbol)) continue;

//     const userPosList = userActivePositions.get(userId);
//     const userPos = userPosList?.find(p => p.assetSymbol === symbol);

//     const enrichedData = { ...symbolData };

//     if (userPos) {
//       const markPrice = parseFloat(symbolData.markPrice ?? symbolData.mark_price);
//       if (!markPrice || isNaN(markPrice)) continue;

//       const {
//         quantity,
//         leverage,
//         positionType,
//         entryPrice,
//         assetSymbol
//       } = userPos;

//       const invested = entryPrice * quantity;
//       let pnl = 0;

//       if (positionType === "LONG") {
//         pnl = (markPrice - entryPrice) * quantity * leverage;
//       } else if (positionType === "SHORT") {
//         pnl = (entryPrice - markPrice) * quantity * leverage;
//       }

//       const pnlPercentage = invested ? (pnl / invested) * 100 : 0;

//       enrichedData.pnl = Number(pnl.toFixed(2));
//       enrichedData.pnlPercentage = Number(pnlPercentage.toFixed(2));
//       enrichedData.quantity = quantity;
//       enrichedData.leverage = leverage;
//       enrichedData.positionType = positionType;
//       enrichedData.entryPrice = entryPrice;
//       enrichedData.markPrice = markPrice;
//       enrichedData.status = assetSymbol;
//     }

//     ws.send(JSON.stringify({
//       type: 'symbol-update',
//       symbol,
//       category,
//       data: enrichedData,
//     }));

//     console.log(`[${category}] Broadcasting ${symbol} to user ${userId}`);
//   }
// }




// === Position Subscription Handler ===
// === Position Subscription Handler ===
export async function handleSubscribe1(req, res) {
  const { userId, category } = req.body;
  const ws = req.app.get('positionConnections').get(userId);

  if (!ws || ws.readyState !== 1) {
    console.log('WebSocket not open or not connected for user:', userId);
    return res.status(400).send('User WebSocket not connected');
  }

  const catMap = userSubscriptions.get(userId) || new Map();
  userSubscriptions.set(userId, catMap);

  const dynamoCommand = new QueryCommand({
    TableName: "incrypto-dev-positions",
    IndexName: "UserIndex",
    KeyConditionExpression: "userId = :uid",
    ExpressionAttributeValues: {
      ":uid": { S: userId }
    }
  });

  let userPositions = [];
  try {
    const { Items } = await dynamoClient.send(dynamoCommand);
    if (!Items || !Items.length) {
      return res.status(400).send("No data found.");
    }
    userPositions = Items.map(item => unmarshall(item));
    userActivePositions.set(userId, userPositions);
  } catch (err) {
    console.error("DynamoDB query failed", err);
    return res.status(500).send("Failed to fetch positions");
  }

  const symbols = userPositions.map(pos => pos.assetSymbol).filter(Boolean);
  if (!symbols.length) return res.status(400).send('No active asset symbols found');

  const symbolSet = catMap.get(category) || new Set();
  catMap.set(category, symbolSet);
  symbols.forEach(symbol => symbolSet.add(symbol));

  // Immediately calculate and broadcast data
  broadcastAllPositions(req.app.get('positionConnections'), userId, category);

  res.send(`Subscribed to ${symbols.length} symbols for user ${userId}`);
}

// === Broadcast Handler for all positions of a user ===
function broadcastAllPositions(positionConnections, userId, category) {
  const ws = positionConnections.get(userId);
  if (!ws || ws.readyState !== 1) return;

  const userPositions = userActivePositions.get(userId);
  if (!userPositions || !userPositions.length) return;

  let totalPNL = 0;
  let totalInvested = 0;

  const positionUpdates = userPositions.map(userPos => {
    const { assetSymbol: symbol, quantity, leverage, positionType, entryPrice } = userPos;
    let data = {};

    if (isFuturesSymbol(symbol)) {
      data = getDeltaSymbolData(symbol);
    } else if (isOptionSymbol(symbol)) {
      const [currency, date] = getCurrencyAndDateFromSymbol(symbol);
      data = getSymbolDataByDate(currency, date, symbol);
    }

    const markPrice = parseFloat(data.markPrice ?? data.mark_price);
    if (!markPrice || isNaN(markPrice)) return null;

    const invested = entryPrice * quantity;
    let pnl = 0;

    if (positionType === "LONG") {
      pnl = (markPrice - entryPrice) * quantity;
    } else if (positionType === "SHORT") {
      pnl = (entryPrice - markPrice) * quantity;
    }

    const pnlPercentage = invested ? (pnl / invested) * 100 : 0;

    totalPNL += pnl;
    totalInvested += invested;

    return {
      symbol,
      markPrice,
      entryPrice,
      quantity,
      leverage,
      positionType,
      pnl: Number(pnl.toFixed(2)),
      pnlPercentage: Number(pnlPercentage.toFixed(2))
    };
  }).filter(Boolean);

  ws.send(JSON.stringify({
    type: 'bulk-position-update',
    positions: positionUpdates,
    totalPNL: Number(totalPNL.toFixed(2)),
    totalInvested: Number(totalInvested.toFixed(2)),
    category,
  }));
}





// === Live Stream LTP Update ===
export function broadcastPositionData(positionConnections, symbol, symbolData, category) {
  for (const [userId, ws] of positionConnections) {
    if (ws.readyState !== 1) continue;

    const catMap = userSubscriptions.get(userId);
    if (!catMap || !catMap.has(category)) continue;

    const subscribedSymbols = catMap.get(category);
    if (!subscribedSymbols.has(symbol)) continue;

    // Recalculate all user's positions based on the new LTP
    broadcastAllPositions(positionConnections, userId, category);
  }
}


// // === Live Stream LTP Update ===
// export function broadcastPositionData(positionConnections, symbol, symbolData, category) {
//   for (const [userId, ws] of positionConnections) {
//     if (ws.readyState !== 1) continue;

//     const catMap = userSubscriptions.get(userId);
//     if (!catMap || !catMap.has(category)) continue;

//     const subscribedSymbols = catMap.get(category);
//     if (!subscribedSymbols.has(symbol)) continue;

//     // Recalculate all user's positions based on the new LTP
//     broadcastAllPositions(userId, category);
//   }
// }







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






export function handleCancelPositionWs(req, res) {
  const { userId } = req.body;
  const positionConnections = req.app.get('positionConnections');
  
  const ws = positionConnections.get(userId);
  if (ws) ws.close();
  
  positionConnections.delete(userId);
  res.send(`Position WebSocket closed for user ${userId}`);
}
