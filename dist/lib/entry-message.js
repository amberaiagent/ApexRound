// Both the browser and server construct this exact, readable EIP-191 message.
// No transfer/approval is requested. It authorizes only one named round entry.
import { CURRENT_ENTRY_VERSION, ENTRY_REQUIREMENTS } from './access-policy.js?v=arena-access-5m-20260914';
export const ENTRY_MESSAGE_VERSION = CURRENT_ENTRY_VERSION;

export function entryRequiredTokens(entry) {
  const version = entry.messageVersion === undefined ? 1 : entry.messageVersion;
  if (!Number.isInteger(version) || !Object.hasOwn(ENTRY_REQUIREMENTS, version)) {
    throw new Error('Unsupported registration message version. Refresh the arena and try again.');
  }
  return ENTRY_REQUIREMENTS[version];
}

export function entryMessage(entry) {
  // Older, unexpired challenges have no version in their persisted JSON payload.
  // Versions 1 and 2 retain their exact 10M text; new version 3 entries require 5M.
  const version = entry.messageVersion === undefined ? 1 : entry.messageVersion;
  const required = entryRequiredTokens(entry);
  const brand = version === 1 ? 'APEX' : 'ARENA';
  return [
    brand + ' round registration',
    'Website: ' + entry.origin,
    'Wallet: ' + entry.address,
    'Network: Robinhood Chain (' + entry.chainId + ')',
    'Round: #' + entry.roundId,
    'Trading starts: ' + new Date(entry.startsAt).toISOString(),
    'Trading ends: ' + new Date(entry.endsAt).toISOString(),
    'Access token: ' + entry.tokenAddress,
    'Required balance: ' + required + ' ' + brand + ' tokens',
    'Register this wallet for this round only. This does not authorize a payment, token approval or transfer.',
    'Nonce: ' + entry.nonce,
    'Issued at: ' + new Date(entry.issuedAt).toISOString(),
    'Expires at: ' + new Date(entry.expiresAt).toISOString(),
  ].join('\n');
}
