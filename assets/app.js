(() => {
"use strict";
const E = Engine, Mx = E.M;
const $ = s => document.querySelector(s);
const LIB = {
  zip: "vendor/jszip.min.js",
  clipper: "vendor/clipper.js",
  utif: "vendor/UTIF.js",
  pako: "vendor/pako_inflate.min.js"
};
const RULES = [
  { id: "uniform", name: "Scale evenly", hint: "Motifs keep exactly the same proportions. One scale per size, from the piece's growth." },
  { id: "fit", name: "Stretch to fit", hint: "Width and length scale separately, like the pattern. Motifs stretch slightly." },
  { id: "warp", name: "Follow the shape", hint: "The print bends with the pattern so it meets the same seams and points in every size." },
  { id: "keep", name: "Keep print size", hint: "No scaling, only re-positioned. For all-over repeats where motif size must not change." }
];
const ANCHORS = [["centre", "Centre of piece"], ["top", "Top centre (waist / neck)"], ["bottom", "Bottom centre (hem)"], ["left", "Left edge"], ["right", "Right edge"], ["point", "A point I choose…"]];
const MEASURES = [["avg", "Average"], ["width", "Width"], ["length", "Length"]];
const EXTS = [["none", "Leave empty"], ["repeat", "Repeat the print"], ["mirror", "Mirror the print"], ["edge", "Extend the edges"], ["ground", "Fill with ground colour"]];
const EXT_HINT = {
  none: "Where the artwork doesn't reach the bleed line, the piece stays empty and the size is flagged.",
  repeat: "The artwork tiles in every direction, motifs at the same size. Best for all-over repeats.",
  mirror: "The artwork is reflected at its edges, so there's no visible join. Good for grounds and textures.",
  edge: "The outermost row of the artwork is stretched outwards. Good when the edges are plain or a gradient.",
  ground: "The piece is filled with one colour under the artwork, taken from the artwork's edge. Change it if needed."
};
const extOf = p => (p && p.extend) || { mode: "none", color: null };
const extLabel = p => EXTS.find(e => e[0] === extOf(p).mode)[1];
function groundColor(p) { const a = artOf(p); return extOf(p).color || (a && a.edgeColor) || "#ffffff"; }

/* ================= state ================= */
const S = { files: [], unitOverride: null, unitInfo: null, pieces: [], arts: {}, pi: 0, si: 0, bleed: 10, dpi: 150,
  zoom: 1, pan: [0, 0], outside: true, compare: false, tool: "move", picking: false, example: false };
let tpsCache = {}, bleedCache = {};
const P = () => S.pieces[S.pi];
const artOf = p => (p && p.artId && S.arts[p.artId] && S.arts[p.artId].ready) ? S.arts[p.artId] : null;
const uid = () => Math.random().toString(36).slice(2, 9);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const f1 = v => (Math.round(v * 10) / 10).toFixed(1);
const f0 = v => String(Math.round(v));
const pct = v => (v * 100).toFixed(1) + " %";
const sign = v => (v > 0 ? "+" : v < 0 ? "−" : "±") + Math.abs(v).toFixed(0);

function toast(msg, ms = 3800) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, ms);
}
function loadLib(url, global) {
  if (window[global]) return Promise.resolve(window[global]);
  return new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = url; s.async = true;
    s.onload = () => window[global] ? res(window[global]) : rej(new Error("Library did not load"));
    s.onerror = () => rej(new Error("Couldn't load a helper library. Check the connection and try again."));
    document.head.appendChild(s);
  });
}

/* ================= transforms ================= */
function tf(p, i) { const a = artOf(p); return a ? E.sizeTransform(p, a, i, tpsCache) : null; }
const mapFn = t => t.kind === "affine" ? (q => Mx.apply(t.m, q)) : t.fn;
function bleedOf(p, i) {
  const key = p.id + "|" + p.sizes[i].size + "|" + S.bleed + "|" + (window.ClipperLib ? 1 : 0);
  if (bleedCache[key]) return bleedCache[key];
  const o = p.sizes[i].outline; let r = o;
  if (S.bleed > 0) {
    r = E.offsetSimple(o, S.bleed);
    if (window.ClipperLib) {
      try {
        const C = window.ClipperLib, sc = 100;
        const path = o.map(([x, y]) => ({ X: Math.round(x * sc), Y: Math.round(y * sc) }));
        if (!C.Clipper.Orientation(path)) path.reverse();
        const co = new C.ClipperOffset(2, 0.2 * sc);
        co.AddPath(path, C.JoinType.jtRound, C.EndType.etClosedPolygon);
        const sol = new C.Paths(); co.Execute(sol, S.bleed * sc);
        const best = sol.sort((a, b) => Math.abs(C.Clipper.Area(b)) - Math.abs(C.Clipper.Area(a)))[0];
        if (best && best.length > 2) r = best.map(q => [q.X / sc, q.Y / sc]);
      } catch (e) { /* keep simple offset */ }
    }
  }
  return bleedCache[key] = r;
}
function coverage(p, i) {
  const art = artOf(p); if (!art) return null;
  const f = mapFn(tf(p, i)), ring = [], n = 48;
  for (let k = 0; k < n; k++) ring.push(f([art.w * k / n, 0]));
  for (let k = 0; k < n; k++) ring.push(f([art.w, art.h * k / n]));
  for (let k = 0; k < n; k++) ring.push(f([art.w * (1 - k / n), art.h]));
  for (let k = 0; k < n; k++) ring.push(f([0, art.h * (1 - k / n)]));
  const pts = E.resample(bleedOf(p, i), 140);
  const miss = pts.filter(q => !E.pointInPoly(q, ring) && E.nearestOnPoly(q, ring).d > 0.6);
  return { ok: !miss.length, miss };
}
function growth(p, i) {
  const mb = E.measure(p.sizes[p.baseIdx]), mi = E.measure(p.sizes[i]);
  return { w: mi.w, h: mi.h, dw: mi.w - mb.w, dh: mi.h - mb.h, rw: mi.w / mb.w, rh: mi.h / mb.h };
}
const isAdjusted = (p, sz) => { const a = p.adj[sz]; return !!a && (Math.abs(a.m - 1) > 1e-6 || Math.abs(a.dx) > 1e-6 || Math.abs(a.dy) > 1e-6); };
function scaleText(t, p) {
  if (!t) return "";
  const k = p.place.k;
  if (Math.abs(t.sx - t.sy) < 1e-4) return pct(t.sx);
  return (t.sx * 100).toFixed(1) + "×" + (t.sy * 100).toFixed(1) + " %";
}

/* ================= loading ================= */
function newPiece(bp) {
  return { id: uid(), name: bp.name, sizes: bp.sizes, baseIdx: bp.baseIdx, sizesGuessed: bp.sizesGuessed, artId: null, place: null,
    rule: { mode: "uniform", measure: "avg", anchor: { type: "centre", pt: null } }, adj: {}, sizeNames: null, extend: { mode: "none", color: null } };
}
function reparse(keep) {
  const old = keep || S.pieces;
  let parsed;
  try { parsed = S.files.map(f => E.parseDXF(f.text, f.name, S.unitOverride)); }
  catch (e) { console.error(e); toast("This DXF couldn't be read. Re-export it as DXF (AAMA or ASTM) and try again."); return false; }
  const built = E.buildPieces(parsed);
  S.unitInfo = parsed[0] ? { unit: parsed[0].unit, source: parsed[0].unitSource } : null;
  S.pieces = built.map(bp => {
    const p = newPiece(bp);
    const o = old.find(q => q.name === bp.name);
    if (o && o.sizeNames && o.sizeNames.length === p.sizes.length) { p.sizeNames = o.sizeNames; p.sizes.forEach((s, k) => s.size = o.sizeNames[k]); }
    if (o) {
      p.id = o.id; p.artId = o.artId; p.place = o.place; p.rule = o.rule; p.adj = o.adj || {}; p.extend = o.extend || p.extend;
      const bi = p.sizes.findIndex(s => s.size === (o.baseSize || (o.sizes && o.sizes[o.baseIdx] && o.sizes[o.baseIdx].size)));
      if (bi >= 0) p.baseIdx = bi;
    }
    return p;
  });
  tpsCache = {}; bleedCache = {};
  if (S.pi >= S.pieces.length) S.pi = 0;
  const p = P(); if (p && S.si >= p.sizes.length) S.si = p.baseIdx;
  return S.pieces.length > 0;
}
async function openDXF(files) {
  const list = [];
  for (const f of files) list.push({ name: f.name, text: await f.text() });
  if (!list.length) return;
  if (S.example) clearAll(true);
  // a re-opened file with the same name replaces the old one
  for (const f of list) { const k = S.files.findIndex(x => x.name === f.name); if (k >= 0) S.files[k] = f; else S.files.push(f); }
  const before = S.pieces.length;
  if (!reparse()) {
    S.files = S.files.filter(f => !list.includes(f)); reparse();
    toast("No closed pattern outlines found. Export the pattern from CAD as DXF (AAMA or ASTM) with the cut line included.", 6000);
  } else {
    if (!before) { S.pi = 0; S.si = P().baseIdx; }
    const n = S.pieces.reduce((s, p) => s + p.sizes.length, 0);
    toast(`Read ${S.pieces.length} piece${S.pieces.length > 1 ? "s" : ""}, ${n} outlines in total.`);
  }
  S.zoom = 1; S.pan = [0, 0];
  save(); renderAll();
}
function clearAll(silent) {
  S.files = []; S.pieces = []; S.arts = {}; S.pi = 0; S.si = 0; S.example = false; S.unitOverride = null;
  tpsCache = {}; bleedCache = {};
  if (!silent) { save(); renderAll(); }
}

/* ---- artwork ---- */
function u8ToB64(u8) { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function svgWithSize(text, wpx, hpx) {
  return text.replace(/<svg\b([^>]*)>/i, (m, attrs) => {
    let a = attrs.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, "");
    if (!/viewBox/i.test(a)) a += "";
    return `<svg${a} width="${Math.round(wpx)}" height="${Math.round(hpx)}">`;
  });
}
function loadImage(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Image could not be decoded")); i.src = src; }); }
async function svgImage(art, wpx) {
  const hpx = wpx * art.h / art.w;
  const url = URL.createObjectURL(new Blob([svgWithSize(art.src, wpx, hpx)], { type: "image/svg+xml" }));
  try { return await loadImage(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 30000); }
}
function rasterize(img, wpx, hpx) {
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(wpx)); c.height = Math.max(1, Math.round(hpx));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); return c;
}
async function prepareArt(art) {
  // preview sources: img (crisp, for straight transforms) and prev (canvas, for the bent mesh and thumbnails)
  if (art.kind === "svg") {
    const dims = E.svgSizeMM(art.src); art.vb = dims.viewBox;
    if (!art.w) { art.w = dims.w; art.h = dims.h; art.known = dims.known; }
    const pw = Math.min(2600, Math.max(800, art.w * 4));
    art.img = await svgImage(art, pw);
    art.prev = rasterize(art.img, pw, pw * art.h / art.w);
    const doc = new DOMParser().parseFromString(art.src, "image/svg+xml"), root = doc.documentElement;
    if (root.nodeName.toLowerCase() !== "svg" || doc.querySelector("parsererror")) throw new Error("This SVG could not be read");
    const keepAttrs = Array.from(root.attributes).filter(a => !/^(xmlns.*|width|height|viewBox|x|y|version|id|preserveAspectRatio|enable-background|xml:space)$/i.test(a.name));
    const ser = new XMLSerializer();
    art.inner = (keepAttrs.length ? `<g ${keepAttrs.map(a => `${a.name}="${esc(a.value)}"`).join(" ")}>` : "") + Array.from(root.childNodes).map(n => ser.serializeToString(n)).join("") + (keepAttrs.length ? "</g>" : "");
  } else {
    art.full = await loadImage(art.src);
    art.nw = art.full.naturalWidth; art.nh = art.full.naturalHeight;
    if (!art.w) {
      const dpi = art.dpi || 150; art.known = !!art.dpi;
      art.w = art.nw / dpi * 25.4; art.h = art.nh / dpi * 25.4;
    }
    const sc = Math.min(1, 2600 / Math.max(art.nw, art.nh));
    art.prev = sc < 1 ? rasterize(art.full, art.nw * sc, art.nh * sc) : art.full;
    art.img = art.prev;
  }
  art.pw = art.prev.width || art.prev.naturalWidth; art.ph = art.prev.height || art.prev.naturalHeight;
  try { art.thumb = (art.prev.toDataURL ? art.prev : rasterize(art.prev, art.pw, art.ph)); const t = rasterize(art.thumb, 160, 160 * art.ph / art.pw); art.thumbURL = t.toDataURL("image/png"); } catch (e) { art.thumbURL = ""; }
  try { // most common colour along the artwork's border, for "Fill with ground colour"
    const sm = rasterize(art.prev, 48, Math.max(1, Math.round(48 * art.ph / art.pw))), W = sm.width, H = sm.height;
    const d = sm.getContext("2d").getImageData(0, 0, W, H).data, buckets = {};
    const add = (x, y) => { const k = (y * W + x) * 4; if (d[k + 3] < 128) return; const key = (d[k] >> 4) + "," + (d[k + 1] >> 4) + "," + (d[k + 2] >> 4); const b = buckets[key] || (buckets[key] = { n: 0, r: 0, g: 0, b: 0 }); b.n++; b.r += d[k]; b.g += d[k + 1]; b.b += d[k + 2]; };
    for (let x = 0; x < W; x++) { add(x, 0); add(x, H - 1); }
    for (let y = 0; y < H; y++) { add(0, y); add(W - 1, y); }
    const best = Object.values(buckets).sort((a, b) => b.n - a.n)[0];
    art.edgeColor = best ? "#" + [best.r, best.g, best.b].map(v => Math.round(v / best.n).toString(16).padStart(2, "0")).join("") : null;
  } catch (e) { art.edgeColor = null; }
  art.ready = true;
  return art;
}
async function readArtFile(file) {
  const name = file.name, ext = (name.split(".").pop() || "").toLowerCase();
  const buf = new Uint8Array(await file.arrayBuffer());
  let art;
  if (ext === "svg" || file.type === "image/svg+xml") {
    art = { id: uid(), name, kind: "svg", src: new TextDecoder().decode(buf) };
  } else if (ext === "tif" || ext === "tiff") {
    await loadLib(LIB.pako, "pako"); // must load before UTIF: ZIP-compressed TIFFs from Photoshop
    const UTIF = await loadLib(LIB.utif, "UTIF");
    const ifds = UTIF.decode(buf.buffer); const ifd = ifds[0]; UTIF.decodeImage(buf.buffer, ifd);
    const rgba = UTIF.toRGBA8(ifd), c = document.createElement("canvas"); c.width = ifd.width; c.height = ifd.height;
    c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer), ifd.width, ifd.height), 0, 0);
    let dpi = null;
    if (ifd.t282 && ifd.t282[0]) { dpi = ifd.t282[0]; if (ifd.t296 && ifd.t296[0] === 3) dpi = dpi * 2.54; }
    art = { id: uid(), name, kind: "raster", src: c.toDataURL("image/png"), dpi: dpi ? Math.round(dpi) : null };
  } else {
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    art = { id: uid(), name, kind: "raster", src: "data:" + (file.type || mime) + ";base64," + u8ToB64(buf), dpi: E.readImageDPI(buf) };
  }
  return prepareArt(art);
}
function defaultPlace(p, art) {
  const b = E.bbox(p.sizes[p.baseIdx].outline);
  let k = 1;
  const ratio = art.w / b.w;
  if (!art.known || ratio < 0.4 || ratio > 2.5) k = Math.max((b.w + 2 * S.bleed) / art.w, (b.h + 2 * S.bleed) / art.h);
  return { x: b.cx, y: b.cy, k, rot: 0 };
}
async function setArt(file) {
  const p = P(); if (!p) { toast("Open a pattern DXF first, then add the print."); return; }
  try {
    toast("Reading " + file.name + "…", 20000);
    const art = await readArtFile(file);
    S.arts[art.id] = art;
    const prev = p.artId; p.artId = art.id; p.place = defaultPlace(p, art); p.adj = {};
    if (prev && !S.pieces.some(q => q.artId === prev)) delete S.arts[prev];
    S.si = p.baseIdx;
    toast(art.known && Math.abs(p.place.k - 1) < 1e-9 ? `Placed at real size (${f0(art.w)} × ${f0(art.h)} mm). Drag it into position on size ${p.sizes[p.baseIdx].size}.` : art.known ? `The file says ${f0(art.w)} × ${f0(art.h)} mm, far from the piece size, so it's fitted to the piece. "Real size" on the right puts it back.` : `Print size wasn't stored in the file, so it's fitted to the piece. Set the real width on the right if you know it.`, 6000);
    save(); renderAll();
  } catch (e) { console.error(e); toast("That artwork couldn't be read. Use SVG, PNG, JPG or TIFF."); }
}

/* ================= drawing ================= */
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
let COL = {};
function readColours() { COL = { mat: css("--mat"), mline: css("--mat-line"), mline2: css("--mat-line-strong"), piece: css("--piece"), cut: css("--cut"), bleed: css("--bleed"), ghost: css("--ghost"), accent: css("--accent"), warn: css("--warn"), muted: css("--muted"), surface: css("--surface") }; }
function path(c, pts) { c.beginPath(); pts.forEach((q, k) => k ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])); c.closePath(); }
function poly(c, pts) { c.beginPath(); pts.forEach((q, k) => k ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])); }
function tri(c, src, s, d, ex) {
  const [s0, s1, s2] = s, [d0, d1, d2] = d;
  const du1 = s1[0] - s0[0], dv1 = s1[1] - s0[1], du2 = s2[0] - s0[0], dv2 = s2[1] - s0[1];
  const det = du1 * dv2 - du2 * dv1; if (Math.abs(det) < 1e-9) return;
  const dx1 = d1[0] - d0[0], dy1 = d1[1] - d0[1], dx2 = d2[0] - d0[0], dy2 = d2[1] - d0[1];
  const a = (dx1 * dv2 - dx2 * dv1) / det, cc = (dx2 * du1 - dx1 * du2) / det, b = (dy1 * dv2 - dy2 * dv1) / det, dd = (dy2 * du1 - dy1 * du2) / det;
  const e = d0[0] - a * s0[0] - cc * s0[1], f = d0[1] - b * s0[0] - dd * s0[1];
  const gx = (d0[0] + d1[0] + d2[0]) / 3, gy = (d0[1] + d1[1] + d2[1]) / 3;
  c.save(); c.beginPath();
  [d0, d1, d2].forEach((q, k) => { const vx = q[0] - gx, vy = q[1] - gy, l = Math.hypot(vx, vy) || 1, x = q[0] + vx / l * ex, y = q[1] + vy / l * ex; k ? c.lineTo(x, y) : c.moveTo(x, y); });
  c.closePath(); c.clip();
  c.transform(a, b, cc, dd, e, f);
  const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
  const x0 = Math.max(0, Math.floor(Math.min(s0[0], s1[0], s2[0])) - 1), y0 = Math.max(0, Math.floor(Math.min(s0[1], s1[1], s2[1])) - 1);
  const x1 = Math.min(sw, Math.ceil(Math.max(s0[0], s1[0], s2[0])) + 1), y1 = Math.min(sh, Math.ceil(Math.max(s0[1], s1[1], s2[1])) + 1);
  if (x1 > x0 && y1 > y0) c.drawImage(src, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  c.restore();
}
/* Bent print (Follow the shape): a WebGL texture-mapped mesh, drawn tile by tile into the 2D canvas.
   Falls back to clipped canvas triangles where WebGL isn't available. */
const GLW = { gl: null, failed: false, tex: null, texSrc: null, buf: null, tile: 2048 };
function glInit() {
  if (GLW.gl || GLW.failed) return GLW.gl;
  try {
    const cv = document.createElement("canvas");
    const gl = cv.getContext("webgl", { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error("no webgl");
    const sh = (type, src) => { const x = gl.createShader(type); gl.shaderSource(x, src); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, "attribute vec2 p;attribute vec2 uv;uniform vec4 r;varying vec2 v;void main(){v=uv;vec2 q=(p-r.xy)/r.zw;gl_Position=vec4(q.x*2.0-1.0,1.0-q.y*2.0,0.0,1.0);}"));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, "#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\nvarying vec2 v;uniform sampler2D t;uniform float m;void main(){vec2 u=v;if(m<0.5){if(u.x<0.0||u.x>1.0||u.y<0.0||u.y>1.0)discard;}else if(m<1.5){u=fract(u);}else if(m<2.5){u=1.0-abs(mod(u,2.0)-1.0);}else{u=clamp(u,0.0,1.0);}gl_FragColor=texture2D(t,u);}"));
    gl.linkProgram(prog); if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link");
    gl.useProgram(prog);
    GLW.loc = { p: gl.getAttribLocation(prog, "p"), uv: gl.getAttribLocation(prog, "uv"), r: gl.getUniformLocation(prog, "r"), m: gl.getUniformLocation(prog, "m") };
    GLW.buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, GLW.buf);
    gl.enableVertexAttribArray(GLW.loc.p); gl.vertexAttribPointer(GLW.loc.p, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(GLW.loc.uv); gl.vertexAttribPointer(GLW.loc.uv, 2, gl.FLOAT, false, 16, 8);
    GLW.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, GLW.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    GLW.maxTex = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 16384);
    const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS); GLW.tile = Math.min(2048, vp[0], vp[1]);
    gl.disable(gl.BLEND);
    GLW.gl = gl;
  } catch (e) { GLW.failed = true; console.warn("WebGL unavailable, using canvas triangles", e); }
  return GLW.gl;
}
const WRAP = { none: 0, ground: 0, repeat: 1, mirror: 2, edge: 3 };
function warpGL(c, src, art, fn, N, Rg, ext) {
  Rg = Rg || [0, 0, art.w, art.h];
  const gl = glInit(); if (!gl || !c.getTransform) return false;
  const T = c.getTransform(); if (Math.abs(T.b) > 1e-9 || Math.abs(T.c) > 1e-9 || T.a <= 0 || T.d <= 0) return false;
  if (GLW.texSrc !== src) {
    let s2 = src; const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
    if (Math.max(sw, sh) > GLW.maxTex) { const k = GLW.maxTex / Math.max(sw, sh); s2 = rasterize(src, sw * k, sh * k); }
    gl.bindTexture(gl.TEXTURE_2D, GLW.tex);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, s2); } catch (e) { return false; }
    GLW.texSrc = src;
  }
  const pts = []; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const gx = u => Rg[0] + (Rg[2] - Rg[0]) * u / N, gy = v => Rg[1] + (Rg[3] - Rg[1]) * v / N;
  for (let v = 0; v <= N; v++) for (let u = 0; u <= N; u++) {
    const q = fn([gx(u), gy(v)]); pts.push(q);
    if (q[0] < x0) x0 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[0] > x1) x1 = q[0]; if (q[1] > y1) y1 = q[1];
  }
  const cw = c.canvas.width, ch = c.canvas.height;
  const dx0 = Math.max(0, Math.floor(x0 * T.a + T.e)), dy0 = Math.max(0, Math.floor(y0 * T.d + T.f));
  const dx1 = Math.min(cw, Math.ceil(x1 * T.a + T.e)), dy1 = Math.min(ch, Math.ceil(y1 * T.d + T.f));
  if (dx1 <= dx0 || dy1 <= dy0) return true;
  const data = new Float32Array(N * N * 6 * 4); let o = 0;
  const put = (i, u, v) => { data[o++] = pts[i][0]; data[o++] = pts[i][1]; data[o++] = gx(u) / art.w; data[o++] = gy(v) / art.h; };
  for (let v = 0; v < N; v++) for (let u = 0; u < N; u++) {
    const i0 = v * (N + 1) + u, i1 = i0 + 1, i2 = i0 + N + 1, i3 = i2 + 1;
    put(i0, u, v); put(i1, u + 1, v); put(i3, u + 1, v + 1); put(i0, u, v); put(i3, u + 1, v + 1); put(i2, u, v + 1);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, GLW.buf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  gl.uniform1f(GLW.loc.m, WRAP[ext || "none"] || 0);
  const ts = GLW.tile;
  for (let ty = dy0; ty < dy1; ty += ts) for (let tx = dx0; tx < dx1; tx += ts) {
    const tw = Math.min(ts, dx1 - tx), th = Math.min(ts, dy1 - ty);
    if (gl.canvas.width !== tw || gl.canvas.height !== th) { gl.canvas.width = tw; gl.canvas.height = th; }
    gl.viewport(0, 0, tw, th);
    gl.uniform4f(GLW.loc.r, (tx - T.e) / T.a, (ty - T.f) / T.d, tw / T.a, th / T.d);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, N * N * 6);
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(gl.canvas, 0, 0, tw, th, tx, ty, tw, th); c.restore();
  }
  return true;
}
function drawWarp(c, src, art, fn, pxPerMM, N, Rg, ext) {
  if (warpGL(c, src, art, fn, Math.max(N, 24), Rg, ext)) return;
  N = Math.min(N, 40);
  const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight, P2 = [];
  for (let v = 0; v <= N; v++) for (let u = 0; u <= N; u++) P2.push(fn([art.w * u / N, art.h * v / N]));
  const ex = 0.7 / pxPerMM;
  for (let v = 0; v < N; v++) for (let u = 0; u < N; u++) {
    const i0 = v * (N + 1) + u, i1 = i0 + 1, i2 = i0 + N + 1, i3 = i2 + 1;
    const s0 = [sw * u / N, sh * v / N], s1 = [sw * (u + 1) / N, sh * v / N], s2 = [sw * u / N, sh * (v + 1) / N], s3 = [sw * (u + 1) / N, sh * (v + 1) / N];
    tri(c, src, [s0, s1, s3], [P2[i0], P2[i1], P2[i3]], ex);
    tri(c, src, [s0, s3, s2], [P2[i0], P2[i3], P2[i2]], ex);
  }
}
/* ---- extending the artwork where it runs out ---- */
// the part of artwork space (mm, artwork frame) needed to cover this size's bleed area
function artRegion(p, i, t, art) {
  const ext = extOf(p).mode;
  if (ext === "none" || ext === "ground") return [0, 0, art.w, art.h];
  const b = E.bbox(bleedOf(p, i));
  let inv;
  if (t.kind === "affine") inv = Mx.inv(t.m);
  else { const f = t.fn, o = f([0, 0]), ax = f([art.w, 0]), ay = f([0, art.h]); inv = Mx.inv([(ax[0] - o[0]) / art.w, (ax[1] - o[1]) / art.w, (ay[0] - o[0]) / art.h, (ay[1] - o[1]) / art.h, o[0], o[1]]); }
  let X0 = 0, Y0 = 0, X1 = art.w, Y1 = art.h;
  for (const q of [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]) {
    const r = Mx.apply(inv, q); X0 = Math.min(X0, r[0]); Y0 = Math.min(Y0, r[1]); X1 = Math.max(X1, r[0]); Y1 = Math.max(Y1, r[1]);
  }
  const pad = (t.kind === "affine" ? 0.03 : 0.12) * Math.max(art.w, art.h), lim = 40;
  return [Math.max(X0 - pad, -lim * art.w), Math.max(Y0 - pad, -lim * art.h), Math.min(X1 + pad, (lim + 1) * art.w), Math.min(Y1 + pad, (lim + 1) * art.h)];
}
const MIRROR = new WeakMap();
function mirrored(src) { // 2 × 2 tile: original, flipped across, flipped down, flipped both
  if (MIRROR.has(src)) return MIRROR.get(src);
  const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight, k = Math.min(1, 8192 / (2 * Math.max(sw, sh)));
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
  const cv = document.createElement("canvas"); cv.width = 2 * w; cv.height = 2 * h; const x = cv.getContext("2d");
  [[0, 0, 1, 1], [2 * w, 0, -1, 1], [0, 2 * h, 1, -1], [2 * w, 2 * h, -1, -1]].forEach(([tx, ty, a, d]) => { x.setTransform(a, 0, 0, d, tx, ty); x.drawImage(src, 0, 0, w, h); });
  MIRROR.set(src, cv); return cv;
}
function drawEdges(c, src, art, Rg) { // stretch the outermost pixel row/column outwards
  const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight, [X0, Y0, X1, Y1] = Rg, w = art.w, h = art.h, ov = Math.min(w, h) * 0.003;
  if (X0 < 0) c.drawImage(src, 0, 0, 1, sh, X0, 0, -X0 + ov, h);
  if (X1 > w) c.drawImage(src, sw - 1, 0, 1, sh, w - ov, 0, X1 - w + ov, h);
  if (Y0 < 0) c.drawImage(src, 0, 0, sw, 1, 0, Y0, w, -Y0 + ov);
  if (Y1 > h) c.drawImage(src, 0, sh - 1, sw, 1, 0, h - ov, w, Y1 - h + ov);
  if (X0 < 0 && Y0 < 0) c.drawImage(src, 0, 0, 1, 1, X0, Y0, -X0 + ov, -Y0 + ov);
  if (X1 > w && Y0 < 0) c.drawImage(src, sw - 1, 0, 1, 1, w - ov, Y0, X1 - w + ov, -Y0 + ov);
  if (X0 < 0 && Y1 > h) c.drawImage(src, 0, sh - 1, 1, 1, X0, h - ov, -X0 + ov, Y1 - h + ov);
  if (X1 > w && Y1 > h) c.drawImage(src, sw - 1, sh - 1, 1, 1, w - ov, h - ov, X1 - w + ov, Y1 - h + ov);
}
/* Draws the print for size i, extended as the piece is set up. o: { img (crisp source), prev (canvas source), scale (px per mm), mesh, thumb } */
function paintPrint(c, p, art, t, i, o) {
  const ext = extOf(p).mode, Rg = artRegion(p, i, t, art), img = o.img || art.img, prev = o.prev || art.prev;
  if (t.kind === "affine") {
    c.save(); c.transform(...t.m);
    if (ext === "repeat" || ext === "mirror") {
      const tile = ext === "mirror" ? mirrored(prev) : prev, k = ext === "mirror" ? 2 : 1;
      const sw = tile.width || tile.naturalWidth, sh = tile.height || tile.naturalHeight, pat = c.createPattern(tile, "repeat");
      pat.setTransform(new DOMMatrix([k * art.w / sw, 0, 0, k * art.h / sh, 0, 0]));
      c.fillStyle = pat; c.fillRect(Rg[0], Rg[1], Rg[2] - Rg[0], Rg[3] - Rg[1]);
    } else {
      if (ext === "edge") drawEdges(c, prev, art, Rg);
      c.drawImage(o.thumb ? prev : img, 0, 0, art.w, art.h);
    }
    c.restore();
  } else drawWarp(c, prev, art, t.fn, o.scale, o.mesh || 20, Rg, ext);
}
function drawGrain(c, g, px) {
  const [a, b] = g, ang = Math.atan2(b[1] - a[1], b[0] - a[0]), h = 7 * px;
  poly(c, [a, b]); c.stroke();
  [[b, ang], [a, ang + Math.PI]].forEach(([q, an]) => { poly(c, [[q[0] - h * Math.cos(an - .45), q[1] - h * Math.sin(an - .45)], q, [q[0] - h * Math.cos(an + .45), q[1] - h * Math.sin(an + .45)]]); c.stroke(); });
}
function drawSize(c, p, i, o) {
  const sz = p.sizes[i], art = artOf(p), bl = bleedOf(p, i), px = 1 / o.scale;
  path(c, bl); c.fillStyle = COL.piece; c.fill();
  if (art) {
    const t = o.t || tf(p, i);
    if (o.outside) { c.save(); c.globalAlpha = .2; paintPrint(c, p, art, t, i, o); c.restore(); }
    c.save(); path(c, bl); c.clip();
    if (extOf(p).mode === "ground") { c.fillStyle = groundColor(p); c.fill(); }
    paintPrint(c, p, art, t, i, o); c.restore();
  }
  if (S.bleed > 0) { c.setLineDash([4 * px, 3 * px]); c.strokeStyle = COL.bleed; c.lineWidth = 1.1 * px; path(c, bl); c.stroke(); c.setLineDash([]); }
  c.strokeStyle = COL.cut; c.lineWidth = (o.detail ? 1.7 : 1.2) * px; path(c, sz.outline); c.stroke();
  if (o.detail) {
    c.lineWidth = 1 * px; c.strokeStyle = COL.cut; c.globalAlpha = .75;
    for (const l of sz.internals) { poly(c, l.pts); if (l.closed) c.closePath(); c.stroke(); }
    if (sz.grain) { c.lineWidth = 1.2 * px; drawGrain(c, sz.grain, px); }
    c.globalAlpha = 1;
  }
}
function fitScale(p, cw, ch) {
  let W = 0, H = 0;
  p.sizes.forEach((s, i) => { const b = E.bbox(bleedOf(p, i)); W = Math.max(W, b.w); H = Math.max(H, b.h); });
  return Math.max(0.01, Math.min((cw - 40) / (W + 30), (ch - 120) / (H + 30)));
}

/* ---- stage ---- */
const stage = $("#stage"), sctx = stage.getContext("2d");
let VIEW = null, dragging = false, rafPending = false, stripTimer = 0;
function view() {
  const p = P(), r = stage.getBoundingClientRect();
  const sc = fitScale(p, r.width, r.height) * S.zoom, b = E.bbox(p.sizes[S.si].outline);
  return { scale: sc, cw: r.width, ch: r.height, tx: r.width / 2 + S.pan[0] - b.cx * sc, ty: r.height / 2 + 8 + S.pan[1] - b.cy * sc };
}
function toMM(ev) { const r = stage.getBoundingClientRect(); return [(ev.clientX - r.left - VIEW.tx) / VIEW.scale, (ev.clientY - r.top - VIEW.ty) / VIEW.scale]; }
function drawStage() {
  rafPending = false;
  const dpr = window.devicePixelRatio || 1, r = stage.getBoundingClientRect();
  const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
  if (stage.width !== W || stage.height !== H) { stage.width = W; stage.height = H; }
  const c = sctx; c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = COL.mat; c.fillRect(0, 0, W, H);
  const p = P(); $("#empty-stage").hidden = !!p;
  if (!p) return;
  const v = VIEW = view(), px = 1 / v.scale;
  c.setTransform(dpr * v.scale, 0, 0, dpr * v.scale, dpr * v.tx, dpr * v.ty);
  // cutting-mat grid: 10 mm fine, 50 mm strong
  const x0 = -v.tx / v.scale, y0 = -v.ty / v.scale, x1 = x0 + v.cw / v.scale, y1 = y0 + v.ch / v.scale;
  const step = v.scale > 0.9 ? 10 : 50;
  for (let k = Math.floor(x0 / step) * step; k <= x1; k += step) { c.strokeStyle = k % 50 === 0 ? COL.mline2 : COL.mline; c.lineWidth = px; poly(c, [[k, y0], [k, y1]]); c.stroke(); }
  for (let k = Math.floor(y0 / step) * step; k <= y1; k += step) { c.strokeStyle = k % 50 === 0 ? COL.mline2 : COL.mline; c.lineWidth = px; poly(c, [[x0, k], [x1, k]]); c.stroke(); }
  const art = artOf(p), t = art ? tf(p, S.si) : null;
  drawSize(c, p, S.si, { scale: v.scale, outside: S.outside, detail: true, mesh: dragging ? 24 : 48, t });
  // compare: base outline scaled evenly onto this size
  if (S.compare && S.si !== p.baseIdx) {
    const gm = E.ghostMatrix(p, S.si, tpsCache), go = p.sizes[p.baseIdx].outline.map(q => Mx.apply(gm, q));
    c.setLineDash([5 * px, 4 * px]); c.strokeStyle = COL.ghost; c.lineWidth = 1.4 * px; path(c, go); c.stroke(); c.setLineDash([]);
  }
  // gaps where the print doesn't reach the bleed line
  if (art) {
    const cov = coverage(p, S.si);
    if (cov && !cov.ok && extOf(p).mode === "none") { c.fillStyle = COL.warn; for (const q of cov.miss) { c.beginPath(); c.arc(q[0], q[1], 3.2 * px, 0, Math.PI * 2); c.fill(); } }
    // pin point
    const A = t.A; c.strokeStyle = COL.accent; c.lineWidth = 1.6 * px;
    c.beginPath(); c.arc(A[0], A[1], 7 * px, 0, Math.PI * 2); c.stroke();
    poly(c, [[A[0] - 12 * px, A[1]], [A[0] + 12 * px, A[1]]]); c.stroke(); poly(c, [[A[0], A[1] - 12 * px], [A[0], A[1] + 12 * px]]); c.stroke();
  }
}
function requestDraw() { if (!rafPending) { rafPending = true; requestAnimationFrame(drawStage); } }

/* ---- size strip ---- */
function renderStrip() {
  const p = P(), el = $("#strip");
  if (!p) { el.innerHTML = ""; return; }
  if (el.dataset.piece !== p.id || el.children.length !== p.sizes.length) {
    el.dataset.piece = p.id;
    el.innerHTML = p.sizes.map((s, i) => `<button class="sz" role="tab" data-i="${i}"><div class="sz-top"><span class="sz-name">${esc(s.size)}</span><span class="sz-pct num"></span></div><canvas width="232" height="184"></canvas><div class="sz-flags"></div></button>`).join("");
  }
  const art = artOf(p);
  Array.from(el.children).forEach((btn, i) => {
    btn.setAttribute("aria-current", i === S.si ? "true" : "false");
    btn.setAttribute("aria-selected", i === S.si ? "true" : "false");
    const t = art ? tf(p, i) : null, g = growth(p, i);
    btn.querySelector(".sz-pct").textContent = t ? (i === p.baseIdx ? "100 %" : scaleText(t, p)) : (i === p.baseIdx ? "" : (g.dw >= 0 ? "+" : "−") + Math.abs(g.dw).toFixed(0) + " mm");
    const cov = art ? coverage(p, i) : null;
    btn.querySelector(".sz-flags").innerHTML = (i === p.baseIdx ? `<span class="flag base">Base</span>` : "") + (isAdjusted(p, p.sizes[i].size) ? `<span class="flag hand">Adjusted</span>` : "") + (cov && !cov.ok ? (extOf(p).mode === "none" ? `<span class="flag gap">Gap at edge</span>` : `<span class="flag ext">Extended</span>`) : "");
    const cv = btn.querySelector("canvas"), c = cv.getContext("2d");
    c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = COL.mat; c.fillRect(0, 0, cv.width, cv.height);
    // all thumbnails share one scale so growth between sizes is visible
    const sc = fitScale(p, cv.width + 40, cv.height + 100) * 0.94, b = E.bbox(p.sizes[i].outline);
    c.setTransform(sc, 0, 0, sc, cv.width / 2 - b.cx * sc, cv.height / 2 - b.cy * sc);
    drawSize(c, p, i, { scale: sc, outside: false, detail: false, thumb: true, mesh: 10, t });
  });
}
function scheduleStrip() { clearTimeout(stripTimer); stripTimer = setTimeout(renderStrip, dragging ? 140 : 0); }

/* ---- stage overlay ---- */
function renderOverlay() {
  const p = P(), el = $("#ov-size");
  if (!p) { el.innerHTML = ""; return; }
  const sz = p.sizes[S.si], g = growth(p, S.si);
  el.innerHTML = `<div class="sz-big"><small>Size</small>${esc(sz.size)}</div><div class="sz-meta num">${esc(p.name)} · ${f0(g.w)} × ${f0(g.h)} mm</div>`;
  $("#t-move").setAttribute("aria-pressed", S.tool === "move"); $("#t-pan").setAttribute("aria-pressed", S.tool === "pan");
  $("#t-outside").setAttribute("aria-pressed", S.outside); $("#t-compare").setAttribute("aria-pressed", S.compare);
  $("#t-compare").disabled = S.si === p.baseIdx;
  $("#lg-ghost").hidden = !(S.compare && S.si !== p.baseIdx);
  $("#pick-msg").hidden = !S.picking; stage.classList.toggle("picking", S.picking);
}

/* ================= left panel ================= */
function pieceIcon(p) {
  const o = p.sizes[p.baseIdx].outline, b = E.bbox(o), s = 34 / Math.max(b.w, b.h);
  const d = "M" + o.map(q => ((q[0] - b.cx) * s + 20).toFixed(1) + " " + ((q[1] - b.cy) * s + 20).toFixed(1)).join("L") + "Z";
  return `<svg class="icon" viewBox="0 0 40 40" aria-hidden="true"><path d="${d}"/></svg>`;
}
function renderLeft() {
  const p = P(), el = $("#left");
  const fileIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/></svg>`;
  let h = `<div class="card"><h2>Pattern <button class="linkbtn" data-a="add-dxf">Add DXF</button></h2>`;
  if (!S.files.length) h += `<p class="hint">No pattern yet. Open a DXF exported from your pattern CAD.</p>`;
  else {
    h += `<div class="files">${S.files.map(f => `<div class="file">${fileIcon}<span title="${esc(f.name)}">${esc(f.name)}</span></div>`).join("")}</div>`;
    const u = S.unitInfo;
    h += `<div class="field"><label for="unit">Units in file</label><select id="unit" data-a="unit">${[["mm", "Millimetres"], ["cm", "Centimetres"], ["in", "Inches"]].map(([v, l]) => `<option value="${v}" ${u && u.unit === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
    if (u) h += `<p class="hint">${u.source === "guess" ? "Guessed from the piece sizes. Check a measurement." : u.source === "user" ? "Set by you." : "Read from the file."}</p>`;
    h += `</div>`;
  }
  h += `</div>`;
  if (S.pieces.length) {
    h += `<div class="card"><h2>Pieces</h2><div class="pieces">${S.pieces.map((q, k) => `<button class="piece" data-a="piece" data-k="${k}" aria-current="${k === S.pi}">${pieceIcon(q)}<span style="min-width:0"><b>${esc(q.name)}</b><small>${q.sizes.length} size${q.sizes.length > 1 ? "s" : ""} · ${esc(q.sizes[0].size)}–${esc(q.sizes[q.sizes.length - 1].size)}</small></span><span class="tag ${artOf(q) ? "on" : "off"}">${artOf(q) ? "Print" : "No print"}</span></button>`).join("")}</div>`;
    if (p && p.sizesGuessed) h += `<div class="note">This file doesn't label the sizes, so they're ordered smallest to largest. Name them here:<div class="renames">${p.sizes.map((s, i) => `<input id="rn-${i}" data-a="rename" data-i="${i}" value="${esc(s.size)}" aria-label="Name of size ${i + 1}">`).join("")}</div></div>`;
    h += `</div>`;
  }
  if (p) {
    const art = artOf(p);
    h += `<div class="card"><h2>Print for ${esc(p.name)}</h2>`;
    if (art) {
      h += `<div class="art"><div class="art-thumb" style="background-image:url('${art.thumbURL}')"></div><div style="min-width:0"><b title="${esc(art.name)}">${esc(art.name)}</b><small class="num">${f0(art.w)} × ${f0(art.h)} mm${art.dpi ? " · " + art.dpi + " dpi" : ""}</small><small>${art.kind === "svg" ? "Vector, stays vector in Illustrator" : "Image"}</small></div></div>`;
      h += `<div class="row" style="margin-top:10px"><button class="btn small" data-a="add-art">Replace</button><button class="btn small ghost" data-a="rm-art">Remove</button></div>`;
    } else {
      h += `<div class="drop" id="art-drop"><b>Drop the print artwork here</b><span class="hint">SVG from Illustrator keeps it vector. PNG, JPG and TIFF also work.</span><button class="btn small primary" data-a="add-art">Choose file</button></div>`;
    }
    h += `</div>`;
  }
  h += `<div class="card"><details class="help"><summary>Getting files out of CAD</summary><p>Export the graded pattern as DXF (AAMA or ASTM) with all sizes, either in one file or one file per size with the size in the file name (FRONT_38.dxf). The cut line should be on layer 1, which is the AAMA default.</p><p>For the print, export from Illustrator as SVG, or from Photoshop as PNG or TIFF with the resolution kept, so the tool knows its real size.</p></details></div>`;
  el.innerHTML = h;
}

/* ================= right panel ================= */
function stepper(id, val, unit, step, label) {
  return `<div class="field"><label for="${id}">${label}</label><div class="stepper"><button data-step="${id}" data-d="${-step}" aria-label="Decrease ${label}">−</button><div class="in"><input id="${id}" type="number" step="${step}" inputmode="decimal" value="${val}" data-a="num"><span class="u">${unit}</span></div><button data-step="${id}" data-d="${step}" aria-label="Increase ${label}">+</button></div></div>`;
}
function renderRight() {
  const p = P(), el = $("#right");
  if (!p) { el.innerHTML = `<div class="card"><h2>Grading rule</h2><p class="hint">Open a pattern to set how the print follows each size.</p></div>`; return; }
  const art = artOf(p), r = p.rule, isBase = S.si === p.baseIdx, sz = p.sizes[S.si];
  let h = `<div class="card"><h2>How the print follows the size</h2><div class="rules" role="radiogroup" aria-label="Grading rule">`;
  h += RULES.map(x => `<button class="rule" role="radio" aria-checked="${r.mode === x.id}" data-a="mode" data-v="${x.id}"><span class="dot"></span><b>${x.name}</b><span>${x.hint}</span></button>`).join("");
  h += `</div><div class="stack" style="margin-top:12px">`;
  if (r.mode === "uniform") h += `<div class="field"><span class="lbl">Scale from the piece's</span><div class="segs">${MEASURES.map(([v, l]) => `<button data-a="measure" data-v="${v}" aria-pressed="${r.measure === v}">${l}</button>`).join("")}</div></div>`;
  if (r.mode !== "warp") {
    h += `<div class="field"><label for="anchor">Pin point</label><select id="anchor" data-a="anchor">${ANCHORS.map(([v, l]) => `<option value="${v}" ${r.anchor.type === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
    h += `<p class="hint">${r.anchor.type === "point" ? (r.anchor.pt ? `This point stays on the same spot of the pattern in every size. <button class="linkbtn" data-a="pick">Choose again</button>` : `<button class="linkbtn" data-a="pick">Click it on the pattern</button>`) : "The print grows out from this point, so it stays put in every size."}</p></div>`;
  }
  const ex = extOf(p);
  h += `<hr class="hr"><div class="field"><label for="ext">Where the artwork runs out</label><select id="ext" data-a="ext">${EXTS.map(([v, l]) => `<option value="${v}" ${ex.mode === v ? "selected" : ""}>${l}</option>`).join("")}</select><p class="hint">${EXT_HINT[ex.mode]}</p>`;
  if (ex.mode === "ground") h += `<div class="row"><input type="color" id="extcolor" data-a="extcolor" value="${groundColor(p)}" aria-label="Ground colour"><span class="mono">${groundColor(p).toUpperCase()}</span>${art && art.edgeColor && ex.color && ex.color.toLowerCase() !== art.edgeColor.toLowerCase() ? `<button class="linkbtn" data-a="extauto">Use the artwork's edge colour</button>` : ""}</div>`;
  h += `</div>`;
  h += `<div class="grid2"><div class="field"><label for="base">Base size</label><select id="base" data-a="base">${p.sizes.map((s, i) => `<option value="${i}" ${i === p.baseIdx ? "selected" : ""}>${esc(s.size)}</option>`).join("")}</select></div>`;
  h += stepper("bleed", S.bleed, "mm", 1, "Bleed") + `</div></div></div>`;

  // this size
  h += `<div class="card"><h2>${isBase ? "Print on the base size" : "Size " + esc(sz.size)}</h2>`;
  if (!art) h += `<p class="hint">Add the print artwork on the left to place it.</p>`;
  else if (isBase) {
    const b = E.bbox(sz.outline), pl = p.place;
    h += `<p class="hint" style="margin-bottom:12px">Place the print as it should sit on size ${esc(sz.size)}. Every other size is worked out from here.</p><div class="stack">`;
    h += `<div class="grid2">${stepper("pw", f1(art.w * pl.k), "mm", 1, "Print width")}${stepper("rot", f1(pl.rot || 0), "°", 1, "Rotate")}</div>`;
    h += `<div class="grid2">${stepper("px", f1(pl.x - b.cx), "mm", 1, "Across from centre")}${stepper("py", f1(pl.y - b.cy), "mm", 1, "Down from centre")}</div>`;
    h += `<div class="row"><button class="btn small" data-a="centre">Centre</button><button class="btn small" data-a="fill">Fill piece</button><button class="btn small" data-a="real" ${art.known ? "" : "disabled"} title="${art.known ? "" : "The file has no stored size"}">Real size</button></div>`;
    h += `<p class="hint">Drag the print on the pattern to move it. Arrow keys nudge 1 mm, with Shift 10 mm.</p></div>`;
  } else {
    const t = tf(p, S.si), g = growth(p, S.si), adj = p.adj[sz.size] || { m: 1, dx: 0, dy: 0 }, cov = coverage(p, S.si);
    h += `<div class="size-head"><div class="big-pct${Math.abs(t.sx - t.sy) < 1e-4 ? "" : " two"}">${Math.abs(t.sx - t.sy) < 1e-4 ? (t.sx * 100).toFixed(1) + "<small> %</small>" : (t.sx * 100).toFixed(1) + "<small> × </small>" + (t.sy * 100).toFixed(1) + "<small> %</small>"}</div><span class="hint">print scale vs ${esc(p.sizes[p.baseIdx].size)}</span></div>`;
    h += `<dl class="readout" style="margin:12px 0"><dt>Piece width</dt><dd>${f0(g.w)} mm (${sign(g.dw)}, ${((g.rw - 1) * 100).toFixed(1)} %)</dd><dt>Piece length</dt><dd>${f0(g.h)} mm (${sign(g.dh)}, ${((g.rh - 1) * 100).toFixed(1)} %)</dd></dl>`;
    if (cov && !cov.ok) h += extOf(p).mode === "none" ? `<div class="note" style="margin:0 0 12px">The artwork doesn't reach the bleed line everywhere on this size (orange dots). Choose how to fill it under <b>Where the artwork runs out</b>, or scale it up here.</div>` : `<p class="hint" style="margin:0 0 12px">The artwork runs out on this size; the gap is filled by <b>${esc(extLabel(p).toLowerCase())}</b>.</p>`;
    h += `<hr class="hr"><div class="stack" style="margin-top:12px"><div class="status-line"><b>Fine-tune by hand</b>${isAdjusted(p, sz.size) ? `<span class="flag hand">Adjusted</span>` : ""}</div>`;
    h += `${stepper("am", f1(adj.m * 100), "%", 0.5, "Extra scale")}`;
    h += `<div class="grid2">${stepper("ax", f1(adj.dx), "mm", 1, "Move across")}${stepper("ay", f1(adj.dy), "mm", 1, "Move down")}</div>`;
    h += `<div class="row"><button class="btn small" data-a="reset" ${isAdjusted(p, sz.size) ? "" : "disabled"}>Reset to automatic</button></div>`;
    h += `<p class="hint">Drag the print to move it on this size only. Changes on the base size still flow through.</p></div>`;
  }
  h += `</div>`;
  el.innerHTML = h;
}

function renderAll() {
  readColours();
  $("#example-note").hidden = !S.example;
  renderLeft(); renderRight(); renderOverlay(); renderStrip(); requestDraw();
}
function update(opts = {}) { // after a state change
  if (opts.cache) { tpsCache = {}; bleedCache = {}; }
  if (!opts.keepRight) renderRight();
  renderOverlay(); scheduleStrip(); requestDraw(); save();
}

/* ================= events: panels ================= */
function setNum(id, v) {
  const p = P(); if (!p) return;
  if (isNaN(v)) return;
  const sz = p.sizes[S.si], art = artOf(p);
  if (id === "bleed") { S.bleed = Math.max(0, Math.min(60, v)); bleedCache = {}; return update(); }
  if (!art) return;
  if (S.si === p.baseIdx) {
    const b = E.bbox(sz.outline), pl = p.place;
    if (id === "pw") pl.k = Math.max(1, v) / art.w;
    if (id === "rot") pl.rot = v;
    if (id === "px") pl.x = b.cx + v;
    if (id === "py") pl.y = b.cy + v;
  } else {
    const a = p.adj[sz.size] || (p.adj[sz.size] = { m: 1, dx: 0, dy: 0 });
    if (id === "am") a.m = Math.max(10, v) / 100;
    if (id === "ax") a.dx = v;
    if (id === "ay") a.dy = v;
  }
  update();
}
document.addEventListener("click", ev => {
  const st = ev.target.closest("[data-step]");
  if (st) { const inp = document.getElementById(st.dataset.step); const v = Math.round((parseFloat(inp.value || 0) + parseFloat(st.dataset.d)) * 100) / 100; inp.value = v; setNum(st.dataset.step, v); return; }
  const b = ev.target.closest("[data-a]"); if (!b || b.tagName === "SELECT" || b.tagName === "INPUT") return;
  const a = b.dataset.a, p = P();
  if (a === "add-dxf") $("#in-dxf").click();
  else if (a === "add-art") $("#in-art").click();
  else if (a === "piece") { S.pi = +b.dataset.k; S.si = P().baseIdx; S.zoom = 1; S.pan = [0, 0]; S.picking = false; renderAll(); }
  else if (a === "rm-art") { const id = p.artId; p.artId = null; p.adj = {}; if (!S.pieces.some(q => q.artId === id)) delete S.arts[id]; save(); renderAll(); }
  else if (a === "mode") { p.rule.mode = b.dataset.v; update(); }
  else if (a === "measure") { p.rule.measure = b.dataset.v; update(); }
  else if (a === "extauto") { p.extend.color = null; update(); }
  else if (a === "pick") { S.picking = true; S.si = p.baseIdx; renderAll(); stage.focus(); }
  else if (a === "centre" || a === "fill" || a === "real") {
    const art = artOf(p), bb = E.bbox(p.sizes[p.baseIdx].outline);
    p.place.x = bb.cx; p.place.y = bb.cy;
    if (a === "fill") { p.place.rot = 0; p.place.k = Math.max((bb.w + 2 * S.bleed) / art.w, (bb.h + 2 * S.bleed) / art.h); }
    if (a === "real") p.place.k = 1;
    update();
  } else if (a === "reset") { delete p.adj[p.sizes[S.si].size]; update(); }
});
document.addEventListener("change", ev => {
  const el = ev.target, a = el.dataset && el.dataset.a, p = P();
  if (!a) return;
  if (a === "num") setNum(el.id, parseFloat(el.value));
  else if (a === "ext") { p.extend = { mode: el.value, color: extOf(p).color }; update(); }
  else if (a === "extcolor") { p.extend = { mode: "ground", color: el.value }; update(); }
  else if (a === "unit") { S.unitOverride = el.value; reparse(); S.zoom = 1; S.pan = [0, 0]; save(); renderAll(); }
  else if (a === "anchor") { p.rule.anchor = { type: el.value, pt: el.value === "point" ? p.rule.anchor.pt : null }; if (el.value === "point" && !p.rule.anchor.pt) { S.picking = true; S.si = p.baseIdx; renderAll(); } else update(); }
  else if (a === "base") {
    const ni = +el.value;
    // carry the print over: where it currently sits on the new base becomes the base placement
    const art = artOf(p);
    if (art && ni !== p.baseIdx) {
      const t = tf(p, ni), c = mapFn(t)([art.w / 2, art.h / 2]);
      const k = t.kind === "affine" ? Math.sqrt(Math.abs(t.m[0] * t.m[3] - t.m[1] * t.m[2])) : p.place.k * Math.sqrt(t.sx * t.sy);
      p.place = { x: c[0], y: c[1], k, rot: p.place.rot || 0 };
    }
    if (p.rule.anchor.type === "point" && p.rule.anchor.pt && ni !== p.baseIdx) p.rule.anchor.pt = E.getTPS(p, ni, tpsCache)(p.rule.anchor.pt);
    p.baseIdx = ni; p.adj = {}; S.si = ni; tpsCache = {}; renderAll(); save();
  } else if (a === "rename") {
    const i = +el.dataset.i, v = el.value.trim() || p.sizes[i].size;
    if (p.sizes.some((s, k) => k !== i && s.size === v)) { toast("Two sizes can't share a name."); el.value = p.sizes[i].size; return; }
    const oldName = p.sizes[i].size; if (p.adj[oldName]) { p.adj[v] = p.adj[oldName]; delete p.adj[oldName]; }
    p.sizes[i].size = v; p.sizeNames = p.sizes.map(s => s.size); tpsCache = {}; bleedCache = {};
    $("#strip").dataset.piece = ""; renderAll(); save();
  }
});
document.addEventListener("keydown", ev => {
  if (ev.key === "Enter" && ev.target.dataset && ev.target.dataset.a === "num") ev.target.blur();
  if (ev.key === "Escape") { if (S.picking) { S.picking = false; renderOverlay(); } if (!$("#export").hidden) closeExport(); }
});

/* ================= events: stage ================= */
const pointers = new Map(); let dragStart = null, pinch = null;
stage.addEventListener("pointerdown", ev => {
  const p = P(); if (!p || !VIEW) return;
  stage.setPointerCapture(ev.pointerId); pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), zoom: S.zoom, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], pan: S.pan.slice() }; dragStart = null; return; }
  if (S.picking) {
    let q = toMM(ev); const sz = p.sizes[p.baseIdx], near = E.nearestOnPoly(q, sz.outline);
    if (near.d < 10 / VIEW.scale) q = near.p; // snap to the cut line
    p.rule.anchor = { type: "point", pt: q }; S.picking = false; renderAll(); save();
    toast("Pin point set. It now lands on the same spot in every size."); return;
  }
  const pan = S.tool === "pan" || ev.button === 1 || ev.shiftKey && false;
  const art = artOf(p);
  dragStart = { mm: toMM(ev), xy: [ev.clientX, ev.clientY], pan: S.pan.slice(), mode: pan || !art ? "pan" : "move" };
  if (dragStart.mode === "move") {
    const isBase = S.si === p.baseIdx, a = isBase ? null : (p.adj[p.sizes[S.si].size] || { m: 1, dx: 0, dy: 0 });
    dragStart.orig = isBase ? [p.place.x, p.place.y] : [a.dx, a.dy];
  }
  dragging = true; stage.classList.add("moving");
});
stage.addEventListener("pointermove", ev => {
  if (!pointers.has(ev.pointerId)) return;
  pointers.set(ev.pointerId, [ev.clientX, ev.clientY]);
  const p = P();
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    S.zoom = Math.max(0.3, Math.min(12, pinch.zoom * d / pinch.d));
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; S.pan = [pinch.pan[0] + mid[0] - pinch.mid[0], pinch.pan[1] + mid[1] - pinch.mid[1]];
    requestDraw(); return;
  }
  if (!dragStart) return;
  if (dragStart.mode === "pan") { S.pan = [dragStart.pan[0] + ev.clientX - dragStart.xy[0], dragStart.pan[1] + ev.clientY - dragStart.xy[1]]; requestDraw(); return; }
  const dx = (ev.clientX - dragStart.xy[0]) / VIEW.scale, dy = (ev.clientY - dragStart.xy[1]) / VIEW.scale;
  if (S.si === p.baseIdx) { p.place.x = dragStart.orig[0] + dx; p.place.y = dragStart.orig[1] + dy; }
  else { const sz = p.sizes[S.si].size, a = p.adj[sz] || (p.adj[sz] = { m: 1, dx: 0, dy: 0 }); a.dx = dragStart.orig[0] + dx; a.dy = dragStart.orig[1] + dy; }
  requestDraw(); scheduleStrip();
});
function endPointer(ev) {
  pointers.delete(ev.pointerId);
  if (pointers.size < 2) pinch = null;
  if (!pointers.size && dragging) {
    dragging = false; stage.classList.remove("moving");
    const moved = dragStart && dragStart.mode === "move"; dragStart = null;
    if (moved) update(); else requestDraw();
  }
}
stage.addEventListener("pointerup", endPointer); stage.addEventListener("pointercancel", endPointer);
stage.addEventListener("wheel", ev => {
  if (!P() || !VIEW) return; ev.preventDefault();
  const r = stage.getBoundingClientRect(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
  const z0 = S.zoom, z1 = Math.max(0.3, Math.min(12, z0 * Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015))));
  // keep the point under the cursor fixed
  const cx = r.width / 2 + S.pan[0], cy = r.height / 2 + 8 + S.pan[1];
  S.pan = [S.pan[0] + (mx - cx) * (1 - z1 / z0), S.pan[1] + (my - cy) * (1 - z1 / z0)];
  S.zoom = z1; requestDraw();
}, { passive: false });
stage.addEventListener("keydown", ev => {
  const p = P(); if (!p || !artOf(p)) return;
  const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key]; if (!k) return;
  ev.preventDefault(); const s = ev.shiftKey ? 10 : 1;
  if (S.si === p.baseIdx) { p.place.x += k[0] * s; p.place.y += k[1] * s; }
  else { const sz = p.sizes[S.si].size, a = p.adj[sz] || (p.adj[sz] = { m: 1, dx: 0, dy: 0 }); a.dx += k[0] * s; a.dy += k[1] * s; }
  update();
});
$("#strip").addEventListener("click", ev => { const b = ev.target.closest(".sz"); if (!b) return; S.si = +b.dataset.i; S.pan = [0, 0]; S.picking = false; renderRight(); renderOverlay(); renderStrip(); requestDraw(); });
$("#strip").addEventListener("keydown", ev => {
  const p = P(); if (!p || !["ArrowLeft", "ArrowRight"].includes(ev.key)) return;
  S.si = Math.max(0, Math.min(p.sizes.length - 1, S.si + (ev.key === "ArrowRight" ? 1 : -1))); renderRight(); renderOverlay(); renderStrip(); requestDraw();
  const btn = $("#strip").children[S.si]; if (btn) btn.focus();
});
$("#t-move").onclick = () => { S.tool = "move"; renderOverlay(); };
$("#t-pan").onclick = () => { S.tool = "pan"; renderOverlay(); };
$("#t-outside").onclick = () => { S.outside = !S.outside; renderOverlay(); requestDraw(); };
$("#t-compare").onclick = () => { S.compare = !S.compare; renderOverlay(); requestDraw(); };
$("#z-in").onclick = () => { S.zoom = Math.min(12, S.zoom * 1.4); requestDraw(); };
$("#z-out").onclick = () => { S.zoom = Math.max(0.3, S.zoom / 1.4); requestDraw(); };
$("#z-fit").onclick = () => { S.zoom = 1; S.pan = [0, 0]; requestDraw(); };
new ResizeObserver(() => requestDraw()).observe($("#stage-wrap"));
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => setTimeout(renderAll, 30));
new MutationObserver(() => setTimeout(renderAll, 30)).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

/* ---- files in ---- */
$("#btn-dxf").onclick = $("#empty-open").onclick = () => $("#in-dxf").click();
$("#in-dxf").onchange = e => { openDXF(Array.from(e.target.files)); e.target.value = ""; };
$("#in-art").onchange = e => { if (e.target.files[0]) setArt(e.target.files[0]); e.target.value = ""; };
$("#btn-open").onclick = () => $("#in-proj").click();
$("#in-proj").onchange = async e => { const f = e.target.files[0]; e.target.value = ""; if (f) openProject(await f.text()); };
$("#example-clear").onclick = () => { clearAll(); toast("Example cleared. Open your DXF to start."); };
let dragDepth = 0;
document.addEventListener("dragenter", e => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) { dragDepth++; document.body.classList.add("dragging"); } });
document.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove("dragging"); });
document.addEventListener("dragover", e => e.preventDefault());
document.addEventListener("drop", async e => {
  e.preventDefault(); dragDepth = 0; document.body.classList.remove("dragging");
  const files = Array.from(e.dataTransfer.files || []); if (!files.length) return;
  const dxf = files.filter(f => /\.dxf$/i.test(f.name)), proj = files.find(f => /\.json$/i.test(f.name)), img = files.find(f => /\.(svg|png|jpe?g|webp|tiff?)$/i.test(f.name));
  if (proj) return openProject(await proj.text());
  if (dxf.length) await openDXF(dxf);
  if (img) setArt(img);
  if (!dxf.length && !img) toast("Drop a DXF pattern, or SVG / PNG / JPG / TIFF artwork.");
});

/* ================= project save / load ================= */
function projectData(withArt = true) {
  return {
    app: "loewe-print-grading", version: 1, saved: new Date().toISOString(), unitOverride: S.unitOverride, bleed: S.bleed, dpi: S.dpi, example: S.example,
    files: S.files,
    pieces: S.pieces.map(p => ({ name: p.name, baseSize: p.sizes[p.baseIdx].size, artId: p.artId, place: p.place, rule: p.rule, adj: p.adj, sizeNames: p.sizeNames, extend: p.extend })),
    arts: Object.fromEntries(Object.values(S.arts).filter(a => withArt).map(a => [a.id, { id: a.id, name: a.name, kind: a.kind, src: a.src, w: a.w, h: a.h, dpi: a.dpi || null, known: !!a.known }]))
  };
}
async function restore(d) {
  if (!d || d.app !== "loewe-print-grading") throw new Error("Not a Print Grading project");
  S.files = d.files || []; S.unitOverride = d.unitOverride || null; S.bleed = d.bleed ?? 10; S.dpi = d.dpi || 150; S.example = !!d.example;
  S.arts = {};
  for (const a of Object.values(d.arts || {})) { try { S.arts[a.id] = await prepareArt({ ...a }); } catch (e) { console.warn(e); } }
  S.pieces = []; reparse(d.pieces || []);
  S.pi = 0; S.si = P() ? P().baseIdx : 0; S.zoom = 1; S.pan = [0, 0];
}
async function openProject(text) {
  try { await restore(JSON.parse(text)); renderAll(); save(); toast("Project opened."); }
  catch (e) { console.error(e); toast("That file isn't a Print Grading project."); }
}
// on-device autosave (IndexedDB), so a refresh loses nothing
const IDB = {
  db: null,
  open() { return this.db ? Promise.resolve(this.db) : new Promise((res, rej) => { try { const r = indexedDB.open("print-grading", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(this.db = r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); } }); },
  async get(k) { const db = await this.open(); return new Promise((res, rej) => { const q = db.transaction("kv").objectStore("kv").get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  async set(k, v) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
};
let saveTimer = 0;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { IDB.set("project", JSON.stringify(projectData())).catch(() => {}); }, 700); }

/* ================= export ================= */
async function saveFile(name, data) {
  let dl = null;
  if (window.claude && window.claude.use) { try { dl = await window.claude.use("downloads"); } catch (e) { dl = null; } }
  if (dl) {
    try { await dl.save({ filename: name, data }); return true; }
    catch (e) { if (e && e.code === "declined") return false; toast(e && e.code === "too_large" ? "The file is too large to save here. Export fewer sizes or a lower resolution." : "Saving isn't available in this view."); return false; }
  }
  if (window.claude) { toast("Saving isn't available in this view."); return false; }
  const blob = data instanceof Blob ? data : new Blob([data]);
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000); return true;
}
const safe = s => String(s).trim().replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, "") || "piece";
const fx = v => +(+v).toFixed(4);
const svgD = pts => "M" + pts.map(q => fx(q[0]) + " " + fx(q[1])).join(" L") + " Z";
const ruleLabel = p => RULES.find(r => r.id === p.rule.mode).name + (p.rule.mode === "uniform" ? " (" + MEASURES.find(m => m[0] === p.rule.measure)[1].toLowerCase() + ")" : "");
const anchorLabel = p => p.rule.mode === "warp" ? "–" : (ANCHORS.find(a => a[0] === p.rule.anchor.type) || ANCHORS[0])[1].replace("A point I choose…", "Chosen point");

async function artSourceFor(art, pxPerArtMM) {
  // a source image with enough pixels for the export resolution
  const want = Math.min(14000, art.w * pxPerArtMM);
  if (art.kind === "svg") return svgImage(art, Math.max(want, 400));
  return art.full;
}
async function renderPNG(p, i, dpi) {
  const art = artOf(p), bl = bleedOf(p, i), b = E.bbox(bl), t = tf(p, i);
  let ppm = dpi / 25.4; const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const maxArea = isIOS ? 16e6 : 140e6, maxSide = 16000;
  let W = Math.ceil(b.w * ppm), H = Math.ceil(b.h * ppm);
  const k = Math.min(1, maxSide / Math.max(W, H), Math.sqrt(maxArea / (W * H)));
  if (k < 1) { ppm *= k; W = Math.ceil(b.w * ppm); H = Math.ceil(b.h * ppm); }
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const c = cv.getContext("2d");
  c.setTransform(ppm, 0, 0, ppm, -b.x * ppm, -b.y * ppm);
  path(c, bl); c.clip();
  const ext = extOf(p).mode;
  if (ext === "ground") { c.fillStyle = groundColor(p); c.fill(); }
  const scale = Math.max(t.sx, t.sy) * p.place.k;
  const src = await artSourceFor(art, ppm * scale * 1.05);
  const needCanvas = t.kind !== "affine" || ext === "repeat" || ext === "mirror" || ext === "edge";
  const prev = needCanvas && art.kind === "svg" ? rasterize(src, src.naturalWidth, src.naturalHeight) : src;
  paintPrint(c, p, art, t, i, { img: src, prev, scale: ppm, mesh: 96 });
  const blob = await new Promise((res, rej) => cv.toBlob(bb => bb ? res(bb) : rej(new Error("PNG could not be created")), "image/png"));
  const u8 = E.pngSetDPI(new Uint8Array(await blob.arrayBuffer()), ppm * 25.4);
  cv.width = cv.height = 1;
  return { u8, dpi: Math.round(ppm * 25.4), x: b.x, y: b.y, w: b.w, h: b.h };
}
function suffixIds(inner, suf) { // unique ids for each copy of the artwork
  const ids = [...new Set([...inner.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]))];
  let out = inner;
  for (const id of ids) {
    const e = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(\\sid=")${e}(")`, "g"), `$1${id}_${suf}$2`).replace(new RegExp(`url\\(#${e}\\)`, "g"), `url(#${id}_${suf})`).replace(new RegExp(`(href=")#${e}(")`, "g"), `$1#${id}_${suf}$2`);
  }
  return out;
}
async function buildSVG(p, i) {
  const sz = p.sizes[i], art = artOf(p), t = tf(p, i), bl = bleedOf(p, i), b = E.bbox(bl);
  const m = 12, vx = b.x - m, vy = b.y - m, vw = b.w + 2 * m, vh = b.h + 2 * m + 12;
  let s = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- LOEWE Print Grading · ${esc(p.name)} · size ${esc(sz.size)} · 1:1, units mm -->\n`;
  s += `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${fx(vw)}mm" height="${fx(vh)}mm" viewBox="${fx(vx)} ${fx(vy)} ${fx(vw)} ${fx(vh)}">\n`;
  s += `<title>${esc(p.name)} – size ${esc(sz.size)}</title>\n<defs><clipPath id="pg_bleed_clip"><path d="${svgD(bl)}"/></clipPath></defs>\n`;
  const ext = extOf(p).mode;
  if (art && ext === "ground") s += `<g id="Ground"><path d="${svgD(bl)}" fill="${groundColor(p)}"/></g>\n`;
  s += `<g id="Print" clip-path="url(#pg_bleed_clip)">\n`;
  if (art) {
    const rasterImage = async id => { const r = await renderPNG(p, i, Math.min(S.dpi, 200)); return `<image${id ? ` id="${id}"` : ""} x="${fx(r.x)}" y="${fx(r.y)}" width="${fx(r.w)}" height="${fx(r.h)}" preserveAspectRatio="none" xlink:href="data:image/png;base64,${u8ToB64(r.u8)}"/>\n`; };
    const vec = (inner) => `<g transform="scale(${fx(art.w / art.vb[2])} ${fx(art.h / art.vb[3])}) translate(${fx(-art.vb[0])} ${fx(-art.vb[1])})">${inner}</g>`;
    const mt = t.kind === "affine" ? t.m.map(fx).join(" ") : "";
    if (t.kind === "affine" && art.kind === "svg" && (ext === "repeat" || ext === "mirror")) {
      // vector copies of the artwork, so it stays editable in Illustrator
      const Rg = artRegion(p, i, t, art), tiles = [];
      for (let ty = Math.floor(Rg[1] / art.h); ty < Math.ceil(Rg[3] / art.h); ty++) for (let tx = Math.floor(Rg[0] / art.w); tx < Math.ceil(Rg[2] / art.w); tx++) tiles.push([tx, ty]);
      if (tiles.length <= 300) {
        s += `<g id="Print_${ext === "repeat" ? "repeated" : "mirrored"}" transform="matrix(${mt})">`;
        for (const [tx, ty] of tiles) {
          const fxX = ext === "mirror" && (tx & 1), fxY = ext === "mirror" && (ty & 1);
          const ox = (fxX ? tx + 1 : tx) * art.w, oy = (fxY ? ty + 1 : ty) * art.h;
          s += `<g transform="translate(${fx(ox)} ${fx(oy)}) scale(${fxX ? -1 : 1} ${fxY ? -1 : 1})">${vec(tx || ty ? suffixIds(art.inner, `t${tx + 50}_${ty + 50}`) : art.inner)}</g>`;
        }
        s += `</g>\n`;
      } else s += await rasterImage("Print_image");
    } else if (t.kind === "affine" && art.kind === "svg") {
      if (ext === "edge") s += `<g id="Print_extended_edges">${await rasterImage()}</g>\n`;
      s += `<g transform="matrix(${mt})">${vec(art.inner)}</g>\n`;
    } else if (t.kind === "affine" && ext === "none" || t.kind === "affine" && ext === "ground") {
      s += `<image width="${fx(art.w)}" height="${fx(art.h)}" preserveAspectRatio="none" transform="matrix(${mt})" xlink:href="${art.src}"/>\n`;
    } else s += await rasterImage();
  }
  s += `</g>\n`;
  if (S.bleed > 0) s += `<g id="Bleed_line" fill="none" stroke="#E4007C" stroke-width="0.3" stroke-dasharray="3 2"><path d="${svgD(bl)}"/></g>\n`;
  s += `<g id="Cut_line" fill="none" stroke="#000000" stroke-width="0.35"><path d="${svgD(sz.outline)}"/></g>\n`;
  if (sz.internals.length || sz.grain) {
    s += `<g id="Pattern_markings" fill="none" stroke="#000000" stroke-width="0.25">`;
    for (const l of sz.internals) s += `<path d="M${l.pts.map(q => fx(q[0]) + " " + fx(q[1])).join(" L")}${l.closed ? " Z" : ""}"/>`;
    if (sz.grain) { const [a, c2] = sz.grain, an = Math.atan2(c2[1] - a[1], c2[0] - a[0]), hh = 6; const arrow = (q, ang) => `M${fx(q[0] - hh * Math.cos(ang - .45))} ${fx(q[1] - hh * Math.sin(ang - .45))} L${fx(q[0])} ${fx(q[1])} L${fx(q[0] - hh * Math.cos(ang + .45))} ${fx(q[1] - hh * Math.sin(ang + .45))}`; s += `<path id="Grain_line" d="M${fx(a[0])} ${fx(a[1])} L${fx(c2[0])} ${fx(c2[1])} ${arrow(c2, an)} ${arrow(a, an + Math.PI)}"/>`; }
    s += `</g>\n`;
  }
  const info = `${p.name} · size ${sz.size} · base ${p.sizes[p.baseIdx].size} · ${ruleLabel(p)} · print ${art ? scaleText(t, p) : "–"}${isAdjusted(p, sz.size) ? " · adjusted by hand" : ""}${extOf(p).mode !== "none" ? " · beyond the artwork: " + extLabel(p).toLowerCase() : ""}`;
  s += `<g id="Info"><text x="${fx(b.x)}" y="${fx(b.y + b.h + m + 4)}" font-family="Arial, Helvetica, sans-serif" font-size="5" fill="#000000">${esc(info)}</text></g>\n</svg>\n`;
  return s;
}
function buildCSV(items) {
  const rows = [["Piece", "Size", "Base size", "Rule", "Pin point", "Piece width (mm)", "Piece length (mm)", "Width vs base (%)", "Length vs base (%)", "Print scale across (%)", "Print scale down (%)", "Extra scale by hand (%)", "Moved across by hand (mm)", "Moved down by hand (mm)", "Print centre from piece centre, across (mm)", "Print centre from piece centre, down (mm)", "Artwork reaches bleed line", "Where the artwork runs out", "Artwork"]];
  for (const { p, i } of items) {
    const sz = p.sizes[i], g = growth(p, i), t = tf(p, i), art = artOf(p), adj = p.adj[sz.size] || { m: 1, dx: 0, dy: 0 }, b = E.bbox(sz.outline);
    const c = mapFn(t)([art.w / 2, art.h / 2]), cov = coverage(p, i);
    rows.push([p.name, sz.size, p.sizes[p.baseIdx].size, ruleLabel(p), anchorLabel(p), f1(g.w), f1(g.h), f1(g.rw * 100), f1(g.rh * 100), f1(t.sx * 100), f1(t.sy * 100), f1(adj.m * 100), f1(adj.dx), f1(adj.dy), f1(c[0] - b.cx), f1(c[1] - b.cy), cov && cov.ok ? "yes" : "no", extLabel(p), art.name]);
  }
  return "﻿" + rows.map(r => r.map(v => /[",;\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(",")).join("\r\n");
}

const EXP = { svg: true, png: true, csv: true, pieces: null, sizes: null };
function openExport() {
  const withArt = S.pieces.filter(p => artOf(p));
  if (!withArt.length) { toast("Add a print to at least one piece first."); return; }
  if (!EXP.pieces || !EXP.pieces.every(id => withArt.some(p => p.id === id))) EXP.pieces = withArt.map(p => p.id);
  EXP.sizes = null;
  renderExport(); $("#export").hidden = false; $("#exp-close").focus();
}
function closeExport() { $("#export").hidden = true; $("#exp-progress").textContent = ""; }
function exportItems() {
  const items = [];
  for (const p of S.pieces) if (EXP.pieces.includes(p.id) && artOf(p)) p.sizes.forEach((s, i) => { if (!EXP.sizes || EXP.sizes.includes(s.size)) items.push({ p, i }); });
  return items;
}
function renderExport() {
  const withArt = S.pieces.filter(p => artOf(p)), allSizes = E.sortSizes([...new Set(withArt.flatMap(p => p.sizes.map(s => s.size)))]);
  const gaps = exportItems().filter(({ p, i }) => { const c = coverage(p, i); return c && !c.ok && extOf(p).mode === "none"; });
  let h = `<div class="field"><span class="lbl">Pieces</span><div class="chips">${withArt.map(p => `<button class="chip" data-x="piece" data-v="${p.id}" aria-pressed="${EXP.pieces.includes(p.id)}">${esc(p.name)}</button>`).join("")}</div></div>`;
  h += `<div class="field"><span class="lbl">Sizes</span><div class="chips">${allSizes.map(s => `<button class="chip" data-x="size" data-v="${esc(s)}" aria-pressed="${!EXP.sizes || EXP.sizes.includes(s)}">${esc(s)}</button>`).join("")}</div></div>`;
  h += `<label class="opt"><input type="checkbox" id="x-svg" ${EXP.svg ? "checked" : ""}><b>Illustrator files (SVG)</b><span>One per size at 1:1 in mm, with layers for the print, cut line, bleed line and pattern markings. Vector artwork stays vector${withArt.some(p => p.rule.mode === "warp") ? ", except with Follow the shape, where the bent print is embedded as an image" : ""}.</span></label>`;
  h += `<label class="opt"><input type="checkbox" id="x-png" ${EXP.png ? "checked" : ""}><b>Print-ready images (PNG)</b><span>One per size, cut to the bleed line, transparent outside, opening at real size in Photoshop.</span></label>`;
  h += `<div class="field" style="padding-left:30px"><label for="x-dpi">Resolution</label><select id="x-dpi" style="max-width:200px">${[100, 150, 200, 300].map(d => `<option value="${d}" ${S.dpi === d ? "selected" : ""}>${d} dpi</option>`).join("")}</select></div>`;
  h += `<label class="opt"><input type="checkbox" id="x-csv" ${EXP.csv ? "checked" : ""}><b>Placement sheet (CSV)</b><span>Scale and position of the print for every size, to check or to rebuild in Illustrator by hand.</span></label>`;
  h += `<p class="hint">The ZIP also includes the project file, so you can reopen and change this later.</p>`;
  if (gaps.length) h += `<div class="note">The print doesn't reach the bleed line on ${gaps.map(g => esc(g.p.name) + " " + esc(g.p.sizes[g.i].size)).join(", ")}.</div>`;
  $("#exp-body").innerHTML = h;
  const n = exportItems().length;
  $("#exp-go").textContent = `Download ZIP (${n} size${n === 1 ? "" : "s"})`;
  $("#exp-go").disabled = !n || !(EXP.svg || EXP.png || EXP.csv);
}
$("#btn-export").onclick = openExport;
$("#exp-close").onclick = closeExport;
$("#export").addEventListener("click", e => { if (e.target.id === "export") closeExport(); });
$("#exp-body").addEventListener("click", e => {
  const b = e.target.closest("[data-x]"); if (!b) return;
  if (b.dataset.x === "piece") { const v = b.dataset.v; EXP.pieces = EXP.pieces.includes(v) ? EXP.pieces.filter(x => x !== v) : EXP.pieces.concat(v); }
  else { const all = [...$("#exp-body").querySelectorAll('[data-x="size"]')].map(x => x.dataset.v); let cur = EXP.sizes || all.slice(); const v = b.dataset.v; cur = cur.includes(v) ? cur.filter(x => x !== v) : cur.concat(v); EXP.sizes = cur.length === all.length ? null : cur; }
  renderExport();
});
$("#exp-body").addEventListener("change", e => {
  if (e.target.id === "x-svg") EXP.svg = e.target.checked;
  if (e.target.id === "x-png") EXP.png = e.target.checked;
  if (e.target.id === "x-csv") EXP.csv = e.target.checked;
  if (e.target.id === "x-dpi") { S.dpi = +e.target.value; save(); }
  renderExport();
});
$("#exp-go").onclick = async () => {
  const btn = $("#exp-go"), prog = $("#exp-progress"), items = exportItems();
  btn.disabled = true;
  try {
    prog.textContent = "Preparing…";
    const JSZip = await loadLib(LIB.zip, "JSZip"), zip = new JSZip();
    const lowered = [];
    let k = 0;
    for (const { p, i } of items) {
      k++; const name = safe(p.name), size = safe(p.sizes[i].size);
      prog.textContent = `Size ${p.sizes[i].size} of ${p.name} (${k} of ${items.length})…`;
      await new Promise(r => setTimeout(r, 16));
      if (EXP.svg) zip.file(`${name}/${name}_${size}.svg`, await buildSVG(p, i));
      if (EXP.png) { const r = await renderPNG(p, i, S.dpi); if (r.dpi < S.dpi - 1) lowered.push(`${p.sizes[i].size} (${r.dpi} dpi)`); zip.file(`${name}/png/${name}_${size}_${r.dpi}dpi.png`, r.u8, { compression: "STORE" }); }
    }
    if (EXP.csv) zip.file("placement-sheet.csv", buildCSV(items));
    zip.file("project.printgrading.json", JSON.stringify(projectData()));
    prog.textContent = "Packing the ZIP…";
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const stamp = new Date().toISOString().slice(0, 10);
    const pn = [...new Set(items.map(x => safe(x.p.name)))].join("+").slice(0, 60);
    const ok = await saveFile(`${pn}_print-grading_${stamp}.zip`, blob);
    prog.textContent = ok ? (lowered.length ? `Saved. Lowered resolution to fit memory on: ${lowered.join(", ")}.` : "Saved.") : "Not saved.";
  } catch (e) { console.error(e); prog.textContent = "Export failed: " + (e.message || e); }
  btn.disabled = false;
};
$("#btn-save").onclick = async () => {
  if (!S.files.length) { toast("Nothing to save yet."); return; }
  const stamp = new Date().toISOString().slice(0, 10), pn = safe((P() || {}).name || "print-grading");
  if (await saveFile(`${pn}_${stamp}.printgrading.json`, JSON.stringify(projectData()))) toast("Project saved. Open it here later to carry on.");
};

/* ================= start ================= */
async function loadExample() {
  S.files = [{ name: "SKIRT_graded_34-42_example.dxf", text: Sample.dxf() }];
  S.unitOverride = null; S.pieces = []; S.arts = {}; reparse([]);
  S.pieces.forEach(p => { const b = p.sizes.findIndex(s => s.size === "36"); if (b >= 0) p.baseIdx = b; });
  const art = await prepareArt({ id: uid(), name: "Sol medallion placement (example).svg", kind: "svg", src: Sample.printSVG() });
  S.arts[art.id] = art;
  const front = S.pieces[0]; front.artId = art.id; front.place = defaultPlace(front, art);
  S.pi = 0; S.si = front.baseIdx; S.example = true;
}
window.PrintGrading = { state: S, buildSVG, renderPNG, buildCSV, tf, coverage }; // for testing and IT integration
(async function start() {
  readColours();
  loadLib(LIB.clipper, "ClipperLib").then(() => { bleedCache = {}; renderStrip(); requestDraw(); }).catch(() => {});
  let restored = false;
  try { const saved = await Promise.race([IDB.get("project"), new Promise(r => setTimeout(() => r(null), 1500))]); if (saved) { await restore(JSON.parse(saved)); restored = S.files.length > 0; } } catch (e) { restored = false; }
  if (!restored) { try { await loadExample(); } catch (e) { console.error(e); } }
  renderAll();
})();
})();
