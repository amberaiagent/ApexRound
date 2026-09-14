import { config } from './lib/config.js';

const menu = document.querySelector('#menu-toggle');
const nav = document.querySelector('#main-nav');
function closeMenu() {
  menu?.setAttribute('aria-expanded', 'false');
  menu?.setAttribute('aria-label', 'Open navigation');
  nav?.classList.remove('is-open');
}
menu?.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded', String(open));
  menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  nav?.classList.toggle('is-open', open);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menu?.getAttribute('aria-expanded') === 'true') { closeMenu(); menu.focus(); }
});
document.addEventListener('click', event => {
  if (!event.target.closest('.site-header')) closeMenu();
});
nav?.addEventListener('click', event => { if (event.target.closest('a')) closeMenu(); });
matchMedia('(min-width: 1051px)').addEventListener('change', closeMenu);

const address = document.querySelector('#access-contract');
const copy = document.querySelector('#copy-contract');
const explorer = document.querySelector('#contract-explorer');
if (address) address.textContent = config.tokenAddress || 'Contract not announced';
if (explorer && config.tokenAddress) {
  explorer.href = config.network.blockExplorerUrls[0] + '/token/' + config.tokenAddress;
  explorer.hidden = false;
}
if (copy && config.tokenAddress) {
  copy.disabled = false;
  copy.addEventListener('click', async () => {
    const status = document.querySelector('#copy-status');
    try { await navigator.clipboard.writeText(config.tokenAddress); status.textContent = 'Contract address copied.'; }
    catch { status.textContent = 'Select and copy the address above.'; }
  });
}

// Keep existing bookmarks useful after the move from sections to real pages.
if (document.body.dataset.page === 'home') {
  const oldSections = {'#arena':'/arena/', '#history':'/rounds/', '#how':'/guide/'};
  if (oldSections[location.hash]) location.replace(oldSections[location.hash]);
}

const chapters = [...document.querySelectorAll('.chapter-nav a[href^="#"]')];
if (chapters.length && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting).sort((a,b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (!visible) return;
    for (const link of chapters) {
      if (link.hash === '#' + visible.target.id) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  }, {rootMargin:'-15% 0px -60% 0px'});
  for (const link of chapters) { const section = document.querySelector(link.hash); if (section) observer.observe(section); }
}
