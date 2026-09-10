// Both the browser and server construct this exact, readable EIP-191 message.
// No transfer/approval is requested. It authorizes only one named round entry.
export function entryMessage(entry) {
  return [
    'APEX round registration',
    'Website: ' + entry.origin,
    'Wallet: ' + entry.address,
    'Network: Robinhood Chain (' + entry.chainId + ')',
    'Round: #' + entry.roundId,
    'Trading starts: ' + new Date(entry.startsAt).toISOString(),
    'Trading ends: ' + new Date(entry.endsAt).toISOString(),
    'Access token: ' + entry.tokenAddress,
    'Required balance: 10000000 APEX tokens',
    'Register this wallet for this round only. This does not authorize a payment, token approval or transfer.',
    'Nonce: ' + entry.nonce,
    'Issued at: ' + new Date(entry.issuedAt).toISOString(),
    'Expires at: ' + new Date(entry.expiresAt).toISOString(),
  ].join('\n');
}
