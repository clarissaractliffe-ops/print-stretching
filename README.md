# Print Grading

A tool for LOEWE product development that regrades a placement or engineered print onto every size of a graded pattern. The team opens the pattern DXF and the print artwork, places the print once on the base size, and the tool works out the print for every other size. Every size can then be fine-tuned by hand, and all sizes export in one go as files Illustrator and Photoshop open at 1:1.

It replaces the manual loop of exporting the DXF, opening it in Illustrator and rescaling the print size by size.

Works in the browser on laptops (main use) and iPad. No install.

---

## What it does

**In**
- **Pattern:** DXF from the pattern CAD, AAMA or ASTM flavour, or plain DXF. Either all sizes in one file (graded nest or one block per size) or one file per size with the size in the file name (`FRONT_38.dxf`). Reads polylines, lightweight polylines, lines, arcs, circles, splines, blocks and inserts. Cut line taken from layer 1 when present (AAMA default); grain line from layer 7; darts, notches and internal lines kept for display and export. Piece names and sizes read from the `Piece Name:` / `Size:` text the CAD writes. Units from the file header, with a manual override.
- **Print:** SVG (stays vector), PNG, JPG, WebP or TIFF. The real print size is read from the file (SVG width/height in mm, PNG/JPEG/TIFF resolution), so artwork made at 1:1 lands at real size.

**Place once, on the base size**
- Drag the print, or type its width, position and rotation. Buttons for Centre, Fill piece and Real size.

**Four ways the print can follow the size** (per piece)

| Rule | What happens | Use for |
|---|---|---|
| **Scale evenly** (default) | One scale factor per size, from the piece's growth (average of width and length, or width only, or length only). Motifs keep exactly the same proportions. | Placement and engineered prints |
| **Stretch to fit** | Width and length scale separately, like the pattern. | Stripes, borders, where slight stretch is acceptable |
| **Follow the shape** | The print is bent with the pattern (thin-plate spline through matching points on the cut line), so it meets the same seams and points in every size. | Prints that must hit specific seams |
| **Keep print size** | No scaling, only re-positioned. | All-over repeats |

- **Pin point:** the point the print grows from: centre, top centre (waist/neck), bottom centre (hem), left/right edge, or any point clicked on the pattern (snaps to the cut line). The pin lands on the same spot of the pattern in every size.
- **Bleed:** print extends past the cut line by a set amount (default 10 mm).

**Check and adjust each size**
- Size strip shows every size at the same scale, with its print scale, "Adjusted" and "Gap at edge" flags.
- Per size: extra scale (%), move across/down (mm), or drag the print. Reset to automatic at any time. Changes on the base still flow through to the adjusted sizes.
- **Gap at edge:** flags any size where the print doesn't reach the bleed line, with orange dots where.
- **Compare with base:** overlays the base outline, scaled evenly, to show where the pattern grows unevenly.

**Out** (one ZIP)
- **Illustrator (SVG):** one file per size, 1:1 in mm, layers `Print` (clipped to the bleed line), `Bleed_line`, `Cut_line`, `Pattern_markings`, `Info`. Vector artwork stays vector, except with Follow the shape, where the bent print is embedded as an image.
- **Photoshop / printing (PNG):** one per size, cut to the bleed line, transparent outside, resolution stored (100–300 dpi) so it opens at real size.
- **Placement sheet (CSV):** scale, position and hand adjustments for every size.
- **Project file (JSON):** reopen and carry on later. Also autosaved on the device.

---

## How the matching works

1. Each size's cut line is matched point-for-point to the base size: by vertex when the CAD exported the same number of points per size, otherwise by corners (turn points), otherwise by arc length.
2. A thin-plate spline is fitted through those pairs. It maps any point of the base piece to the same place on another size.
3. Scale evenly / Stretch / Keep: the print is scaled about the pin point, and the pin point is moved to where the spline says it lands. Follow the shape: every point of the print goes through the spline.

All of this is in `engine.js` (no UI code), testable on its own in Node.

---

## Run it

It's one file: `index.html`. Open it in Chrome, Edge or Safari. No server needed.

GitHub Pages for prototype hosting: create a repo, add `index.html` and this README, Settings → Pages → Deploy from branch. **Example files only:** unreleased prints and patterns should not go through a personal GitHub account; that's what the LVMH-hosted version is for.

**Editing the source:** `app.src.html` (page), `engine.js` (DXF + geometry), `sample.js` (example pattern and print). Run `python3 build.py` to produce `index.html` (standalone) and `app.html` (claude.ai preview).

---

## Browser support

Tested in Chrome on desktop and at phone width. Safari and iPad still to be checked on a device.

| | Edit | Follow the shape | Export |
|---|---|---|---|
| Chrome / Edge, laptop | ✓ | ✓ (WebGL) | ✓ |
| Safari, Mac | ✓ | ✓ | ✓ |
| Safari, iPad | ✓ | ✓ | ✓, images capped at about 16 megapixels each by iPadOS; the tool lowers the dpi for that size and says so |

---

## Handover notes for IT

### 1. Test with real CAD exports (**first step**)
The DXF reader was built against the AAMA/ASTM structure and tested with generated files, not yet with real exports from the team's CAD. Before anything else, collect 5–10 real graded DXFs (different pieces, different CADs if more than one is used) and check: pieces and sizes are named correctly, units are right, the cut line is the right outline. Expected adjustments are small and isolated in `parseDXF()`.

### 2. Base-size-only DXF + grade rules (**decision**)
Some CADs export only the base size plus a separate `.RUL` grade-rule file. That isn't supported yet. Options: ask the team to export all sizes (simplest), or add a RUL reader that applies the grade rules to the base outline.

### 3. Hosting and confidentiality
Everything runs in the browser; files never leave the device. For production, host the static page internally behind SSO. No backend is needed for the current feature set.

### 4. Libraries
Loaded from public CDNs: **JSZip 3.10.1** (MIT, export), **clipper-lib 6.4.2** (Boost licence, bleed offset; a simpler built-in offset is used if it can't load), **UTIF 3.1.0** (MIT, only when a TIFF is opened). For production, vendor them into the repo.

### 5. Illustrator round-trip
SVG is the safest open format for Illustrator: layers come through as named groups, units in mm. To check on site: that the team's Illustrator version opens the files at exactly 1:1 (measure one piece) and that the clipping comes through as a clipping mask. If they prefer native files, an Illustrator script (`.jsx`) that applies the same transforms to the original `.ai` artwork is a possible phase 2: the placement sheet already holds every number it would need.

### 6. Branding
Same as Style Review: LOEWE logo embedded; Cormorant Garamond stands in for the proprietary LOEWE typeface (`@font-face "LOEWE Display"` picks up the real one).

### 7. Data model (project file)
```json
{
  "app": "loewe-print-grading", "version": 1,
  "files": [{ "name": "SKIRT_graded.dxf", "text": "…DXF…" }],
  "unitOverride": null, "bleed": 10, "dpi": 150,
  "pieces": [{
    "name": "SKIRT FRONT", "baseSize": "36", "artId": "a1",
    "place": { "x": 0, "y": 294, "k": 1, "rot": 0 },
    "rule": { "mode": "uniform", "measure": "avg", "anchor": { "type": "centre", "pt": null } },
    "adj": { "42": { "m": 1.01, "dx": 0, "dy": -4 } }
  }],
  "arts": { "a1": { "name": "print.svg", "kind": "svg", "src": "<svg…", "w": 700, "h": 660 } }
}
```
Coordinates are mm, y pointing down, in the DXF's own frame.

---

## Ideas for phase 2 (to validate with the team)

- **Several prints per piece** (e.g. a placement motif plus an all-over ground).
- **Matching across seams:** check that the print lines up where two pieces are sewn together, in every size.
- **Grade-rule (RUL) import** for base-size-only DXFs.
- **Direct CAD / PLM link:** pull the graded pattern by style code instead of exporting a DXF.
- **Illustrator script export** for teams who need native `.ai` files.
- **Marker preview:** lay all sizes out on the fabric width to estimate print meterage for digital printing.

### Questions for the PD team
1. Which CAD exports the patterns (Lectra Modaris, Gerber AccuMark, CLO, Optitex…)? Do exports include all sizes?
2. Is the print artwork usually vector (Illustrator) or raster (Photoshop)? What resolution goes to the printer?
3. What does "same proportions" mean on your prints: motifs never stretch (Scale evenly), or the print must always hit the same seams (Follow the shape)? Does it depend on the print?
4. Which point should stay fixed across sizes: CF waist, centre of the piece, a motif?
5. How much bleed does the printer need?
6. What file does the printer or the print team expect at the end (TIFF, PDF, AI)?
