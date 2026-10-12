// This transport has no create, resume, billing or credential-management method.
const ORIGIN = 'https://rest.runpod.io/v1';
export class ProviderError extends Error {
  constructor(code, status = null) { super(code); this.code = code; this.status = status; }
}
export const validPodId = id => typeof id === 'string' && /^[a-z0-9]{10,32}$/.test(id);
export class RunpodShutdownApi {
  #key; #fetch; #timeout;
  constructor({ apiKey, fetchImpl = globalThis.fetch, timeoutMs = 5000 }) {
    if (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n]/.test(apiKey)) throw new ProviderError('controller_credential_missing');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) throw new ProviderError('invalid_timeout');
    this.#key = apiKey; this.#fetch = fetchImpl; this.#timeout = timeoutMs;
  }
  async #request(method, podId, suffix = '') {
    if (!validPodId(podId)) throw new ProviderError('invalid_pod_id');
    try {
      const response = await this.#fetch(`${ORIGIN}/pods/${podId}${suffix}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(this.#timeout),
        headers: { Authorization: `Bearer ${this.#key}`, Accept: 'application/json' }
      });
      // Never log provider bodies: Pod GET responses can contain environment secrets.
      if (response.status === 404 && method === 'GET') return null;
      if (!response.ok) throw new ProviderError(`http_${response.status}`, response.status);
      if (method !== 'GET') return { accepted: true };
      const value = await response.json();
      if (!value || value.id !== podId || typeof value.name !== 'string' ||
          !['RUNNING', 'EXITED', 'TERMINATED'].includes(value.desiredStatus)) throw new ProviderError('invalid_provider_response');
      const cost = value.costPerHr;
      if (!(typeof cost === 'string' || typeof cost === 'number') || !/^\d+(\.\d{1,6})?$/.test(String(cost))) throw new ProviderError('invalid_provider_rate');
      const [whole, fraction = ''] = String(cost).split('.');
      const hourlyMicrousd = (BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'))).toString();
      const networkVolumeId = Object.hasOwn(value,'networkVolumeId') ? value.networkVolumeId
        : Object.hasOwn(value,'networkVolume') ? (value.networkVolume === null ? null : value.networkVolume?.id) : undefined;
      return { id: value.id, name: value.name, desiredStatus: value.desiredStatus, hourlyMicrousd,
        volumeInGb: value.volumeInGb,
        networkVolumeId: value.networkVolume != null ? (value.networkVolume.id || 'unknown-attached-volume') : networkVolumeId };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      // Fetch errors, redirects, invalid JSON and provider text never cross the log boundary.
      throw new ProviderError('transport_or_response_error');
    }
  }
  get(podId) { return this.#request('GET', podId); }
  stop(podId) { return this.#request('POST', podId, '/stop'); }
  delete(podId) { return this.#request('DELETE', podId); }
}
