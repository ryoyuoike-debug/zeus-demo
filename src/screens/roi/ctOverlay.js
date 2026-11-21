// =============================================================================
// 関心領域: CT（軸位断）上のオーバーレイ描画
//   ・塗った範囲（円の和集合）: 半透明のオレンジ＋輪郭線
//     近くのスライスに塗った範囲は、薄い点線の輪郭で参考表示
//   ・2 点ライン: 現在のスライスの厚みに入る部分は実線、それ以外は点線
//     始点・終点のマーカ、体表との交点、深さのラベル
//   ・ライン指定中のプレビュー（始点 → カーソル）
//   ・ペン・消しゴムのカーソル
//   ・AI ROI（研究開発中）の断面輪郭
// =============================================================================
import { zToSliceIndex } from '../../ui/ctViewer.js';
import { onSlice, slabInterval, aiRoiContour, dist3 } from './geometry.js';
import { COLORS } from './scene3d.js';

const GHOST_REACH = 9;
const FONT = '600 11px system-ui, -apple-system, "Segoe UI", sans-serif';

/**
 * @param {() => {
 *   circles: Array<{x:number,y:number,z:number,r:number}>, line: object|null, lineDim: boolean, grow: number,
 *   draftStart: number[]|null, hover: {x:number,y:number}|null, tool: 'line'|'pen'|'eraser', brushR: number,
 *   depthText: string, ai: boolean, painting: boolean,
 * }} get
 */
export function createCtOverlay(get) {
  const bufFill = document.createElement('canvas');
  const bufLine = document.createElement('canvas');
  const fillCtx = bufFill.getContext('2d');
  const lineCtx = bufLine.getContext('2d');

  /** 円の和集合を塗る（デバイスピクセル）。expand: 半径の拡張（CSS px） */
  function unionPath(c2, api, list, expand, dpr) {
    c2.beginPath();
    for (const c of list) {
      const p = api.worldToCanvas(c.x, c.y);
      const r = Math.max(0.5, api.mmToPx(c.r) + expand) * dpr;
      c2.moveTo(p.x * dpr + r, p.y * dpr);
      c2.arc(p.x * dpr, p.y * dpr, r, 0, Math.PI * 2);
    }
  }

  function drawUnion(g, api, list, { fill, fillAlpha, stroke, strokeW, dash = null, alpha = 1 }) {
    if (!list.length) return;
    const W = api.canvas.width, H = api.canvas.height;
    const dpr = window.devicePixelRatio || 1;
    const cssW = W / dpr, cssH = H / dpr;
    for (const b of [bufFill, bufLine]) if (b.width !== W || b.height !== H) { b.width = W; b.height = H; }
    if (fill) {
      fillCtx.setTransform(1, 0, 0, 1, 0, 0);
      fillCtx.clearRect(0, 0, W, H);
      fillCtx.fillStyle = fill;
      unionPath(fillCtx, api, list, 0, dpr);
      fillCtx.fill();
      g.globalAlpha = fillAlpha * alpha;
      g.drawImage(bufFill, 0, 0, cssW, cssH);
    }
    if (stroke) {
      // 外側に広げた和集合 − 元の和集合 = 輪郭
      lineCtx.setTransform(1, 0, 0, 1, 0, 0);
      lineCtx.globalCompositeOperation = 'source-over';
      lineCtx.clearRect(0, 0, W, H);
      lineCtx.fillStyle = stroke;
      unionPath(lineCtx, api, list, strokeW, dpr);
      lineCtx.fill();
      lineCtx.globalCompositeOperation = 'destination-out';
      unionPath(lineCtx, api, list, 0, dpr);
      lineCtx.fill();
      lineCtx.globalCompositeOperation = 'source-over';
      if (dash) {
        // 点線風: 斜めの縞で輪郭を間引く
        lineCtx.globalCompositeOperation = 'destination-out';
        lineCtx.strokeStyle = '#000';
        lineCtx.lineWidth = dash * dpr;
        lineCtx.beginPath();
        for (let x = -H; x < W; x += dash * 2.4 * dpr) { lineCtx.moveTo(x, 0); lineCtx.lineTo(x + H, H); }
        lineCtx.stroke();
        lineCtx.globalCompositeOperation = 'source-over';
      }
      g.globalAlpha = alpha;
      g.drawImage(bufLine, 0, 0, cssW, cssH);
    }
    g.globalAlpha = 1;
  }

  function pill(g, x, y, text, { bg = 'rgba(8,14,26,0.86)', border = COLORS.line, color = '#e9fbff', align = 'left' } = {}) {
    g.font = FONT;
    const w = g.measureText(text).width + 12;
    const lx = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
    g.fillStyle = bg;
    g.strokeStyle = border;
    g.lineWidth = 1;
    g.beginPath();
    if (g.roundRect) g.roundRect(lx, y - 9, w, 18, 9); else g.rect(lx, y - 9, w, 18);
    g.fill(); g.stroke();
    g.fillStyle = color;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, lx + w / 2, y + 0.5);
    return w;
  }

  function seg(g, api, a, b, { width, color, dash = null, alpha = 1 }) {
    const p = api.worldToCanvas(a[0], a[1]), q = api.worldToCanvas(b[0], b[1]);
    g.globalAlpha = alpha;
    g.strokeStyle = color;
    g.lineWidth = width;
    g.setLineDash(dash || []);
    g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 1;
  }
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  /** 点のマーカ（始点 = 輪、終点 = 塗り＋十字） */
  function pointMarker(g, api, p, kind, z, dim) {
    const on = Math.abs(p[2] - z) <= 1.01;
    const c = api.worldToCanvas(p[0], p[1]);
    const a = dim ? 0.4 : on ? 1 : 0.6;
    g.globalAlpha = a;
    g.lineWidth = 2;
    g.strokeStyle = COLORS.line;
    if (!on) g.setLineDash([3, 3]);
    if (kind === 'start') {
      g.fillStyle = 'rgba(8,14,26,0.6)';
      g.beginPath(); g.arc(c.x, c.y, 6, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = COLORS.line;
      g.beginPath(); g.arc(c.x, c.y, 2, 0, Math.PI * 2); g.fill();
    } else {
      g.shadowColor = 'rgba(62,224,255,0.8)';
      g.shadowBlur = on && !dim ? 10 : 0;
      g.fillStyle = on ? '#ffffff' : 'rgba(255,255,255,0.35)';
      g.beginPath(); g.arc(c.x, c.y, 5, 0, Math.PI * 2); g.fill(); g.stroke();
      g.shadowBlur = 0;
      g.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { g.moveTo(c.x + dx * 8, c.y + dy * 8); g.lineTo(c.x + dx * 13, c.y + dy * 13); }
      g.stroke();
    }
    g.setLineDash([]);
    const label = (kind === 'start' ? '始点' : '終点') + (on ? '' : `（Im ${zToSliceIndex(p[2]) + 1}）`);
    g.globalAlpha = a;
    return { c, label };
  }

  return function draw(g, api) {
    const s = get();
    const z = api.z;
    const cw = api.canvas.clientWidth, ch = api.canvas.clientHeight;

    // ---- 近くのスライスに塗った範囲（参考） ----
    const near = [], cur = [];
    for (const c of s.circles) {
      if (onSlice(c, z)) cur.push(c);
      else if (Math.abs(c.z - z) <= GHOST_REACH) near.push(c);
    }
    if (near.length && !s.painting) drawUnion(g, api, near, { stroke: 'rgba(255,170,90,1)', strokeW: 1.1, dash: 2.2, alpha: 0.5 });
    // ---- 現在のスライスの ROI ----
    drawUnion(g, api, cur, { fill: COLORS.roi, fillAlpha: 0.36, stroke: '#ffb066', strokeW: 1.6 });

    // ---- AI ROI（研究開発中）----
    if (s.ai) {
      const segs = aiRoiContour(z);
      if (segs.length) {
        g.strokeStyle = COLORS.ai;
        g.lineWidth = 1.6;
        g.setLineDash([4, 3]);
        g.beginPath();
        for (const [x0, y0, x1, y1] of segs) {
          const p = api.worldToCanvas(x0, y0), q = api.worldToCanvas(x1, y1);
          g.moveTo(p.x, p.y); g.lineTo(q.x, q.y);
        }
        g.stroke();
        g.setLineDash([]);
      }
    }

    // ---- 2 点ライン ----
    const L = s.line;
    if (L) {
      const dim = s.lineDim;
      const grow = Math.max(0, Math.min(1, s.grow));
      const full = dist3(L.end, L.ext);
      const reach = full * grow;
      const inner = L.skin ? dist3(L.end, L.skin) : dist3(L.end, L.start);
      const at = (d) => lerp3(L.end, L.ext, Math.min(d, reach) / full);
      const parts = [];
      if (reach > 0) parts.push({ a: L.end, b: at(inner), ext: false });
      if (reach > inner) parts.push({ a: at(inner), b: at(full), ext: true });
      for (const p of parts) {
        const color = COLORS.line;
        // 全体（投影）は細い点線
        seg(g, api, p.a, p.b, { width: p.ext ? 1.2 : 1.4, color, dash: [5, 4], alpha: dim ? 0.3 : p.ext ? 0.55 : 0.7 });
        // スライスの厚みに入る部分は実線
        const iv = slabInterval(p.a, p.b, z, 1.0);
        if (iv) {
          const a = lerp3(p.a, p.b, iv[0]), b = lerp3(p.a, p.b, iv[1]);
          g.shadowColor = 'rgba(62,224,255,0.7)';
          g.shadowBlur = dim ? 0 : 6;
          seg(g, api, a, b, { width: p.ext ? 2 : 2.6, color, alpha: dim ? 0.4 : p.ext ? 0.75 : 1 });
          g.shadowBlur = 0;
        }
      }
      // 延長端の矢印
      if (grow >= 1) {
        const pe = api.worldToCanvas(L.ext[0], L.ext[1]);
        const pb = api.worldToCanvas((L.skin || L.start)[0], (L.skin || L.start)[1]);
        const ang = Math.atan2(pe.y - pb.y, pe.x - pb.x);
        if (Number.isFinite(ang) && Math.hypot(pe.x - pb.x, pe.y - pb.y) > 12) {
          g.globalAlpha = dim ? 0.3 : 0.7;
          g.fillStyle = COLORS.line;
          g.beginPath();
          g.moveTo(pe.x, pe.y);
          g.lineTo(pe.x - Math.cos(ang - 0.4) * 9, pe.y - Math.sin(ang - 0.4) * 9);
          g.lineTo(pe.x - Math.cos(ang + 0.4) * 9, pe.y - Math.sin(ang + 0.4) * 9);
          g.closePath(); g.fill();
          g.globalAlpha = 1;
        }
      }
      // 体表との交点
      if (L.skin && grow * full >= inner) {
        const k = api.worldToCanvas(L.skin[0], L.skin[1]);
        const on = Math.abs(L.skin[2] - z) <= 1.01;
        g.globalAlpha = dim ? 0.35 : on ? 1 : 0.6;
        g.strokeStyle = '#ffffff';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(k.x, k.y - 5); g.lineTo(k.x + 5, k.y); g.lineTo(k.x, k.y + 5); g.lineTo(k.x - 5, k.y); g.closePath();
        g.stroke();
        g.globalAlpha = 1;
      }
      // 始点・終点
      const ms = pointMarker(g, api, L.start, 'start', z, dim);
      const me = pointMarker(g, api, L.end, 'end', z, dim);
      g.globalAlpha = dim ? 0.45 : 1;
      // ラベルは線の外側（始点側は始点の外、終点は下）
      const dx = ms.c.x - me.c.x, dy = ms.c.y - me.c.y;
      const dl = Math.hypot(dx, dy) || 1;
      const ux = dx / dl, uy = dy / dl;
      const startLabelX = ms.c.x + ux * 12 + (ux < 0 ? 0 : 0);
      pill(g, startLabelX, ms.c.y + uy * 12 - 14, ms.label, { align: ux < -0.2 ? 'right' : ux > 0.2 ? 'left' : 'center' });
      pill(g, me.c.x - ux * 14, me.c.y - uy * 14 + 16, me.label, { align: ux > 0.2 ? 'right' : ux < -0.2 ? 'left' : 'center', bg: 'rgba(62,224,255,0.92)', color: '#032029', border: 'rgba(255,255,255,0.8)' });
      // 深さ（体内部分の中央）
      if (s.depthText && L.skin && grow >= 1) {
        // 線の下側に置き（始点ラベルは上側）、線が短いときは終点ラベルと重ならないよう始点側へずらす
        const ks = api.worldToCanvas(L.skin[0], L.skin[1]);
        const mid = { x: (me.c.x + ks.x) / 2, y: (me.c.y + ks.y) / 2 };
        const half = Math.hypot(ks.x - me.c.x, ks.y - me.c.y) / 2;
        g.font = FONT;
        const pw = g.measureText(s.depthText).width + 12;
        let nx = -uy, ny = ux;
        if (ny < 0) { nx = -nx; ny = -ny; }
        const shift = Math.max(0, pw / 2 + 12 - half);
        pill(g, mid.x + nx * 18 + ux * shift, mid.y + ny * 18 + uy * shift + 2, s.depthText, { align: 'center', bg: 'rgba(8,14,26,0.9)', border: 'rgba(62,224,255,0.6)', color: '#bff4ff' });
      }
      g.globalAlpha = 1;
    }

    // ---- ライン指定中のプレビュー ----
    if (s.tool === 'line' && s.draftStart) {
      const st = s.draftStart;
      const ps = api.worldToCanvas(st[0], st[1]);
      if (s.hover) {
        const w = api.canvasToWorld(s.hover.x, s.hover.y);
        const len = dist3(st, [w.x, w.y, z]);
        g.strokeStyle = COLORS.line;
        g.lineWidth = 1.6;
        g.setLineDash([6, 4]);
        g.beginPath(); g.moveTo(ps.x, ps.y); g.lineTo(s.hover.x, s.hover.y); g.stroke();
        g.setLineDash([]);
        pill(g, s.hover.x + 14, s.hover.y + 16, `${len.toFixed(1)} mm（模擬値）`, { border: 'rgba(62,224,255,0.6)' });
      }
      const m = pointMarker(g, api, st, 'start', z, false);
      pill(g, m.c.x + 10, m.c.y - 16, m.label);
      g.globalAlpha = 1;
    }

    // ---- カーソル ----
    if (s.hover && s.hover.x >= 0 && s.hover.y >= 0 && s.hover.x <= cw && s.hover.y <= ch) {
      const { x, y } = s.hover;
      if (s.tool === 'pen' || s.tool === 'eraser') {
        const r = Math.max(2, api.mmToPx(s.brushR));
        g.lineWidth = 1.4;
        g.strokeStyle = s.tool === 'pen' ? 'rgba(255,190,120,0.95)' : 'rgba(255,255,255,0.95)';
        if (s.tool === 'eraser') g.setLineDash([3, 3]);
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
        g.setLineDash([]);
        g.strokeStyle = 'rgba(0,0,0,0.55)';
        g.lineWidth = 1;
        g.beginPath(); g.arc(x, y, r + 1.2, 0, Math.PI * 2); g.stroke();
        g.fillStyle = s.tool === 'pen' ? COLORS.roi : '#fff';
        g.beginPath(); g.arc(x, y, 1.3, 0, Math.PI * 2); g.fill();
      } else if (s.tool === 'line') {
        g.strokeStyle = 'rgba(62,224,255,0.95)';
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(x - 10, y); g.lineTo(x - 3, y); g.moveTo(x + 3, y); g.lineTo(x + 10, y);
        g.moveTo(x, y - 10); g.lineTo(x, y - 3); g.moveTo(x, y + 3); g.lineTo(x, y + 10);
        g.stroke();
      }
    }
  };
}
