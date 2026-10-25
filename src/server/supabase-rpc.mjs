/** Server-only REST/RPC transport. Never import into browser/CLI bundles. */
export class SupabasePersistenceError extends Error {
  constructor(code = 'storage_unavailable') { super('Private storage request could not be completed.'); this.name = 'SupabasePersistenceError'; this.code = code; }
}
const fail = code => { throw new SupabasePersistenceError(code); };
export const ownerId = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(value)) fail('invalid_owner');
  return value;
};
export function supabasePersistenceConfig(env = {}) {
  return { url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY, timeoutMs: env.SUPABASE_RPC_TIMEOUT_MS };
}
export function createSupabaseRpc(config, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof window !== 'undefined') fail('server_only');
  let url;
  try { url = new URL(config?.url); } catch { fail('storage_configuration_required'); }
  if (url.protocol !== 'https:' || !/^[a-z0-9][a-z0-9-]{1,62}\.supabase\.co$/.test(url.hostname) || url.origin !== config.url || url.username || url.password || url.port) fail('storage_configuration_required');
  const key = config.serviceKey;
  if (typeof key !== 'string' || key.length > 4096 || /\s/.test(key)) fail('storage_configuration_required');
  const secret = /^sb_secret_[A-Za-z0-9_-]{16,}$/.test(key);
  if (!secret) {
    try {
      const parts = key.split('.');
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (parts.length !== 3 || payload.role !== 'service_role' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) fail('storage_configuration_required');
    } catch { fail('storage_configuration_required'); }
  }
  const timeoutMs = config.timeoutMs === undefined || config.timeoutMs === '' ? 10000 : Number(config.timeoutMs);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 15000 || typeof fetchImpl !== 'function') fail('storage_configuration_required');
  return async (name, payload) => {
    if (!['angbao_workspace_v1', 'angbao_billing_v1', 'angbao_agent_v1'].includes(name)) fail('invalid_operation');
    let body;
    try { body = JSON.stringify(payload); if (new TextEncoder().encode(body).length > 2 * 1024 * 1024) fail('storage_input_too_large'); } catch (error) { if (error instanceof SupabasePersistenceError) throw error; fail('storage_input_invalid'); }
    const controller = new AbortController(); let timer, reader;
    const operation = async () => {
      const headers = { apikey: key, 'content-type': 'application/json', accept: 'application/json' };
      if (!secret) headers.authorization = `Bearer ${key}`;
      const response = await fetchImpl(`${url.origin}/rest/v1/rpc/${name}`, { method: 'POST', headers, body, signal: controller.signal, redirect: 'error', cache: 'no-store' });
      if (!response.ok) { controller.abort(); void response.body?.cancel().catch(() => {}); fail('storage_unavailable'); }
      reader = response.body?.getReader(); const chunks = []; let size = 0;
      if (!reader) fail('storage_invalid_response');
      try {
        while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 2 * 1024 * 1024) { controller.abort(); void reader.cancel().catch(() => {}); fail('storage_invalid_response'); } chunks.push(value); }
        const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } catch (error) { if (error instanceof SupabasePersistenceError) throw error; fail('storage_invalid_response'); }
    };
    try {
      return await Promise.race([operation(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); void reader?.cancel().catch(() => {}); reject(new SupabasePersistenceError('storage_timeout')); }, timeoutMs); })]);
    } catch (error) { if (error instanceof SupabasePersistenceError) throw error; fail('storage_unavailable'); }
    finally { clearTimeout(timer); }
  };
}
