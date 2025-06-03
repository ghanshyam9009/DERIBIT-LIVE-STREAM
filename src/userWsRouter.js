import express from 'express';
import { handleSubscribe, handleUnsubscribe, handleCancelWs } from './services/userStreamHandler.js';
import { handleSubscribe1,handleUnsubscribe2,handleCancelPositionWs} from './services/subscriptionHandler.js';
import { getDatesByCurrency } from './services/symbolStore.js';


const router = express.Router();

router.post('/subscribe', handleSubscribe);
router.post('/unsubscribe', handleUnsubscribe);
router.post('/cancel-ws', handleCancelWs);



router.post('/external-subscribe', handleSubscribe1);
router.post('/external-unsubscribe', handleUnsubscribe2);
router.post('/cancel-position-ws', handleCancelPositionWs);

router.post('/dates', (req, res) => {
    const { currency, userId } = req.body;
  
    if (!currency || !userId) {
      return res.status(400).json({ error: 'currency and userId are required' });
    }
  
    const result = getDatesByCurrency(currency); // logic doesn't use userId currently
    res.json(result);
  });



export default router;
