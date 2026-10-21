#!/usr/bin/env python3
"""Builds the two outputs from app.src.html:
   app.html   -> page body for the claude.ai artifact (no doctype; the host wraps it)
   index.html -> standalone file for GitHub Pages / LVMH hosting"""
import pathlib
here = pathlib.Path(__file__).parent
src = (here / "app.src.html").read_text()
logo = (here / "logo.txt").read_text().strip()
engine = (here / "engine.js").read_text().replace("</script", "<\\/script")
sample = (here / "sample.js").read_text().replace("</script", "<\\/script")
page = src.replace("__LOGO__", logo).replace("/*__ENGINE__*/", engine).replace("/*__SAMPLE__*/", sample)
(here / "app.html").write_text(page)
head = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
        'body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style></head><body>\n')
(here / "index.html").write_text(head + page + "\n</body></html>\n")
print("app.html", len(page), "bytes")
