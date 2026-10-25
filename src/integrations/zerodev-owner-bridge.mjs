import { createHash } from 'node:crypto';
import { validateGoalTransferIntent, encodeGoalTransferKernelCallData } from '../domain/goal-transfer.mjs';

// Inactive wiring candidate. Production must supply pinned official exports and a
// trusted runtime resolver backed by accepted server evidence, never request JSON.
export const ZERO_DEV_OWNER_BRIDGE_VERSIONS = Object.freeze({ sdk: '5.5.11', ecdsaValidator: '5.4.9', viem: '2.57.11', kernel: '0.3.1', entryPoint: '0.7' });
const ENTRY_POINT = '0x0000000071727de22e5e9d8baf0edac6f37da032';
const VALIDATOR = '0x845adb2c711129d4f3966735ed98a9f09fc4ce57';
const GAS = ['callGasLimit', 'verificationGasLimit', 'preVerificationGas', 'paymasterVerificationGasLimit', 'paymasterPostOpGasLimit'];
const NUMBERS = ['nonce', ...GAS, 'maxFeePerGas', 'maxPriorityFeePerGas'];
const OP_FIELDS = ['sender', 'nonce', 'callData', ...GAS, 'maxFeePerGas', 'maxPriorityFeePerGas', 'paymaster', 'paymasterData'];
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : plain(value) ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export class ZeroDevOwnerBridgeError extends Error {
  constructor(code) { super(`ZeroDev owner bridge stopped: ${code}.`); this.name = 'ZeroDevOwnerBridgeError'; this.code = code; }
}
const fail = code => { throw new ZeroDevOwnerBridgeError(code); };
function exact(value, fields) {
  if (!plain(value)) fail('invalid_input');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== fields.length || fields.some(key => !own(descriptors, key) || !descriptors[key].enumerable || !own(descriptors[key], 'value'))) fail('invalid_input');
}
function address(value) { if (typeof value !== 'string' || !/^0x[0-9a-f]{40}$/.test(value) || /^0x0{40}$/.test(value)) fail('invalid_runtime'); return value; }
function hash(value) { if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value)) fail('invalid_hash'); return value; }
function hex(value) { if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) fail('invalid_operation'); return value.toLowerCase(); }
function integer(value, maximum = (1n << 128n) - 1n, zero = false) {
  const decimal = typeof value === 'bigint' ? value.toString() : value;
  if (typeof decimal !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(decimal)) fail('invalid_limits');
  const result = BigInt(decimal); if (result > maximum || (!zero && result === 0n)) fail('invalid_limits'); return result;
}
const inertOperation = operation => Object.fromEntries(OP_FIELDS.map(key => [key, typeof operation[key] === 'bigint' ? operation[key].toString() : operation[key]]));
const rpcOperation = operation => Object.fromEntries(Object.entries(operation).map(([key, value]) => [key, typeof value === 'bigint' ? `0x${value.toString(16)}` : value]));

/**
 * sdk: official SDK createKernelAccount/createKernelAccountClient/
 * createZeroDevPaymasterClient and official ECDSA signerToEcdsaValidator.
 * primitives: official viem createPublicClient/custom, accounts.toAccount,
 * account-abstraction.getUserOperationHash, and recoverMessageAddress.
 * No constructor is invoked by this factory. The default runtime resolver denies.
 * resolveAcceptedRuntime reads only previously accepted trusted server state; it
 * must not perform unbudgeted provider I/O or accept a runtime record from JSON.
 */
export function createZeroDevOwnerBridge({ sdk, primitives, resolveAcceptedRuntime = async () => null, requestRpc = async () => fail('provider_unavailable'), reserveSubmission = async () => false, now = () => new Date() } = {}) {
  const sdkNames = ['createKernelAccount', 'createKernelAccountClient', 'createZeroDevPaymasterClient', 'signerToEcdsaValidator'];
  const primitiveNames = ['createPublicClient', 'custom', 'toAccount', 'getUserOperationHash', 'recoverMessageAddress'];
  exact(sdk, sdkNames); exact(primitives, primitiveNames);
  if ([...sdkNames.map(key => sdk[key]), ...primitiveNames.map(key => primitives[key]), resolveAcceptedRuntime, requestRpc, reserveSubmission, now].some(value => typeof value !== 'function')) fail('invalid_dependencies');
  const api = Object.freeze({ ...sdk }), tools = Object.freeze({ ...primitives }), attempts = new Set(), entries = new Map();
  const time = () => { const date = now(); if (!(date instanceof Date) || !Number.isFinite(date.getTime())) fail('invalid_clock'); return date.getTime(); };
  function runtime(value, intent) {
    if (value === null || value === undefined) fail('runtime_not_accepted');
    exact(value, ['contextId', 'intentDigest', 'chainId', 'account', 'owner', 'paymaster', 'expiresAt', 'deployment', 'ownerValidation', 'tokenVerification', 'sponsorshipEvidence', 'limits']);
    exact(value.sponsorshipEvidence, ['id', 'digest', 'coverage', 'expiresAt']);
    exact(value.limits, [...GAS, 'maxFeePerGas', 'maxPriorityFeePerGas', 'maxTotalCostWei']);
    if (typeof value.contextId !== 'string' || !/^[A-Za-z0-9_.:-]{1,100}$/.test(value.contextId) || value.intentDigest !== intent.intentDigest || value.chainId !== 46630 || value.account !== intent.account || value.deployment !== 'existing-account-and-token-source-verified' || value.ownerValidation !== 'ecdsa-root-no-hook-verified' || value.tokenVerification !== 'test-token-recipient-and-balance-verified') fail('runtime_not_accepted');
    address(value.owner); address(value.account); address(value.paymaster);
    const grant = value.sponsorshipEvidence;
    if (typeof grant.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,100}$/.test(grant.id) || !/^[a-f0-9]{64}$/.test(grant.digest) || grant.coverage !== 'accepted-no-card-all-gas-premium-usage-zero-paid-fallback') fail('sponsorship_not_accepted');
    for (const expiry of [value.expiresAt, grant.expiresAt]) if (typeof expiry !== 'string' || !Number.isFinite(Date.parse(expiry)) || Date.parse(expiry) <= time() || Date.parse(expiry) > Date.parse(intent.expiresAt)) fail('runtime_expired');
    for (const key of GAS) integer(value.limits[key], 1000000n);
    const maxFee = integer(value.limits.maxFeePerGas, 1000000000n), priority = integer(value.limits.maxPriorityFeePerGas, maxFee, true);
    const costCap = integer(value.limits.maxTotalCostWei, 1000000000000000n);
    if (priority > maxFee || GAS.reduce((sum, key) => sum + BigInt(value.limits[key]), 0n) * maxFee > costCap) fail('invalid_limits');
    return freeze(structuredClone(value));
  }
  async function accepted(intent, phase, prior = null) {
    if (time() < Date.parse(intent.createdAt) || time() >= Date.parse(intent.expiresAt)) fail('intent_expired');
    const result = runtime(await resolveAcceptedRuntime(intent, { phase }), intent);
    if (prior && canonical(result) !== canonical(prior)) fail('runtime_changed');
    return result;
  }
  function checkedOperation(input, intent, context) {
    exact(input, OP_FIELDS);
    const operation = { ...input, sender: address(input.sender), paymaster: address(input.paymaster), callData: hex(input.callData), paymasterData: hex(input.paymasterData) };
    for (const key of NUMBERS) operation[key] = integer(input[key], key === 'nonce' || key === 'preVerificationGas' ? (1n << 256n) - 1n : (1n << 128n) - 1n, key === 'nonce' || key === 'maxPriorityFeePerGas');
    if (operation.sender !== intent.account || operation.callData !== encodeGoalTransferKernelCallData(intent) || operation.paymaster !== context.paymaster || operation.paymasterData === '0x' || operation.maxPriorityFeePerGas > operation.maxFeePerGas) fail('operation_mismatch');
    for (const key of [...GAS, 'maxFeePerGas', 'maxPriorityFeePerGas']) if (operation[key] > BigInt(context.limits[key])) fail('cost_cap');
    const maximumCost = GAS.reduce((sum, key) => sum + operation[key], 0n) * operation.maxFeePerGas;
    if (maximumCost > BigInt(context.limits.maxTotalCostWei)) fail('cost_cap');
    return { operation: freeze(operation), maximumCost };
  }
  function session(intent, context) {
    const counts = {}, start = performance.now(); let phase = 'prepare', estimate = null, signed = null;
    const ceilings = { 'execution:eth_chainId': 1, 'execution:eth_getCode': 1, 'execution:eth_call': 1, 'bundler:zd_getUserOperationGasPrice': 1, 'bundler:eth_estimateUserOperationGas': 1, 'paymaster:zd_sponsorUserOperation': 2 };
    const nonceKey = `0000${VALIDATOR.slice(2)}0000`;
    const nonceData = `0x35567e1a${intent.account.slice(2).padStart(64, '0')}${nonceKey.padStart(64, '0')}`;
    async function request(role, request) {
      const { method, params = [] } = request, key = `${role}:${method}`;
      if (phase === 'sign') fail('provider_request_during_sign');
      const maximum = phase === 'send' && key === 'bundler:eth_sendUserOperation' ? 1 : phase === 'prepare' ? ceilings[key] : 0;
      const remaining = phase === 'prepare' ? 30000 - (performance.now() - start) : 5000;
      if (!maximum || (counts[`${phase}:${key}`] ?? 0) >= maximum || remaining <= 0) fail('read_budget');
      if (role === 'execution' && method === 'eth_getCode' && (params[0]?.toLowerCase() !== intent.account || params[1] !== 'latest')) fail('unexpected_rpc');
      if (role === 'execution' && method === 'eth_call' && (params[0]?.to?.toLowerCase() !== ENTRY_POINT || params[0]?.data?.toLowerCase() !== nonceData || params[1] !== 'latest')) fail('unexpected_rpc');
      if (method === 'eth_chainId' || method === 'zd_getUserOperationGasPrice') { if (params.length) fail('unexpected_rpc'); }
      if (method === 'zd_sponsorUserOperation') {
        const body = params[0];
        if (params.length !== 1 || body?.chainId !== 46630 || body?.entryPointAddress?.toLowerCase() !== ENTRY_POINT || body?.shouldConsume !== false || body?.shouldOverrideFee !== false || body?.gasTokenData !== undefined || body?.userOp?.sender?.toLowerCase() !== intent.account || body?.userOp?.callData?.toLowerCase() !== encodeGoalTransferKernelCallData(intent) || ['factory', 'factoryData', 'initCode', 'authorization', 'eip7702Auth'].some(key => own(body.userOp, key))) fail('unexpected_rpc');
      }
      if (method === 'eth_estimateUserOperationGas' && (!estimate || canonical(params) !== canonical([rpcOperation(estimate), ENTRY_POINT]))) fail('unexpected_rpc');
      if (method === 'eth_sendUserOperation' && (!signed || canonical(params) !== canonical([rpcOperation(signed), ENTRY_POINT]))) fail('unexpected_rpc');
      counts[`${phase}:${key}`] = (counts[`${phase}:${key}`] ?? 0) + 1;
      const controller = new AbortController(); let timer;
      try {
        const result = await Promise.race([requestRpc(role, { method, params }, { signal: controller.signal, maxResponseBytes: 131072 }), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new ZeroDevOwnerBridgeError('provider_timeout')); }, Math.min(5000, remaining)); })]);
        if (Buffer.byteLength(JSON.stringify(result) ?? '') > 131072) fail('response_too_large');
        if (method === 'eth_chainId' && (typeof result !== 'string' || !/^0x[0-9a-fA-F]+$/.test(result) || BigInt(result) !== 46630n)) fail('wrong_chain');
        return result;
      } catch (error) { if (error instanceof ZeroDevOwnerBridgeError) throw error; fail('provider_rejected'); }
      finally { clearTimeout(timer); }
    }
    return { counts, transport: role => tools.custom({ request: args => request(role, args) }, { retryCount: 0 }), phase: value => { phase = value; }, estimate: value => { estimate = value; }, signed: value => { signed = value; } };
  }
  function known(reviewDigest) { const entry = entries.get(reviewDigest); if (!entry) fail('unknown_review'); return entry; }
  return Object.freeze({
    async prepare(value) {
      const intent = validateGoalTransferIntent(value);
      if (attempts.has(intent.intentDigest) || attempts.size >= 16) fail('prepare_already_attempted');
      attempts.add(intent.intentDigest);
      const context = await accepted(intent, 'prepare'), io = session(intent, context);
      const chain = { id: 46630, name: 'Robinhood Testnet', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [] } }, testnet: true };
      let permit = null;
      const owner = tools.toAccount({ address: context.owner, signTransaction: async () => fail('signing_disabled'), signTypedData: async () => fail('signing_disabled'), signMessage: async ({ message }) => {
        if (!permit || permit.used || message?.raw?.toLowerCase() !== permit.hash) fail('signing_disabled');
        permit.used = true;
        const raw = hex(await permit.wallet.signMessage({ account: context.owner, message: { raw: permit.hash } }));
        if (raw.length !== 132 || (await tools.recoverMessageAddress({ message: { raw: permit.hash }, signature: raw })).toLowerCase() !== context.owner) fail('wrong_wallet_signature');
        permit.raw = raw; return raw;
      } });
      const client = tools.createPublicClient({ chain, transport: io.transport('execution') });
      const validator = await api.signerToEcdsaValidator(client, { signer: owner, entryPoint: { address: ENTRY_POINT, version: '0.7' }, kernelVersion: '0.3.1' });
      if (validator.address?.toLowerCase() !== VALIDATOR) fail('validator_mismatch');
      const account = await api.createKernelAccount(client, { address: intent.account, plugins: { sudo: validator }, entryPoint: { address: ENTRY_POINT, version: '0.7' }, kernelVersion: '0.3.1', initConfig: [] });
      if (account.address?.toLowerCase() !== intent.account || await account.isDeployed() !== true) fail('account_not_deployed');
      const nonce = await account.getNonce();
      if ((integer(nonce, (1n << 256n) - 1n, true) >> 64n) !== BigInt(`0x0000${VALIDATOR.slice(2)}0000`)) fail('nonce_key_mismatch');
      const bundler = api.createKernelAccountClient({ chain, client, bundlerTransport: io.transport('bundler') });
      const paymaster = api.createZeroDevPaymasterClient({ chain, transport: io.transport('paymaster') });
      const fees = await bundler.getUserOperationGasPrice();
      if (integer(fees.maxFeePerGas) > BigInt(context.limits.maxFeePerGas) || integer(fees.maxPriorityFeePerGas, (1n << 128n) - 1n, true) > BigInt(context.limits.maxPriorityFeePerGas) || fees.maxPriorityFeePerGas > fees.maxFeePerGas) fail('cost_cap');
      const candidate = { sender: intent.account, nonce: integer(nonce, (1n << 256n) - 1n, true), callData: encodeGoalTransferKernelCallData(intent), callGasLimit: BigInt(context.limits.callGasLimit), verificationGasLimit: BigInt(context.limits.verificationGasLimit), preVerificationGas: BigInt(context.limits.preVerificationGas), maxFeePerGas: integer(fees.maxFeePerGas), maxPriorityFeePerGas: integer(fees.maxPriorityFeePerGas, (1n << 128n) - 1n, true) };
      const stub = hex(await account.getStubSignature(candidate));
      const quote = async operation => {
        const response = await paymaster.sponsorUserOperation({ userOperation: { ...operation, signature: stub, chainId: 46630, entryPointAddress: ENTRY_POINT }, shouldConsume: false, shouldOverrideFee: false });
        if (response.maxFeePerGas !== undefined && response.maxFeePerGas !== candidate.maxFeePerGas || response.maxPriorityFeePerGas !== undefined && response.maxPriorityFeePerGas !== candidate.maxPriorityFeePerGas) fail('fee_override');
        const fields = Object.fromEntries([...GAS, 'paymaster', 'paymasterData'].map(key => [key, response[key]]));
        return checkedOperation({ ...candidate, ...fields }, intent, context);
      };
      const first = await quote(candidate);
      io.estimate({ ...first.operation, signature: stub });
      const estimation = await bundler.estimateUserOperationGas({ ...first.operation, signature: stub, entryPointAddress: ENTRY_POINT });
      for (const key of GAS) integer(estimation[key], BigInt(context.limits[key]));
      const final = await quote({ ...first.operation, ...Object.fromEntries(GAS.map(key => [key, estimation[key]])) });
      for (const key of GAS) if (final.operation[key] < estimation[key]) fail('insufficient_quoted_gas');
      await accepted(intent, 'prepared-review', context);
      const userOperationHash = hash(tools.getUserOperationHash({ userOperation: { ...final.operation, signature: '0x' }, entryPointAddress: ENTRY_POINT, entryPointVersion: '0.7', chainId: 46630 }));
      const body = { format: 'angbao-zerodev-owner-operation-review@1', status: 'unsigned-owner-review-required', intent, intentDigest: intent.intentDigest, owner: context.owner, chainId: 46630, kernelVersion: '0.3.1', entryPoint: { address: ENTRY_POINT, version: '0.7' }, userOperation: inertOperation(final.operation), userOperationHash, nonce: final.operation.nonce.toString(), maximumGasCostWei: final.maximumCost.toString(), runtimeContextDigest: digest(context), sponsorshipEvidence: context.sponsorshipEvidence, expiresAt: context.expiresAt, authority: 'none', ownerApprovalObtained: false, signingAllowed: false, deploymentAllowed: false, submissionAllowed: false, financialSuccessEstablished: false, requests: { ...io.counts }, limitations: ['Requires an accepted trusted runtime and zero-cost sponsor evidence; supplied JSON cannot provide either.', 'Quote usability and free coverage require provider/account-specific acceptance. This module does not establish them.', 'Successful preparation, signature or submission is not inclusion or token-transfer success.'] };
      const prepared = freeze({ ...body, ownerReviewDigest: digest({ domain: 'angbao.zerodev-owner-review.v1', review: body }) });
      entries.set(prepared.ownerReviewDigest, { intent, context, io, account, bundler, operation: final.operation, prepared, status: 'prepared', permit: value => { permit = value; } });
      return prepared;
    },
    async requestWalletSignature(ownerReviewDigest, wallet) {
      const entry = known(ownerReviewDigest); if (entry.status !== 'prepared') fail('signature_already_attempted');
      entry.status = 'signature-attempted';
      await accepted(entry.intent, 'wallet-signature', entry.context);
      if (!wallet || typeof wallet.getChainId !== 'function' || typeof wallet.signMessage !== 'function' || wallet.account?.address?.toLowerCase() !== entry.context.owner || await wallet.getChainId() !== 46630) fail('wrong_wallet');
      const permit = { wallet, hash: entry.prepared.userOperationHash, used: false, raw: null };
      entry.io.phase('sign'); entry.permit(permit);
      try {
        const signature = hex(await entry.account.signUserOperation({ ...entry.operation, chainId: 46630 }));
        // Pinned v0.7 sudo manager returns ECDSA signature unchanged (no regular plugin).
        if (!permit.used || !permit.raw || signature !== permit.raw) fail('unexpected_signature_composition');
        entry.signature = signature; entry.status = 'signed';
        return freeze({ status: 'signed-not-submitted', ownerReviewDigest, userOperationHash: entry.prepared.userOperationHash, ownerSignatureVerified: true, submissionAllowed: false, financialSuccessEstablished: false });
      } catch (error) { if (error instanceof ZeroDevOwnerBridgeError) throw error; fail('wallet_signature_rejected'); }
      finally { entry.permit(null); }
    },
    async submitSigned(ownerReviewDigest) {
      const entry = known(ownerReviewDigest); if (entry.status !== 'signed') fail('signed_operation_required');
      entry.status = 'submission-attempted';
      try {
        await accepted(entry.intent, 'submission', entry.context);
        // Complete unsigned payload is persisted before the first network attempt.
        // Its twelve v0.7 fields become thirteen only when signature is added on wire.
        // The wallet signature must never enter durable records, exports or replay logs.
        if (await reserveSubmission(freeze({ ownerReviewDigest, intentDigest: entry.intent.intentDigest, userOperationHash: entry.prepared.userOperationHash, entryPoint: ENTRY_POINT, userOperation: entry.prepared.userOperation })) !== true) fail('durable_reservation_required');
        entry.status = 'reserved-not-broadcast';
        // Persistence can cross expiry or a server-runtime revision. A reservation
        // never licenses a stale send, and its record remains for receipt-only recovery.
        await accepted(entry.intent, 'broadcast', entry.context);
        entry.io.phase('send');
        entry.io.signed({ ...entry.operation, signature: entry.signature });
        try {
          const result = hash((await entry.bundler.sendUserOperation({ ...entry.operation, signature: entry.signature, entryPointAddress: ENTRY_POINT })).toLowerCase());
          if (result !== entry.prepared.userOperationHash) fail('submission_uncertain');
          entry.status = 'submitted-unconfirmed';
          return freeze({ status: entry.status, ownerReviewDigest, userOperationHash: result, financialSuccessEstablished: false, receiptVerificationRequired: true });
        } catch { entry.status = 'submission-uncertain'; fail('submission_uncertain'); }
      } finally { entry.signature = null; entry.io.signed(null); }
    },
    status(ownerReviewDigest) { const entry = known(ownerReviewDigest); return freeze({ status: entry.status, userOperationHash: entry.prepared.userOperationHash, financialSuccessEstablished: false }); },
  });
}
