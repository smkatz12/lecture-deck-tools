/* deck-ink.js — part of lecture-deck-tools (MIT license)
   https://github.com/smkatz12/lecture-deck-tools

   Apple Pencil / mouse ink, laser pointer and Pencil/tap navigation for
   <deck-stage> slide decks exported from Claude Design.
   Ink is vector data in 1920x1080 slide coordinates, keyed by 1-based slide number.

   Optional settings, set before this script loads:
     <meta name="deck-id" content="my-course-lecture01">   one per deck; keeps each deck's ink separate
     <script>window.DeckInkConfig = { colors: ['#fff', '#ffd166'], font: 'Avenir, sans-serif' };</script> */
(() => {
  if (window.__deckInkLoaded) return; window.__deckInkLoaded = true;
  const OPT = window.DeckInkConfig || {};
  const DECK_ID = document.querySelector('meta[name="deck-id"]')?.content
    || ('deck:' + location.pathname.replace(/\/(index\.html?)?$/i, '') || 'deck');
  const VERSION = 1, W = 1920, H = 1080, NS = 'http://www.w3.org/2000/svg';
  const LS = 'deck-ink:' + DECK_ID, LS_CFG = 'deck-ink-cfg', LS_HIDE = 'deck-ink-hidden:' + DECK_ID;
  const COLORS = Array.isArray(OPT.colors) && OPT.colors.length ? OPT.colors : ['#ffffff', '#c3b8ff', '#80b9ff', '#ffa4e7', '#f5d58a'];
  const UI_FONT = OPT.font || "'Gill Sans','Gill Sans MT',Cabin,sans-serif";
  const INTERACTIVE = 'a, button, input, select, textarea, label, video[controls], [role="button"], [data-goto], [contenteditable]:not([contenteditable="false"])';

  // Contacts wider than this (CSS px) are treated as a resting hand. iPad fingertips report roughly 40-55 px.
  const PALM_PX = 90;
  // Add ?inkdebug to the address to see what the iPad reports for each touch (for troubleshooting).
  const DEBUG = /[?&#]inkdebug/.test(location.href);
  let dbgBox = null;
  function dbg(msg) {
    if (!DEBUG) return;
    if (!dbgBox) {
      dbgBox = document.createElement('div');
      dbgBox.style.cssText = 'position:fixed;top:8px;left:8px;z-index:2147483647;max-width:46vw;padding:8px 10px;border-radius:8px;background:rgba(0,0,0,.8);color:#9f9;font:12px/1.35 ui-monospace,Menlo,monospace;pointer-events:none;white-space:pre-wrap';
      document.body.appendChild(dbgBox);
    }
    const lines = (dbgBox.textContent ? dbgBox.textContent.split('\n') : []).concat(`${(performance.now() / 1000).toFixed(2)}  ${msg}`);
    dbgBox.textContent = lines.slice(-14).join('\n');
  }
  const st = {
    stage: null, secs: [], idx: 0,
    tool: 'pen', color: COLORS[0], drawMode: false, hidden: localStorage.getItem(LS_HIDE) === '1',
    published: emptyDoc(), work: emptyDoc(), dirty: false,
    undo: {}, live: null, penDown: 0, penUpAt: 0, touch: null, suppressClick: 0,
  };
  function emptyDoc() { return { format: 'deck-ink', version: VERSION, deck: DECK_ID, slides: {} }; }
  const clone = o => JSON.parse(JSON.stringify(o));
  const cfg = () => { try { return JSON.parse(localStorage.getItem(LS_CFG)) || {}; } catch (e) { return {}; } };
  const canPublish = () => { const c = cfg(); return !!(c.token && c.repo); };

  /* ---------- storage ---------- */
  function saveLocal() {
    try { localStorage.setItem(LS, JSON.stringify({ dirty: st.dirty, doc: st.work })); } catch (e) { toast('Could not autosave ink (storage full?)', true); }
    updateDot();
  }
  function loadLocal() {
    try { const v = JSON.parse(localStorage.getItem(LS)); if (v && v.doc && v.doc.deck === DECK_ID) return v; } catch (e) {}
    return null;
  }
  const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
  function norm(d) { const o = {}; Object.keys(d.slides || {}).sort((a, b) => a - b).forEach(k => { if (d.slides[k].strokes.length) o[k] = d.slides[k].strokes; }); return o; }
  function validDoc(d) { return d && d.format === 'deck-ink' && d.slides && typeof d.slides === 'object'; }

  async function boot() {
    const local = loadLocal();
    try {
      const r = await fetch('ink.json?t=' + Date.now(), { cache: 'no-store' });
      if (r.ok) { const d = await r.json(); if (validDoc(d)) st.published = d; }
    } catch (e) {}
    if (local && local.dirty) { st.work = local.doc; st.dirty = !same(local.doc, st.published); }
    else { st.work = clone(st.published); st.dirty = false; }
    renderAll(); updateDot();
  }

  /* ---------- geometry + rendering ---------- */
  const slideKey = i => String(i + 1);
  const strokesOf = i => (st.work.slides[slideKey(i)] || { strokes: [] }).strokes;
  function setStrokes(i, arr) {
    const k = slideKey(i);
    if (arr.length) st.work.slides[k] = { label: st.secs[i]?.dataset.label || '', strokes: arr };
    else delete st.work.slides[k];
  }
  function layer(i) {
    const sec = st.secs[i]; if (!sec) return null;
    let g = sec.querySelector(':scope > svg[data-ink-layer]');
    if (!g) {
      g = document.createElementNS(NS, 'svg');
      g.setAttribute('data-ink-layer', ''); g.setAttribute('viewBox', `0 0 ${W} ${H}`);
      g.setAttribute('style', 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:60;overflow:visible');
      sec.appendChild(g);
    }
    g.style.display = st.hidden ? 'none' : '';
    return g;
  }
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const f = n => Math.round(n * 10) / 10;
  function smoothLine(P) {
    if (P.length < 3) return P.map((p, i) => (i ? 'L' : 'M') + f(p[0]) + ' ' + f(p[1])).join(' ');
    let d = `M${f(P[0][0])} ${f(P[0][1])}`;
    for (let i = 1; i < P.length - 1; i++) { const m = mid(P[i], P[i + 1]); d += ` Q${f(P[i][0])} ${f(P[i][1])} ${f(m[0])} ${f(m[1])}`; }
    const l = P[P.length - 1]; return d + ` L${f(l[0])} ${f(l[1])}`;
  }
  function outline(s) {
    const P = s.p, n = P.length, base = s.w;
    const wd = i => base * (0.3 + 0.9 * Math.min(1, P[i][2] ?? 0.5));
    if (n === 1 || (n === 2 && Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]) < 1)) {
      const r = wd(0) / 2; return `M${f(P[0][0] - r)} ${f(P[0][1])} a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0 a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
    }
    const L = [], R = [];
    for (let i = 0; i < n; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1]; const len = Math.hypot(tx, ty) || 1; tx /= len; ty /= len;
      const h = wd(i) / 2; L.push([P[i][0] - ty * h, P[i][1] + tx * h]); R.push([P[i][0] + ty * h, P[i][1] - tx * h]);
    }
    const rl = wd(n - 1) / 2, r0 = wd(0) / 2, RR = R.reverse();
    let d = smoothLine(L);
    d += ` A${f(rl)} ${f(rl)} 0 0 1 ${f(RR[0][0])} ${f(RR[0][1])}`;
    d += ' ' + smoothLine(RR).replace(/^M/, 'L');
    d += ` A${f(r0)} ${f(r0)} 0 0 1 ${f(L[0][0])} ${f(L[0][1])}Z`;
    return d;
  }
  function strokeEl(s) {
    const e = document.createElementNS(NS, 'path');
    if (s.t === 'hl') {
      e.setAttribute('d', smoothLine(s.p)); e.setAttribute('fill', 'none'); e.setAttribute('stroke', s.c);
      e.setAttribute('stroke-width', s.w); e.setAttribute('stroke-linecap', 'round'); e.setAttribute('stroke-linejoin', 'round');
      e.setAttribute('stroke-opacity', '0.38');
    } else { e.setAttribute('d', outline(s)); e.setAttribute('fill', s.c); }
    return e;
  }
  function render(i) {
    const g = layer(i); if (!g) return;
    g.textContent = '';
    strokesOf(i).forEach(s => g.appendChild(strokeEl(s)));
  }
  function renderAll() { st.secs.forEach((_, i) => render(i)); }
  function toSlide(e, sec) {
    const r = sec.getBoundingClientRect();
    return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height];
  }

  /* ---------- editing ---------- */
  function pushUndo(i) { (st.undo[i] = st.undo[i] || []).push(clone(strokesOf(i))); if (st.undo[i].length > 80) st.undo[i].shift(); }
  function commit() { st.dirty = !same(st.work, st.published); saveLocal(); }
  function undo() { const u = st.undo[st.idx]; if (!u || !u.length) return toast('Nothing to undo'); setStrokes(st.idx, u.pop()); render(st.idx); commit(st.idx); }
  function clearSlide() { if (!strokesOf(st.idx).length) return; pushUndo(st.idx); setStrokes(st.idx, []); render(st.idx); commit(st.idx); }
  function distSeg(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  }
  function eraseAt(p, prev) {
    const arr = strokesOf(st.idx), keep = arr.filter(s => {
      const rad = 16 + s.w / 2;
      for (let k = 0; k < s.p.length; k++) {
        const a = s.p[k], b = s.p[k + 1] || a;
        if (distSeg(p, a, b) < rad || (prev && distSeg(a, prev, p) < rad)) return false;
      }
      return true;
    });
    if (keep.length !== arr.length) { if (!st.live.erased) { pushUndo(st.idx); st.live.erased = true; } setStrokes(st.idx, keep); render(st.idx); }
  }

  /* ---------- input ---------- */
  const inUI = e => e.composedPath().some(n => n === ui.root);
  // Taps on the deck's own chrome (thumbnail rail, slide-count overlay, menus) belong to that chrome:
  // never draw there, never treat them as slide taps, never swallow their clicks.
  const CHROME = ['rail', 'rail-resize', 'thumb', 'overlay', 'ctxmenu', 'confirm-backdrop'];
  const inChrome = e => e.composedPath().some(n => n.classList && CHROME.some(c => n.classList.contains(c)));
  const onStage = e => st.stage && e.composedPath().includes(st.stage) && !inChrome(e);
  const interactive = e => e.composedPath().some(n => n.matches && n.matches(INTERACTIVE));
  const curSec = () => st.secs[st.idx];

  /* ---------- laser pointer (never saved) ---------- */
  const laser = { cv: null, ctx: null, pts: [], raf: 0, until: 0, dot: null };
  function laserSetup() {
    if (laser.cv) return;
    const cv = document.createElement('canvas');
    cv.setAttribute('data-ink-laser', '');
    cv.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;z-index:2147483500';
    document.body.appendChild(cv); laser.cv = cv; laser.ctx = cv.getContext('2d');
    // Size the canvas to exactly the visible viewport in CSS pixels, so canvas and pointer coordinates
    // match 1:1. (100vh on iPad Safari is taller than the visible area and would stretch the drawing.)
    const size = () => {
      const r = devicePixelRatio || 1, w = window.innerWidth, h = window.innerHeight;
      cv.style.width = w + 'px'; cv.style.height = h + 'px';
      cv.width = Math.round(w * r); cv.height = Math.round(h * r); laser.ctx.setTransform(r, 0, 0, r, 0, 0);
    };
    size(); addEventListener('resize', size);
    if (window.visualViewport) visualViewport.addEventListener('resize', size);
    document.addEventListener('fullscreenchange', () => setTimeout(size, 50));
  }
  // Add a point; the dot lingers ~linger ms after the last point, the trail fades over 280 ms.
  function laserAt(x, y, linger = 450) {
    laserSetup();
    const t = performance.now();
    laser.pts.push([x, y, t]); laser.until = t + linger;
    if (!laser.raf) laser.raf = requestAnimationFrame(laserFrame);
  }
  function laserFrame(now) {
    const c = laser.ctx, TRAIL = 280;
    c.clearRect(0, 0, innerWidth, innerHeight);
    laser.pts = laser.pts.filter(p => now - p[2] < TRAIL);
    const P = laser.pts;
    for (let i = 1; i < P.length; i++) {
      const a = 1 - (now - P[i][2]) / TRAIL;
      c.strokeStyle = `rgba(255,59,48,${(a * 0.55).toFixed(3)})`; c.lineWidth = 3 + 5 * a; c.lineCap = 'round';
      c.beginPath(); c.moveTo(P[i - 1][0], P[i - 1][1]); c.lineTo(P[i][0], P[i][1]); c.stroke();
    }
    if (now < laser.until && laser.last) {
      const fade = Math.min(1, (laser.until - now) / 150), [x, y] = laser.last;
      const g = c.createRadialGradient(x, y, 0, x, y, 22);
      g.addColorStop(0, `rgba(255,255,255,${fade})`); g.addColorStop(0.18, `rgba(255,80,70,${fade})`);
      g.addColorStop(0.45, `rgba(255,40,30,${0.45 * fade})`); g.addColorStop(1, 'rgba(255,40,30,0)');
      c.fillStyle = g; c.beginPath(); c.arc(x, y, 22, 0, 7); c.fill();
    }
    if (now < laser.until || laser.pts.length) laser.raf = requestAnimationFrame(laserFrame);
    else { laser.raf = 0; c.clearRect(0, 0, innerWidth, innerHeight); }
  }
  function laserPoint(e, linger) { laser.last = [e.clientX, e.clientY]; laserAt(e.clientX, e.clientY, linger); }

  function startStroke(e) {
    const sec = curSec(); if (!sec) return;
    if (st.hidden && st.tool !== 'laser') { st.hidden = false; localStorage.setItem(LS_HIDE, '0'); renderAll(); syncUI(); }
    e.preventDefault(); e.stopPropagation();
    try { e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId); } catch (_) {}
    const p = toSlide(e, sec), pr = e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5;
    st.live = { id: e.pointerId, sec, last: p };
    if (st.tool === 'laser') { Object.assign(st.live, { laser: true, t0: performance.now(), x0: e.clientX, y0: e.clientY, far: 0 }); laserPoint(e, 100000); return; }
    if (st.tool === 'eraser') { eraseAt(p); return; }
    const s = st.tool === 'hl' ? { t: 'hl', c: st.color, w: 30, p: [[f(p[0]), f(p[1]), 0.5]] } : { t: 'pen', c: st.color, w: 7, p: [[f(p[0]), f(p[1]), +pr.toFixed(2)]] };
    st.live.s = s; st.live.el = strokeEl(s); layer(st.idx).appendChild(st.live.el);
  }
  function moveStroke(e) {
    const L = st.live; if (!L || e.pointerId !== L.id) return;
    e.preventDefault();
    if (L.laser) {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of (evs.length ? evs : [e])) { laserPoint(ev, 100000); L.far = Math.max(L.far, Math.hypot(ev.clientX - L.x0, ev.clientY - L.y0)); }
      return;
    }
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      const p = toSlide(ev, L.sec);
      if (st.tool === 'eraser') { eraseAt(p, L.last); L.last = p; continue; }
      const P = L.s.p, q = P[P.length - 1];
      const sx = q[0] + (p[0] - q[0]) * 0.65, sy = q[1] + (p[1] - q[1]) * 0.65;
      if (Math.hypot(sx - q[0], sy - q[1]) < 1.2) continue;
      const pr = ev.pointerType === 'pen' ? (ev.pressure || q[2]) : 0.5;
      P.push([f(sx), f(sy), +(q[2] * 0.6 + pr * 0.4).toFixed(2)]);
    }
    if (L.s) L.el.setAttribute('d', L.s.t === 'hl' ? smoothLine(L.s.p) : outline(L.s));
  }
  function endStroke(e) {
    const L = st.live; if (!L || e.pointerId !== L.id) return;
    st.live = null;
    if (L.laser) {
      laser.until = performance.now() + 450;
      // A quick, still tap with the laser advances (or, at the far left edge, goes back),
      // so the Pencil alone can drive the talk. Pointing and dragging never navigate.
      const quick = performance.now() - L.t0 < 300 && L.far < 14;
      dbg(`laser up after ${Math.round(performance.now() - L.t0)}ms, moved ${Math.round(L.far)}px: ${quick ? 'tap' : 'pointing'}`);
      if (quick) { laser.until = 0; nav(L.x0 < window.innerWidth * 0.12 ? -1 : 1); }
      return;
    }
    if (st.tool === 'eraser') { if (L.erased) commit(st.idx); return; }
    pushUndo(st.idx); setStrokes(st.idx, strokesOf(st.idx).concat([L.s])); render(st.idx); commit(st.idx);
  }
  function nav(dir) {
    dbg(`navigate ${dir > 0 ? 'forward' : 'back'}`);
    // Dispatch from the body, like a real key press, so window capture listeners (the deck's build
    // engine) run before bubble listeners (deck-stage's slide change), exactly as with a keyboard.
    const key = dir > 0 ? 'ArrowRight' : 'ArrowLeft';
    (document.body || document.documentElement).dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true, composed: true }));
  }

  function onDown(e) {
    if (inUI(e)) return;
    dbg(`${e.pointerType} down  ${Math.round(e.width || 0)}x${Math.round(e.height || 0)}  tool=${st.tool}  onSlide=${onStage(e)}`);
    if (e.pointerType === 'pen') {
      st.penDown++; st.suppressClick = performance.now() + 600; showUI(true);
      if (st.touch) st.touch.sawPen = true;   // palm landed first, then the Pencil: that touch is a palm
      if (onStage(e)) startStroke(e);
      return;
    }
    if (e.pointerType === 'touch') {
      if (st.penDown || performance.now() - st.penUpAt < 400) { e.preventDefault(); e.stopPropagation(); st.suppressClick = performance.now() + 600; return; }
      if (!onStage(e) || interactive(e)) return;
      // A resting hand shows up as a large contact; never treat it as a tap or swipe.
      if (Math.max(e.width || 0, e.height || 0) > PALM_PX) { dbg(`touch down ${Math.round(e.width)}x${Math.round(e.height)}: palm, ignored`); st.suppressClick = performance.now() + 800; return; }
      if (!st.touch) st.touch = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), sawPen: false };
      else { st.touch.multi = true; }   // a second finger/palm while one is down: not a clean tap
      st.suppressClick = performance.now() + 800;
      return;
    }
    if (e.pointerType === 'mouse' && st.drawMode && e.button === 0 && onStage(e)) { st.suppressClick = performance.now() + 600; startStroke(e); }
  }
  function onUp(e) {
    if (e.pointerType === 'pen') { st.penDown = Math.max(0, st.penDown - 1); st.penUpAt = performance.now(); endStroke(e); scheduleHide(); return; }
    if (e.pointerType === 'touch' && st.touch && st.touch.id === e.pointerId) {
      const T = st.touch, dx = e.clientX - T.x, dy = e.clientY - T.y, dt = performance.now() - T.t; st.touch = null;
      if (st.penDown || performance.now() - st.penUpAt < 400) return;
      // Palm rejection: the Pencil was used during this touch, more than one contact was down,
      // or the contact grew large while resting. Real taps/swipes are short and clean.
      const why = T.sawPen ? 'pencil used during touch' : T.multi ? 'several contacts' : Math.max(e.width || 0, e.height || 0) > PALM_PX ? 'palm-sized' : dt > 700 ? 'held too long' : '';
      if (why) { dbg(`touch up after ${Math.round(dt)}ms: ignored (${why})`); return; }
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.3) nav(dx < 0 ? 1 : -1);
      else if (Math.hypot(dx, dy) < 18 && dt < 600) nav(e.clientX < window.innerWidth / 2 ? -1 : 1);
      return;
    }
    if (e.pointerType === 'mouse') endStroke(e);
  }
  function onCancel(e) { if (e.pointerType === 'pen') { st.penDown = Math.max(0, st.penDown - 1); st.penUpAt = performance.now(); endStroke(e); } if (st.touch && st.touch.id === e.pointerId) st.touch = null; }
  function onClick(e) {
    if (inUI(e) || inChrome(e)) return;
    if (performance.now() < st.suppressClick && !(interactive(e) && !st.live)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }
  function onKey(e) {
    const t = e.composedPath ? e.composedPath()[0] : e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && (st.drawMode || ui.shown)) { e.preventDefault(); e.stopImmediatePropagation(); undo(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'd' || e.key === 'D') { e.preventDefault(); e.stopImmediatePropagation(); setDraw(!st.drawMode); return; }
    if (e.key === 'l' || e.key === 'L') {
      e.preventDefault(); e.stopImmediatePropagation();
      if (st.tool === 'laser') { st.tool = st.prevTool || 'pen'; }
      else { st.prevTool = st.tool; st.tool = 'laser'; }
      syncUI(); showUI(true); toast(st.tool === 'laser' ? 'Laser pointer' : 'Pen'); return;
    }
    if (e.key === 'Escape' && (st.drawMode || ui.panelOpen)) { e.preventDefault(); e.stopImmediatePropagation(); if (ui.panelOpen) togglePanel(false); else setDraw(false); }
  }
  function setDraw(on) {
    st.drawMode = on;
    if (st.stage) st.stage.style.cursor = on ? 'crosshair' : '';
    if (on) showUI(false); else scheduleHide();
    syncUI();
  }

  /* ---------- UI ---------- */
  const ui = { root: null, shown: false, panelOpen: false, hideT: 0, btn: {} };
  // Pinned toolbar: always on screen, dimmed when idle. Default on for the presenter (publish set up), off for students.
  const LS_PIN = 'deck-ink-pinned';
  const isPinned = () => { const v = localStorage.getItem(LS_PIN); return v == null ? canPublish() : v === '1'; };
  const presenting = () => document.documentElement.classList.contains('deck-presenting');
  const ic = name => `<span style="font-family:'Material Symbols Outlined';font-size:22px;line-height:1;font-weight:300">${name}</span>`;
  function btnCss(active) { return `display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:12px;border:0;cursor:pointer;color:${active ? '#000' : '#e8e8e8'};background:${active ? '#80b9ff' : 'transparent'};padding:0;position:relative`; }
  function buildUI() {
    const r = document.createElement('div'); ui.root = r;
    r.setAttribute('data-ink-ui', '');
    r.style.cssText = `position:fixed;left:50%;bottom:14px;transform:translate(-50%,140%);opacity:0;transition:transform .28s cubic-bezier(.2,.8,.2,1),opacity .28s;z-index:2147483600;font-family:${UI_FONT};touch-action:manipulation;user-select:none;-webkit-user-select:none`;
    r.innerHTML = `
      <div data-msg style="position:absolute;bottom:64px;left:50%;transform:translateX(-50%);white-space:nowrap;padding:8px 14px;border-radius:10px;background:#161616;border:1px solid #333;color:#fff;font-size:15px;letter-spacing:.04em;opacity:0;transition:opacity .2s;pointer-events:none"></div>
      <div data-panel style="display:none;position:absolute;bottom:64px;left:50%;transform:translateX(-50%);width:380px;padding:18px;border-radius:16px;background:#121212;border:1px solid #333;color:#ddd;font-size:14px;letter-spacing:.03em;box-shadow:0 10px 40px rgba(0,0,0,.6)">
        <div style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:#fff;margin-bottom:12px">Publish settings</div>
        ${['repo|Repository (owner/name)|e.g. your-name/your-slides', 'branch|Branch|main', 'path|Folder path|leave blank: uses this lecture\'s folder', 'token|Personal access token|github_pat_…'].map(x => { const [k, l, ph] = x.split('|'); return `<label style="display:block;margin-bottom:10px;color:#aaa">${l}<input data-cfg="${k}" ${k === 'token' ? 'type="password"' : ''} placeholder="${ph}" autocomplete="off" spellcheck="false" style="display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:8px 10px;border-radius:8px;border:1px solid #3a3a3a;background:#0a0a0a;color:#fff;font:14px/1.3 ui-monospace,Menlo,monospace"></label>`; }).join('')}
        <div style="font-size:12px;color:#888;line-height:1.4;margin:2px 0 12px">Stored on this device only. The token needs <em>Contents: read &amp; write</em> on the repo.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button data-act="cfgsave" style="flex:1;padding:9px;border-radius:9px;border:0;background:#80b9ff;color:#000;font:inherit;cursor:pointer">Save</button>
          <button data-act="cfgforget" style="padding:9px 12px;border-radius:9px;border:1px solid #444;background:none;color:#ddd;font:inherit;cursor:pointer">Forget token</button>
          <button data-act="discard" style="padding:9px 12px;border-radius:9px;border:1px solid #5a2a2a;background:none;color:#fab0ae;font:inherit;cursor:pointer">Discard local ink</button>
        </div>
      </div>
      <div data-bar style="display:flex;align-items:center;gap:2px;padding:5px;border-radius:16px;background:rgba(18,18,18,.94);border:1px solid #2e2e2e;box-shadow:0 8px 30px rgba(0,0,0,.5);backdrop-filter:blur(8px)">
        <button data-tool="pen" title="Pen (Apple Pencil always draws · D toggles mouse drawing)">${ic('stylus')}</button>
        <button data-tool="hl" title="Highlighter">${ic('ink_highlighter')}</button>
        <button data-tool="eraser" title="Stroke eraser">${ic('ink_eraser')}</button>
        <button data-tool="laser" title="Laser pointer (L): follows the Pencil, nothing is saved">${ic('my_location')}</button>
        <div style="width:1px;height:26px;background:#333;margin:0 6px"></div>
        ${COLORS.map(c => `<button data-color="${c}" title="${c}" style="width:34px;height:44px;border:0;background:none;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0"><span style="display:block;width:20px;height:20px;border-radius:50%;background:${c}"></span></button>`).join('')}
        <div style="width:1px;height:26px;background:#333;margin:0 6px"></div>
        <button data-act="undo" title="Undo (⌘Z)">${ic('undo')}</button>
        <button data-act="clear" title="Clear this slide">${ic('delete')}</button>
        <button data-act="hide" title="Show / hide all ink">${ic('visibility')}</button>
        <div style="width:1px;height:26px;background:#333;margin:0 6px"></div>
        <button data-act="download" title="Download ink.json">${ic('download')}</button>
        <button data-act="load" title="Load ink.json">${ic('upload_file')}</button>
        <button data-act="publish" title="Publish ink to GitHub">${ic('cloud_upload')}</button>
        <button data-act="settings" title="Publish settings">${ic('settings')}</button>
        <button data-act="pin" title="Keep toolbar on screen">${ic('keep')}</button>
        <span data-dot title="Unpublished changes" style="display:none;width:8px;height:8px;border-radius:50%;background:#ffa4e7;margin:0 8px 0 4px;box-shadow:0 0 8px #ffa4e7"></span>
        <input data-file type="file" accept="application/json,.json" style="display:none">
      </div>`;
    document.body.appendChild(r);
    r.querySelectorAll('[data-tool],[data-act]').forEach(b => { if (b.tagName === 'BUTTON' && !b.closest('[data-panel]')) b.style.cssText = btnCss(false); });
    r.addEventListener('pointerdown', () => showUI(false));
    r.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return; e.stopPropagation();
      if (b.dataset.tool) { st.tool = b.dataset.tool; if (st.tool === 'eraser') {} syncUI(); }
      else if (b.dataset.color) { st.color = b.dataset.color; if (st.tool === 'eraser' || st.tool === 'laser') st.tool = 'pen'; syncUI(); }
      else act(b.dataset.act, b);
      b.blur();
    });
    r.querySelector('[data-file]').addEventListener('change', importFile);
    window.addEventListener('mousemove', e => { if (e.clientY > window.innerHeight - 70) showUI(false); }, { passive: true });
    window.addEventListener('deckpresent', () => { syncUI(); if (isPinned()) scheduleHide(1500); });
    syncUI();
    if (isPinned()) { ui.shown = true; scheduleHide(10); }
  }
  function syncUI() {
    if (!ui.root) return;
    ui.root.querySelectorAll('[data-tool]').forEach(b => { b.style.cssText = btnCss(b.dataset.tool === st.tool); });
    ui.root.querySelectorAll('[data-color]').forEach(b => { b.firstElementChild.style.boxShadow = b.dataset.color === st.color && st.tool !== 'eraser' ? '0 0 0 2px #121212, 0 0 0 4px ' + b.dataset.color : 'none'; });
    const h = ui.root.querySelector('[data-act="hide"]'); h.innerHTML = ic(st.hidden ? 'visibility_off' : 'visibility'); h.style.color = st.hidden ? '#777' : '#e8e8e8';
    ui.root.querySelector('[data-act="publish"]').style.display = canPublish() ? 'flex' : 'none';
    ui.root.querySelector('[data-bar]').style.borderColor = st.drawMode ? '#80b9ff' : '#2e2e2e';
    const pin = ui.root.querySelector('[data-act="pin"]');
    pin.innerHTML = ic(isPinned() ? 'keep' : 'keep_off'); pin.style.color = isPinned() ? '#80b9ff' : '#e8e8e8';
    pin.title = isPinned() ? 'Toolbar stays on screen (tap to auto-hide)' : 'Toolbar auto-hides (tap to keep on screen)';
    // While presenting, keep only the drawing tools: file and settings buttons are for prep, not the audience.
    ['download', 'load', 'settings'].forEach(a => { ui.root.querySelector(`[data-act="${a}"]`).style.display = presenting() ? 'none' : 'flex'; });
    updateDot();
  }
  function updateDot() { const d = ui.root && ui.root.querySelector('[data-dot]'); if (d) d.style.display = st.dirty ? 'block' : 'none'; }
  function showUI(autohide) {
    if (!ui.root) return; ui.shown = true;
    ui.root.style.transform = 'translate(-50%,0)'; ui.root.style.opacity = '1';
    clearTimeout(ui.hideT); if (autohide) scheduleHide(); else scheduleHide(5000);
  }
  function scheduleHide(ms = 3500) {
    clearTimeout(ui.hideT);
    ui.hideT = setTimeout(() => {
      if (st.drawMode || ui.panelOpen || st.penDown || (ui.root && ui.root.matches(':hover'))) return scheduleHide(ms);
      if (isPinned()) { ui.root.style.transform = 'translate(-50%,0)'; ui.root.style.opacity = '0.4'; return; }   // pinned: stay, but quietly
      ui.shown = false; ui.root.style.transform = 'translate(-50%,140%)'; ui.root.style.opacity = '0';
    }, ms);
  }
  let toastT;
  function toast(msg, err) {
    if (!ui.root) return; const m = ui.root.querySelector('[data-msg]');
    m.textContent = msg; m.style.color = err ? '#fab0ae' : '#fff'; m.style.borderColor = err ? '#7a3330' : '#333'; m.style.opacity = '1';
    showUI(false); clearTimeout(toastT); toastT = setTimeout(() => { m.style.opacity = '0'; }, err ? 7000 : 3200);
  }
  function togglePanel(on) {
    ui.panelOpen = on; const p = ui.root.querySelector('[data-panel]'); p.style.display = on ? 'block' : 'none';
    if (on) { const c = cfg(); p.querySelectorAll('[data-cfg]').forEach(i => { i.value = c[i.dataset.cfg] || (i.dataset.cfg === 'branch' ? 'main' : ''); }); showUI(false); }
    else scheduleHide();
  }
  let clearArm = 0;
  async function act(a, b) {
    if (a === 'undo') undo();
    else if (a === 'clear') {
      if (!strokesOf(st.idx).length) return toast('No ink on this slide');
      if (performance.now() < clearArm) { clearArm = 0; b.style.background = 'transparent'; b.style.color = '#e8e8e8'; clearSlide(); toast('Cleared this slide · undo to restore'); }
      else { clearArm = performance.now() + 2500; b.style.background = '#7a3330'; b.style.color = '#fff'; toast('Tap again to clear this slide'); setTimeout(() => { if (performance.now() >= clearArm) { b.style.background = 'transparent'; b.style.color = '#e8e8e8'; } }, 2600); }
    }
    else if (a === 'hide') { st.hidden = !st.hidden; localStorage.setItem(LS_HIDE, st.hidden ? '1' : '0'); renderAll(); syncUI(); toast(st.hidden ? 'Ink hidden' : 'Ink shown'); }
    else if (a === 'download') download();
    else if (a === 'load') ui.root.querySelector('[data-file]').click();
    else if (a === 'publish') publish();
    else if (a === 'pin') { localStorage.setItem(LS_PIN, isPinned() ? '0' : '1'); syncUI(); toast(isPinned() ? 'Toolbar stays on screen' : 'Toolbar auto-hides'); scheduleHide(); }
    else if (a === 'settings') togglePanel(!ui.panelOpen);
    else if (a === 'cfgsave') {
      const c = cfg(); ui.root.querySelectorAll('[data-cfg]').forEach(i => { c[i.dataset.cfg] = i.value.trim(); });
      c.repo = (c.repo || '').replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
      localStorage.setItem(LS_CFG, JSON.stringify(c)); togglePanel(false); syncUI();
      toast(c.token && c.repo ? 'Settings saved — Publish is enabled' : 'Settings saved (add repo + token to enable Publish)');
    }
    else if (a === 'cfgforget') { const c = cfg(); delete c.token; localStorage.setItem(LS_CFG, JSON.stringify(c)); ui.root.querySelector('[data-cfg="token"]').value = ''; syncUI(); toast('Token removed from this device'); }
    else if (a === 'discard') { st.work = clone(st.published); st.dirty = false; st.undo = {}; localStorage.removeItem(LS); renderAll(); updateDot(); togglePanel(false); toast('Local ink discarded — showing published ink'); }
  }
  function docOut() { const d = clone(st.work); d.format = 'deck-ink'; d.version = VERSION; d.deck = DECK_ID; d.updated = new Date().toISOString(); return d; }
  function download() {
    const blob = new Blob([JSON.stringify(docOut())], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ink.json';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('Downloaded ink.json');
  }
  function importFile(e) {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const d = JSON.parse(rd.result);
        if (!validDoc(d)) throw new Error('not an ink file');
        if (d.deck && d.deck !== DECK_ID) toast(`Loaded ink made for "${d.deck}"`, true);
        st.secs.forEach((_, i) => pushUndo(i));
        st.work = { format: 'deck-ink', version: VERSION, deck: DECK_ID, slides: d.slides };
        st.dirty = !same(st.work, st.published); saveLocal(); renderAll();
        if (!d.deck || d.deck === DECK_ID) toast('Loaded ' + file.name);
      } catch (err) { toast('Could not load ink: ' + err.message, true); }
    };
    rd.readAsText(file);
  }
  const b64 = str => { const bytes = new TextEncoder().encode(str); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); };
  async function publish() {
    const c = cfg(); if (!c.token || !c.repo) { togglePanel(true); return toast('Add a repository and token first', true); }
    // Folder defaults to wherever this deck is served from, so one device setup works for every lecture.
    const autoDir = () => {
      let segs = location.pathname.replace(/[^/]*$/, '').split('/').filter(Boolean).map(decodeURIComponent);
      const repoName = (c.repo || '').split('/')[1];
      if (/\.github\.io$/i.test(location.hostname) && segs[0] === repoName) segs = segs.slice(1);
      return segs.join('/');
    };
    const dir = ((c.path || '').replace(/^\/+|\/+$/g, '')) || autoDir();
    const path = (dir ? dir + '/' : '') + 'ink.json';
    const branch = c.branch || 'main', api = `https://api.github.com/repos/${c.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
    const H = { Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    toast('Publishing…');
    try {
      let sha;
      const g = await fetch(api + '?ref=' + encodeURIComponent(branch), { headers: H, cache: 'no-store' });
      if (g.ok) sha = (await g.json()).sha;
      else if (g.status !== 404) throw new Error(await ghErr(g));
      const doc = docOut();
      const body = { message: `Update ink (${Object.keys(doc.slides).length} slides)`, content: b64(JSON.stringify(doc)), branch };
      if (sha) body.sha = sha;
      const p = await fetch(api, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!p.ok) throw new Error(await ghErr(p));
      st.published = clone(doc); st.dirty = false; saveLocal();
      toast(`Published ${path} to ${c.repo}@${branch} ✓ (Pages may take a minute to update)`);
    } catch (err) { toast('Publish failed: ' + err.message, true); }
  }
  async function ghErr(r) { let m = ''; try { m = (await r.json()).message; } catch (e) {} return `${r.status}${m ? ' — ' + m : ''}${r.status === 401 ? ' (check the token)' : r.status === 404 ? ' (check repo / branch / token access)' : ''}`; }

  /* ---------- wiring ---------- */
  function attach(stage) {
    st.stage = stage;
    st.secs = [...stage.querySelectorAll(':scope > section')];
    const act = st.secs.findIndex(s => s.hasAttribute('data-deck-active')); st.idx = act < 0 ? 0 : act;
    stage.style.touchAction = 'none';
    stage.addEventListener('slidechange', e => {
      st.secs = [...stage.querySelectorAll(':scope > section')];
      st.idx = e.detail && typeof e.detail.index === 'number' ? e.detail.index : st.secs.findIndex(s => s.hasAttribute('data-deck-active'));
      const g = layer(st.idx); if (g && !g.childNodes.length && strokesOf(st.idx).length) render(st.idx);
      if (g && g.animate) g.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: 'ease-out' });
      if (st.live) st.live = null;
    });
    // re-attach layers if the host re-renders slide markup
    new MutationObserver(() => {
      const now = [...stage.querySelectorAll(':scope > section')];
      if (now.length !== st.secs.length || now.some((s, i) => s !== st.secs[i])) { st.secs = now; renderAll(); }
      else st.secs.forEach((s, i) => { if (!s.querySelector(':scope > svg[data-ink-layer]') && strokesOf(i).length) render(i); });
    }).observe(stage, { childList: true, subtree: false });
    buildUI(); boot();
  }
  // A resting hand must not select text or images, start an image drag, or open the iOS callout.
  const noSelect = document.createElement('style');
  noSelect.textContent = `deck-stage, deck-stage * { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
    deck-stage img, deck-stage svg, deck-stage video { -webkit-user-drag: none; user-drag: none; }`;
  (document.head || document.documentElement).appendChild(noSelect);
  const inDeck = e => e.composedPath().some(n => n.tagName === 'DECK-STAGE');
  document.addEventListener('selectstart', e => { if (inDeck(e) && !interactive(e)) e.preventDefault(); }, true);
  document.addEventListener('dragstart', e => { if (inDeck(e)) e.preventDefault(); }, true);
  document.addEventListener('contextmenu', e => { if ((st.penDown || st.live) && inDeck(e)) e.preventDefault(); }, true);
  window.addEventListener('pointerdown', onDown, { capture: true, passive: false });
  window.addEventListener('pointermove', e => {
    if (st.live) { moveStroke(e); return; }
    if (st.tool !== 'laser' || inUI(e) || !onStage(e)) return;
    // Apple Pencil hover (no contact) on supported iPads, or a mouse while drawing mode is on
    if ((e.pointerType === 'pen' && e.buttons === 0) || (e.pointerType === 'mouse' && st.drawMode)) laserPoint(e, 350);
  }, { capture: true, passive: false });
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onCancel, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('keydown', onKey, true);
  document.addEventListener('touchmove', e => { if (st.penDown || st.live) e.preventDefault(); }, { passive: false });
  const wait = () => {
    const s = document.querySelector('deck-stage');
    if (s && typeof s.goTo === 'function' && s.querySelector(':scope > section')) attach(s);
    else setTimeout(wait, 250);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wait); else wait();
  window.DeckInk = { state: st, download, publish, render: renderAll };
})();
