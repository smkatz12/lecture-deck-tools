/* present.js — part of lecture-deck-tools (MIT license)
   https://github.com/smkatz12/lecture-deck-tools

   Present mode for <deck-stage> slide decks exported from Claude Design.
   P (or the button in the top-right corner) enters full screen and hides the
   thumbnail rail and other chrome; P or Esc leaves it. deck-stage already
   knows how to present: it listens for the {__omelette_presenting} message,
   which hides the rail and keeps the slide counter out of the audience's view. */
(() => {
  if (window.__deckPresentLoaded) return; window.__deckPresentLoaded = true;
  let presenting = false;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.title = 'Present (P)';
  btn.setAttribute('aria-label', 'Present');
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg><span>Present</span>';
  btn.style.cssText = [
    'position:fixed', 'top:14px', 'right:14px', 'z-index:2147483600',
    'display:flex', 'align-items:center', 'gap:6px', 'padding:8px 14px 8px 10px',
    'border-radius:999px', 'border:1px solid #333', 'background:rgba(18,18,18,.9)', 'color:#eee',
    `font:14px/1 ${(window.DeckInkConfig || {}).font || "'Gill Sans','Gill Sans MT',Cabin,sans-serif"}`, 'letter-spacing:.12em', 'text-transform:uppercase',
    'cursor:pointer', 'opacity:0', 'transition:opacity .25s', 'touch-action:manipulation', '-webkit-tap-highlight-color:transparent',
  ].join(';');

  let fadeT;
  function peek(ms = 2500) {
    if (presenting) return;
    btn.style.opacity = '1';
    clearTimeout(fadeT);
    fadeT = setTimeout(() => { if (!btn.matches(':hover')) btn.style.opacity = '0'; }, ms);
  }
  btn.addEventListener('mouseleave', () => peek(1200));
  btn.addEventListener('focus', () => peek(6000));
  btn.addEventListener('click', e => { e.stopPropagation(); toggle(); });
  // Mouse near the top edge, or a finger touching the top strip, reveals the button.
  window.addEventListener('mousemove', e => { if (e.clientY < 90) peek(); }, { passive: true });
  window.addEventListener('pointerdown', e => { if (e.pointerType === 'touch' && e.clientY < 90) peek(4000); }, { capture: true, passive: true });

  function tell(on) {
    window.postMessage({ __omelette_presenting: on }, '*');
    document.documentElement.classList.toggle('deck-presenting', on);
    window.dispatchEvent(new CustomEvent('deckpresent', { detail: { on } }));
  }
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  async function enter() {
    presenting = true; btn.style.display = 'none'; tell(true);
    const el = document.documentElement;
    try {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } catch (e) { /* full screen refused (e.g. iPhone): stay in present mode without it */ }
  }
  function exit() {
    presenting = false; btn.style.display = 'flex'; btn.style.opacity = '0'; tell(false);
    if (fsEl()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); }
  }
  function toggle() { presenting ? exit() : enter(); }
  const onFs = () => { if (!fsEl() && presenting) exit(); };
  document.addEventListener('fullscreenchange', onFs);
  document.addEventListener('webkitfullscreenchange', onFs);

  window.addEventListener('keydown', e => {
    const t = e.composedPath ? e.composedPath()[0] : e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'p' || e.key === 'P') { e.preventDefault(); toggle(); }
    else if (e.key === 'Escape' && presenting && !fsEl()) exit();
  }, true);

  const mount = () => { document.body.appendChild(btn); peek(3000); };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
  window.DeckPresent = { enter, exit, toggle, get presenting() { return presenting; } };
})();
