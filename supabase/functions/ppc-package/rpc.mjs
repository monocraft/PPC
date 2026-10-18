const OPERATIONS = new Set(['reserve', 'upload_claim', 'upload_result', 'finalize', 'confirm', 'current', 'cleanup', 'phase', 'control', 'prepare_claim', 'prepare_result']);
export function createPackageDeliveryRpc({ env = {}, fetchImpl = globalThis.fetch } = {}) {
  let keys; try { keys = JSON.parse(env.SUPABASE_SECRET_KEYS || '{}'); } catch { throw new Error('Private delivery database is unavailable.'); }
  const credential = keys.default || env.SUPABASE_SERVICE_ROLE_KEY;
  const base = env.SUPABASE_URL;
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(base || '') || !credential) throw new Error('Private delivery database is unavailable.');
  return async (operation, payload = {}) => {
    if (!OPERATIONS.has(operation) && operation !== 'rate') throw new Error('Unknown delivery operation.');
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json', apikey: credential };
    if (!credential.startsWith('sb_secret_')) headers.Authorization = `Bearer ${credential}`;
    const name = operation === 'rate' ? 'ppc_master_rate' : `ppc_package_${operation}`;
    const response = await fetchImpl(`${base}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify({ payload }), redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok || response.redirected) { await response.body?.cancel().catch(() => {}); throw new Error('Private delivery database is unavailable.'); }
    const reader = response.body?.getReader(); if (!reader) throw new Error('Private delivery database is unavailable.');
    const decoder = new TextDecoder('utf-8', { fatal: true }); let size = 0, text = '';
    try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 32 * 1024) throw new Error('Invalid delivery state.'); text += decoder.decode(part.value, { stream: true }); } return JSON.parse(text + decoder.decode()); }
    finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  };
}
