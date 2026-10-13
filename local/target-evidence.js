// Read-only evidence for the deliberately public #71 puzzle; never dispatches work.
export const puzzle71 = Object.freeze({ id: 'public-puzzle-71', version: 1,
  address: '1PWo3JeB9jrGwfHDNpdGK54CRas7fsVzXU',
  start: (2n ** 70n).toString(), endExclusive: (2n ** 71n).toString(),
  rangeSource: 'https://btcpuzzle.info/puzzle/71' });
export const explorers = Object.freeze(['https://blockstream.info/api', 'https://mempool.space/api']);
const fields = ['funded_txo_count', 'funded_txo_sum', 'spent_txo_count', 'spent_txo_sum', 'tx_count'];
function stats(value, confirmed = true) {
  if (!value || fields.some(k => !Number.isSafeInteger(value[k]) || value[k] < 0)) throw Error('Invalid explorer amounts/counts');
  if (confirmed && (value.spent_txo_sum > value.funded_txo_sum || value.spent_txo_count > value.funded_txo_count))
    throw Error('Inconsistent explorer totals');
  return Object.fromEntries(fields.map(k => [k, value[k]]));
}
export function assessTarget(observations, now = Date.now()) {
  if (!Number.isSafeInteger(now) || now < 0) throw Error('Invalid evidence clock');
  const reasons = []; const valid = [];
  for (const source of explorers) {
    const rows = observations.filter(r => r.source === source);
    if (rows.length !== 1) { reasons.push('Missing or duplicate explorer'); continue; }
    const row = rows[0];
    try {
      const at = Date.parse(row.observedUtc);
      if (!Number.isFinite(at) || at > now || now - at > 600000) throw Error('Stale or future evidence');
      if (row.result?.address !== puzzle71.address) throw Error('Wrong target or unavailable explorer');
      valid.push({ source, chain: stats(row.result.chain_stats), mempool: stats(row.result.mempool_stats, false) });
    } catch (error) { reasons.push(error.message); }
  }
  if (valid.length === 2 && JSON.stringify(valid[0].chain) !== JSON.stringify(valid[1].chain)) reasons.push('Explorers disagree');
  if (valid.some(r => r.chain.spent_txo_count > 0 || r.chain.spent_txo_sum > 0)) reasons.push('Confirmed spending observed');
  if (valid.some(r => fields.some(k => r.mempool[k] !== 0))) reasons.push('Pending activity; reconcile before use');
  if (valid.some(r => r.chain.funded_txo_sum === 0)) reasons.push('No confirmed funding');
  const corroborated = valid.length === 2 && JSON.stringify(valid[0].chain) === JSON.stringify(valid[1].chain);
  return { target: puzzle71, assessedUtc: new Date(now).toISOString(),
    status: reasons.length ? 'PAUSED_EVIDENCE' : 'FUNDED_NO_SPEND_OBSERVED', reasons,
    corroboratedBalanceSatoshis: corroborated ? String(valid[0].chain.funded_txo_sum - valid[0].chain.spent_txo_sum) : null,
    searchEnabled: false, publicKeyStatus: 'NOT_VERIFIED',
    limits: 'Explorer agreement is not a full-node verification or proof nobody knows the key. No live dispatch authorization.' };
}
export async function observeTarget(fetcher = fetch) {
  return Promise.all(explorers.map(async source => {
    try {
      const response = await fetcher(`${source}/address/${puzzle71.address}`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw Error('Explorer HTTP error');
      const body = await response.text(); if (body.length > 16384) throw Error('Explorer response too large');
      return { source, observedUtc: new Date().toISOString(), result: JSON.parse(body) };
    } catch { return { source, observedUtc: new Date().toISOString(), error: 'Explorer unavailable or invalid' }; }
  }));
}
