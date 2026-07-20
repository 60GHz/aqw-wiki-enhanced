"""Regenerate extension/src/data/wikidot-theme.js from extension/assets/wikidot-theme.css.

The skin must exist BEFORE first paint on every wiki page, in every browser,
with no fetch race - so it ships as a plain JS string loaded by the
document_start content script block (the same script-tag pattern every other
dataset uses). Run this after refreshing the css bundle:

    py tools/make-theme-js.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSS = os.path.join(ROOT, "extension", "assets", "wikidot-theme.css")
OUT = os.path.join(ROOT, "extension", "src", "data", "wikidot-theme.js")

with open(CSS, encoding="utf-8") as f:
    css = f.read()

with open(OUT, "w", encoding="utf-8", newline="\n") as f:
    f.write("/* Generated from extension/assets/wikidot-theme.css by tools/make-theme-js.py.\n"
            "   boot.js lays this down before first paint so the wiki can never\n"
            "   render bare - do not edit by hand, refresh the css and rerun. */\n")
    f.write("const AQWE_WIKIDOT_CSS = " + json.dumps(css) + ";\n")

print(f"wrote {OUT} ({os.path.getsize(OUT)} bytes)")
