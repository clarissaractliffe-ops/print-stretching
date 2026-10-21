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
- **Where the artwork runs out:** when a bigger size goes past the edge of the artwork, the gap can be filled without enlarging the motifs:
  - **Repeat the print:** tiles the artwork in every direction. With "Keep print size" this handles all-over repeats from a single repeat tile.
  - **Mirror the print:** reflects the artwork at its edges, so there's no visible join.
  - **Extend the edges:** stretches the outermost row of pixels outwards; for plain or gradient edges.
  - **Fill with ground colour:** one colour under the artwork, picked automatically from the artwork's edge and changeable.

**Check and adjust each size**
- Size strip shows every size at the same scale, with its print scale, "Adjusted" and "Gap at edge" flags.
- Per size: extra scale (%), move across/down (mm), or drag the print. Reset to automatic at any time. Changes on the base still flow through to the adjusted sizes.
- **Gap at edge:** flags any size where the print doesn't reach the bleed line and nothing fills it, with orange dots where. Sizes where the artwork runs out but is filled are marked "Extended".
- **Compare with base:** overlays the base outline, scaled evenly, to show where the pattern grows unevenly.

**Out** (one ZIP)
- **Illustrator (SVG):** one file per size, 1:1 in mm, layers `Print` (clipped to the bleed line), `Bleed_line`, `Cut_line`, `Pattern_markings`, `Info`. Vector artwork stays vector, including repeated and mirrored copies (each copy is its own group), and a ground colour is its own `Ground` layer. Embedded as an image instead: the bent print in Follow the shape, extended edges (`Print_extended_edges` layer under the vector artwork), and repeats of raster artwork.
- **Photoshop / printing (PNG):** one per size, cut to the bleed line, transparent outside, resolution stored (100–300 dpi) so it opens at real size.
- **Placement sheet (CSV):** scale, position and hand adjustments for every size.
- **Project file (JSON):** the tool's own save file, with the pattern, the artwork and every setting and hand adjustment inside it. Use it to carry on later or on another computer, hand a style to a colleague, or re-export after the print is revised without redoing the sizes. Illustrator and the printer don't need it. The browser also autosaves, but only one project per browser. The file contains the artwork, so it's as confidential as the print.

---

## How the matching works

1. Each size's cut line is matched point-for-point to the base size: by vertex when the CAD exported the same number of points per size, otherwise by corners (turn points), otherwise by arc length.
2. A thin-plate spline is fitted through those pairs. It maps any point of the base piece to the same place on another size.
3. Scale evenly / Stretch / Keep: the print is scaled about the pin point, and the pin point is moved to where the spline says it lands. Follow the shape: every point of the print goes through the spline.

All of this is in `engine.js` (no UI code), testable on its own in Node.

---

## Run it

Open `index.html` from a web server (GitHub Pages, an internal server, or `python3 -m http.server` in this folder). No backend, no database.

**GitHub Pages (prototype only):** Settings → Pages → Deploy from branch → `main` / root. Example files only: the repository and its Pages site sit on a personal account.

**Editing:** change files in `src/`, then run `python3 build.py`. It regenerates `index.html` and `assets/`, and `build/claude-preview.html` for the claude.ai preview.

```
index.html              hosted page (generated)
assets/                 app code, styles, fonts, logo (generated from src/, except fonts and logo)
vendor/                 third-party libraries, with their licences
src/app.src.html        page source: markup, styles, app code
src/engine.js           DXF reading, size matching, print transforms (no UI)
src/sample.js           example pattern and print
build.py
```

---

## Security: working with unreleased prints

**Nothing leaves the computer.** Patterns and prints are opened in the browser, processed there, and exported to the computer's own downloads. There is no upload, no server and no analytics.

**The page can't connect anywhere else.** The hosted version (`index.html`) loads only files from its own folder: libraries are in `vendor/`, fonts in `assets/fonts/`. A Content Security Policy in the page tells the browser to refuse every outgoing connection (`connect-src 'none'`), every outside image, script, font or frame, and inline or `eval` code. So even a later code change, or a compromised library, couldn't send artwork out without the policy being edited too.

Tested: in Chrome, a deliberate attempt to send data out by fetch, beacon, WebSocket, outside image and outside script was refused every time, and normal use (open pattern, open PNG/SVG/TIFF, export ZIP) made no request outside the page's own folder.

**What the policy can't cover** (for IT's review):
- A script navigating the whole page to another address. The code has no such navigation or outside links; code review keeps it that way.
- `frame-ancestors` can't be set from inside the page. When hosting internally, also send the same policy as an HTTP header, plus `frame-ancestors 'self'`.
- The on-device autosave (browser storage) and exported files stay on the computer. On shared machines, IT may want autosave off or cleared.

**Steps to approve it for unreleased prints**
1. Transfer this repository to the company's code platform and make it private; changes go through IT review.
2. Host `index.html` + `assets/` + `vendor/` internally, behind company sign-in, with the CSP also sent as an HTTP header.
3. InfoSec review: about 1,900 lines of app code and styles, no backend; third-party code is the four libraries in `vendor/`.
4. Sign-off from the owner of the artwork (design / PD lead).
5. Decide autosave on shared devices; export to the approved SharePoint/Teams folder.
6. Pilot with real DXFs and prints, then roll out.

The claude.ai preview is a separate copy that loads libraries from public CDNs and sits on a personal account: example files only.

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
See **Security** above.

### 4. Libraries
Bundled in `vendor/`, nothing loaded from outside: **JSZip 3.10.1** (MIT or GPLv3, export), **clipper-lib 6.4.2** (Boost licence, bleed offset), **UTIF 3.1.0** (MIT, TIFF reading) and **pako 1.0.11** (MIT, for ZIP-compressed TIFFs). Fonts in `assets/fonts/` are Cormorant Garamond, Hanken Grotesk and JetBrains Mono, all under the SIL Open Font License (licences alongside).

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
    "adj": { "42": { "m": 1.01, "dx": 0, "dy": -4 } },
    "extend": { "mode": "mirror", "color": null }
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
