import { randomBytes } from 'node:crypto';
import { verifyMessage } from 'ethers';
import { scheduleAt } from '../dist/lib/schedule.js';
import { entryMessage, entryRequiredTokens, ENTRY_MESSAGE_VERSION } from '../dist/lib/entry-message.js';
import { REQUIRED_ACCESS_TOKENS } from '../dist/lib/access-policy.js';
import { normalizeAddress, uint256 } from '../scripts/lib/token-inspection.mjs';

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new ApiError(status, message); };
export function addressOf(value) {
  try { return normalizeAddress(value); } catch { fail(400, 'Invalid wallet address.'); }
}

export async function readEligibility(token, address, rpc, now = Date.now, requiredTokens = REQUIRED_ACCESS_TOKENS) {
  const chain = await rpc('eth_chainId');
  if (BigInt(chain) !== BigInt(token.chainId)) fail(503, 'Token verification network is unavailable.');
  const block = await rpc('eth_getBlockByNumber', ['latest', false]);
  if (!block || !/^0x[0-9a-f]+$/i.test(block.number) || !/^0x[0-9a-f]{64}$/i.test(block.hash) || !/^0x[0-9a-f]+$/i.test(block.timestamp)) {
    fail(503, 'Unable to verify the latest block.');
  }
  const age = now() - Number(BigInt(block.timestamp)) * 1000;
  if (age < -120000 || age > 300000) fail(503, 'The token balance source is not up to date.');
  const [code, decimals, raw] = await Promise.all([
    rpc('eth_getCode', [token.address, block.number]),
    rpc('eth_call', [{ to: token.address, data: '0x313ce567' }, block.number]),
    rpc('eth_call', [{ to: token.address, data: '0x70a08231' + address.slice(2).padStart(64, '0') }, block.number]),
  ]);
  if (!/^0x[0-9a-f]+$/i.test(code) || /^0x0*$/i.test(code) || uint256(decimals, 'decimals') !== BigInt(token.decimals)) fail(503, 'Token details could not be verified.');
  const balance = uint256(raw, 'balance'), required = requiredTokens * 10n ** BigInt(token.decimals);
  if (balance < required) fail(403, 'Insufficient balance. Hold at least ' + requiredTokens.toLocaleString('en-US') + ' $ARENA to register.');
  const again = await rpc('eth_getBlockByNumber', [block.number, false]);
  if (again?.hash?.toLowerCase() !== block.hash.toLowerCase()) fail(503, 'Chain state changed. Please try again.');
  return { balance: balance.toString(), block: block.number, blockHash: block.hash };
}

export class ArenaService {
  constructor(store, { rpc, now = Date.now, eligibility } = {}) {
    this.store = store;
    this.now = now;
    this.eligibility = eligibility ?? ((token, address, entry) => readEligibility(token, address, rpc, now, entryRequiredTokens(entry)));
  }
  state(address = null) {
    return this.store.snapshot(() => {
      const launch = this.store.launch(), serverNow = this.now();
      const schedule = scheduleAt(launch?.activatedAt ?? null, serverNow);
      return {
        serverNow, activatedAt: launch?.activatedAt ?? null, token: launch?.token ?? null, ...schedule,
        participants: schedule.current ? this.store.count(schedule.current.id) : 0,
        nextParticipants: schedule.next ? this.store.count(schedule.next.id) : 0,
        myCurrentEntry: address && schedule.current ? this.store.entry(schedule.current.id, address) : null,
        myNextEntry: address && schedule.next ? this.store.entry(schedule.next.id, address) : null,
        resultsStatus: 'not-connected', pool: null,
      };
    });
  }
  assertOpen(roundId) {
    const state = this.state();
    if (!state.token || !state.registration?.open || state.registration.roundId !== roundId) fail(409, 'Registration is closed for this round.');
    return state;
  }
  challenge({ address: input, roundId }, origin) {
    const address = addressOf(input);
    if (!Number.isSafeInteger(roundId) || roundId < 1) fail(400, 'Invalid round.');
    return this.store.transaction(() => {
      const state = this.assertOpen(roundId);
      if (this.store.entry(roundId, address)) fail(409, 'This wallet is already registered for this round.');
      const entry = {
        messageVersion: ENTRY_MESSAGE_VERSION,
        nonce: randomBytes(24).toString('hex'), address, roundId, origin,
        chainId: state.token.chainId, tokenAddress: state.token.address,
        startsAt: state.next.start, endsAt: state.next.end,
        issuedAt: state.serverNow, expiresAt: Math.min(state.serverNow + 300000, state.registration.closesAt),
      };
      this.store.saveChallenge(entry);
      return { ...entry, message: entryMessage(entry) };
    });
  }
  async register({ nonce, signature }, origin) {
    if (typeof nonce !== 'string' || !/^[0-9a-f]{48}$/.test(nonce) || typeof signature !== 'string' || !/^0x(?:[0-9a-f]{128}|[0-9a-f]{130})$/i.test(signature)) fail(400, 'Invalid signed registration.');
    const entry = this.store.challenge(nonce);
    if (!entry || entry.used || entry.expiresAt <= this.now() || entry.origin !== origin) fail(409, 'This registration request expired or was already used. Please try again.');
    const state = this.assertOpen(entry.roundId);
    const matchesLaunch = current => current.token.address === entry.tokenAddress
      && current.token.chainId === entry.chainId && current.activatedAt === state.activatedAt
      && current.next.start === entry.startsAt && current.next.end === entry.endsAt;
    if (!matchesLaunch(state)) fail(409, 'Access token changed. Request a new entry.');
    const message = entryMessage(entry);
    let signer;
    try { signer = verifyMessage(message, signature).toLowerCase(); } catch { fail(401, 'The wallet signature is invalid.'); }
    if (signer !== entry.address) fail(401, 'The signature belongs to a different wallet.');
    if (this.store.entry(entry.roundId, entry.address)) fail(409, 'This wallet is already registered for this round.');
    const balance = await this.eligibility(state.token, entry.address, entry);
    return this.store.transaction(() => {
      // Recheck the authoritative window AFTER the signature and RPC calls.
      if (!matchesLaunch(this.assertOpen(entry.roundId))) fail(409, 'Access token changed. Request a new entry.');
      const current = this.store.challenge(nonce), acceptedAt = this.now();
      if (!current || current.used || current.expiresAt <= acceptedAt) fail(409, 'The entry window or registration request has expired.');
      if (entryMessage(current) !== message) fail(409, 'The registration request changed. Request a new entry.');
      if (this.store.entry(entry.roundId, entry.address)) fail(409, 'This wallet is already registered for this round.');
      this.store.db.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?)').run(entry.roundId, entry.address, acceptedAt, balance.balance, balance.block, balance.blockHash, message, signature);
      this.store.db.prepare('UPDATE challenges SET used=1 WHERE nonce=?').run(nonce);
      return this.store.entry(entry.roundId, entry.address);
    });
  }
}
