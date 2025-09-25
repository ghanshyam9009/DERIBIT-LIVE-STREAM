import { WebSocketServer } from "ws";
import {
  DynamoDBClient,
  QueryCommand,
  GetItemCommand
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { DateTime } from "luxon";
import { getDeltaSymbolData } from "./deltaSymbolStore.js";
import { getSymbolDataByDate } from "./symbolStore.js";

import {
  getCurrencyAndDateFromSymbol,
  isFuturesSymbol,
  isOptionSymbol,
} from "../utils/symbolUtils.js";
const dynamoClient = new DynamoDBClient({ region: "ap-southeast-1" });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

export const fundConnections = new Map();  // Map<userId, WebSocket>
const lastPayload = new Map();             // cache last sent payload

export function createFundWebSocket() {
  const wss = new WebSocketServer({ noServer: true });

  // polling or use DynamoDB Streams for instant updates
  setInterval(async () => {
    for (const [userId, ws] of fundConnections.entries()) {
      if (ws.readyState !== 1) continue;
      const payload = await buildFundSnapshot(userId);
      const prev = lastPayload.get(userId);

      // send only when values change
      if (
        // !prev ||
        // payload.totalContribution !== prev.totalContribution ||
        // payload.availableFunds   !== prev.availableFunds ||
        // payload.livePNL          !== prev.livePNL
        true
      ) {
        ws.send(JSON.stringify(payload));
        lastPayload.set(userId, payload);
      }
    }
  }, 3000);

  return wss;
}

function normalizeToBinanceSymbol(symbol) {
    if (!symbol || symbol.includes("-")) return symbol;
    return symbol.endsWith("USDT") ? symbol : symbol.replace("USD", "USDT");
  }
  
async function buildFundSnapshot(userId) {
  // 1️⃣ fetch open positions
  const posRes = await dynamoClient.send(new QueryCommand({
    TableName: "incrypto-dev-positions",
    IndexName: "UserIndex",
    KeyConditionExpression: "userId = :u",
    ExpressionAttributeValues: { ":u": { S: userId } }
  }));
  const positions = (posRes.Items || []).map(unmarshall);
  const open = positions.filter(p => p.status === "OPEN");

  let totalContribution = 0, livePNL = 0;
  for (const p of open) {
    totalContribution += Number(p.contributionAmount || 0);
    // console.log(totalContribution);
    const norm = normalizeToBinanceSymbol(p.assetSymbol);
    let markPrice = 0;
    if (isFuturesSymbol(p.assetSymbol)) {
      markPrice = Number(getDeltaSymbolData(norm)?.mark_price || 0);
    } else if (isOptionSymbol(p.assetSymbol)) {
      const [currency, date] = getCurrencyAndDateFromSymbol(p.assetSymbol);
      markPrice = Number(getSymbolDataByDate(currency, date, p.assetSymbol)?.mark_price || 0);
    }
    if (!markPrice) continue;

    const isShort = ["SHORT", "SHORT_LIMIT"].includes(p.positionType);
    livePNL += isShort
      ? (p.entryPrice - markPrice) * p.quantity
      : (markPrice - p.entryPrice) * p.quantity;
  }

  // 2️⃣ fetch funds
  const fundsRes = await dynamoClient.send(new GetItemCommand({
    TableName: "incrypto-dev-funds",
    Key: { userId: { S: userId } }
  }));
  const availableFunds = Number(unmarshall(fundsRes.Item || {}).availableBalance || 0);

  const grandTotal = totalContribution + availableFunds + livePNL;
  
//   console.log(grandTotal)

  return {
    type: "fund-update",
    userId,
    totalContribution: +totalContribution.toFixed(6),
    availableFunds:   +availableFunds.toFixed(6),
    livePNL:          +livePNL.toFixed(6),
    grandTotal:       +grandTotal.toFixed(6),
    timestamp: DateTime.now().toISO()
  };
}

