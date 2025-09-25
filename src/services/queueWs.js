
// services/queueWs.js
import { WebSocketServer } from "ws";
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from "@aws-sdk/client-sqs";
import {
  saveMessage,
  getUndeliveredMessages,
  markDelivered,
} from "../lib/dynamoClient.js";


import dotenv from "dotenv";

dotenv.config(); 



if (!process.env.AWS_ACCESS_KEY_ID_2 || !process.env.AWS_SECRET_ACCESS_KEY_2) {
  console.error("❌ AWS credentials missing from env!");
}

const sqsClient = new SQSClient({
  region: "ap-southeast-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID_2 || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY_2 || "",
  },
});


// --- SQS Queue URLs ---
const QUEUES = {
  web: "https://sqs.ap-southeast-1.amazonaws.com/614745601820/web-order-events-queue-dev",
  mobile: "https://sqs.ap-southeast-1.amazonaws.com/614745601820/mobile-order-events-queue-dev",
  audit: "https://sqs.ap-southeast-1.amazonaws.com/614745601820/audit-order-events-queue-dev",
};

// Connections map: key = `${userId}:${queueType}`
const queueConnections = new Map();

function createQueueWebSocket() {
  const queueWss = new WebSocketServer({ noServer: true });

  // Poll each SQS queue
  Object.entries(QUEUES).forEach(([queueType, url]) => {
    pollQueue(queueType, url);
  });

  return queueWss;
}

// --- Poll SQS continuously ---
async function pollQueue(queueType, queueUrl) {
  try {
    const params = { QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 20 };
    const data = await sqsClient.send(new ReceiveMessageCommand(params));

    if (data.Messages) {
      for (const msg of data.Messages) {
        let body;
        try {
          body = JSON.parse(msg.Body);
          if (body.Message) body = JSON.parse(body.Message);
        } catch (err) {
          console.error("❌ Failed to parse SQS message:", err);
          continue;
        }

        const userId = body.userId;
        const messageId = body.messageId || msg.MessageId;
        const payload = body;

        const connectionKey = `${userId}:${queueType}`;
        const ws = queueConnections.get(connectionKey);

        if (ws && ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ messageId, payload, category: queueType }));
          await saveMessage(userId, messageId, payload, queueType, true);
          console.log(`➡️ Sent & saved as delivered to ${userId} [${queueType}]`);
        } else {
          await saveMessage(userId, messageId, payload, queueType, false);
          console.log(`💾 Saved undelivered message for ${userId} [${queueType}]`);
        }

        // Remove from SQS
        await sqsClient.send(new DeleteMessageCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: msg.ReceiptHandle,
        }));
      }
    }
  } catch (err) {
    console.error(`❌ Error polling ${queueType}:`, err);
  }

  setImmediate(() => pollQueue(queueType, queueUrl));
}

// --- Resend Undelivered Messages ---
async function resendPendingMessages(userId, category, ws) {
  try {
    const pending = await getUndeliveredMessages(userId, category);
    for (const msg of pending) {
      ws.send(JSON.stringify({
        messageId: msg.messageId,
        payload: msg.payload,
        category,
      }));
      await markDelivered(userId, msg.messageId, category);
    }
    if (pending.length > 0) {
      console.log(`📦 Resent ${pending.length} pending messages to ${userId} [${category}]`);
    }
  } catch (err) {
    console.error(`❌ Failed to resend pending messages for ${userId} [${category}]`, err);
  }
}

export { createQueueWebSocket, queueConnections, resendPendingMessages };
