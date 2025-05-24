// utils/symbolUtils.js

export function isOptionSymbol(symbol) {
    // Match format like BTC-25MAY25-107000-C
    return /^[A-Z]+-\d{2}[A-Z]{3}\d{2}-\d+-[CP]$/.test(symbol);
  }
  
  export function isFuturesSymbol(symbol) {
    // Ends with USD
    return /^[A-Z]+USD$/.test(symbol);
  }
  
  
  export function getCurrencyAndDateFromSymbol(symbol) {
    // Example: BTC-25MAY25-107000-C
    const parts = symbol.split('-');
    if (parts.length < 4) return [null, null];
  
    const currency = parts[0];
    const date = parts[1];
  
    return [currency, date];
  }
  