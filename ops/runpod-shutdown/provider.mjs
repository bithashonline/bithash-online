// This transport has no create, resume, billing or credential-management method.
const ORIGIN = 'https://api.runpod.io/v2';
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
        headers: { Authorization: `Bearer ${this.#key}`, Accept: 'application/json',
          ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
        ...(method === 'POST' ? { body: JSON.stringify({ action: 'stop' }) } : {})
      });
      // Never log provider bodies: Pod GET responses can contain environment secrets.
      if (response.status === 404 && method === 'GET') return null;
      if (!response.ok) throw new ProviderError(`http_${response.status}`, response.status);
      if (method !== 'GET') return { accepted: true };
      const value = await response.json();
      if (!value || value.id !== podId || typeof value.name !== 'string' ||
          !['PROVISIONING', 'STARTING', 'RUNNING', 'EXITED', 'ERROR', 'TERMINATED'].includes(value.status)) throw new ProviderError('invalid_provider_response');
      const cost = value.cost;
      if (!(typeof cost === 'string' || typeof cost === 'number') || !/^\d+(\.\d{1,6})?$/.test(String(cost))) throw new ProviderError('invalid_provider_rate');
      const [whole, fraction = ''] = String(cost).split('.');
      const hourlyMicrousd = (BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'))).toString();
      // Only an explicit empty mounts object proves no attached persistent storage.
      // Missing, null, malformed or future mount kinds must block automatic deletion.
      let volumeInGb; let networkVolumeId;
      const mounts = value.mounts;
      if (mounts && typeof mounts === 'object' && !Array.isArray(mounts)) {
        if (Object.keys(mounts).length === 0) { volumeInGb = 0; networkVolumeId = null; }
        else {
          if (Number.isSafeInteger(mounts.persistent?.size) && mounts.persistent.size > 0) volumeInGb = mounts.persistent.size;
          if (Array.isArray(mounts.network) && mounts.network.length > 0) networkVolumeId = 'attached-network-volume';
        }
      }
      // Preserve the controller's internal field for durable-state compatibility.
      // v2 status is observed lifecycle, not v1 desired state; cost is not an invoice.
      return { id: value.id, name: value.name, desiredStatus: value.status, hourlyMicrousd,
        volumeInGb, networkVolumeId };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      // Fetch errors, redirects, invalid JSON and provider text never cross the log boundary.
      throw new ProviderError('transport_or_response_error');
    }
  }
  get(podId) { return this.#request('GET', podId); }
  stop(podId) { return this.#request('POST', podId, '/action'); }
  delete(podId) { return this.#request('DELETE', podId); }
}
