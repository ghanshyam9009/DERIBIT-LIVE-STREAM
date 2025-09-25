
// import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

// export const dynamoClient = new DynamoDBClient({
//   region: process.env.AWS_REGION || "ap-southeast-1",
//   endpoint: process.env.DYNAMODB_ENDPOINT || "http://localhost:8000",
//   credentials: {
//     accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
//     secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ""
//   }
// });

// import { saveMessage, getPendingMessages, markDelivered } from "../lib/dynamoClient.js";






// lib/dynamoClient.js
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";


import dotenv from "dotenv";

dotenv.config(); // Load variables from .env



export const dynamoClient = new DynamoDBClient({
  region: "ap-southeast-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID_2,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY_2,
  },
});


const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = "incrypto-dev-sns";

// Save message
export async function saveMessage(userId, messageId, payload, category, delivered = false) {
  const item = {
    userId,
    messageId,
    category,
    payload,
    delivered,
    timestamp: new Date().toISOString(),
  };
  await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
  return item;
}

// Get undelivered messages (last 24 hrs)
export async function getUndeliveredMessages(userId, category) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const params = {
    TableName: TABLE_NAME,
    FilterExpression:
      "userId = :uid AND category = :cat AND delivered = :d AND #ts >= :since",
    ExpressionAttributeNames: { "#ts": "timestamp" },
    ExpressionAttributeValues: {
      ":uid": userId,
      ":cat": category,
      ":d": false,
      ":since": since,
    },
  };
  const data = await docClient.send(new ScanCommand(params));
  return data.Items || [];
}

// Mark as delivered
export async function markDelivered(userId, messageId, category) {
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { messageId },
    UpdateExpression: "SET delivered = :d",
    ExpressionAttributeValues: { ":d": true },
  }));
}

export default { saveMessage, getUndeliveredMessages, markDelivered };
