import { createSupabaseRpc } from './supabase-rpc.mjs';
export class AgentAccessError extends Error {
  constructor(code, status = 503) { super('Personal-agent access request was not accepted.'); this.name = 'AgentAccessError'; this.code = code; this.status = status; }
}
const statuses = { invalid_token:401, insufficient_scope:403, grant_not_found:404, request_limit:429, rate_limit:429, review_limit:429, grant_limit:409, workspace_required:409, idempotency_conflict:409 };
export function createPersonalAgentStore(config, { fetchImpl, audience } = {}) {
  let origin;try{origin=new URL(audience);}catch{throw new AgentAccessError('access_unconfigured');}
  if(origin.protocol!=='https:'||origin.origin!==audience||origin.username||origin.password)throw new AgentAccessError('access_unconfigured');
  const rpc = createSupabaseRpc(config, { fetchImpl });
  async function call(operation, { ownerId = null, digest = null, ...payload } = {}) {
    const value = await rpc('angbao_agent_v1', { p_operation: operation, p_owner_id: ownerId, p_digest: digest, p_payload: { ...payload, audience } });
    if (!value || typeof value !== 'object' || typeof value.ok !== 'boolean') throw new AgentAccessError('access_unavailable');
    if (!value.ok) throw new AgentAccessError(Object.hasOwn(statuses, value.code) ? value.code : 'access_unavailable', statuses[value.code] || 503);
    return value.data;
  }
  return {
    list: ownerId => call('list', { ownerId }),
    create: (ownerId, grant) => call('create', { ownerId, ...grant }),
    revoke: (ownerId, grantId) => call('revoke', { ownerId, grantId }),
    authorize: digest => call('authorize', { digest }),
    read: (digest, scope) => call('read', { digest, scope }),
    receipt: (digest, scope, operationKey, fingerprint) => call('receipt', { digest, scope, operationKey, fingerprint }),
    commit: (digest, scope, revision, envelope, operationKey, fingerprint) => call('commit', { digest, scope, revision, envelope, operationKey, fingerprint }),
  };
}
