import express from 'express';
import { handleSubscribe, handleUnsubscribe, handleCancelWs } from './services/userStreamHandler.js';

const router = express.Router();

router.post('/subscribe', handleSubscribe);
router.post('/unsubscribe', handleUnsubscribe);
router.post('/cancel-ws', handleCancelWs);


export function broadcastToUsers(currency, date, symbol, data) {
    for (const [userId, ws] of req.app.get('userConnections')) {
      if (ws.readyState !== 1) continue;
  
      const catMap = userSubscriptions.get(userId);
      if (!catMap) continue;
  
      for (const [category, symbolSet] of catMap.entries()) {
        if (symbolSet.has(symbol)) {
          ws.send(JSON.stringify({ symbol, data }));
          break;
        }
      }
    }
  }

export default router;
