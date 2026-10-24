/**
 * ui.js
 * ---------------------------------------------------------------------------
 * Every DOM concern lives here: pads, status pills, counters, the overlay
 * canvas (hand skeleton, movement trails, zone outlines), toasts and the
 * calibration drag-to-move pads.
 *
 * main.js owns the logic; this class only knows how to show things and how to
 * hand user intent back through callbacks.
 */

import { INSTRUMENTS } from './drumMapping.js';

const HAND_COLORS = { Left: '#00e5ff', Right: '#ff5cf0' };

export class UI {
  constructor() {
    this.el = {
      video: document.getElementById('video'),
      overlay: document.getElementById('overlay'),
      stage: document.getElementById('stage'),
      pads: document.getElementById('pads'),
      hint: document.getElementById('stage-hint'),
      hitLog: document.getElementById('hit-log'),
      calibBadge: document.getElementById('calib-badge'),

      statusCamera: document.getElementById('status-camera'),
      statusHands: document.getElementById('status-hands'),
      statusAudio: document.getElementById('status-audio'),
      statusFps: document.getElementById('status-fps'),

      countTotal: document.getElementById('count-total'),
      counterGrid: document.getElementById('counter-grid'),
      kitList: document.getElementById('kit-list'),

      recStatus: document.getElementById('rec-status'),

      toast: document.getElementById('toast'),
    };

    this.ctx = this.el.overlay.getContext('2d');
    this.padEls = new Map();     // instrumentId -> element
    this.counterCells = new Map();
    this.trails = new Map();     // handId -> [{x,y,t}]
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this._buildCounterGrid();
    this._buildKitList();
    this._observeResize();
  }

  /* ------------------------------------------------------------- build */
  _buildCounterGrid() {
    this.el.counterGrid.innerHTML = '';
    for (const inst of Object.values(INSTRUMENTS)) {
      const cell = document.createElement('div');
      cell.className = 'counter-cell';
      cell.style.setProperty('--glow', inst.glow);
      cell.innerHTML = `<b data-count>0</b><span>${inst.label.split(' ')[0]}</span>`;
      this.el.counterGrid.appendChild(cell);
      this.counterCells.set(inst.id, cell.querySelector('[data-count]'));
    }
  }

  _buildKitList() {
    this.el.kitList.innerHTML = '';
    for (const inst of Object.values(INSTRUMENTS)) {
      const li = document.createElement('li');
      li.style.setProperty('--glow', inst.glow);
      li.innerHTML =
        `<span class="swatch"></span>` +
        `<span class="kit-name">${inst.label}</span>` +
        `<span class="kit-sound">${inst.sound.replace('sounds/', '')}</span>`;
      this.el.kitList.appendChild(li);
    }
  }

  /** Create/replace the pad elements from a zone list. */
  buildPads(zones) {
    this.el.pads.innerHTML = '';
    this.padEls.clear();
    for (const z of zones) {
      const pad = document.createElement('div');
      pad.className = 'pad';
      pad.dataset.zone = z.id;
      pad.style.setProperty('--glow', z.glow);
      pad.innerHTML = `<div class="pad-label">${z.label}</div>`;
      this.el.pads.appendChild(pad);
      this.padEls.set(z.id, pad);
    }
  }

  /** Reposition + resize pads to match the zone list. Call on layout change. */
  layoutPads(zones) {
    const r = this.el.stage.getBoundingClientRect();
    const scale = Math.min(r.width, r.height);
    for (const z of zones) {
      const pad = this.padEls.get(z.id);
      if (!pad) continue;
      pad.style.left = `${z.x * 100}%`;
      pad.style.top = `${z.y * 100}%`;
      pad.style.width = `${2 * z.r * scale}px`;
    }
    this._resizeCanvas();
  }

  /** Enable pointer interaction so pads can be dragged in Calibration Mode. */
  setCalibrationInteractive(on, handlers) {
    for (const [id, pad] of this.padEls) {
      pad.style.pointerEvents = on ? 'auto' : 'none';
      pad.style.cursor = on ? 'grab' : 'default';
      if (on) {
        pad.onpointerdown = (e) => {
          e.preventDefault();
          pad.setPointerCapture(e.pointerId);
          pad.style.cursor = 'grabbing';
          handlers.onDragStart(id);
        };
        pad.onpointerup = (e) => {
          try { pad.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
          pad.style.cursor = 'grab';
          handlers.onDragEnd(id);
        };
        pad.onpointermove = (e) => {
          if (!pad.hasPointerCapture || !pad.hasPointerCapture(e.pointerId)) return;
          const rect = this.el.stage.getBoundingClientRect();
          const x = (e.clientX - rect.left) / rect.width;
          const y = (e.clientY - rect.top) / rect.height;
          handlers.onDragMove(id, Math.min(Math.max(x, 0.03), 0.97), Math.min(Math.max(y, 0.05), 0.95));
        };
      } else {
        pad.onpointerdown = null;
        pad.onpointerup = null;
        pad.onpointermove = null;
      }
    }
  }

  /* ---------------------------------------------------------- feedback */
  flashPad(zoneId) {
    const pad = this.padEls.get(zoneId);
    if (!pad) return;
    pad.classList.remove('hit');
    // Force a reflow so the animation restarts on rapid repeats.
    void pad.offsetWidth;
    pad.classList.add('hit');

    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    pad.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  }

  setHover(zoneId) {
    for (const [id, pad] of this.padEls) pad.classList.toggle('hover', id === zoneId);
  }

  pushHitLog(instrumentId, velocity) {
    const inst = INSTRUMENTS[instrumentId];
    if (!inst) return;
    const item = document.createElement('div');
    item.className = 'log-item';
    item.style.setProperty('--glow', inst.glow);
    item.textContent = `${inst.label}  ·  ${velocity.toFixed(2)}`;
    this.el.hitLog.appendChild(item);
    setTimeout(() => item.remove(), 1500);
    // Keep the log short.
    while (this.el.hitLog.children.length > 6) this.el.hitLog.firstChild.remove();
  }

  updateCounters(totals) {
    this.el.countTotal.textContent = totals.all;
    for (const [id, cell] of this.counterCells) {
      cell.textContent = totals[id] || 0;
    }
  }

  /* ----------------------------------------------------------- status */
  setStatus(which, state, text) {
    const map = {
      camera: this.el.statusCamera,
      hands: this.el.statusHands,
      audio: this.el.statusAudio,
      fps: this.el.statusFps,
    };
    const el = map[which];
    if (!el) return;
    el.dataset.state = state;
    el.innerHTML = `<i></i>${text}`;
  }

  showHint(show) {
    this.el.hint.classList.toggle('hidden', !show);
  }

  setCalibrationBadge(on) {
    this.el.calibBadge.hidden = !on;
  }

  toast(message, ok = false) {
    const t = this.el.toast;
    t.textContent = message;
    t.classList.toggle('ok', ok);
    t.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
  }

  setRecorderStatus(text) {
    this.el.recStatus.textContent = text;
  }

  /* ---------------------------------------------------------- overlay */
  _observeResize() {
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this._resizeCanvas());
      this._ro.observe(this.el.stage);
    }
    window.addEventListener('resize', () => this._resizeCanvas());
  }

  _resizeCanvas() {
    const r = this.el.stage.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    this.el.overlay.width = Math.round(w * this.dpr);
    this.el.overlay.height = Math.round(h * this.dpr);
    this._cssW = w;
    this._cssH = h;
  }

  /**
   * Draw one overlay frame.
   * @param {object} p
   * @param {Array} p.hands        tracker hands
   * @param {Array} p.zones        zone list
   * @param {boolean} p.calibration
   * @param {number} p.nowMs
   * @param {number} p.hoverZoneId
   */
  renderOverlay({ hands, zones, calibration, nowMs, hoverZoneId }) {
    if (!this._cssW) this._resizeCanvas();
    const ctx = this.ctx;
    const W = this._cssW;
    const H = this._cssH;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // --- zone outlines ---------------------------------------------------
    const scale = Math.min(W, H);
    for (const z of zones) {
      const cx = z.x * W;
      const cy = z.y * H;
      const rad = z.r * scale;
      const isHover = z.id === hoverZoneId;

      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.setLineDash(calibration ? [] : [6, 8]);
      ctx.lineWidth = calibration ? 2.5 : 1.2;
      ctx.strokeStyle = `rgba(${z.glow}, ${calibration ? 0.85 : isHover ? 0.6 : 0.22})`;
      ctx.stroke();
      ctx.setLineDash([]);

      if (calibration) {
        ctx.fillStyle = `rgba(${z.glow}, 0.06)`;
        ctx.fill();
        // centre crosshair
        ctx.beginPath();
        ctx.moveTo(cx - 7, cy); ctx.lineTo(cx + 7, cy);
        ctx.moveTo(cx, cy - 7); ctx.lineTo(cx, cy + 7);
        ctx.strokeStyle = `rgba(${z.glow}, 0.9)`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // --- trails + skeleton ----------------------------------------------
    for (const hand of hands) {
      const color = HAND_COLORS[hand.label] || '#ffffff';

      // Trail
      let trail = this.trails.get(hand.id);
      if (!trail) { trail = []; this.trails.set(hand.id, trail); }
      trail.push({ x: hand.strike.x, y: hand.strike.y, t: nowMs });
      const cutoff = nowMs - 550;
      while (trail.length && trail[0].t < cutoff) trail.shift();
      if (trail.length > 1) {
        ctx.lineCap = 'round';
        for (let i = 1; i < trail.length; i++) {
          const a = trail[i - 1];
          const b = trail[i];
          const age = (nowMs - b.t) / 550;
          ctx.beginPath();
          ctx.moveTo(a.x * W, a.y * H);
          ctx.lineTo(b.x * W, b.y * H);
          ctx.strokeStyle = hexToRgba(color, (1 - age) * 0.8);
          ctx.lineWidth = (1 - age) * 7 + 1;
          ctx.stroke();
        }
      }

      // Skeleton
      const lw = Math.max(1.5, hand.scale * W * 0.09);
      ctx.strokeStyle = hexToRgba(color, 0.85);
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      for (const [a, b] of HAND_BONES) {
        const pa = hand.landmarks[a];
        const pb = hand.landmarks[b];
        ctx.beginPath();
        ctx.moveTo(pa.x * W, pa.y * H);
        ctx.lineTo(pb.x * W, pb.y * H);
        ctx.stroke();
      }
      // Joints
      ctx.fillStyle = '#ffffff';
      for (const p of hand.landmarks) {
        ctx.beginPath();
        ctx.arc(p.x * W, p.y * H, Math.max(1.6, lw * 0.45), 0, Math.PI * 2);
        ctx.fill();
      }

      // Strike point
      ctx.beginPath();
      ctx.arc(hand.strike.x * W, hand.strike.y * H, 9, 0, Math.PI * 2);
      ctx.fillStyle = hexToRgba(color, 0.28);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Hand label
      ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = color;
      ctx.fillText(`${hand.label}`, hand.palm.x * W + 14, hand.palm.y * H - 14);
    }

    // Prune trails for hands no longer present.
    const liveIds = new Set(hands.map((h) => h.id));
    for (const id of [...this.trails.keys()]) if (!liveIds.has(id)) this.trails.delete(id);
  }

  clearOverlay() {
    if (!this._cssW) return;
    this.ctx.clearRect(0, 0, this._cssW, this._cssH);
    this.trails.clear();
  }

  dispose() {
    if (this._ro) this._ro.disconnect();
    clearTimeout(this._toastTimer);
  }
}

/* Bones for the skeleton overlay (kept local to the drawing code). */
const HAND_BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
