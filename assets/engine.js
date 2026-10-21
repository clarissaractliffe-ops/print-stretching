/* Print Grading engine: DXF parsing, size matching and print transforms.
   Pure functions, no DOM. All geometry in millimetres, y pointing down (screen / SVG convention). */
const Engine = (() => {
"use strict";

/* ---------------- small geometry helpers ---------------- */
const hyp = Math.hypot;
function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}
function signedArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}
const area = pts => Math.abs(signedArea(pts));
function perimeter(pts, closed = true) {
  let L = 0;
  for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; L += hyp(q[0] - p[0], q[1] - p[1]); }
  return L;
}
function pointInPoly(pt, poly) {
  let inside = false; const [x, y] = pt;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function centroid(pts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n], c = p[0] * q[1] - q[0] * p[1];
    a += c; cx += (p[0] + q[0]) * c; cy += (p[1] + q[1]) * c;
  }
  if (Math.abs(a) < 1e-9) { const b = bbox(pts); return [b.cx, b.cy]; }
  return [cx / (3 * a), cy / (3 * a)];
}
function dedupe(pts, closed = true, tol = 1e-6) {
  const out = [];
  for (const p of pts) { const l = out[out.length - 1]; if (!l || hyp(p[0] - l[0], p[1] - l[1]) > tol) out.push(p); }
  if (closed && out.length > 2) { const f = out[0], l = out[out.length - 1]; if (hyp(f[0] - l[0], f[1] - l[1]) <= tol) out.pop(); }
  return out;
}
function nearestOnPoly(pt, poly) {
  let best = Infinity, bp = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    let t = L2 ? ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
    const q = [a[0] + t * dx, a[1] + t * dy], d = hyp(q[0] - pt[0], q[1] - pt[1]);
    if (d < best) { best = d; bp = q; }
  }
  return { d: best, p: bp };
}

/* ---------------- affine matrices [a,b,c,d,e,f] ---------------- */
const M = {
  id: () => [1, 0, 0, 1, 0, 0],
  t: (x, y) => [1, 0, 0, 1, x, y],
  s: (sx, sy = sx) => [sx, 0, 0, sy, 0, 0],
  r: deg => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [c, s, -s, c, 0, 0]; },
  mul(m1, m2) { // m1 after m2
    return [m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5]];
  },
  chain(...ms) { return ms.reduce((acc, m) => M.mul(acc, m), M.id()); },
  apply: (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]],
  inv(m) {
    const det = m[0] * m[3] - m[1] * m[2];
    const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
    return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
  }
};

/* ================= DXF ================= */
function bulgePts(p1, p2, b) {
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1], c = hyp(dx, dy);
  if (c < 1e-9 || Math.abs(b) < 1e-9) return [];
  const theta = 4 * Math.atan(b), r = c * (1 + b * b) / (4 * Math.abs(b));
  const d = c * (1 - b * b) / (4 * b);
  const mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2;
  const cx = mx - d * dy / c, cy = my + d * dx / c;
  const a1 = Math.atan2(p1[1] - cy, p1[0] - cx);
  const n = Math.max(2, Math.ceil(Math.abs(theta) / (Math.PI / 36)));
  const out = [];
  for (let i = 1; i < n; i++) { const a = a1 + theta * i / n; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return out;
}
function arcPts(cx, cy, r, a0, a1) {
  let s = a0 * Math.PI / 180, e = a1 * Math.PI / 180;
  while (e <= s) e += 2 * Math.PI;
  const n = Math.max(4, Math.ceil((e - s) / (Math.PI / 36))), out = [];
  for (let i = 0; i <= n; i++) { const a = s + (e - s) * i / n; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return out;
}
function splinePts(deg, knots, ctrl, weights, fit) {
  if (ctrl.length < 2) return fit.length >= 2 ? fit : ctrl;
  const p = deg || 3, n = ctrl.length;
  if (!knots || knots.length !== n + p + 1) {
    knots = []; // clamped uniform
    for (let i = 0; i < n + p + 1; i++) knots.push(i <= p ? 0 : i >= n ? n - p : i - p);
  }
  const w = weights && weights.length === n ? weights : ctrl.map(() => 1);
  const t0 = knots[p], t1 = knots[n], steps = Math.max(16, n * 10), out = [];
  for (let s = 0; s <= steps; s++) {
    const t = Math.min(t0 + (t1 - t0) * s / steps, t1 - 1e-10 * (t1 - t0 || 1));
    let k = p; while (k < n - 1 && t >= knots[k + 1]) k++;
    const d = [];
    for (let j = 0; j <= p; j++) { const c = ctrl[k - p + j], ww = w[k - p + j]; d.push([c[0] * ww, c[1] * ww, ww]); }
    for (let r = 1; r <= p; r++) for (let j = p; j >= r; j--) {
      const i = k - p + j, den = knots[i + p - r + 1] - knots[i], a = den ? (t - knots[i]) / den : 0;
      d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1], (1 - a) * d[j - 1][2] + a * d[j][2]];
    }
    out.push([d[p][0] / d[p][2], d[p][1] / d[p][2]]);
  }
  return out;
}

function tokenize(text) {
  const lines = text.split(/\r\n|\r|\n/), pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (isNaN(code)) { i -= 1; continue; } // resync on stray lines
    pairs.push([code, lines[i + 1].replace(/\s+$/, "").replace(/^\s+/, "")]);
  }
  return pairs;
}

// Read entities from pairs[i..] until a 0-code value in stopAt. Returns [entities, nextIndex]
function readEntities(pairs, i, stopAt) {
  const ents = [];
  while (i < pairs.length) {
    const [code, val] = pairs[i];
    if (code !== 0) { i++; continue; }
    if (stopAt.includes(val)) break;
    const type = val; const g = []; i++;
    while (i < pairs.length && pairs[i][0] !== 0) g.push(pairs[i++]);
    const get = (c, d) => { const f = g.find(x => x[0] === c); return f ? f[1] : d; };
    const num = (c, d = 0) => parseFloat(get(c, d)) || 0;
    const layer = get(8, "0");
    if (type === "POLYLINE") {
      const flags = parseInt(get(70, 0), 10) || 0;
      const verts = [];
      while (i < pairs.length && pairs[i][0] === 0 && pairs[i][1] === "VERTEX") {
        i++; const v = [];
        while (i < pairs.length && pairs[i][0] !== 0) v.push(pairs[i++]);
        const vg = c => { const f = v.find(x => x[0] === c); return f ? parseFloat(f[1]) || 0 : 0; };
        const vf = parseInt((v.find(x => x[0] === 70) || [0, 0])[1], 10) || 0;
        if (vf & 16) continue; // spline frame control point
        verts.push({ p: [vg(10), vg(20)], b: vg(42) });
      }
      if (i < pairs.length && pairs[i][1] === "SEQEND") { i++; while (i < pairs.length && pairs[i][0] !== 0) i++; }
      ents.push(polyFromVerts(verts, !!(flags & 1), layer));
    } else if (type === "LWPOLYLINE") {
      const flags = parseInt(get(70, 0), 10) || 0, verts = [];
      for (const [c, v] of g) {
        if (c === 10) verts.push({ p: [parseFloat(v) || 0, 0], b: 0 });
        else if (c === 20 && verts.length) verts[verts.length - 1].p[1] = parseFloat(v) || 0;
        else if (c === 42 && verts.length) verts[verts.length - 1].b = parseFloat(v) || 0;
      }
      ents.push(polyFromVerts(verts, !!(flags & 1), layer));
    } else if (type === "LINE") {
      ents.push({ type: "poly", layer, closed: false, pts: [[num(10), num(20)], [num(11), num(21)]] });
    } else if (type === "ARC") {
      ents.push({ type: "poly", layer, closed: false, pts: arcPts(num(10), num(20), num(40), num(50), num(51)) });
    } else if (type === "CIRCLE") {
      const pts = arcPts(num(10), num(20), num(40), 0, 360); pts.pop();
      ents.push({ type: "poly", layer, closed: true, pts, circle: true });
    } else if (type === "SPLINE") {
      const flags = parseInt(get(70, 0), 10) || 0, deg = parseInt(get(71, 3), 10) || 3;
      const knots = [], ctrl = [], weights = [], fit = [];
      for (const [c, v] of g) {
        if (c === 40) knots.push(parseFloat(v));
        else if (c === 41) weights.push(parseFloat(v));
        else if (c === 10) ctrl.push([parseFloat(v) || 0, 0]);
        else if (c === 20 && ctrl.length) ctrl[ctrl.length - 1][1] = parseFloat(v) || 0;
        else if (c === 11) fit.push([parseFloat(v) || 0, 0]);
        else if (c === 21 && fit.length) fit[fit.length - 1][1] = parseFloat(v) || 0;
      }
      const pts = splinePts(deg, knots, ctrl, weights, fit);
      ents.push({ type: "poly", layer, closed: !!(flags & 1), pts });
    } else if (type === "TEXT" || type === "MTEXT" || type === "ATTRIB") {
      let t = g.filter(x => x[0] === 3).map(x => x[1]).join("") + (get(1, "") || "");
      t = t.replace(/\\P/g, " ").replace(/\\[A-Za-z][^;]*;/g, "").replace(/[{}]/g, "").trim();
      if (t) ents.push({ type: "text", layer, text: t, p: [num(10), num(20)] });
    } else if (type === "POINT") {
      ents.push({ type: "point", layer, p: [num(10), num(20)] });
    } else if (type === "INSERT") {
      ents.push({ type: "insert", layer, name: get(2, ""), p: [num(10), num(20)], sx: num(41, 1) || 1, sy: num(42, 1) || 1, rot: num(50) });
    }
  }
  return [ents, i];
}
function polyFromVerts(verts, closed, layer) {
  const pts = [];
  for (let k = 0; k < verts.length; k++) {
    pts.push(verts[k].p);
    const nxt = verts[k + 1] || (closed ? verts[0] : null);
    if (nxt && verts[k].b) pts.push(...bulgePts(verts[k].p, nxt.p, verts[k].b));
  }
  return { type: "poly", layer, closed, pts };
}

function readDXF(text) {
  const pairs = tokenize(text);
  const header = {}, blocks = {}; let entities = [];
  let i = 0;
  while (i < pairs.length) {
    if (pairs[i][0] === 0 && pairs[i][1] === "SECTION") {
      const name = (pairs[i + 1] || [])[1]; i += 2;
      if (name === "HEADER") {
        while (i < pairs.length && !(pairs[i][0] === 0 && pairs[i][1] === "ENDSEC")) {
          if (pairs[i][0] === 9) { const k = pairs[i][1]; const v = pairs[i + 1]; if (v) header[k] = v[1]; }
          i++;
        }
      } else if (name === "BLOCKS") {
        while (i < pairs.length && !(pairs[i][0] === 0 && pairs[i][1] === "ENDSEC")) {
          if (pairs[i][0] === 0 && pairs[i][1] === "BLOCK") {
            i++; const g = [];
            while (i < pairs.length && pairs[i][0] !== 0) g.push(pairs[i++]);
            const bname = (g.find(x => x[0] === 2) || g.find(x => x[0] === 3) || [0, ""])[1];
            const base = [parseFloat((g.find(x => x[0] === 10) || [0, 0])[1]) || 0, parseFloat((g.find(x => x[0] === 20) || [0, 0])[1]) || 0];
            const [ents, ni] = readEntities(pairs, i, ["ENDBLK", "ENDSEC"]); i = ni;
            if (pairs[i] && pairs[i][1] === "ENDBLK") i++;
            blocks[bname] = { name: bname, base, ents };
          } else i++;
        }
      } else if (name === "ENTITIES") {
        const [ents, ni] = readEntities(pairs, i, ["ENDSEC"]); entities = ents; i = ni;
      } else {
        while (i < pairs.length && !(pairs[i][0] === 0 && pairs[i][1] === "ENDSEC")) i++;
      }
    }
    i++;
  }
  return { header, blocks, entities };
}

function transformEnt(e, m) {
  if (e.type === "poly") return { ...e, pts: e.pts.map(p => M.apply(m, p)) };
  if (e.type === "text" || e.type === "point") return { ...e, p: M.apply(m, e.p) };
  return e;
}
function expandInsert(ins, blocks, depth, parentM) {
  const b = blocks[ins.name]; if (!b || depth > 5) return [];
  const m = M.mul(parentM, M.chain(M.t(ins.p[0], ins.p[1]), M.r(ins.rot), M.s(ins.sx, ins.sy), M.t(-b.base[0], -b.base[1])));
  const out = [];
  for (const e of b.ents) {
    if (e.type === "insert") out.push(...expandInsert(e, blocks, depth + 1, m));
    else out.push(transformEnt(e, m));
  }
  return out;
}

// Join open polylines/lines/arcs whose ends meet into longer chains; closed chains become candidates.
function joinChains(polys, tol) {
  const open = polys.map(p => p.pts.slice()), done = [];
  while (open.length) {
    let cur = open.pop(), grew = true;
    while (grew) {
      grew = false;
      for (let k = 0; k < open.length; k++) {
        const o = open[k], cs = cur[0], ce = cur[cur.length - 1], os = o[0], oe = o[o.length - 1];
        const d = (a, b) => hyp(a[0] - b[0], a[1] - b[1]);
        if (d(ce, os) < tol) cur = cur.concat(o.slice(1));
        else if (d(ce, oe) < tol) cur = cur.concat(o.slice(0, -1).reverse());
        else if (d(cs, oe) < tol) cur = o.concat(cur.slice(1));
        else if (d(cs, os) < tol) cur = o.slice().reverse().concat(cur.slice(1));
        else continue;
        open.splice(k, 1); grew = true; break;
      }
    }
    const closed = cur.length > 3 && hyp(cur[0][0] - cur[cur.length - 1][0], cur[0][1] - cur[cur.length - 1][1]) < tol;
    done.push({ pts: cur, closed });
  }
  return done;
}

const SIZE_RE = /^\s*(?:sample\s+)?size\s*[:=]\s*(.+)$/i;
const NAME_RE = /^\s*piece\s*name\s*[:=]\s*(.+)$/i;
const SKIP_TEXT = /^\s*(quantity|qty|category|material|annotation|style|style name|grade rule table|units|creation date|author|sample size|fabric|description|rule|#)\b/i;

function sizeFromFilename(fn) {
  const base = (fn || "").replace(/\.[^.]+$/, "");
  const m = base.match(/(?:^|[\s_\-.])((?:\d{2,3})|(?:X{0,3}S)|M|(?:X{0,3}L)|(?:T\d))$/i);
  return m ? m[1].toUpperCase() : null;
}

/* Parse one DXF file into entries: { name, size, outline, internals, grain, file } in mm, y-down */
function parseDXF(text, fileName, forceUnit) {
  const dxf = readDXF(text);
  // gather groups
  const groups = [], loose = [];
  for (const e of dxf.entities) {
    if (e.type === "insert") groups.push({ name: e.name, ents: expandInsert(e, dxf.blocks, 0, M.id()) });
    else loose.push(e);
  }
  if (loose.length) groups.push({ name: "", ents: loose });
  if (!groups.some(g => g.ents.length)) { // some exporters leave ENTITIES empty
    for (const b of Object.values(dxf.blocks)) if (!b.name.startsWith("*")) groups.push({ name: b.name, ents: b.ents });
  }
  // units
  const allTexts = groups.flatMap(g => g.ents.filter(e => e.type === "text").map(e => e.text));
  let unit = null, unitSource = "header";
  const ins = parseInt(dxf.header.$INSUNITS, 10);
  if (ins === 1) unit = "in"; else if (ins === 4) unit = "mm"; else if (ins === 5) unit = "cm"; else if (ins === 6) unit = "m";
  if (!unit) {
    const ut = allTexts.map(t => t.match(/units?\s*[:=]\s*(metric|english|imperial|mm|cm|inch|inches)/i)).find(Boolean);
    if (ut) { unit = /metric|mm/i.test(ut[1]) ? "mm" : /cm/i.test(ut[1]) ? "cm" : "in"; unitSource = "text"; }
  }
  // candidates per group
  const raw = [];
  let maxDim = 0;
  groups.forEach((g, gi) => {
    const polys = g.ents.filter(e => e.type === "poly" && e.pts.length >= 2);
    const closed = polys.filter(p => p.closed || (p.pts.length > 3 && hyp(p.pts[0][0] - p.pts[p.pts.length - 1][0], p.pts[0][1] - p.pts[p.pts.length - 1][1]) < 1e-6));
    const openP = polys.filter(p => !closed.includes(p));
    let cands = closed.filter(p => !p.circle).map(p => ({ pts: dedupe(p.pts), layer: p.layer, src: p }));
    // AAMA: boundary on layer 1
    const onL1 = cands.filter(c => c.layer === "1");
    if (onL1.length) cands = onL1;
    if (!cands.length && openP.length) { // try to join open pieces (lines + arcs)
      const bb = bbox(openP.flatMap(p => p.pts)), tol = Math.max(bb.w, bb.h) * 1e-4 + 1e-6;
      const chains = joinChains(openP.filter(p => p.layer === "1").length ? openP.filter(p => p.layer === "1") : openP, tol);
      cands = chains.filter(c => c.closed).map(c => ({ pts: dedupe(c.pts), layer: "joined", src: null }));
    }
    cands = cands.filter(c => c.pts.length >= 3 && area(c.pts) > 0);
    if (!cands.length) return;
    const maxA = Math.max(...cands.map(c => area(c.pts)));
    cands = cands.filter(c => area(c.pts) > maxA * 0.02);
    // drop internal shapes (pockets, holes) that are clearly not another size of the same piece
    cands = cands.filter(c => !cands.some(o => o !== c && area(o.pts) > area(c.pts) && pointInPoly(centroid(c.pts), o.pts) && area(c.pts) / area(o.pts) < 0.55));
    const texts = g.ents.filter(e => e.type === "text");
    const sizeTexts = texts.map(t => ({ t, m: t.text.match(SIZE_RE) })).filter(x => x.m);
    const nameText = texts.map(t => t.text.match(NAME_RE)).find(Boolean);
    const others = polys.filter(p => !cands.some(c => c.src === p));
    cands.forEach(c => {
      const b = bbox(c.pts); maxDim = Math.max(maxDim, b.w, b.h);
      let size = null;
      if (sizeTexts.length === 1 && cands.length === 1) size = sizeTexts[0].m[1].trim();
      else if (sizeTexts.length) {
        const inside = sizeTexts.filter(s => pointInPoly(s.t.p, c.pts));
        if (inside.length === 1) size = inside[0].m[1].trim();
      }
      let name = nameText ? nameText[1].trim() : null;
      if (!name) {
        const t = texts.find(t => pointInPoly(t.p, c.pts) && !SIZE_RE.test(t.text) && !SKIP_TEXT.test(t.text) && /[A-Za-z]{2}/.test(t.text) && t.text.length < 40);
        if (t) name = t.text.trim();
      }
      if (!name && g.name && !g.name.startsWith("*") && !/^(model|block|_)/i.test(g.name)) name = g.name.replace(/[_-]?(\d{2,3}|X{0,3}S|M|X{0,3}L)$/i, "").replace(/_/g, " ").trim() || g.name;
      raw.push({ group: gi, cand: c, name, size, others, b });
    });
  });
  if (!unit) { unit = maxDim > 0 && maxDim < 90 ? "in" : "mm"; unitSource = "guess"; }
  if (forceUnit) { unit = forceUnit; unitSource = "user"; }
  const k = { mm: 1, cm: 10, in: 25.4, m: 1000 }[unit];
  const conv = p => [p[0] * k, -p[1] * k];

  // internals per candidate: smallest containing boundary in same group
  const entries = raw.map(r => {
    const outline = r.cand.pts.map(conv);
    return { name: r.name, size: r.size, outline, internals: [], grain: null, file: fileName, group: r.group, _raw: r };
  });
  for (const gi of new Set(raw.map(r => r.group))) {
    const es = entries.filter(e => e.group === gi);
    const others = es[0]._raw.others;
    for (const p of others) {
      const pts = p.pts.map(conv);
      if (pts.length < 2 || p.circle && pts.length && area(pts) < 1) continue;
      const mid = pts[Math.floor(pts.length / 2)];
      const host = es.filter(e => pointInPoly(mid, e.outline) || nearestOnPoly(mid, e.outline).d < 15).sort((a, b) => area(a.outline) - area(b.outline))[0];
      if (!host) continue;
      const isGrain = p.layer === "7" || /grain/i.test(p.layer);
      if (isGrain && pts.length >= 2 && !host.grain) host.grain = [pts[0], pts[pts.length - 1]];
      else host.internals.push({ pts, closed: !!p.closed });
    }
  }
  entries.forEach(e => { e.outline = dedupe(e.outline); if (signedArea(e.outline) < 0) e.outline.reverse(); delete e._raw; });
  return { entries, unit, unitSource, file: fileName };
}

/* Group entries from one or more files into pieces with sizes */
const SIZE_ORDER = ["XXXS", "XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];
function sizeKey(s) {
  const u = String(s).toUpperCase().trim();
  const i = SIZE_ORDER.indexOf(u); if (i >= 0) return [0, i];
  const n = parseFloat(u.replace(/[^\d.]/g, "")); if (!isNaN(n)) return [1, n];
  return [2, u];
}
function sortSizes(arr, get = x => x) {
  return arr.sort((a, b) => { const ka = sizeKey(get(a)), kb = sizeKey(get(b)); return ka[0] - kb[0] || (ka[1] < kb[1] ? -1 : ka[1] > kb[1] ? 1 : 0); });
}
function signature(pts) {
  const b = bbox(pts), a = area(pts), P = perimeter(pts);
  return { aspect: b.w / (b.h || 1), fill: a / ((b.w * b.h) || 1), comp: P * P / (a || 1), b };
}
function similar(s1, s2) {
  const r = (x, y) => Math.abs(x - y) / Math.max(x, y);
  return r(s1.aspect, s2.aspect) < 0.3 && Math.abs(s1.fill - s2.fill) < 0.08 && r(s1.comp, s2.comp) < 0.15;
}
function iou(b1, b2) {
  const x0 = Math.max(b1.x, b2.x), y0 = Math.max(b1.y, b2.y), x1 = Math.min(b1.x + b1.w, b2.x + b2.w), y1 = Math.min(b1.y + b1.h, b2.y + b2.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return inter / (b1.w * b1.h + b2.w * b2.h - inter);
}

function buildPieces(parsedFiles) {
  const multi = parsedFiles.length > 1;
  const all = [];
  for (const pf of parsedFiles) for (const e of pf.entries) {
    if (!e.size && multi) {
      const sameFileSameName = pf.entries.filter(o => o.name === e.name).length;
      if (sameFileSameName === 1) e.size = sizeFromFilename(pf.file);
    }
    e.sig = signature(e.outline);
    all.push(e);
  }
  // cluster
  const clusters = [];
  for (const e of all) {
    let c = null;
    if (e.name) c = clusters.find(c => c.name && c.name.toLowerCase() === e.name.toLowerCase());
    if (!c && !e.name) c = clusters.find(c => !c.name && c.items.some(o => iou(o.sig.b, e.sig.b) > 0.45 && similar(o.sig, e.sig)))
      || clusters.find(c => !c.name && c.items.some(o => o.file !== e.file && similar(o.sig, e.sig)))
      || clusters.find(c => !c.name && !e.size && c.items.every(o => !o.size) && c.items.some(o => similar(o.sig, e.sig) && !c.items.some(x => x.file === e.file && x.group === e.group && iou(x.sig.b, e.sig.b) < 0.05)));
    if (!c) { c = { name: e.name, items: [] }; clusters.push(c); }
    c.items.push(e);
  }
  let letter = 0;
  const pieces = clusters.map(c => {
    let guessed = false;
    if (c.items.some(e => !e.size)) {
      if (c.items.every(e => !e.size)) {
        c.items.sort((a, b) => area(a.outline) - area(b.outline));
        c.items.forEach((e, i) => e.size = c.items.length === 1 ? "Base" : "Size " + (i + 1));
        guessed = c.items.length > 1;
      } else c.items.forEach((e, i) => { if (!e.size) e.size = "Size ?" + (i + 1); });
    }
    const seen = {};
    c.items.forEach(e => { const k = e.size; if (seen[k]) e.size = k + " (" + (++seen[k]) + ")"; else seen[k] = 1; });
    sortSizes(c.items, e => e.size);
    const sizes = c.items.map(e => ({ size: String(e.size), outline: e.outline, internals: e.internals, grain: e.grain, file: e.file }));
    const name = c.name || "Piece " + String.fromCharCode(65 + letter++);
    const mid = Math.floor((sizes.length - 1) / 2);
    return { name, sizes, baseIdx: mid, sizesGuessed: guessed };
  });
  return pieces;
}

/* ================= measurements ================= */
function grainAngle(sz) {
  if (!sz.grain) return 0;
  const [a, b] = sz.grain, ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
  // rotation that makes the grain line vertical
  let r = 90 - ang; r = ((r + 180) % 180 + 180) % 180; if (r > 90) r -= 180;
  return Math.abs(r) < 1 ? 0 : r;
}
function measure(sz) {
  const r = grainAngle(sz), m = M.r(r);
  const pts = r ? sz.outline.map(p => M.apply(m, p)) : sz.outline;
  const b = bbox(pts);
  return { w: b.w, h: b.h, area: area(sz.outline), bbox: bbox(sz.outline) };
}

/* ================= correspondence between two sizes ================= */
function resample(pts, n, closed = true) {
  const segs = [], L = []; let tot = 0;
  const m = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < m; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], d = hyp(b[0] - a[0], b[1] - a[1]); segs.push([a, b, d]); L.push(tot); tot += d; }
  const out = []; let k = 0;
  const count = closed ? n : n - 1;
  for (let i = 0; i < n; i++) {
    const t = tot * i / count;
    while (k < segs.length - 1 && L[k + 1] <= t) k++;
    const [a, b, d] = segs[k], u = d ? (t - L[k]) / d : 0;
    out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
  }
  return out;
}
function normalizer(pts) { const b = bbox(pts); return p => [(p[0] - b.cx) / (b.w || 1), (p[1] - b.cy) / (b.h || 1)]; }
function bestShift(A, B) { // same length arrays; find shift s minimizing sum |nA[i]-nB[i+s]|
  const nA = A.map(normalizer(A)), nB = B.map(normalizer(B)), n = A.length;
  let best = Infinity, bs = 0;
  const step = n > 400 ? Math.ceil(n / 400) : 1;
  for (let s = 0; s < n; s++) {
    let e = 0;
    for (let i = 0; i < n; i += step) { const a = nA[i], b = nB[(i + s) % n]; e += (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2; if (e > best) break; }
    if (e < best) { best = e; bs = s; }
  }
  return { shift: bs, err: best / Math.ceil(n / step) };
}
function corners(pts, ang = 28) {
  const n = pts.length, P = perimeter(pts), delta = Math.max(P * 0.008, 2);
  // cumulative arc length for neighbour lookup
  const cum = [0]; for (let i = 1; i <= n; i++) cum.push(cum[i - 1] + hyp(pts[i % n][0] - pts[i - 1][0], pts[i % n][1] - pts[i - 1][1]));
  const at = s => { s = ((s % P) + P) % P; let lo = 0, hi = n; while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; } const a = pts[lo], b = pts[(lo + 1) % n], d = cum[lo + 1] - cum[lo], u = d ? (s - cum[lo]) / d : 0; return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]; };
  const turn = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = at(cum[i] - delta), b = at(cum[i] + delta);
    const v1 = [p[0] - a[0], p[1] - a[1]], v2 = [b[0] - p[0], b[1] - p[1]];
    const t = Math.abs(Math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1[0] * v2[0] + v1[1] * v2[1])) * 180 / Math.PI;
    turn.push(t);
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    if (turn[i] < ang) continue;
    // local max within delta
    let isMax = true;
    for (let j = 1; j < n && isMax; j++) {
      const k1 = (i + j) % n, k2 = (i - j + n) % n;
      const d1 = ((cum[i + j > n ? n : i + j] ?? 0) - cum[i]);
      if (Math.min(hyp(pts[k1][0] - pts[i][0], pts[k1][1] - pts[i][1]), hyp(pts[k2][0] - pts[i][0], pts[k2][1] - pts[i][1])) > delta) break;
      if (turn[k1] > turn[i] || turn[k2] > turn[i] || (turn[k1] === turn[i] && k1 < i)) isMax = false;
      void d1;
    }
    if (isMax) out.push(i);
  }
  return out;
}
function subPath(pts, i, j) { // from index i to j inclusive going forward (cyclic)
  const out = [], n = pts.length;
  for (let k = i; ; k = (k + 1) % n) { out.push(pts[k]); if (k === j) break; }
  return out;
}
/* Returns matched point lists {A, B} (base, target), N points each */
function correspond(base, target, N = 160) {
  let T = target.slice();
  if (Math.sign(signedArea(base)) !== Math.sign(signedArea(T))) T.reverse();
  // 1. same vertex count: direct vertex match
  if (base.length === T.length && base.length >= 4) {
    const { shift, err } = bestShift(base, T);
    if (err < 0.004) {
      const n = base.length, idx = [];
      const step = n > N ? n / N : 1;
      for (let i = 0; i < Math.min(n, N); i++) idx.push(Math.floor(i * step));
      return { A: idx.map(i => base[i]), B: idx.map(i => T[(i + shift) % n]), method: "vertices" };
    }
  }
  // 2. matching corners: resample segment by segment
  const cA = corners(base), cB = corners(T);
  if (cA.length >= 3 && cA.length === cB.length) {
    const nA = normalizer(base), nB = normalizer(T), m = cA.length;
    let best = Infinity, bs = 0;
    for (let s = 0; s < m; s++) {
      let e = 0; for (let i = 0; i < m; i++) { const a = nA(base[cA[i]]), b = nB(T[cB[(i + s) % m]]); e += (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2; }
      if (e < best) { best = e; bs = s; }
    }
    if (best / m < 0.01) {
      const P = perimeter(base), A = [], B = [];
      for (let i = 0; i < m; i++) {
        const sa = subPath(base, cA[i], cA[(i + 1) % m]), sb = subPath(T, cB[(i + bs) % m], cB[(i + 1 + bs) % m]);
        const k = Math.max(3, Math.round(N * perimeter(sa, false) / P) + 1);
        const ra = resample(sa, k, false), rb = resample(sb, k, false);
        A.push(...ra.slice(0, -1)); B.push(...rb.slice(0, -1));
      }
      return { A, B, method: "corners" };
    }
  }
  // 3. arc-length fallback
  const A = resample(base, N), B0 = resample(T, N), { shift } = bestShift(A, B0);
  return { A, B: A.map((_, i) => B0[(i + shift) % N]), method: "arc length" };
}

/* ================= thin-plate spline ================= */
function solve(Ain, bs) { // Gaussian elimination, several right-hand sides
  const n = Ain.length, A = Ain.map(r => r.slice()), B = bs.map(b => b.slice());
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; for (const b of B) [b[c], b[p]] = [b[p], b[c]];
    const d = A[c][c] || 1e-12;
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / d; if (!f) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      for (const b of B) b[r] -= f * b[c];
    }
  }
  return B.map(b => { const x = new Array(n).fill(0); for (let r = n - 1; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k]; x[r] = s / (A[r][r] || 1e-12); } return x; });
}
function fitTPS(src, dst, lambda = 1e-5, maxPts = 90) {
  let S = src, D = dst;
  if (src.length > maxPts) { const st = src.length / maxPts, idx = []; for (let i = 0; i < maxPts; i++) idx.push(Math.floor(i * st)); S = idx.map(i => src[i]); D = idx.map(i => dst[i]); }
  const b = bbox(S), sc = Math.max(b.w, b.h) || 1, nz = p => [(p[0] - b.cx) / sc, (p[1] - b.cy) / sc];
  const P = S.map(nz), n = P.length;
  const U = r2 => r2 > 1e-12 ? r2 * Math.log(r2) : 0;
  const K = [];
  for (let i = 0; i < n + 3; i++) K.push(new Array(n + 3).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) K[i][j] = i === j ? lambda : U((P[i][0] - P[j][0]) ** 2 + (P[i][1] - P[j][1]) ** 2);
    K[i][n] = K[n][i] = 1; K[i][n + 1] = K[n + 1][i] = P[i][0]; K[i][n + 2] = K[n + 2][i] = P[i][1];
  }
  const bx = D.map(p => p[0]).concat([0, 0, 0]), by = D.map(p => p[1]).concat([0, 0, 0]);
  const [wx, wy] = solve(K, [bx, by]);
  const f = p => {
    const q = nz(p); let x = wx[n] + wx[n + 1] * q[0] + wx[n + 2] * q[1], y = wy[n] + wy[n + 1] * q[0] + wy[n + 2] * q[1];
    for (let i = 0; i < n; i++) { const u = U((q[0] - P[i][0]) ** 2 + (q[1] - P[i][1]) ** 2); x += wx[i] * u; y += wy[i] * u; }
    return [x, y];
  };
  return f;
}

/* ================= print transforms ================= */
const ANCHORS = {
  centre: [0.5, 0.5], top: [0.5, 0], bottom: [0.5, 1], left: [0, 0.5], right: [1, 0.5]
};
/* base placement: art (w,h mm) centred at (x,y), scaled k, rotated rot */
function baseMatrix(art, place) {
  return M.chain(M.t(place.x, place.y), M.r(place.rot || 0), M.s(place.k), M.t(-art.w / 2, -art.h / 2));
}
function anchorPoint(sz, anchor, tps) {
  if (anchor.type === "point" && anchor.pt) return tps ? tps(anchor.pt) : anchor.pt;
  const b = bbox(sz.outline), r = ANCHORS[anchor.type] || ANCHORS.centre;
  return [b.x + b.w * r[0], b.y + b.h * r[1]];
}
/* Main entry: how the print sits on size i.
   ctx: { piece, art, mapCache } ; returns { kind:'affine', m, sx, sy } or { kind:'warp', fn, approx } */
function sizeTransform(piece, art, i, cache) {
  const base = piece.sizes[piece.baseIdx], sz = piece.sizes[i];
  const M0 = baseMatrix(art, piece.place);
  const adj = (piece.adj && piece.adj[sz.size]) || { m: 1, dx: 0, dy: 0 };
  if (i === piece.baseIdx) return { kind: "affine", m: M0, sx: 1, sy: 1, A: anchorPoint(base, piece.rule.anchor), adj: { m: 1, dx: 0, dy: 0 } };
  const rule = piece.rule;
  const needTPS = rule.mode === "warp" || rule.anchor.type === "point";
  const tps = needTPS ? getTPS(piece, i, cache) : null;
  const A0 = anchorPoint(base, rule.anchor), Ai = anchorPoint(sz, rule.anchor, tps);
  const mb = measure(base), mi = measure(sz);
  let sx = 1, sy = 1;
  if (rule.mode === "uniform") {
    const s = rule.measure === "width" ? mi.w / mb.w : rule.measure === "length" ? mi.h / mb.h : rule.measure === "area" ? Math.sqrt(mi.area / mb.area) : Math.sqrt((mi.w * mi.h) / (mb.w * mb.h));
    sx = sy = s;
  } else if (rule.mode === "fit") { sx = mi.w / mb.w; sy = mi.h / mb.h; }
  else if (rule.mode === "warp") { sx = mi.w / mb.w; sy = mi.h / mb.h; }
  const manual = M.chain(M.t(Ai[0] + adj.dx, Ai[1] + adj.dy), M.s(adj.m), M.t(-Ai[0], -Ai[1]));
  if (rule.mode === "warp") {
    const fn = p => M.apply(manual, tps(M.apply(M0, p)));
    return { kind: "warp", fn, M0, tps, manual, sx: sx * adj.m, sy: sy * adj.m, A: [Ai[0] + adj.dx, Ai[1] + adj.dy], adj };
  }
  // grain-aligned scaling for 'fit' when grain is rotated
  const g = grainAngle(base);
  const S = g && sx !== sy ? M.chain(M.r(-g), M.s(sx, sy), M.r(g)) : M.s(sx, sy);
  const G = M.chain(M.t(Ai[0], Ai[1]), S, M.t(-A0[0], -A0[1]));
  return { kind: "affine", m: M.chain(manual, G, M0), sx: sx * adj.m, sy: sy * adj.m, A: [Ai[0] + adj.dx, Ai[1] + adj.dy], G, adj };
}
function getTPS(piece, i, cache) {
  const base = piece.sizes[piece.baseIdx], sz = piece.sizes[i];
  const key = piece.id + "|" + base.size + "|" + sz.size;
  if (cache && cache[key]) return cache[key];
  const c = correspond(base.outline, sz.outline);
  const f = fitTPS(c.A, c.B);
  f.method = c.method;
  if (cache) cache[key] = f;
  return f;
}
/* auto transform of the base outline into size i (for the "compare" ghost) */
function ghostMatrix(piece, i, cache) {
  const fakeArt = { w: 0, h: 0 };
  const saved = piece.place; piece.place = { x: 0, y: 0, k: 1, rot: 0 };
  const savedAdj = piece.adj; piece.adj = {};
  const savedRule = piece.rule;
  if (piece.rule.mode === "warp") piece.rule = { ...piece.rule, mode: "uniform", measure: "avg" };
  const t = sizeTransform(piece, fakeArt, i, cache);
  piece.place = saved; piece.adj = savedAdj; piece.rule = savedRule;
  return t.m;
}

/* ================= offset outline (bleed) via simple vertex normals, used if Clipper isn't loaded ================= */
function offsetSimple(pts, d) {
  if (!d) return pts;
  const n = pts.length, out = [], s = Math.sign(signedArea(pts)) || 1;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], p = pts[i], b = pts[(i + 1) % n];
    const n1 = norm([(p[1] - a[1]) * s, -(p[0] - a[0]) * s]), n2 = norm([(b[1] - p[1]) * s, -(b[0] - p[0]) * s]);
    let nx = n1[0] + n2[0], ny = n1[1] + n2[1]; const l = hyp(nx, ny) || 1; nx /= l; ny /= l;
    const cos = nx * n1[0] + ny * n1[1], k = d / Math.max(cos, 0.35);
    out.push([p[0] + nx * k, p[1] + ny * k]);
  }
  return out;
}
function norm(v) { const l = hyp(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }

/* ================= PNG pHYs (DPI) ================= */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC_T[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function pngSetDPI(u8, dpi) {
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21), dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9); chunk.set([112, 72, 89, 115], 4); dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));
  // strip existing pHYs, insert after IHDR (8 sig + 25 IHDR)
  const parts = [u8.subarray(0, 33)]; let i = 33;
  parts.push(chunk);
  while (i < u8.length) {
    const len = new DataView(u8.buffer, u8.byteOffset + i).getUint32(0), type = String.fromCharCode(...u8.subarray(i + 4, i + 8));
    if (type !== "pHYs") parts.push(u8.subarray(i, i + 12 + len));
    i += 12 + len;
  }
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function readImageDPI(u8) {
  if (u8[0] === 0x89 && u8[1] === 0x50) { // PNG
    let i = 8;
    while (i + 8 < u8.length) {
      const dv = new DataView(u8.buffer, u8.byteOffset + i), len = dv.getUint32(0), type = String.fromCharCode(...u8.subarray(i + 4, i + 8));
      if (type === "pHYs") { const ppx = dv.getUint32(8), unit = u8[i + 16]; return unit === 1 ? Math.round(ppx * 0.0254) : null; }
      if (type === "IDAT") break;
      i += 12 + len;
    }
  } else if (u8[0] === 0xFF && u8[1] === 0xD8) { // JPEG: JFIF APP0
    let i = 2;
    while (i + 4 < u8.length && u8[i] === 0xFF) {
      const marker = u8[i + 1], len = (u8[i + 2] << 8) | u8[i + 3];
      if (marker === 0xE0 && String.fromCharCode(...u8.subarray(i + 4, i + 9)) === "JFIF\0") {
        const units = u8[i + 11], xd = (u8[i + 12] << 8) | u8[i + 13];
        if (units === 1 && xd > 1) return xd; if (units === 2 && xd > 1) return Math.round(xd * 2.54);
      }
      if (marker === 0xDA) break;
      i += 2 + len;
    }
  }
  return null;
}
/* SVG physical size in mm */
function svgSizeMM(svgText) {
  const head = svgText.slice(0, 4000);
  const illustrator = /Adobe Illustrator/i.test(head);
  const tag = (svgText.match(/<svg\b[^>]*>/i) || [""])[0];
  const attr = n => { const m = tag.match(new RegExp("\\s" + n + "\\s*=\\s*[\"']([^\"']+)[\"']", "i")); return m ? m[1] : null; };
  const vb = (attr("viewBox") || "").split(/[\s,]+/).map(Number).filter(v => !isNaN(v));
  const toMM = v => {
    if (!v) return null; const m = String(v).match(/^\s*([\d.]+)\s*([a-z%]*)\s*$/i); if (!m) return null;
    const n = parseFloat(m[1]), u = m[2].toLowerCase();
    return u === "mm" ? n : u === "cm" ? n * 10 : u === "in" ? n * 25.4 : u === "pt" ? n * 25.4 / 72 : u === "pc" ? n * 25.4 / 6 : u === "%" ? null : n * 25.4 / (illustrator ? 72 : 96);
  };
  let w = toMM(attr("width")), h = toMM(attr("height"));
  if (vb.length === 4) {
    if (w && !h) h = w * vb[3] / vb[2];
    if (h && !w) w = h * vb[2] / vb[3];
    if (!w && !h) { const k = 25.4 / (illustrator ? 72 : 96); w = vb[2] * k; h = vb[3] * k; }
  }
  return { w: w || 200, h: h || 200, viewBox: vb.length === 4 ? vb : [0, 0, w || 200, h || 200], known: !!(attr("width") || vb.length === 4), illustrator };
}

return { bbox, area, signedArea, perimeter, pointInPoly, centroid, nearestOnPoly, dedupe, M, readDXF, parseDXF, buildPieces, sortSizes, measure, grainAngle,
  correspond, corners, resample, fitTPS, sizeTransform, getTPS, baseMatrix, anchorPoint, ghostMatrix, offsetSimple, pngSetDPI, readImageDPI, svgSizeMM, sizeFromFilename, crc32 };
})();
if (typeof module !== "undefined") module.exports = Engine;
