import { createECDH, createHash } from 'node:crypto';

const hash = (name, data) => createHash(name).update(data).digest();
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const fixtures = Object.freeze([
  Object.freeze({ id: 'puzzle-1', start: '1', end: '2', address: '1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH' }),
  Object.freeze({ id: 'puzzle-2', start: '2', end: '4', address: '1CUNEBjYrCn2y1SdiUMohaKUi4wpP326Lb' }),
  Object.freeze({ id: 'puzzle-3', start: '4', end: '8', address: '19ZewH8Kk1PDbSNdJ97FP4EiCjTRaZMZQA' }),
]);
export function integer(value) {
  if (typeof value === 'bigint') { if (value < 0n) throw Error('Expected unsigned integer'); return value; }
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw Error('Expected exact unsigned decimal string');
  return BigInt(value);
}
export function addressFor(key) {
  key = integer(key);
  if (key <= 0n || key >= 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n) throw Error('Invalid scalar');
  const curve = createECDH('secp256k1');
  curve.setPrivateKey(Buffer.from(key.toString(16).padStart(64, '0'), 'hex'));
  const payload = Buffer.concat([Buffer.from([0]), hash('ripemd160', hash('sha256', curve.getPublicKey(null, 'compressed')))]);
  const bytes = Buffer.concat([payload, hash('sha256', hash('sha256', payload)).subarray(0, 4)]);
  let number = BigInt('0x' + bytes.toString('hex')), result = '';
  while (number) { result = alphabet[Number(number % 58n)] + result; number /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; result = '1' + result; }
  return result;
}
// The only executable targets are known solved fixtures. No arbitrary wallet or #71 API.
export function search(id, start, end) {
  const fixture = fixtures.find(f => f.id === id);
  start = integer(start); end = integer(end);
  if (!fixture || start < BigInt(fixture.start) || end > BigInt(fixture.end) || end <= start) throw Error('Outside solved fixture');
  const began = process.hrtime.bigint();
  let matched = false;
  for (let key = start; key < end; key++) if (addressFor(key) === fixture.address) matched = true;
  return { attempted: (end - start).toString(), matched, elapsedNanoseconds: (process.hrtime.bigint() - began).toString() }; // Never return/log candidate keys.
}
