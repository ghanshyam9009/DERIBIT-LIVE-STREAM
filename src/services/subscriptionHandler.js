import { getDeltaSymbolData } from "./deltaSymbolStore.js";
import { getSymbolDataByDate } from "./symbolStore.js";
import { DateTime } from "luxon";
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

import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

export const userSubscriptions = new Map();
const userActivePositions = new Map();
const userRealizedTodayPnL = new Map();
const closedOnlyBroadcasted = new Map(); // userId => boolean

const dynamoClient = new DynamoDBClient({ region: "ap-southeast-1" });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

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

  let allPositions = [];
  try {
    const { Items } = await dynamoClient.send(dynamoCommand);
    if (!Items || !Items.length) return res.status(400).send("No data found.");
    allPositions = Items.map((item) => unmarshall(item));
  } catch (err) {
    return res.status(500).send("Failed to fetch positions");
  }

  // Only open positions are used for symbol registration
  const openPositions = allPositions.filter((pos) => pos.status === "OPEN");

  const symbols = openPositions.map((pos) => pos.assetSymbol).filter(Boolean);
  // if (!symbols.length)
  //   return res.status(400).send("No active asset symbols found");

  // ✅ Register current category symbols
  const symbolSet = catMap.get(category) || new Set();
  symbols.forEach((symbol) => symbolSet.add(normalizeToBinanceSymbol(symbol)));
  catMap.set(category, symbolSet);

  // ✅ ALSO register futures symbols under "futures" category
  const futuresSet = catMap.get("futures") || new Set();
  openPositions.forEach((pos) => {
    if (isFuturesSymbol(pos.assetSymbol)) {
      futuresSet.add(normalizeToBinanceSymbol(pos.assetSymbol));
    }
  });
  catMap.set("futures", futuresSet);

  // ✅ Final update to subscription map
  userSubscriptions.set(userId, catMap);

  // 🚀 Trigger position broadcast with full logic
  broadcastAllPositions(req.app.get("positionConnections"), userId, category);

  res.send(`Subscribed to ${symbols.length} symbols for user ${userId}`);
}

const sentClosedPositions = new Map();

export async function broadcastAllPositions(
  positionConnections,
  userId,
  category
) {
  const ws = positionConnections.get(userId);
  if (!ws || ws.readyState !== 1) return;

  // Ensure user set exists
  if (!sentClosedPositions.has(userId)) {
    sentClosedPositions.set(userId, new Set());
  }
  const sentSet = sentClosedPositions.get(userId);

  const now = DateTime.now().setZone("Asia/Kolkata");
  const todayStart = now.set({
    hour: 5,
    minute: 30,
    second: 0,
    millisecond: 0,
  });
  const todayEnd = todayStart.plus({ hours: 24 });

  const dynamoCommand = new QueryCommand({
    TableName: "incrypto-dev-positions",
    IndexName: "UserIndex",
    KeyConditionExpression: "userId = :uid",
    ExpressionAttributeValues: {
      ":uid": { S: userId },
    },
  });

  let allUserPositions = [];
  try {
    const { Items } = await dynamoClient.send(dynamoCommand);
    allUserPositions = (Items || []).map((item) => unmarshall(item));
  } catch (err) {
    console.error("❌ Failed to fetch user positions:", err);
    return;
  }

  let totalOpenPNL = 0;
  let totalOpenInvested = 0;
  let openPositions = allUserPositions.filter((pos) => pos.status === "OPEN");

  const openPayload = await Promise.all(
    openPositions.map(async (pos) => {
      const {
        assetSymbol: symbol,
        orderID,
        positionId,
        quantity,
        leverage,
        positionType,
        entryPrice,
        contributionAmount,
        takeProfit,
        stopLoss,
        orderType,
        lot,
        openedAt,
      } = pos;

      const normalizedSymbol = normalizeToBinanceSymbol(symbol);
      let data = {};

      if (isFuturesSymbol(symbol)) {
        data = getDeltaSymbolData(normalizedSymbol);
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
      const isShort = positionType === "SHORT" || positionType === "SHORT_LIMIT";
      const pnl = isShort
        ? (entryPrice - markPrice) * quantity
        : (markPrice - entryPrice) * quantity;

      const pnlPercentage = invested ? (pnl / invested) * 100 : 0;
      totalOpenPNL += pnl;
      totalOpenInvested += invested;

      return {
        symbol,
        orderID,
        positionId,
        markPrice,
        entryPrice,
        quantity,
        leverage,
        positionType,
        pnl: Number(pnl.toFixed(6)),
        pnlPercentage: Number(pnlPercentage.toFixed(2)),
        invested: Number(invested.toFixed(4)),
        openedAt,
        contributionAmount,
        stopLoss,
        takeProfit,
        orderType,
        lot,
        status: "OPEN",
      };
    })
  );

  const filteredOpen = openPayload.filter(Boolean);

  // ➕ Realized Closed Positions
  // const closedPositions = allUserPositions.filter((pos) => {
  //   if (pos.status !== "CLOSED" || !pos.closedAt) return false;
  //   const closedTime = DateTime.fromISO(pos.closedAt, { zone: "Asia/Kolkata" });
  //   return closedTime >= todayStart && closedTime <= todayEnd;
  // });

  // Calculate cutoff for last 24 hours (use UTC to match DB timestamps)
  const cutoffTime = DateTime.utc().minus({ hours: 24 });

  // Filter closed positions whose updatedAt is within last 24 hours
  const closedPositions = allUserPositions.filter((pos) => {
    if (pos.status !== "CLOSED" || !pos.updatedAt) return false;

    // Parse updatedAt as UTC
    const updatedTime = DateTime.fromISO(pos.updatedAt, { zone: "utc" });
    return updatedTime >= cutoffTime;
  });

  let totalClosedPNL = 0;
  let totalClosedInvested = 0;

  const newclosedPayload = closedPositions.map((pos) => {
    const {
      assetSymbol: symbol,
      orderID,
      positionId,
      entryPrice,
      quantity,
      leverage,
      positionType,
      pnl,
      exitPrice,
      closedAt,
      initialMargin,
      stopLoss,
      takeProfit,
      orderType,
      lot,
      initialQuantity,
      positionClosedType,
    } = pos;

    const invested = entryPrice * initialQuantity;
    totalClosedInvested += invested;
    totalClosedPNL += Number(pnl || 0);

    return {
      symbol,
      orderID,
      positionId,
      exitPrice,
      entryPrice,
      quantity,
      leverage,
      positionType,
      pnl: Number(pnl?.toFixed(6) || 0),
      pnlPercentage: Number(((pnl / invested) * 100).toFixed(2)),
      // pnlPercentage: Number((initialQuantity*(entryPrice-exitPrice)).toFixed(2)),
      invested: Number(invested.toFixed(4)),
      closedAt,
      initialMargin,
      stopLoss,
      takeProfit,
      orderType,
      lot,
      status: "CLOSED",
      initialQuantity,
      positionClosedType,
    };
  });

  newclosedPayload.forEach((p) => sentSet.add(p.positionId));

  const realizedTodayPNL = userRealizedTodayPnL.get(userId) || 0;
  const totalPNL = totalOpenPNL + totalClosedPNL + realizedTodayPNL;
  const liquidationThreshold = (await getUserLiquidationPrice(userId)) || 0; // Default threshold if not found
  // console.log(liquidationThreshold)

  // 🚨 LIQUIDATION CHECK
  // 🚨 LIQUIDATION CHECK
  if (totalOpenPNL <= -liquidationThreshold && filteredOpen.length > 0) {
    console.log(
      `⚠️ Liquidating all open positions for user: ${userId} due to total loss ₹${totalPNL.toFixed(
        2
      )} exceeding limit ₹100`
    );

    const nowISO = DateTime.now().setZone("Asia/Kolkata").toISO();

    const liquidationTasks = filteredOpen.map(async (pos) => {
      const {
        positionId,
        pnl,
        markPrice,
        positionType,
        contributionAmount,
        symbol,
        leverage,
        lot,
        quantity,
        stopLoss,
        takeProfit,
        orderType,
        orderID,
      } = pos;

      // 1️⃣ Close the position in DB
      const updateCmd = {
        TableName: "incrypto-dev-positions",
        Key: {
          positionId: { S: positionId },
        },
        UpdateExpression: `
        SET 
          #status = :closed,
          #closedAt = :closedAt,
          #positionClosedType = :positionClosedType,
          #quantity = :zero,
          #contributionAmount = :zero,
          #pnl = :pnl,
          #exitPrice = :exitPrice
      `,
        ExpressionAttributeNames: {
          "#status": "status",
          "#closedAt": "closedAt",
          "#positionClosedType": "positionClosedType",
          "#quantity": "quantity",
          "#contributionAmount": "contributionAmount",
          "#pnl": "pnl",
          "#exitPrice": "exitPrice",
        },
        ExpressionAttributeValues: {
          ":closed": { S: "CLOSED" },
          ":closedAt": { S: nowISO },
          ":positionClosedType": { S: "LIQUIDATION_HIT" },
          ":zero": { N: "0" },
          ":pnl": { N: pnl.toFixed(6) },
          ":exitPrice": { N: markPrice.toFixed(6) },
        },
      };

      await dynamoClient.send(new UpdateItemCommand(updateCmd));

      // 2️⃣ Create a reverse order entry
      const newOrderId = `INOR-${Date.now()}`;
      const safeExitPrice = markPrice;
      const safeQuantity = quantity;
      const BROKERAGE_FEE = 0; // set your fee
      const feeInINR = 0; // convert fee if needed
      const currency = symbol; // or extract from symbol if required
      const orderSource = "SYSTEM";
      const strategy = "LIQUIDATION";
      const posId = positionId;

      const orderPayload = {
        orderId: newOrderId,
        userId,
        createdAt: nowISO,
        updatedAt: nowISO,
        fee: BROKERAGE_FEE,
        feeInINR,
        leverage,
        lot,
        marginAmount: contributionAmount,
        currency,
        status: "FILLED",
        orderType: "MARKET",
        // operation: positionType === "LONG" ? "SELL" : "BUY",
        operation: (positionType === "LONG" || positionType === "LONG_LIMIT") ? "SELL" : "BUY",
        orderMessage: `Auto order due to liquidation @${safeExitPrice}; margin=${contributionAmount.toFixed(
          8
        )}, fee=${BROKERAGE_FEE.toFixed(8)}`,
        stockSymbol: symbol,
        price: safeExitPrice,
        size: safeQuantity,
        totalValue: safeExitPrice * safeQuantity,
        stopLoss,
        takeProfit,
        positionID: posId,
        source: currency,
        metaData: {
          source: orderSource,
          strategy,
        },
      };

      await docClient.send(
        new PutCommand({
          TableName: "incrypto-dev-orders",
          Item: orderPayload,
        })
      );

      console.log(
        `📦 Created liquidation order ${newOrderId} for position ${positionId}`
      );
    });

    try {
      await Promise.all(liquidationTasks);
      console.log("✅ Liquidation + reverse orders complete.");

      // 3️⃣ Update user's funds to 0
      const updateFundsCmd = {
        TableName: "incrypto-dev-funds",
        Key: {
          userId: { S: userId },
        },
        UpdateExpression: "SET #availableBalance = :zero",
        ExpressionAttributeNames: {
          "#availableBalance": "availableBalance",
        },
        ExpressionAttributeValues: {
          ":zero": { N: "0" },
        },
      };

      await dynamoClient.send(new UpdateItemCommand(updateFundsCmd));
      console.log("💰 User funds set to ₹0 due to liquidation.");
    } catch (err) {
      console.error("❌ Liquidation update failed:", err);
    }

    return; // stop broadcasting since liquidation just happened
  }

  ////////////////////////////////////////////////////////////////////////

  const allPositions = [...filteredOpen, ...newclosedPayload];
  // const userBankBalance = await getUserBankBalance(userId);

  const payload = {
    type: "bulk-position-update",
    positions: allPositions,
    livepnl: totalOpenPNL,
    totalPNL: Number(totalPNL.toFixed(6)),
    totalInvested: Number((totalOpenInvested + totalClosedInvested).toFixed(4)),
    category,
  };

  ws.send(JSON.stringify(payload));
}

export function broadcastPositionData(
  positionConnections,
  symbol,
  symbolData,
  category
) {
  const normalizedSymbol = normalizeToBinanceSymbol(symbol);

  for (const [userId, ws] of positionConnections) {
    if (ws.readyState !== 1) continue;

    const catMap = userSubscriptions.get(userId);
    if (!catMap || !catMap.has(category)) continue;

    const subscribedSymbols = catMap.get(category);
    if (!subscribedSymbols.has(normalizedSymbol)) continue;

    broadcastAllPositions(positionConnections, userId, category);
  }
}

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

async function getUserLiquidationPrice(userId) {
  try {
    // Step 1: Fetch fund balance
    const fundCmd = new QueryCommand({
      TableName: "incrypto-dev-funds",
      KeyConditionExpression: "userId = :uid",
      ExpressionAttributeValues: {
        ":uid": { S: userId },
      },
    });

    const fundRes = await dynamoClient.send(fundCmd);
    const fund = fundRes.Items?.length ? unmarshall(fundRes.Items[0]) : null;
    const availableBalance = fund?.availableBalance || 0;

    return availableBalance;
  } catch (err) {
    console.error("❌ Error computing liquidation price:", err);
    return 0;
  }
}

function normalizeToBinanceSymbol(symbol) {
  if (!symbol || symbol.includes("-")) return symbol;
  return symbol.endsWith("USDT") ? symbol : symbol.replace("USD", "USDT");
}

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
    userPositions = Items.map((item) => unmarshall(item)).filter(
      (pos) => pos.status === "OPEN"
    );
    userActivePositions.set(userId, userPositions);
  } catch (err) {
    return res.status(500).send("Failed to fetch positions");
  }

  const symbols = userPositions.map((pos) => pos.assetSymbol).filter(Boolean);
  const symbolSet = catMap.get(category) || new Set();
  symbols.forEach((symbol) => symbolSet.add(normalizeToBinanceSymbol(symbol)));
  catMap.set(category, symbolSet);

  const futuresSet = catMap.get("futures") || new Set();
  userPositions.forEach((pos) => {
    if (isFuturesSymbol(pos.assetSymbol)) {
      futuresSet.add(normalizeToBinanceSymbol(pos.assetSymbol));
    }
  });
  catMap.set("futures", futuresSet);
  userSubscriptions.set(userId, catMap);

  console.log("✅ Manual PnL Update Triggered", userId);
  broadcastAllPositions(req.app.get("positionConnections"), userId, category);
  res.send("Triggered PnL Update Successfully");
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
