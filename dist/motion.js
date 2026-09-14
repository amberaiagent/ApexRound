// Decorative motion is independent of the wallet, token and authoritative timer.
const root = document.documentElement;
const art = document.querySelector('.hero-art');
const sculpture = document.querySelector('.arena-sculpture');
const toggle = document.querySelector('#motion-toggle');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
const animations = new Set();
const seen = new WeakSet();
let manualPause = false, artVisible = false, pointerFrame = 0, bounds;
try { manualPause = localStorage.getItem('arena:motion-paused') === 'true'; } catch { /* Storage is optional. */ }
const paused = () => manualPause || reduced.matches;

function resetTilt() {
  cancelAnimationFrame(pointerFrame); pointerFrame = 0;
  for (const name of ['--tilt-x', '--tilt-y', '--drift-x', '--drift-y']) sculpture?.style.removeProperty(name);
}
function updateMotion() {
  root.classList.toggle('motion-paused', paused());
  art?.classList.toggle('motion-running', !paused() && artVisible && !document.hidden);
  toggle.hidden = false;
  toggle.disabled = reduced.matches;
  toggle.setAttribute('aria-label', reduced.matches ? 'Animations off: reduced motion preference' : manualPause ? 'Resume animations' : 'Pause animations');
  toggle.querySelector('.motion-label').textContent = paused() ? 'Motion off' : 'Motion on';
  if (paused() || document.hidden) {
    resetTilt();
    for (const animation of animations) animation.cancel();
    animations.clear();
  }
}
toggle.addEventListener('click', () => {
  manualPause = !manualPause;
  try { localStorage.setItem('arena:motion-paused', String(manualPause)); } catch { /* Keep the in-page preference. */ }
  updateMotion();
});
reduced.addEventListener('change', updateMotion);
finePointer.addEventListener('change', resetTilt);
document.addEventListener('visibilitychange', updateMotion);

function enter(element, delay = 0) {
  if (seen.has(element)) return;
  seen.add(element);
  if (paused() || document.hidden || typeof element.animate !== 'function') return;
  const animation = element.animate([
    { opacity: 0, transform: 'translate3d(0,22px,0)' },
    { opacity: 1, transform: 'translate3d(0,0,0)' },
  ], { duration: 750, delay, easing: 'cubic-bezier(.18,.7,.2,1)', fill: 'backwards' });
  animations.add(animation);
  animation.finished.then(() => animations.delete(animation), () => animations.delete(animation));
}

if ('IntersectionObserver' in window) {
  const artObserver = new IntersectionObserver(entries => {
    artVisible = entries[0].isIntersecting;
    updateMotion();
  }, { threshold: 0 });
  if (art) artObserver.observe(art);
  const revealObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      enter(entry.target, Number(entry.target.dataset.motionDelay || 0));
      revealObserver.unobserve(entry.target);
    }
  }, { threshold: .12 });
  const targets = document.querySelectorAll('.page-heading, .editorial-intro, .section-heading, .path-card, .access-banner, .guide-chapter, .rule-section, .faq-layout, .contract-panel, .simple-steps article');
  for (const element of targets) {
    if (element.matches('.steps article, .principles > div')) element.dataset.motionDelay = String([...element.parentElement.children].indexOf(element) * 85);
    revealObserver.observe(element);
  }
} else {
  artVisible = true;
}
updateMotion();
if (!location.hash || location.hash === '#') {
  document.querySelectorAll('.hero-copy > *').forEach((element, index) => enter(element, index * 80));
}

art?.addEventListener('pointerenter', () => { bounds = art.getBoundingClientRect(); });
art?.addEventListener('pointermove', event => {
  if (paused() || !finePointer.matches || event.pointerType === 'touch' || document.hidden) return;
  bounds ??= art.getBoundingClientRect();
  const x = Math.max(-.5, Math.min(.5, (event.clientX - bounds.left) / bounds.width - .5));
  const y = Math.max(-.5, Math.min(.5, (event.clientY - bounds.top) / bounds.height - .5));
  cancelAnimationFrame(pointerFrame);
  pointerFrame = requestAnimationFrame(() => {
    pointerFrame = 0;
    sculpture.style.setProperty('--tilt-x', `${-y * 12}deg`);
    sculpture.style.setProperty('--tilt-y', `${x * 16}deg`);
    sculpture.style.setProperty('--drift-x', `${x * 15}px`);
    sculpture.style.setProperty('--drift-y', `${y * 10}px`);
  });
}, { passive: true });
art?.addEventListener('pointerleave', resetTilt);
window.addEventListener('resize', () => { bounds = undefined; resetTilt(); }, { passive: true });
window.addEventListener('scroll', () => { bounds = undefined; }, { passive: true });
