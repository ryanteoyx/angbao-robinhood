/** Declarative editing only: these records are never jobs, agent grants or runnable graphs. */
export const COMPOSITION_LIMITS = Object.freeze({ drafts: 20, blocks: 30, id: 80, name: 120, label: 120, harness: 80, reference: 500, bytes: 65536 });
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

export class CompositionDraftError extends Error {
  constructor(message, code = 'invalid_composition_draft') { super(message); this.name = 'CompositionDraftError'; this.code = code; this.status = 400; }
}
function reject(message) { throw new CompositionDraftError(message); }
function exact(value, keys) {
  if (!plain(value) || Object.keys(value).some(key => forbidden.has(key) || !keys.includes(key))) reject('This draft includes an unsupported field. Use only the documented fields.');
}
function text(value, limit) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\u0000-\u001f\u007f]/.test(value)) reject('Enter plain text within the field limit. Do not leave it blank.');
  // Defensive detection, not a secret scanner. Text is never evaluated or fetched.
  if (/-----BEGIN .*PRIVATE KEY|\bBearer\s+\S+|\bsk-[A-Za-z0-9_-]{16,}|(?:api[_-]?key|access[_-]?token|secret|authorization)\s*[=:]\s*\S+/i.test(value)) reject('Remove passwords, access tokens or keys before saving this draft.');
  if (/^(?:javascript|data):/i.test(value.trim()) || /<\s*script\b/i.test(value)) reject('Remove scripts and executable links from this draft.');
  return value.trim();
}
function identifier(value, stored) {
  if (value === undefined && !stored) return crypto.randomUUID();
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value)) reject('Give each draft and block an ID of 1 to 80 letters, numbers, hyphens or underscores, starting with a letter or number.');
  return value;
}
function timestamp(value) {
  if (typeof value !== 'string' || value.length > 30 || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) reject('Draft timestamps must use the ISO format, such as 2026-10-24T00:00:00.000Z.');
  return value;
}
function reference(value) {
  const result = text(value, COMPOSITION_LIMITS.reference);
  if (/^https?:\/\//i.test(result)) {
    let url;
    try { url = new URL(result); } catch { reject('Enter a valid source URL or a plain-text reference.'); }
    if (url.username || url.password || [...url.searchParams.keys()].some(key => /token|key|secret|auth|signature/i.test(key))) reject('Remove usernames, passwords and access keys from source links.');
  }
  return result;
}

function blockConfig(type, input, validateStrategy) {
  if (type === 'strategy') {
    exact(input, ['id', 'version', 'settings']);
    text(input.id, 80); text(input.version, 64);
    if (typeof validateStrategy !== 'function') reject('Angbao cannot validate this strategy. Try again after the app is updated.');
    return validateStrategy(input);
  }
  const keys = type === 'agent' ? ['label', 'harness'] : type === 'source' ? ['label', 'reference'] : ['label'];
  exact(input, keys);
  const result = { label: text(input.label, COMPOSITION_LIMITS.label) };
  if (type === 'agent' && own(input, 'harness')) result.harness = text(input.harness, COMPOSITION_LIMITS.harness);
  if (type === 'source' && own(input, 'reference')) result.reference = reference(input.reference);
  return result;
}

/** Stored mode validates existing records without rewriting their timestamps or IDs. */
export function normalizeCompositionDrafts(input, { previous = [], now = new Date(), validateStrategy, stored = false } = {}) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > COMPOSITION_LIMITS.drafts) reject('Save up to 20 strategy drafts.');
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > COMPOSITION_LIMITS.bytes) reject('Your strategy drafts exceed 64 KiB. Shorten or remove a draft before saving.');
  const seenDrafts = new Set();
  const result = input.map(draft => {
    exact(draft, ['id', 'name', 'blocks', 'updatedAt', 'status']);
    const id = identifier(draft.id, stored);
    if (seenDrafts.has(id)) reject('Give each strategy draft a different ID.');
    seenDrafts.add(id);
    if (draft.status !== undefined && draft.status !== 'draft') reject('Set this strategy\'s status to draft. Saved drafts cannot run.');
    if (stored && draft.status !== 'draft') reject('The saved strategy must have draft status. It cannot run.');
    if (own(draft, 'updatedAt')) timestamp(draft.updatedAt);
    const name = text(draft.name, COMPOSITION_LIMITS.name);
    if (!Array.isArray(draft.blocks) || draft.blocks.length > COMPOSITION_LIMITS.blocks) reject('Use up to 30 blocks in each strategy draft.');
    const seenBlocks = new Set();
    const blocks = draft.blocks.map(block => {
      exact(block, ['id', 'type', 'config']);
      const blockId = identifier(block.id, stored);
      if (seenBlocks.has(blockId)) reject('Give each block in this draft a different ID.');
      seenBlocks.add(blockId);
      if (!['agent', 'source', 'context', 'strategy', 'check', 'review'].includes(block.type)) reject('Choose an agent, source, context, strategy, check or review block.');
      return { id: blockId, type: block.type, config: blockConfig(block.type, block.config, validateStrategy) };
    });
    const old = previous.find(item => item.id === id);
    const unchanged = old?.name === name && JSON.stringify(old.blocks) === JSON.stringify(blocks);
    const updatedAt = stored ? timestamp(draft.updatedAt) : unchanged ? timestamp(old.updatedAt) : now.toISOString();
    return { id, name, blocks, updatedAt, status: 'draft' };
  });
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > COMPOSITION_LIMITS.bytes) reject('Your saved strategy drafts would exceed 64 KiB. Shorten or remove a draft and try again.');
  return result;
}
