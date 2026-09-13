// Both the browser and server construct this exact, readable EIP-191 message.
// No transfer/approval is requested. It authorizes only one named round entry.
export const ENTRY_MESSAGE_VERSION = 2;

export function entryMessage(entry) {
  // Older, unexpired challenges have no version in their persisted JSON payload.
  // Keep their signed bytes intact while issuing ARENA text for all new entries.
  const version = entry.messageVersion === undefined ? 1 : entry.messageVersion;
  if (version !== 1 && version !== ENTRY_MESSAGE_VERSION) throw new Error('Unsupported registration message version. Refresh the arena and try again.');
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
    'Required balance: 10000000 ' + brand + ' tokens',
    'Register this wallet for this round only. This does not authorize a payment, token approval or transfer.',
    'Nonce: ' + entry.nonce,
    'Issued at: ' + new Date(entry.issuedAt).toISOString(),
    'Expires at: ' + new Date(entry.expiresAt).toISOString(),
  ].join('\n');
}
