/* Example data: an AAMA-style graded DXF (skirt front + back, sizes 34–42) and an engineered placement print (SVG, mm). */
const Sample = (() => {
"use strict";
const SIZES = ["34", "36", "38", "40", "42"];

function bez(p0, p1, p2, p3, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
  }
  return out;
}
// y-down millimetres, x centred on CF/CB
function skirt(kind, g) {
  const f = kind === "front";
  const ww = (f ? 360 : 350) + 20 * g, hw = (f ? 470 : 480) + 20 * g, hm = (f ? 640 : 650) + 24 * g, L = (f ? 600 : 605) + 5 * g, hipY = 190 + 2 * g;
  const wy = x => -12 * (x / (ww / 2)) ** 2, hy = x => L - 14 * (x / (hm / 2)) ** 2;
  const pts = [];
  for (let i = 0; i <= 20; i++) { const x = -ww / 2 + ww * i / 20; pts.push([x, wy(x)]); }
  const side = bez([ww / 2, -12], [ww / 2 + (hw - ww) / 4, 50], [hw / 2, hipY - 80], [hw / 2, hipY], 14).slice(1);
  pts.push(...side);
  for (let i = 1; i <= 10; i++) { const t = i / 10; pts.push([hw / 2 + (hm / 2 - hw / 2) * t, hipY + (L - 14 - hipY) * t]); }
  for (let i = 1; i <= 20; i++) { const x = hm / 2 - hm * i / 20; pts.push([x, hy(x)]); }
  for (let i = 1; i <= 10; i++) { const t = i / 10; pts.push([-hm / 2 + (hm / 2 - hw / 2) * t, L - 14 + (hipY - L + 14) * t]); }
  const lside = side.slice(0, -1).reverse().map(p => [-p[0], p[1]]);
  pts.push(...lside);
  // darts
  const dl = f ? 95 : 130, dx = ww / 4.2, darts = [-dx, dx].map(x => [[x - 9, wy(x - 9)], [x, dl], [x + 9, wy(x + 9)]]);
  const notches = [[[hw / 2, hipY], [hw / 2 - 6, hipY]], [[-hw / 2, hipY], [-hw / 2 + 6, hipY]]];
  return { outline: pts, darts, notches, grain: [[0, 70], [0, L - 70]], L };
}

function dxf() {
  const out = [];
  const w = (c, v) => out.push(String(c), String(v));
  const n = v => (Math.round(v * 1000) / 1000).toFixed(3);
  w(0, "SECTION"); w(2, "HEADER"); w(9, "$ACADVER"); w(1, "AC1009"); w(9, "$INSUNITS"); w(70, 4); w(9, "$MEASUREMENT"); w(70, 1); w(0, "ENDSEC");
  w(0, "SECTION"); w(2, "BLOCKS");
  const inserts = [];
  [["front", "SKIRT FRONT", 0], ["back", "SKIRT BACK", 900]].forEach(([kind, name, ox]) => {
    SIZES.forEach((s, si) => {
      const g = si - 1, sk = skirt(kind, g), bn = name.replace(/ /g, "_") + "_" + s;
      w(0, "BLOCK"); w(8, 1); w(2, bn); w(70, 0); w(10, 0); w(20, 0); w(30, 0); w(3, bn);
      w(0, "POLYLINE"); w(8, 1); w(66, 1); w(70, 1); w(10, 0); w(20, 0); w(30, 0);
      for (const [x, y] of sk.outline) { w(0, "VERTEX"); w(8, 1); w(10, n(x + ox)); w(20, n(-y)); w(30, 0); }
      w(0, "SEQEND"); w(8, 1);
      w(0, "LINE"); w(8, 7); w(10, n(ox)); w(20, n(-sk.grain[0][1])); w(30, 0); w(11, n(ox)); w(21, n(-sk.grain[1][1])); w(31, 0);
      for (const d of sk.darts) { w(0, "POLYLINE"); w(8, 8); w(66, 1); w(70, 0); w(10, 0); w(20, 0); w(30, 0); for (const [x, y] of d) { w(0, "VERTEX"); w(8, 8); w(10, n(x + ox)); w(20, n(-y)); w(30, 0); } w(0, "SEQEND"); w(8, 8); }
      for (const [a, b] of sk.notches) { w(0, "LINE"); w(8, 4); w(10, n(a[0] + ox)); w(20, n(-a[1])); w(30, 0); w(11, n(b[0] + ox)); w(21, n(-b[1])); w(31, 0); }
      w(0, "TEXT"); w(8, 1); w(10, n(ox - 60)); w(20, n(-260)); w(30, 0); w(40, 8); w(1, "Piece Name: " + name);
      w(0, "TEXT"); w(8, 1); w(10, n(ox - 60)); w(20, n(-280)); w(30, 0); w(40, 8); w(1, "Size: " + s);
      w(0, "TEXT"); w(8, 1); w(10, n(ox - 60)); w(20, n(-300)); w(30, 0); w(40, 8); w(1, "Quantity: 1");
      w(0, "ENDBLK"); w(8, 1);
      inserts.push(bn);
    });
  });
  w(0, "ENDSEC");
  w(0, "SECTION"); w(2, "ENTITIES");
  for (const bn of inserts) { w(0, "INSERT"); w(8, 1); w(2, bn); w(10, 0); w(20, 0); w(30, 0); }
  w(0, "ENDSEC"); w(0, "EOF");
  return out.join("\n");
}

/* Engineered placement print, drawn for SKIRT FRONT size 36. 700 × 660 mm. Original example artwork. */
function printSVG() {
  const W = 700, H = 660, cx = 350, cy = 312;
  const C = { ground: "#E8E1CF", green: "#24503D", ochre: "#C48A2C", sky: "#8FB2C4", ink: "#1C1B19", rust: "#A9472E" };
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">`;
  s += `<rect id="ground" width="${W}" height="${H}" fill="${C.ground}"/>`;
  // fine waist stripes
  s += `<g id="waist-stripes" fill="${C.ink}">`;
  for (let i = 0; i < 4; i++) s += `<rect x="0" y="${22 + i * 7}" width="${W}" height="${i % 2 ? 1.2 : 2.4}"/>`;
  s += `</g>`;
  // rays
  s += `<g id="rays" stroke="${C.green}" stroke-width="2.2" stroke-linecap="round">`;
  for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2, r0 = 168, r1 = i % 2 ? 214 : 236; s += `<line x1="${(cx + r0 * Math.cos(a)).toFixed(1)}" y1="${(cy + r0 * Math.sin(a)).toFixed(1)}" x2="${(cx + r1 * Math.cos(a)).toFixed(1)}" y2="${(cy + r1 * Math.sin(a)).toFixed(1)}"/>`; }
  s += `</g>`;
  // leaves
  s += `<g id="leaves">`;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + Math.PI / 12, r = 292, x = cx + r * Math.cos(a), y = cy + r * Math.sin(a), deg = a * 180 / Math.PI + 90;
    const col = i % 3 === 0 ? C.rust : i % 3 === 1 ? C.green : C.ink;
    s += `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${deg.toFixed(1)})"><path d="M0 -46 Q28 -10 0 46 Q-28 -10 0 -46Z" fill="${col}"/><path d="M0 -40 L0 40" stroke="${C.ground}" stroke-width="1.6"/></g>`;
  }
  s += `</g>`;
  // medallion
  s += `<g id="medallion"><circle cx="${cx}" cy="${cy}" r="152" fill="${C.green}"/><circle cx="${cx}" cy="${cy}" r="124" fill="${C.ochre}"/><circle cx="${cx}" cy="${cy}" r="96" fill="${C.sky}"/>`;
  for (let i = 0; i < 16; i++) { const a = i / 16 * 360; s += `<ellipse cx="${cx}" cy="${cy - 72}" rx="9" ry="20" fill="${C.ground}" transform="rotate(${a} ${cx} ${cy})"/>`; }
  s += `<circle cx="${cx}" cy="${cy}" r="46" fill="${C.ink}"/><circle cx="${cx}" cy="${cy}" r="18" fill="${C.ochre}"/></g>`;
  // hem band of circles
  s += `<g id="hem-band">`;
  for (let x = 14, k = 0; x < W; x += 34, k++) s += `<circle cx="${x}" cy="${H - 70}" r="12" fill="${[C.green, C.ochre, C.sky, C.rust][k % 4]}"/>`;
  s += `<rect x="0" y="${H - 44}" width="${W}" height="3" fill="${C.ink}"/></g>`;
  s += `</svg>`;
  return s;
}
return { dxf, printSVG, SIZES, skirt };
})();
if (typeof module !== "undefined") module.exports = Sample;
