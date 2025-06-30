export function extractDateFromSymbol(symbol) {
  const match = symbol.match(/(BTC|ETH)-(\d{1,2}[A-Z]{3}\d{2})/);
  return match ? match[2] : null;
}

export function parseDate(dateStr) {
  const match = dateStr.match(/^(\d{1,2})([A-Z]{3})(\d{2})$/);
  if (!match) return null;

  const [, dayStr, monStr, yearStr] = match;

  const months = {
    JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
    JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11
  };

  const day = parseInt(dayStr, 10);
  const year = parseInt('20' + yearStr, 10);

  return new Date(year, months[monStr], day);
}
