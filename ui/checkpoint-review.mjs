/** Browser-only envelope checks. These checks do not establish server or wallet authority. */
import {getContractAddress} from '../src/vendor/kernel-identity-codecs.mjs';

export const CHECKPOINT_CREATE_PURPOSE = 'angbao-commitment-create';
export const CHECKPOINT_COMMIT_PURPOSE = 'angbao-decision-checkpoint-commit';
export const CHECKPOINT_AUTHORITY_FIELDS = Object.freeze([
  'ownerApprovalEstablished', 'signingAllowed', 'deploymentAllowed', 'submissionAllowed', 'financialAuthority',
]);
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
// Public constants only. Tests bind every byte/hash/selector to the committed compiled artifact.
export const CHECKPOINT_WALLET_BUILD = freeze({
  buildReference: {
    sourceSha256: '20af25cd73f46f497bbc398dd75664b1e0ff050ef6a7f4a0c9c68532c2b013b0',
    buildDigest: '680511489b111e193bc1463111ee611dc08a09ff30a93633a27cb851e08f6415',
    runtimeSha256: 'd494186e8cfe35cbe7d8c1cbcc5ff815944517ae9cd300eb5a648c91ee5f586f',
  },
  creationSha256: '4027b07c4a3fc57d6a578ea22ea39759a6b9eb146dd1f148f216111f5c19e76f',
  creationBytecode: '0x6080604052348015600e575f5ffd5b506101e08061001c5f395ff3fe608060405260043610610028575f3560e01c80638b1592b51461002c578063e3ce094d14610071575b5f5ffd5b348015610037575f5ffd5b5061005f610046366004610155565b5f60208181529281526040808220909352908152205481565b60405190815260200160405180910390f35b61008461007f36600461018a565b610086565b005b34156100a55760405163e320176b60e01b815260040160405180910390fd5b8115806100b0575080155b156100cd5760405162b4a20960e31b815260040160405180910390fd5b335f9081526020818152604080832085845290915290205415610103576040516317fd8aab60e31b815260040160405180910390fd5b335f8181526020818152604080832086845282529182902084905590518381528492917fd4cebf902bc5a93f89fc70c15dca1327ca93c452fecfcdf8756a39ffbb61c04e910160405180910390a35050565b5f5f60408385031215610166575f5ffd5b82356001600160a01b038116811461017c575f5ffd5b946020939093013593505050565b5f5f6040838503121561019b575f5ffd5b5050803592602090910135915056fea26469706673582212204faa8bae8c12c46e0b0ba7ee7019a39bf812543c824866ad5dfc2ea7ac7ced8f64736f6c634300081e0033',
  commitSelector: '0xe3ce094d',
});
export class CheckpointReviewError extends Error {
  constructor(code = 'invalid_checkpoint_review') {
    super('This checkpoint review cannot be used. Read the saved operation before continuing.');
    this.name = 'CheckpointReviewError'; this.code = code;
  }
}
const fail = code => { throw new CheckpointReviewError(code); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function bounded(value) {
  let nodes = 0; const seen = new Set();
  function visit(item, depth) {
    if (++nodes > 2048 || depth > 8) fail();
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') { if (item.length > 16384) fail(); return; }
    if (typeof item === 'number') { if (!Number.isSafeInteger(item)) fail(); return; }
    if (!plain(item) || seen.has(item)) fail();
    seen.add(item);
    for (const key of Reflect.ownKeys(item)) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)
        || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail();
      visit(descriptor.value, depth + 1);
    }
    seen.delete(item);
  }
  visit(value, 0);
  if (new TextEncoder().encode(JSON.stringify(value)).length > 32768) fail();
}
function exact(value, keys) {
  if (!plain(value)) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length || keys.some(key =>
    !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], 'value'))) fail();
}
const uuid = value => { if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)) fail(); };
const digest = value => { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail(); };
const address = value => { if (typeof value !== 'string' || !/^0x[a-f0-9]{40}$/.test(value) || /^0x0{40}$/.test(value)) fail(); };
const bytes32 = value => { if (typeof value !== 'string' || !/^0x[a-f0-9]{64}$/.test(value) || /^0x0{64}$/.test(value)) fail(); };
function integer(value, maximum, zero = false) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,77})$/.test(value)) fail();
  const result = BigInt(value); if (result > maximum || !zero && result === 0n) fail(); return result;
}
function timestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail();
  return Date.parse(value);
}
const hex = number => '0x' + number.toString(16);
function intrinsic(data, creation) {
  const bytes = data.slice(2).match(/../g) ?? [];
  return 21000n + (creation ? 32000n + 2n * BigInt(Math.ceil(bytes.length / 32)) : 0n)
    + bytes.reduce((sum, byte) => sum + (byte === '00' ? 4n : 16n), 0n);
}

/** expected is a separately pinned public UI context, never derived from an untrusted challenge. */
export function validateCheckpointWalletReview(challenge, expected, options = {now: Date.now()}) {
  try {
    bounded(challenge); bounded(expected); bounded(options); exact(options, ['now']);
    if (!Number.isSafeInteger(options.now) || options.now < 0) fail();
    exact(challenge, ['format', 'id', 'purpose', 'recordId', 'intentDigest', 'reviewDigest', 'expectedOwner',
      'chainId', 'transaction', 'expiresAt', 'phase', 'retryAllowed', ...CHECKPOINT_AUTHORITY_FIELDS]);
    exact(expected, ['purpose', 'recordId', 'intentDigest', 'reviewDigest', 'expectedOwner', 'chainId', 'contract',
      'buildReference', 'payer', 'costs', 'anchor', 'observedAt', 'expiresAt']);
    const creation = expected.purpose === CHECKPOINT_CREATE_PURPOSE;
    if (!creation && expected.purpose !== CHECKPOINT_COMMIT_PURPOSE) fail();
    uuid(challenge.id); uuid(expected.recordId); digest(expected.intentDigest); digest(expected.reviewDigest);
    address(expected.expectedOwner); address(expected.contract);
    if (expected.expectedOwner === expected.contract || expected.chainId !== 46630
      || challenge.format !== 'angbao-checkpoint-wallet-challenge@1' || challenge.phase !== 'review-transaction'
      || challenge.retryAllowed !== false || CHECKPOINT_AUTHORITY_FIELDS.some(key => challenge[key] !== false)
      || ['purpose', 'recordId', 'intentDigest', 'reviewDigest', 'expectedOwner', 'chainId', 'expiresAt']
        .some(key => challenge[key] !== expected[key])) fail();
    const observed = timestamp(expected.observedAt), expiry = timestamp(expected.expiresAt);
    if (expiry <= observed || expiry - observed > 60000 || observed > options.now || expiry <= options.now) fail('expired');
    exact(expected.buildReference, ['sourceSha256', 'buildDigest', 'runtimeSha256']);
    if (Object.keys(CHECKPOINT_WALLET_BUILD.buildReference).some(key =>
      expected.buildReference[key] !== CHECKPOINT_WALLET_BUILD.buildReference[key])) fail();
    exact(expected.payer, ['nonce', 'gasLimit', 'maxFeePerGas', 'maxPriorityFeePerGas']);
    const nonce = integer(expected.payer.nonce, (1n << 64n) - 2n, true);
    const gas = integer(expected.payer.gasLimit, 500000n), fee = integer(expected.payer.maxFeePerGas, 1000000000n);
    const priority = integer(expected.payer.maxPriorityFeePerGas, fee, true);
    let data;
    if (creation) {
      if (expected.anchor !== null || getContractAddress({from: expected.expectedOwner, nonce}).toLowerCase() !== expected.contract) fail();
      data = CHECKPOINT_WALLET_BUILD.creationBytecode;
    } else {
      exact(expected.anchor, ['operationRef', 'commitment']);
      bytes32(expected.anchor.operationRef); bytes32(expected.anchor.commitment);
      data = CHECKPOINT_WALLET_BUILD.commitSelector + expected.anchor.operationRef.slice(2) + expected.anchor.commitment.slice(2);
    }
    exact(expected.costs, ['minimumIntrinsicGas', 'maximumGasFeeWei', 'nativeValueWei']);
    const minimum = intrinsic(data, creation);
    if (gas < minimum || expected.costs.minimumIntrinsicGas !== minimum.toString()
      || expected.costs.maximumGasFeeWei !== (gas * fee).toString() || expected.costs.nativeValueWei !== '0') fail();
    const envelope = {from: expected.expectedOwner, ...(creation ? {} : {to: expected.contract}), chainId: '0xb626',
      type: '0x2', nonce: hex(nonce), value: '0x0', gas: hex(gas), maxFeePerGas: hex(fee),
      maxPriorityFeePerGas: hex(priority), data};
    exact(challenge.transaction, Object.keys(envelope));
    if (Object.keys(envelope).some(key => challenge.transaction[key] !== envelope[key])) fail();
    return freeze(structuredClone(challenge));
  } catch (error) {
    if (error instanceof CheckpointReviewError) throw new CheckpointReviewError(error.code);
    fail();
  }
}
