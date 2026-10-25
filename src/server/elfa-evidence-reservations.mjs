/** Persistent single-host Node budget ledger. Not a Vercel filesystem adapter. */
import { DatabaseSync } from 'node:sqlite';
import { openSync, closeSync, constants, mkdirSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ElfaReservationError } from './elfa-evidence-errors.mjs';
export { ElfaReservationError } from './elfa-evidence-errors.mjs';

if (typeof window !== 'undefined') throw new Error('Elfa reservations are server-only.');
const hash = value => createHash('sha256').update(value).digest('hex');
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,199}$/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000000;
const fail = code => { throw new ElfaReservationError(code); };
const limitsValid = value => value && Object.keys(value).sort().join(',') === 'globalCredits,globalRequests,ownerCredits,ownerRequests' && ['globalRequests', 'ownerRequests'].every(key => integer(value[key]) && value[key] > 0) && (value.globalCredits === null && value.ownerCredits === null || [value.globalCredits, value.ownerCredits].every(integer));

/** Contract: reserve atomically charges both aggregate and owner caps before I/O.
 * Holds never expire/refund automatically. A reserved row after crash is uncertain.
 * operationId uniqueness crosses windows: recovery cannot silently fetch again.
 * No queries, credentials, evidence bodies or caller tokens enter this ledger.
 */
export function createSqliteElfaReservationRepository({ directory, maxReservations = 10000, readOnly = false } = {}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || path.resolve(directory) !== directory || !Number.isInteger(maxReservations) || maxReservations < 1 || maxReservations > 100000 || typeof readOnly!=='boolean') fail('configuration');
  let db,fileIdentity;
  try {
    if(!readOnly)mkdirSync(directory, { recursive: true, mode: 0o700 });
    const parent = lstatSync(directory);
    if (!parent.isDirectory() || parent.isSymbolicLink() || realpathSync(directory) !== directory || (parent.mode & 0o077) || typeof process.getuid === 'function' && parent.uid !== process.getuid()) fail('configuration');
    const file = path.join(directory, 'elfa-evidence-reservations.sqlite');
    const handle = openSync(file, (readOnly?constants.O_RDONLY:constants.O_CREAT | constants.O_RDWR) | constants.O_NOFOLLOW, 0o600);
    try {
      const stat = lstatSync(file);
      fileIdentity=stat;
      if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) || typeof process.getuid === 'function' && stat.uid !== process.getuid()) fail('configuration');
    } finally { closeSync(handle); }
    db = new DatabaseSync(file,{readOnly});
    if(!readOnly)db.exec(`PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS elfa_budget_windows (
        key_slot TEXT NOT NULL, window_id TEXT NOT NULL, binding_digest TEXT NOT NULL,
        PRIMARY KEY(key_slot,window_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS elfa_evidence_reservations (
        reservation_id TEXT PRIMARY KEY, key_slot TEXT NOT NULL, window_id TEXT NOT NULL,
        owner_digest TEXT NOT NULL, operation_id TEXT NOT NULL, request_digest TEXT NOT NULL,
        credits INTEGER NOT NULL CHECK(credits >= 0), state TEXT NOT NULL CHECK(state IN ('reserved','completed','uncertain','not-dispatched')),
        created_at TEXT NOT NULL, settled_at TEXT,
        UNIQUE(key_slot,owner_digest,operation_id),
        FOREIGN KEY(key_slot,window_id) REFERENCES elfa_budget_windows(key_slot,window_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS elfa_reservations_window ON elfa_evidence_reservations(key_slot,window_id,owner_digest);`);
  } catch (error) { try { db?.close(); } catch {} if (error instanceof ElfaReservationError) throw error; fail('storage'); }
  let closed = false;
  const transaction = work => {
    if (closed||readOnly) fail('storage');
    try { db.exec('BEGIN IMMEDIATE'); const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { try { db.exec('ROLLBACK'); } catch {} if (error instanceof ElfaReservationError) throw error; fail('storage'); }
  };
  const view = row => ({ reservationId: row.reservation_id, state: row.state, operationId: row.operation_id, windowId: row.window_id, reservedRequestUnits: 1, reservedCreditUnits: row.credits });
  return Object.freeze({
    inspect({keySlot,ownerId,operationId}={}){
      if(closed||![keySlot,ownerId,operationId].every(id))fail('invalid_input');
      try{
        const parent=lstatSync(directory),file=path.join(directory,'elfa-evidence-reservations.sqlite'),stat=lstatSync(file);
        if(!parent.isDirectory()||parent.isSymbolicLink()||realpathSync(directory)!==directory||(parent.mode&0o077)||!stat.isFile()||stat.isSymbolicLink()||stat.dev!==fileIdentity.dev||stat.ino!==fileIdentity.ino||stat.nlink!==1||(stat.mode&0o077)||typeof process.getuid==='function'&&(parent.uid!==process.getuid()||stat.uid!==process.getuid()))fail('storage');
        const row=db.prepare('SELECT * FROM elfa_evidence_reservations WHERE key_slot=? AND owner_digest=? AND operation_id=?').get(keySlot,hash(`angbao.elfa-owner.v1:${ownerId}`),operationId);
        return row?{...view(row),requestDigest:row.request_digest,conservativeHold:true}:null;
      }catch(error){if(error instanceof ElfaReservationError)throw error;fail('storage');}
    },
    async reserve(input) {
      if (!input || ![input.keySlot, input.windowId, input.ownerId, input.operationId].every(id) || !digest(input.requestDigest) || !digest(input.budgetBindingDigest) || !limitsValid(input.limits) || !integer(input.creditUnits) || typeof input.now !== 'string' || !Number.isFinite(Date.parse(input.now))) fail('invalid_input');
      if (input.limits.globalCredits === null && input.creditUnits !== 0) fail('invalid_input');
      const ownerDigest = hash(`angbao.elfa-owner.v1:${input.ownerId}`);
      return transaction(() => {
        const existing = db.prepare('SELECT * FROM elfa_evidence_reservations WHERE key_slot=? AND owner_digest=? AND operation_id=?').get(input.keySlot, ownerDigest, input.operationId);
        if (existing) { if (existing.request_digest !== input.requestDigest) fail('operation_conflict'); return { fresh: false, ...view(existing) }; }
        const binding = hash(JSON.stringify({ limits: input.limits, creditUnits: input.creditUnits, policy: input.budgetBindingDigest }));
        const window = db.prepare('SELECT binding_digest FROM elfa_budget_windows WHERE key_slot=? AND window_id=?').get(input.keySlot, input.windowId);
        if (window && window.binding_digest !== binding) fail('window_conflict');
        const total = db.prepare('SELECT count(*) AS count FROM elfa_evidence_reservations').get().count;
        if (total >= maxReservations) fail('capacity');
        const global = db.prepare('SELECT count(*) AS requests,coalesce(sum(credits),0) AS credits FROM elfa_evidence_reservations WHERE key_slot=? AND window_id=?').get(input.keySlot, input.windowId);
        const owner = db.prepare('SELECT count(*) AS requests,coalesce(sum(credits),0) AS credits FROM elfa_evidence_reservations WHERE key_slot=? AND window_id=? AND owner_digest=?').get(input.keySlot, input.windowId, ownerDigest);
        if (global.requests + 1 > input.limits.globalRequests || owner.requests + 1 > input.limits.ownerRequests || input.limits.globalCredits !== null && (global.credits + input.creditUnits > input.limits.globalCredits || owner.credits + input.creditUnits > input.limits.ownerCredits)) fail('budget_exhausted');
        if (!window) db.prepare('INSERT INTO elfa_budget_windows VALUES(?,?,?)').run(input.keySlot, input.windowId, binding);
        const reservationId = randomUUID();
        db.prepare('INSERT INTO elfa_evidence_reservations VALUES(?,?,?,?,?,?,?,?,?,NULL)').run(reservationId, input.keySlot, input.windowId, ownerDigest, input.operationId, input.requestDigest, input.creditUnits, 'reserved', input.now);
        return { fresh: true, reservationId, state: 'reserved', operationId: input.operationId, windowId: input.windowId, reservedRequestUnits: 1, reservedCreditUnits: input.creditUnits };
      });
    },
    async settle({ keySlot, ownerId, operationId, requestDigest, reservationId, state, now } = {}) {
      if (![keySlot, ownerId, operationId, reservationId].every(id) || !digest(requestDigest) || !['completed', 'uncertain', 'not-dispatched'].includes(state) || typeof now !== 'string' || !Number.isFinite(Date.parse(now))) fail('invalid_input');
      return transaction(() => {
        const row = db.prepare('SELECT * FROM elfa_evidence_reservations WHERE key_slot=? AND owner_digest=? AND operation_id=? AND reservation_id=?').get(keySlot, hash(`angbao.elfa-owner.v1:${ownerId}`), operationId, reservationId);
        if (!row || row.request_digest !== requestDigest) fail('operation_conflict');
        if (row.state !== 'reserved' && row.state !== state) fail('settlement_conflict');
        if (row.state === 'reserved') db.prepare('UPDATE elfa_evidence_reservations SET state=?,settled_at=? WHERE reservation_id=?').run(state, now, reservationId);
        return { ...view({ ...row, state }), conservativeHold: true };
      });
    },
    close() { if (!closed) { closed = true; db.close(); } },
  });
}
