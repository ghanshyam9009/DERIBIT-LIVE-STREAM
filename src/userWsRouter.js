import express from 'express';
import { handleSubscribe, handleUnsubscribe, handleCancelWs } from './services/userStreamHandler.js';
import { handleSubscribe1,handleUnsubscribe2,handleCancelPositionWs} from './services/subscriptionHandler.js';

const router = express.Router();

router.post('/subscribe', handleSubscribe);
router.post('/unsubscribe', handleUnsubscribe);
router.post('/cancel-ws', handleCancelWs);

router.post('/external-subscribe', handleSubscribe1);
router.post('/external-unsubscribe', handleUnsubscribe2);
router.post('/cancel-position-ws', handleCancelPositionWs);






export default router;
