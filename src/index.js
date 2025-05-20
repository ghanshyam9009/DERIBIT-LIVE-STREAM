

// import { fetchAndSaveSymbolsByCurrency, readSymbolsFromCSVsByCurrency } from './services/fetchSymbols.js';
// import { startWebSocketForCurrency } from './services/wsHandler.js';
// import config from './config/index.js';

// (async () => {
//   try {
//     console.log('🚀 Starting Deribit Symbol Service...');

//     for (const currency of config.currencies) {
//       await fetchAndSaveSymbolsByCurrency(currency);
//       const symbols = await readSymbolsFromCSVsByCurrency(currency);
//       startWebSocketForCurrency(currency, symbols);
//     }
//   } catch (err) {
//     console.error('❌ Startup error:', err);
//   }
// })();
