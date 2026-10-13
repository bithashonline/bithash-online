// Arbitrary test values, NOT approved production economics or real token identities.
export function fixturePolicy(coin = 'main', kind = 'main', shares) {
  return { coin, mint: `dummy-${coin}`, kind, asset: { id: 'dummy-SOL', decimals: 9 },
    target: { id: 'solved-fixture', version: 1 }, policyVersion: 1, mode: 'fixture',
    shares: shares ?? { compute: 6100, rewards: 2300, [kind === 'main' ? 'treasury' : 'burn']: 1600 } };
}
export function fixtureReceipt(p, event = 'receipt-main', amount = '10001') {
  return { event, mode: 'fixture', coin: p.coin, mint: p.mint, asset: { ...p.asset }, target: { ...p.target },
    policyVersion: p.policyVersion, amount, custody: 'shared-dummy-wallet' };
}
