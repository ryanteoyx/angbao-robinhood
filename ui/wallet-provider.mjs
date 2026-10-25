/** Explicit injected-wallet selection. Transactions require a separately reviewed owner testnet action. */
import {validateCheckpointWalletReview, CheckpointReviewError, CHECKPOINT_CREATE_PURPOSE,
  CHECKPOINT_COMMIT_PURPOSE, CHECKPOINT_AUTHORITY_FIELDS} from './checkpoint-review.mjs';
export class WalletProviderError extends Error {
  constructor(code, message) { super(message); this.name = 'WalletProviderError'; this.code = code; }
}
const refuse = (code, message) => { throw new WalletProviderError(code, message); };
const ownerAddress = value => typeof value === 'string' && /^0x[\da-f]{40}$/i.test(value) && !/^0x0{40}$/i.test(value);
const operationHash = value => typeof value === 'string' && /^0x[\da-f]{64}$/i.test(value);
const uuid = value => typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
const chainNumber = value => typeof value === 'string' && /^0x[\da-f]+$/i.test(value) ? Number(BigInt(value)) : NaN;

export function createWalletProviderSelection({ windowObject = globalThis.window, onInvalidated = () => {}, now = Date.now } = {}) {
  if (!windowObject || typeof windowObject.addEventListener !== 'function' || typeof windowObject.removeEventListener !== 'function' || typeof windowObject.dispatchEvent !== 'function' || typeof now !== 'function' || typeof onInvalidated !== 'function') refuse('unsupported_environment', 'Wallet discovery is unavailable in this browser.');
  const providers = new Map();
  const checkpointAttempts = new Set(), checkpointRecords = new Set();
  let current = null, binding = null, generation = 0, closed = false, legacyNumber = 0, listeners = [];
  const assertOpen = () => { if (closed) refuse('closed', 'Wallet selection has closed. Open it again.'); };
  const metadata = item => item ? Object.freeze({ id: item.id, name: item.name, source: item.source }) : null;
  function invalidate(reason) {
    binding = null; generation++;
    try { onInvalidated(reason); } catch { /* UI callbacks cannot retain wallet authority. */ }
  }
  function detach() {
    for (const [provider, name, callback] of listeners) { try { provider.removeListener(name, callback); } catch { /* Invalidate even if a provider breaks cleanup. */ } }
    listeners = [];
  }
  function add(provider, id, name, source) {
    if (!provider || (typeof provider !== 'object' && typeof provider !== 'function')) return;
    const existing = providers.get(id);
    if (existing) {
      if (existing.provider !== provider && current === existing) invalidate('provider-changed');
      return; // An announcement cannot replace an already selected provider.
    }
    if ([...providers.values()].some(item => item.provider === provider)) return;
    providers.set(id, { id, provider, name, source });
  }
  function announcement(event) {
    if (closed) return;
    try {
      const { info, provider } = event.detail || {};
      if (!info || !uuid(info.uuid) || typeof info.name !== 'string' || !info.name.trim() || info.name.length > 100) return;
      // Names are plain untrusted text; icons/rdns do not establish identity.
      add(provider, `eip6963:${info.uuid.toLowerCase()}`, info.name.trim(), 'eip6963');
    } catch { /* Malformed announcements do not control selection. */ }
  }
  windowObject.addEventListener('eip6963:announceProvider', announcement);
  function discover() {
    assertOpen();
    try {
      const EventType = windowObject.Event || globalThis.Event;
      if (typeof EventType !== 'function') refuse('unsupported_environment', 'Wallet discovery events are unavailable.');
      windowObject.dispatchEvent(new EventType('eip6963:requestProvider'));
      const injected = windowObject.ethereum;
      const legacy = Array.isArray(injected?.providers) ? injected.providers : injected ? [injected] : [];
      for (const provider of legacy) if (![...providers.values()].some(item => item.provider === provider)) add(provider, `legacy:${++legacyNumber}`, 'Injected wallet (legacy discovery)', 'legacy');
    } catch (error) { if (error instanceof WalletProviderError) throw error; refuse('discovery_failed', 'Wallet discovery failed. Reopen wallet selection.'); }
    return list();
  }
  function list() { assertOpen(); return [...providers.values()].map(metadata); }
  function select(providerId) {
    assertOpen(); const next = providers.get(providerId);
    if (!next) refuse('provider_not_found', 'Choose an available wallet explicitly.');
    if (current === next) return selected();
    detach(); invalidate('selection-changed'); current = null;
    const provider = next.provider;
    if (typeof provider.request !== 'function' || typeof provider.on !== 'function' || typeof provider.removeListener !== 'function') refuse('unsupported_provider', 'This wallet cannot report account and network changes safely. Choose another wallet.');
    try {
      for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) {
        const callback = () => invalidate(event);
        provider.on(event, callback); listeners.push([provider, event, callback]);
      }
      current = next;
    } catch { detach(); refuse('unsupported_provider', 'This wallet could not register account and network listeners.'); }
    return selected();
  }
  function selected() { assertOpen(); return current ? Object.freeze({ ...metadata(current), connected: binding !== null, owner: binding?.owner || null, chainId: binding?.chainId || null, generation }) : null; }
  function expected(expectedOwner, chainId) {
    assertOpen();
    if (!ownerAddress(expectedOwner) || chainId !== 46630) refuse('invalid_request', 'Choose the exact owner wallet account on Robinhood Testnet.');
    if (!current) refuse('selection_required', 'Choose a wallet before connecting.');
    return expectedOwner.toLowerCase();
  }
  // Only internal state: this must remain side-effect-free after provider/clock callbacks.
  function selectionCheckpoint(item, version) {
    assertOpen();
    if (current !== item || generation !== version) refuse('wallet_changed', 'The wallet, account or network changed. Review and connect again.');
  }
  function checkpoint(item, version) {
    selectionCheckpoint(item, version);
    if (item.source === 'legacy') {
      const injected = windowObject.ethereum;
      const candidates = injected?.providers;
      const present = Array.isArray(candidates) ? Array.prototype.includes.call(candidates, item.provider) : injected === item.provider;
      // ethereum/providers/index getters can synchronously invalidate or close selection.
      selectionCheckpoint(item, version);
      if (!present) { invalidate('provider-changed'); refuse('wallet_changed', 'The injected wallet changed. Choose and connect again.'); }
    }
    selectionCheckpoint(item, version);
  }
  async function request(item, version, method, params) {
    checkpoint(item, version);
    let result;
    try { result = await item.provider.request({ method, ...(params ? { params } : {}) }); }
    catch (error) {
      checkpoint(item, version);
      let unsupported = false;
      try { unsupported = error?.code === 4200 || error?.code === -32601; } catch { /* Provider error metadata is untrusted. */ }
      if (unsupported) {
        invalidate('unsupported-method');
        refuse('unsupported_wallet_method', 'This wallet does not support the required operation. Choose another wallet and connect again.');
      }
      refuse('wallet_request_failed', 'The wallet request was declined or could not be completed.');
    }
    checkpoint(item, version); return result;
  }
  function checkAccount(accounts, owner) {
    if (!Array.isArray(accounts) || !accounts.length || !ownerAddress(accounts[0]) || accounts[0].toLowerCase() !== owner) { invalidate('account-mismatch'); refuse('account_mismatch', 'The selected wallet account differs from the reviewed owner wallet account.'); }
  }
  function checkChain(chain) {
    if (chainNumber(chain) !== 46630) { invalidate('chain-mismatch'); refuse('chain_mismatch', 'Select Robinhood Testnet in your wallet, then connect again.'); }
  }
  async function connect({ expectedOwner, chainId } = {}) {
    const owner = expected(expectedOwner, chainId); invalidate('connecting');
    const item = current, version = generation;
    checkAccount(await request(item, version, 'eth_requestAccounts'), owner);
    checkChain(await request(item, version, 'eth_chainId'));
    binding = { owner, chainId }; return selected();
  }
  async function connectOwner({chainId=46630}={}) {
    assertOpen();if(chainId!==46630||!current)refuse('selection_required','Choose a wallet on Robinhood Testnet before continuing.');
    invalidate('connecting');const item=current,version=generation;
    const accounts=await request(item,version,'eth_requestAccounts');
    if(!Array.isArray(accounts)||!ownerAddress(accounts[0]))refuse('account_mismatch','Choose a public owner account in the selected wallet.');
    const owner=accounts[0].toLowerCase();checkChain(await request(item,version,'eth_chainId'));
    binding={owner,chainId};return selected();
  }
  async function signOperationHash({ expectedOwner, chainId, operationHash: hash, expiresAt } = {}) {
    const owner = expected(expectedOwner, chainId);
    const expiry = typeof expiresAt === 'string' ? Date.parse(expiresAt) : NaN;
    if (!operationHash(hash) || !Number.isFinite(expiry) || expiry <= now()) refuse('invalid_operation', 'The exact operation hash is missing or expired. Prepare it again.');
    if (!binding || binding.owner !== owner || binding.chainId !== chainId) refuse('connection_required', 'Connect the exact reviewed owner wallet account before signing.');
    const item = current, version = generation;
    const fresh = () => { checkpoint(item, version); if (expiry <= now()) refuse('expired', 'This operation expired. Prepare and review it again.'); };
    checkAccount(await request(item, version, 'eth_accounts'), owner);
    checkChain(await request(item, version, 'eth_chainId')); fresh();
    const signature = await request(item, version, 'personal_sign', [hash, owner]); fresh();
    checkAccount(await request(item, version, 'eth_accounts'), owner);
    checkChain(await request(item, version, 'eth_chainId')); fresh();
    if (typeof signature !== 'string' || !/^0x[\da-f]{130}$/i.test(signature)) refuse('invalid_signature', 'The wallet returned an unsupported signature.');
    return signature; // Never stored in discovery, selection or binding state.
  }
  async function sendReviewedTestnetTransfer({purpose,expectedOwner,chainId,transaction,token,recipient,amountAtomic,expiresAt}={}) {
    const owner=expected(expectedOwner,chainId),expiry=Date.parse(expiresAt);
    if(purpose!=='robinhood-eoa-goal-transfer'||!binding||binding.owner!==owner||binding.chainId!==46630||!Number.isFinite(expiry)||expiry<=now())refuse('invalid_transaction_review','Reconnect and review this exact test transfer before wallet approval.');
    const keys=['from','to','chainId','type','nonce','value','gas','maxFeePerGas','maxPriorityFeePerGas','data'];
    if(!transaction||typeof transaction!=='object'||Reflect.ownKeys(transaction).length!==keys.length||keys.some(k=>{const d=Object.getOwnPropertyDescriptor(transaction,k);return !d?.enumerable||!Object.hasOwn(d,'value')||typeof d.value!=='string';})||!ownerAddress(token)||!ownerAddress(recipient)||!/^0x[a-f0-9]{40}$/.test(token)||!/^0x[a-f0-9]{40}$/.test(recipient)||!/^[1-9][0-9]{0,77}$/.test(amountAtomic)||BigInt(amountAtomic)>2n**256n-1n)refuse('invalid_transaction_review','The exact test-token transfer could not be confirmed.');
    const tx={...transaction},data='0xa9059cbb'+recipient.slice(2).padStart(64,'0')+BigInt(amountAtomic).toString(16).padStart(64,'0');
    if(tx.from!==owner||tx.to!==token||tx.chainId!=='0xb626'||tx.type!=='0x2'||tx.value!=='0x0'||tx.data!==data||new Set([owner,token,recipient]).size!==3)refuse('invalid_transaction_review','The wallet transaction differs from the reviewed test transfer.');
    for(const k of ['nonce','gas','maxFeePerGas','maxPriorityFeePerGas'])if(!/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(tx[k]))refuse('invalid_transaction_review','The transaction costs or nonce could not be confirmed.');
    if(BigInt(tx.nonce)>(1n<<64n)-2n||BigInt(tx.gas)<21000n||BigInt(tx.gas)>500000n||BigInt(tx.maxFeePerGas)===0n||BigInt(tx.maxFeePerGas)>1000000000n||BigInt(tx.maxPriorityFeePerGas)>BigInt(tx.maxFeePerGas))refuse('invalid_transaction_review','The test-transfer cost cap is unsupported.');
    const item=current,version=generation,fresh=()=>{checkpoint(item,version);if(expiry<=now())refuse('expired','This test-transfer review expired. Read saved status before continuing.');};
    checkAccount(await request(item,version,'eth_accounts'),owner);checkChain(await request(item,version,'eth_chainId'));fresh();
    // The caller must have durably reserved this exact nonce before this explicit user action.
    let result;try{result=await item.provider.request({method:'eth_sendTransaction',params:[Object.freeze(tx)]});}catch{refuse('transaction_outcome_uncertain','Wallet outcome uncertain. Read saved status; do not send another transfer.');}
    if(typeof result!=='string'||!/^0x[a-f0-9]{64}$/.test(result)||/^0x0{64}$/.test(result))refuse('transaction_outcome_uncertain','Wallet outcome uncertain. Read saved status; do not send another transfer.');
    let walletContextChanged=false;try{fresh();}catch{walletContextChanged=true;}
    return Object.freeze({transactionHash:result,walletContextChanged});
  }
  const checkpointAuthority = () => Object.fromEntries(CHECKPOINT_AUTHORITY_FIELDS.map(key => [key, false]));
  function checkpointDenied(code, review = null) {
    const error = new WalletProviderError(code, 'This wallet send was not invoked by this attempt. Read the saved checkpoint; do not automatically retry.');
    Object.assign(error, {outcome: 'not-invoked', sendInvoked: false, retryAllowed: false,
      nonceReleaseAllowed: false, absenceOfBroadcastEstablished: false, ...checkpointAuthority(),
      ...(review ? {challengeId: review.id, recordId: review.recordId, intentDigest: review.intentDigest} : {})});
    throw error;
  }
  function checkpointClock() {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0) checkpointDenied('invalid_checkpoint_clock');
    return value;
  }
  async function sendCheckpoint(input, purpose) {
    let review, item, version, expiry, lastTime;
    try {
      // Inspect descriptors before reading input, then capture the entire review before any await.
      if (!input || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) checkpointDenied('invalid_checkpoint_review');
      const fields = Object.getOwnPropertyDescriptors(input);
      if (Reflect.ownKeys(fields).length !== 2 || ['challenge', 'expected'].some(key =>
        !fields[key]?.enumerable || !Object.hasOwn(fields[key], 'value'))) checkpointDenied('invalid_checkpoint_review');
      lastTime = checkpointClock();
      review = validateCheckpointWalletReview(fields.challenge.value, fields.expected.value, {now: lastTime});
      if (review.purpose !== purpose) checkpointDenied('invalid_checkpoint_purpose', review);
      if (checkpointAttempts.has(review.id) || checkpointRecords.has(review.recordId)) checkpointDenied('checkpoint_already_attempted', review);
      if (checkpointAttempts.size >= 128) checkpointDenied('checkpoint_attempt_limit', review);
      // An attempt remains consumed after a local stop, expiry, 4001 or unknown outcome.
      checkpointAttempts.add(review.id); checkpointRecords.add(review.recordId);
      const owner = expected(review.expectedOwner, review.chainId);
      if (!binding || binding.owner !== owner || binding.chainId !== 46630) checkpointDenied('connection_required', review);
      item = current; version = generation; expiry = Date.parse(review.expiresAt);
      const fresh = () => {
        checkpoint(item, version);
        const time = checkpointClock();
        // now() is a callback too. No provider getter or callback follows this final state check.
        selectionCheckpoint(item, version);
        if (time < lastTime) checkpointDenied('checkpoint_clock_changed', review);
        lastTime = time;
        if (expiry <= time) checkpointDenied('expired', review);
      };
      checkAccount(await request(item, version, 'eth_accounts'), owner); fresh();
      checkChain(await request(item, version, 'eth_chainId')); fresh();
      const send = item.provider.request;
      if (typeof send !== 'function') checkpointDenied('unsupported_provider', review);
      // No deferred Promise/microtask between this final check and the one provider invocation.
      fresh();
      const call = Object.freeze({method: 'eth_sendTransaction', params: Object.freeze([review.transaction])});
      let result, reportedRejection = false, failed = false;
      try { result = await Reflect.apply(send, item.provider, [call]); }
      catch (error) {
        failed = true;
        // Do not evaluate provider getters, nested errors, messages or signatures.
        try { reportedRejection = Object.getOwnPropertyDescriptor(error, 'code')?.value === 4001; } catch { /* Unknown outcome. */ }
      }
      let walletContextChanged = false, reviewExpired = null, clockChanged = false;
      try { checkpoint(item, version); } catch { walletContextChanged = true; }
      try { const time = checkpointClock(); reviewExpired = time >= expiry; clockChanged = time < lastTime; }
      catch { clockChanged = true; }
      try { selectionCheckpoint(item, version); } catch { walletContextChanged = true; }
      const validHash = !failed && typeof result === 'string' && /^0x[\da-f]{64}$/i.test(result) && !/^0x0{64}$/i.test(result);
      // A valid late hash belongs to the original record even after selection, expiry or disconnect.
      return Object.freeze({purpose, challengeId: review.id, recordId: review.recordId, intentDigest: review.intentDigest,
        reviewDigest: review.reviewDigest, outcome: validHash ? 'hash-returned' : reportedRejection ? 'provider-reported-rejection' : 'unknown',
        transactionHash: validHash ? result.toLowerCase() : null, sendInvoked: true, walletContextChanged, reviewExpired,
        clockChanged, contextChanged: walletContextChanged || reviewExpired !== false || clockChanged,
        retryAllowed: false, nonceReleaseAllowed: false, absenceOfBroadcastEstablished: false, ...checkpointAuthority()});
    } catch (error) {
      // Only the block before provider invocation throws; provider outcomes above are returned explicitly.
      const ownCode = error instanceof WalletProviderError || error instanceof CheckpointReviewError
        ? Object.getOwnPropertyDescriptor(error, 'code')?.value : null;
      checkpointDenied(typeof ownCode === 'string' ? ownCode : 'invalid_checkpoint_review', review);
    }
  }
  const sendReviewedCheckpointCreation = input => sendCheckpoint(input, CHECKPOINT_CREATE_PURPOSE);
  const sendReviewedCheckpointCommit = input => sendCheckpoint(input, CHECKPOINT_COMMIT_PURPOSE);
  function close() { if (closed) return; detach(); windowObject.removeEventListener('eip6963:announceProvider', announcement); invalidate('closed'); current = null; providers.clear(); closed = true; }
  return Object.freeze({ discover, list, select, selected, connect, connectOwner, signOperationHash, sendReviewedTestnetTransfer,
    sendReviewedCheckpointCreation, sendReviewedCheckpointCommit, close });
}
