
import { broadcastToUsers } from './userStreamHandler.js';
import { userConnections } from '../server.js';

const fullStore = new Map(); // Map<currency, Map<date, Map<symbol, data>>>

function ensureNestedMap(currency, date) {
  if (!fullStore.has(currency)) fullStore.set(currency, new Map());
  const dateMap = fullStore.get(currency);
  if (!dateMap.has(date)) dateMap.set(date, new Map());
  return dateMap.get(date);
}

export function storeSymbolDataByDate(currency, date, symbol, symbolData) {
  const symbolMap = ensureNestedMap(currency, date);
  symbolMap.set(symbol, symbolData);
  broadcastToUsers(userConnections, currency, date, symbol, symbolData);
}

export function getSymbolDataByDate(currency, date, symbol) {
  return fullStore.get(currency)?.get(date)?.get(symbol);
}

export function getAllSymbolDataByDate(currency, date) {
  const symbols = fullStore.get(currency)?.get(date);
  return symbols ? Object.fromEntries(symbols) : {};
}

export function getAllDates(currency) {
  return [...(fullStore.get(currency)?.keys() || [])];
}

export function getFullSymbolDataMap() {
  return fullStore;
}
