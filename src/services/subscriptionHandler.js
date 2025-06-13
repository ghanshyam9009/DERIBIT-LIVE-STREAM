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
  ListTablesCommand,
} from "@aws-sdk/client-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

export const userSubscriptions = new Map();
const userActivePositions = new Map();

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

// === Subscribe User to Position Category ===
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
    userPositions = Items.map((item) => unmarshall(item));
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
    userPositions = Items.map((item) => unmarshall(item));
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

// === Central Position Broadcaster ===// === Cleaned Position Broadcaster ===
function broadcastAllPositions(positionConnections, userId, category) {
  const ws = positionConnections.get(userId);
  if (!ws || ws.readyState !== 1) return;

  const userPositions = userActivePositions.get(userId);
  if (!userPositions || !userPositions.length) return;

  let totalPNL = 0;
  let totalInvested = 0;

  const positionUpdates = userPositions
    .map((userPos) => {
      const {
        assetSymbol: symbol,
        quantity,
        leverage,
        positionType,
        entryPrice,
      } = userPos;
      let data = {};

      if (isFuturesSymbol(symbol)) {
        data = getDeltaSymbolData(symbol);
      } else if (isOptionSymbol(symbol)) {
        const [currency, date] = getCurrencyAndDateFromSymbol(symbol);
        data = getSymbolDataByDate(currency, date, symbol);
      }

      // const markPrice = parseFloat(data.markPrice ?? data.mark_price);
      // if (!markPrice || isNaN(markPrice)) return null;

      let markPrice = Number(data?.mark_price);
      if (!markPrice || isNaN(markPrice)) {
        markPrice = Number(data?.calculated?.mark_price?.value);
      }

      if (!markPrice || isNaN(markPrice)) return null;

      const invested = entryPrice * quantity;
      let pnl = 0;
      if (positionType === "LONG") pnl = (markPrice - entryPrice) * quantity;
      else if (positionType === "SHORT")
        pnl = (entryPrice - markPrice) * quantity;

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
        pnlPercentage: Number(pnlPercentage.toFixed(2)),
      };
    })
    .filter(Boolean);

  // ✅ Log only once per broadcast
  const symbolNames = positionUpdates.map((p) => p.symbol);
  console.log(
    `[${userId}] Broadcasting ${symbolNames.length} symbols [${symbolNames.join(
      ", "
    )}] in category '${category}'`
  );

  ws.send(
    JSON.stringify({
      type: "bulk-position-update",
      positions: positionUpdates,
      totalPNL: Number(totalPNL.toFixed(2)),
      totalInvested: Number(totalInvested.toFixed(2)),
      category,
    })
  );
}

// === Real-time Broadcast on Symbol Price Update ===
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
