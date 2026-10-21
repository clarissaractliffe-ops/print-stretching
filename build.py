#!/usr/bin/env python3
"""Build Print Grading from src/.

  python3 build.py

Outputs
  index.html + assets/   Hosted version (GitHub Pages now, LVMH hosting later).
                         Loads nothing from the internet: libraries in vendor/, fonts in assets/fonts/.
                         A Content Security Policy blocks every outgoing connection.
  build/claude-preview.html
                         Single-file version for the claude.ai preview (loads libraries from public CDNs).
                         Not for unreleased prints.
"""
import pathlib, re

ROOT = pathlib.Path(__file__).parent
SRC = ROOT / "src"

src = (SRC / "app.src.html").read_text()
engine = (SRC / "engine.js").read_text()
sample = (SRC / "sample.js").read_text()
logo_data = (SRC / "logo.txt").read_text().strip()

# --- split the source page ---------------------------------------------------
style_m = re.search(r"<style>\n(.*?)\n</style>\n", src, re.S)
css = style_m.group(1)
scripts = list(re.finditer(r"<script>\n(.*?)\n</script>\n?", src, re.S))
assert len(scripts) == 3, "expected engine, sample and app scripts"
app_js = scripts[2].group(1)
markup = src[style_m.end():scripts[0].start()]  # body markup between </style> and the first <script>

# --- 1. claude.ai preview: one file, CDN libraries ---------------------------
preview = (src.replace("__LOGO__", logo_data)
              .replace("/*__ENGINE__*/", engine.replace("</script", "<\\/script"))
              .replace("/*__SAMPLE__*/", sample.replace("</script", "<\\/script")))
(ROOT / "build").mkdir(exist_ok=True)
(ROOT / "build" / "claude-preview.html").write_text(preview)

# --- 2. hosted version: local files only, locked down -------------------------
LOCAL_LIBS = '''const LIB = {
  zip: "vendor/jszip.min.js",
  clipper: "vendor/clipper.js",
  utif: "vendor/UTIF.js",
  pako: "vendor/pako_inflate.min.js"
};'''
hosted_js, n = re.subn(r"const LIB = \{.*?\n\};", LOCAL_LIBS, app_js, count=1, flags=re.S)
assert n == 1
assert "https://" not in re.sub(r"//[^\n]*", "", hosted_js.split("const RULES")[0]), "CDN URL left in hosted build"

CSP = "; ".join([
    "default-src 'none'",
    "script-src 'self'",                 # only the files in this folder; no inline or remote scripts
    "style-src 'self' 'unsafe-inline'",  # inline style attributes are used for layout
    "img-src 'self' data: blob:",        # artwork is opened locally as data:/blob: images
    "font-src 'self'",
    "connect-src 'none'",                # no fetch, XHR, WebSocket or beacons: nothing can be sent out
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
])

font_css = []
for fam, file, weight, style in [
    ("Cormorant Garamond", "cormorant-garamond-latin-500-normal", 500, "normal"),
    ("Cormorant Garamond", "cormorant-garamond-latin-600-normal", 600, "normal"),
    ("Cormorant Garamond", "cormorant-garamond-latin-400-italic", 400, "italic"),
    ("Cormorant Garamond", "cormorant-garamond-latin-500-italic", 500, "italic"),
    ("Hanken Grotesk", "hanken-grotesk-latin-400-normal", 400, "normal"),
    ("Hanken Grotesk", "hanken-grotesk-latin-500-normal", 500, "normal"),
    ("Hanken Grotesk", "hanken-grotesk-latin-600-normal", 600, "normal"),
    ("Hanken Grotesk", "hanken-grotesk-latin-700-normal", 700, "normal"),
    ("JetBrains Mono", "jetbrains-mono-latin-400-normal", 400, "normal"),
    ("JetBrains Mono", "jetbrains-mono-latin-500-normal", 500, "normal"),
]:
    font_css.append(f'@font-face {{ font-family: "{fam}"; src: url("fonts/{file}.woff2") format("woff2"); font-weight: {weight}; font-style: {style}; font-display: swap; }}')
font_css.append('/* Official LOEWE typeface: add its files here as "LOEWE Display" and every heading picks it up. */')

assets = ROOT / "assets"
(assets / "fonts.css").write_text("\n".join(font_css) + "\n")
(assets / "app.css").write_text(css + "\n")
(assets / "engine.js").write_text(engine)
(assets / "sample.js").write_text(sample)
(assets / "app.js").write_text(hosted_js + "\n")

body = markup.replace("__LOGO__", "assets/loewe-logo.png")
index = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="{CSP}">
<meta name="referrer" content="no-referrer">
<meta http-equiv="x-dns-prefetch-control" content="off">
<meta name="robots" content="noindex, nofollow">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Print Grading</title>
<link rel="stylesheet" href="assets/fonts.css">
<link rel="stylesheet" href="assets/app.css">
<style>:root{{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}}body{{margin:0}}img{{max-width:100%}}</style>
</head>
<body>
{body.strip()}

<script src="assets/engine.js"></script>
<script src="assets/sample.js"></script>
<script src="assets/app.js"></script>
</body>
</html>
'''
# the hosted page must not reference any other site
for m in re.finditer(r'(?:src|href)="(https?:[^"]+)"', index):
    raise SystemExit("External reference left in index.html: " + m.group(1))
(ROOT / "index.html").write_text(index)
print("index.html", len(index), "bytes; build/claude-preview.html", len(preview), "bytes")
