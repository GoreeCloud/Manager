const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6 });
export function money(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return usd.format(value);
}
