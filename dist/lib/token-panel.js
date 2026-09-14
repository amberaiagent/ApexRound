// The displayed contract always follows the authoritative live state, including retirement.
export function mountTokenPanel({document, window, navigator}) {
  const address = document.querySelector('#access-contract');
  if (!address) return;
  const copy = document.querySelector('#copy-contract');
  const explorer = document.querySelector('#contract-explorer');
  const status = document.querySelector('#copy-status');
  let currentAddress = null;
  function render(snapshot) {
    const token = snapshot?.ready ? snapshot.state?.token : null;
    const valid = token?.chainId === 4663 && /^0x[0-9a-f]{40}$/i.test(token.address) && !/^0x0{40}$/i.test(token.address);
    const nextAddress = valid ? token.address.toLowerCase() : null;
    if (currentAddress !== nextAddress && status) status.textContent = '';
    currentAddress = nextAddress;
    address.textContent = currentAddress || (snapshot?.ready ? 'New contract to be announced' : snapshot?.error || snapshot?.state ? 'Contract updates unavailable' : 'Checking contract status…');
    if (copy) { copy.disabled = !currentAddress; copy.hidden = !currentAddress; }
    if (explorer) {
      explorer.hidden = !currentAddress;
      if (currentAddress) explorer.href = 'https://robinhoodchain.blockscout.com/token/' + currentAddress;
      else explorer.removeAttribute('href');
    }
  }
  copy?.addEventListener('click', async () => {
    const selected = currentAddress;
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected);
      if (currentAddress === selected && status) status.textContent = 'Contract address copied.';
    } catch {
      if (currentAddress === selected && status) status.textContent = 'Select and copy the address above.';
    }
  });
  window.addEventListener('arena:state', event => render(event.detail));
  render(null);
  window.dispatchEvent(new CustomEvent('arena:state-request'));
}
