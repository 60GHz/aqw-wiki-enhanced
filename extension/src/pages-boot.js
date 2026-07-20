/* AQW Wiki Enhanced - runs in the <head> of our standalone pages (Armory,
   Farm Goals) so the theme lands before first paint, exactly like boot.js
   does for the wiki. Extension pages cannot run inline scripts under MV3
   CSP, and chrome.storage is async - so the pages keep a synchronous
   localStorage mirror of the theme. setTheme() writes it; chrome.storage
   remains the truth and heals any drift moments later. */
"use strict";
try {
    const aqweBootTheme = localStorage.getItem("aqwe-theme") || "good";
    document.documentElement.dataset.theme = aqweBootTheme;
    document.documentElement.dataset.aqweTheme = aqweBootTheme;
} catch { /* storage blocked - the async read will set it */ }
