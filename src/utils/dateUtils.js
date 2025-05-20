export function extractDateFromSymbol(symbol) {
  const match = symbol.match(/(BTC|ETH)-(\d{2}[A-Z]{3}\d{2})/);
  return match ? match[2] : null;
}

  
  export function parseDate(dateStr) {
    const months = {
      JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
      JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11
    };
    const day = parseInt(dateStr.slice(0, 2));
    const monStr = dateStr.slice(2, 5);
    const year = parseInt('20' + dateStr.slice(5));
    return new Date(year, months[monStr], day);
  }
  