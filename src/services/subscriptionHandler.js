










import { getDeltaSymbolData } from "./deltaSymbolStore.js";
import { getSymbolDataByDate } from "./symbolStore.js";
import {
  getCurrencyAndDateFromSymbol,
  isFuturesSymbol,
  isOptionSymbol,
} from "../utils/symbolUtils.js";
import {
  DynamoDBClient,
  QueryCommand,
  UpdateItemCommand,
  ListTablesCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall, marshall } from "@aws-sdk/util-dynamodb";

export const userSubscriptions = new Map();
const userActivePositions = new Map();
const userRealizedTodayPnL = new Map();

const dynamoClient = new DynamoDBClient({ region: "ap-southeast-1" });

export async function checkDynamoConnection() {
  try {
    const command = new ListTablesCommand({});
    const response = await dynamoClient.send(command);
    console.log("✅ DynamoDB Connected. Tables:", response.TableNames);
  } catch (err) {
    console.error("❌ DynamoDB connection failed:", err);
  }
}
checkDynamoConnection();

function isTodayCustom(timestamp) {
  const now = new Date();
  const start = new Date();
  start.setHours(13, 25, 0, 0);
  const end = new Date(start);
  if (now < start) {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  }
  end.setDate(start.getDate() + 1);
  return timestamp >= start.getTime() && timestamp < end.getTime();
}

async function getUserBankBalance(userId) {
  const cmd = new QueryCommand({
    TableName: "incrypto-dev-funds",
    KeyConditionExpression: "userId = :uid",
    ExpressionAttributeValues: {
      ":uid": { S: userId },
    },
  });
  try {
    const { Items } = await dynamoClient.send(cmd);
    const fund = Items && Items.length ? unmarshall(Items[0]) : null;
    return fund?.availableBalance || 0;
  } catch (err) {
    console.error("❌ Error fetching fund data:", err);
    return 0;
  }
}

async function squareOffUser(userId) {
  const openPositions = userActivePositions.get(userId) || [];
  const now = new Date().toISOString();

  for (const pos of openPositions) {
    let data = {};
    if (isFuturesSymbol(pos.assetSymbol)) {
      data = getDeltaSymbolData(pos.assetSymbol);
    } else if (isOptionSymbol(pos.assetSymbol)) {
      const [currency, date] = getCurrencyAndDateFromSymbol(pos.assetSymbol);
      data = getSymbolDataByDate(currency, date, pos.assetSymbol);
    }

    let markPrice = Number(data?.mark_price);
    if (!markPrice || isNaN(markPrice)) {
      markPrice = Number(data?.calculated?.mark_price?.value);
    }
    if (!markPrice || isNaN(markPrice)) continue;

    const pnl = (pos.positionType === "LONG")
      ? (markPrice - pos.entryPrice) * pos.quantity
      : (pos.entryPrice - markPrice) * pos.quantity;

    const updateCmd = new UpdateItemCommand({
      TableName: "incrypto-dev-positions",
      Key: marshall({ positionId: pos.positionId }),
      UpdateExpression:
        "SET #s = :closed, exitPrice = :exitPrice, pnl = :pnl, realizedPnL = :pnl, exitTime = :now, closedAt = :now",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: marshall({
        ":closed": "CLOSED",
        ":exitPrice": markPrice,
        ":pnl": pnl,
        ":now": now,
      }),
    });

    try {
      await dynamoClient.send(updateCmd);
    } catch (err) {
      console.error(`❌ Failed to update position ${pos.positionId}:`, err);
    }
  }

  // Set availableBalance to 0
  const updateFundsCmd = new UpdateItemCommand({
    TableName: "incrypto-dev-funds",
    Key: marshall({ userId }),
    UpdateExpression: "SET availableBalance = :zero",
    ExpressionAttributeValues: marshall({ ":zero": 0 }),
  });

  try {
    await dynamoClient.send(updateFundsCmd);
    console.log(`✅ User ${userId} balance set to 0 and positions closed`);
  } catch (err) {
    console.error(`❌ Failed to update balance for ${userId}:`, err);
  }
}

export async function broadcastAllPositions(positionConnections, userId, category) {
  const ws = positionConnections.get(userId);
  if (!ws || ws.readyState !== 1) return;

  const userPositions = userActivePositions.get(userId);
  if (!userPositions || !userPositions.length) return;

  let totalPNL = 0;
  let totalInvested = 0;

  const positionUpdates = userPositions.map((userPos) => {
    const {
      assetSymbol: symbol,
      quantity,
      leverage,
      positionType,
      entryPrice,
      positionId,
    } = userPos;

    let data = {};
    if (isFuturesSymbol(symbol)) {
      data = getDeltaSymbolData(symbol);
    } else if (isOptionSymbol(symbol)) {
      const [currency, date] = getCurrencyAndDateFromSymbol(symbol);
      data = getSymbolDataByDate(currency, date, symbol);
    }

    let markPrice = Number(data?.mark_price);
    if (!markPrice || isNaN(markPrice)) {
      markPrice = Number(data?.calculated?.mark_price?.value);
    }
    if (!markPrice || isNaN(markPrice)) return null;

    const invested = entryPrice * quantity;
    const pnl = positionType === "LONG"
      ? (markPrice - entryPrice) * quantity
      : (entryPrice - markPrice) * quantity;

    const pnlPercentage = invested ? (pnl / invested) * 100 : 0;
    totalPNL += pnl;
    totalInvested += invested;

    return {
      symbol,
      positionId,
      markPrice,
      entryPrice,
      quantity,
      leverage,
      positionType,
      pnl: Number(pnl.toFixed(6)),
      pnlPercentage: Number(pnlPercentage.toFixed(2)),
    };
  }).filter(Boolean);

  const realizedTodayPNL = userRealizedTodayPnL.get(userId) || 0;
  const netPNL = totalPNL + realizedTodayPNL;

  getUserBankBalance(userId).then((userBankBalance) => {
    const maxAllowedLoss = userBankBalance - totalInvested;
    if (netPNL < -Math.abs(maxAllowedLoss)) {
      console.log(`❌ Max loss breached for ${userId}. Auto-squareoff.`);
      squareOffUser(userId);

      ws.send(JSON.stringify({
        type: "auto-squareoff",
        reason: "Loss limit breached",
        netPNL,
        maxAllowedLoss,
      }));
      return;
    }

    const payload = {
      type: "bulk-position-update",
      positions: positionUpdates,
      totalPNL: Number(totalPNL.toFixed(6)),
      totalInvested: Number(totalInvested.toFixed(4)),
      category,
    };

    ws.send(JSON.stringify(payload));
  });
}



export async function handleSubscribe1(req, res) {
  const { userId, category } = req.body;
  const ws = req.app.get("positionConnections").get(userId);

  if (!ws || ws.readyState !== 1) {
    return res.status(400).send("User WebSocket not connected");
  }

  const catMap = userSubscriptions.get(userId) || new Map();
  userSubscriptions.set(userId, catMap);

  const dynamoCommand = new QueryCommand({
    TableName: "incrypto-dev-positions",
    IndexName: "UserIndex",
    KeyConditionExpression: "userId = :uid",
    ExpressionAttributeValues: {
      ":uid": { S: userId },
    },
  });

  let userPositions = [];
  try {
    const { Items } = await dynamoClient.send(dynamoCommand);
    if (!Items || !Items.length) return res.status(400).send("No data found.");
    userPositions = Items.map((item) => unmarshall(item)).filter((pos) => pos.status === 'OPEN');
    userActivePositions.set(userId, userPositions);
  } catch (err) {
    return res.status(500).send("Failed to fetch positions");
  }

  const symbols = userPositions.map((pos) => pos.assetSymbol).filter(Boolean);
  if (!symbols.length)
    return res.status(400).send("No active asset symbols found");

  const symbolSet = catMap.get(category) || new Set();
  symbols.forEach((symbol) => symbolSet.add(symbol));
  catMap.set(category, symbolSet);

  broadcastAllPositions(req.app.get("positionConnections"), userId, category);

  res.send(`Subscribed to ${symbols.length} symbols for user ${userId}`);
}

// === Trigger Manual PnL Update ===
export async function triggerPNLUpdate(req, res) {
  const { userId, category } = req.body;
  if (!userId) return res.status(400).send("Missing userId");

  const catMap = userSubscriptions.get(userId) || new Map();
  userSubscriptions.set(userId, catMap);

  const dynamoCommand = new QueryCommand({
    TableName: "incrypto-dev-positions",
    IndexName: "UserIndex",
    KeyConditionExpression: "userId = :uid",
    ExpressionAttributeValues: {
      ":uid": { S: userId },
    },
  });

  let userPositions = [];
  try {
    const { Items } = await dynamoClient.send(dynamoCommand);
    if (!Items || !Items.length) return res.status(400).send("No data found.");
    userPositions = Items.map((item) => unmarshall(item)).filter((pos) => pos.status === 'OPEN');
    userActivePositions.set(userId, userPositions);
  } catch (err) {
    return res.status(500).send("Failed to fetch positions");
  }

  const symbols = userPositions.map((pos) => pos.assetSymbol).filter(Boolean);
  const symbolSet = catMap.get(category) || new Set();
  symbols.forEach((symbol) => symbolSet.add(symbol));
  catMap.set(category, symbolSet);

  console.log("trigeered hogaya");

  broadcastAllPositions(req.app.get("positionConnections"), userId, category);

  res.send("Triggered PnL Update Successfully");
}



export function broadcastPositionData(
  positionConnections,
  symbol,
  symbolData,
  category
) {
  for (const [userId, ws] of positionConnections) {
    if (ws.readyState !== 1) continue;

    const catMap = userSubscriptions.get(userId);
    if (!catMap || !catMap.has(category)) continue;

    const subscribedSymbols = catMap.get(category);
    if (!subscribedSymbols.has(symbol)) continue;

    broadcastAllPositions(positionConnections, userId, category);
  }
}

export function handleUnsubscribe2(req, res) {
  const { userId, category } = req.body;
  const ws = req.app.get("positionConnections").get(userId);

  if (!userSubscriptions.has(userId)) {
    console.log(`No subscriptions for user: ${userId}`);
    return res.send("No subscriptions for user");
  }

  const catMap = userSubscriptions.get(userId);
  if (!catMap.has(category)) {
    console.log(`No such category for user: ${category}`);
    return res.send("No such category");
  }

  const symbolSet = catMap.get(category);
  const symbolsToRemove = [...symbolSet]; // extract all subscribed symbols
  const removedCount = symbolsToRemove.length;

  // Delete entire symbol set for the category
  catMap.delete(category);

  // Clean up userSubscriptions if category map becomes empty
  if (catMap.size === 0) {
    userSubscriptions.delete(userId);
  }

  // Notify via WebSocket
  if (ws && ws.readyState === 1) {
    symbolsToRemove.forEach((symbol) => {
      ws.send(
        JSON.stringify({
          type: "unsubscribed",
          symbol,
          category,
        })
      );
    });
  }

  res.send(
    `Unsubscribed ${removedCount} symbols from category "${category}" for user ${userId}`
  );
}

export function handleCancelPositionWs(req, res) {
  const { userId } = req.body;
  const positionConnections = req.app.get("positionConnections");

  const ws = positionConnections.get(userId);
  if (ws) ws.close();

  positionConnections.delete(userId);
  res.send(`Position WebSocket closed for user ${userId}`);
}
