/* IMPORTANT : cette fonction est sérialisée via chrome.scripting.executeScript.
 * Aucune dépendance externe/globale autre que les API DOM natives. */
"use strict";
async function scanReader(scanToken, settings) {
  const config = settings || {};
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const pagePath = /\.(?:jpe?g|png|webp|gif|avif)$/i;
  const numbered = /(?:^|\/)(?:page[-_ ]*)?\d{1,6}\.(?:jpe?g|png|webp|gif|avif)$/i;
  const banned = /(?:^|[\/_-])(?:logo|avatar|icon|emoji|sprite|favicon|spinner|loader|thumb|thumbnail)(?:[\/_-]|\.)/i;
  const visited = new WeakMap();
  const collected = [];
  const loadedUrls = new Set();
  globalThis.__bdcbzScanTokens = globalThis.__bdcbzScanTokens || Object.create(null);
  if (!(scanToken in globalThis.__bdcbzScanTokens)) {
    globalThis.__bdcbzScanTokens[scanToken] = false;
  }
  let steps = 0;
  let aborted = false;
  const stopped = () => Boolean(globalThis.__bdcbzScanTokens?.[scanToken]);

  function asURL(raw) {
    if (!raw || typeof raw !== "string") return null;
    try {
      const u = new URL(raw.trim(), document.baseURI);
      return /^https?:$/.test(u.protocol) && pagePath.test(u.pathname) ? u.href : null;
    } catch { return null; }
  }
  function biggestSrcset(srcset) {
    if (!srcset) return null;
    const entries = srcset.split(",").map((chunk) => {
      const [url, modifier] = chunk.trim().split(/\s+/);
      return { url, weight: Number.parseFloat(modifier || "1") || 1 };
    }).filter((p) => asURL(p.url));
    entries.sort((a, b) => b.weight - a.weight);
    return entries[0]?.url || null;
  }
  function chooseRoot() {
    const selectors = [
      ".reading-content", ".reader-content", ".chapter-content", ".chapter-images",
      "#reader", "#chapter-content", "#reader-container", "[data-reader]",
      "[class*='reader-pages']", "[class*='chapter-reader']", "article", "main"
    ];
    let best = document.body;
    let score = -1;
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const rect = element.getBoundingClientRect();
        if (rect.width < 250) continue;
        const count = element.querySelectorAll("img, picture, [style*='background-image']").length;
        if (!count) continue;
        const candidateScore = count * 100 + Math.min(50000, element.scrollHeight || 0) / 100;
        if (candidateScore > score) { best = element; score = candidateScore; }
      }
    }
    return best;
  }
  const root = chooseRoot();

  function remember(raw, element, source) {
    const url = asURL(raw);
    if (!url) return;
    const parsed = new URL(url);
    if (banned.test(parsed.pathname)) return;
    const likelyPage = parsed.pathname.includes("/_converted/") || numbered.test(parsed.pathname);
    if (element) {
      if (element.closest("header, footer, nav, aside, [role='navigation']")) return;
      const rect = element.getBoundingClientRect();
      const width = element.naturalWidth || rect.width;
      const height = element.naturalHeight || rect.height;
      // Un nom de page numérique est suffisant pour une image différée dont la taille n'est pas encore connue.
      if ((width < 280 || height < 320) && !(likelyPage && !element.naturalWidth)) return;
      let seen = visited.get(element);
      if (!seen) { seen = new Set(); visited.set(element, seen); }
      if (seen.has(url)) return;
      seen.add(url);
    } else if (loadedUrls.has(url)) return;
    collected.push({ url, source });
    loadedUrls.add(url);
  }
  function scanDOM() {
    for (const img of root.querySelectorAll("img")) {
      const picture = img.closest("picture");
      const sources = picture?.querySelectorAll("source[srcset]") || [];
      const candidates = [
        img.getAttribute("data-original"), img.getAttribute("data-full"),
        img.getAttribute("data-url"), img.getAttribute("data-src"),
        img.getAttribute("data-lazy-src"), biggestSrcset(img.getAttribute("data-srcset")),
        ...[...sources].map((s) => biggestSrcset(s.getAttribute("srcset"))),
        biggestSrcset(img.getAttribute("srcset")), img.currentSrc, img.getAttribute("src")
      ];
      const pick = candidates.find((raw) => asURL(raw));
      if (pick) remember(pick, img, "DOM");
    }
    for (const element of root.querySelectorAll("[style*='background-image']")) {
      const raw = element.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/i)?.[1];
      if (!raw) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width >= 280 && rect.height >= 320) remember(raw, element, "background");
    }
  }
  function findScroller() {
    const main = document.scrollingElement || document.documentElement;
    let chosen = main;
    let diff = Math.max(0, main.scrollHeight - main.clientHeight);
    const candidates = [root, ...root.querySelectorAll("section, article, div")];
    for (const e of candidates) {
      const delta = e.scrollHeight - e.clientHeight;
      if (delta < 500 || e.clientHeight < 200) continue;
      const overflow = getComputedStyle(e).overflowY;
      if (/auto|scroll/.test(overflow) && delta > diff) { chosen = e; diff = delta; }
    }
    return chosen;
  }
  function notify() {
    try {
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        Promise.resolve(chrome.runtime.sendMessage({ type: "BDCBZ_SCAN", token: scanToken, count: loadedUrls.size, steps })).catch(() => {});
      }
    } catch { /* Aucun canal disponible dans cette page. */ }
  }

  const scroller = findScroller();
  const originalTop = scroller.scrollTop;
  const originalBehavior = scroller.style.scrollBehavior;
  const started = Date.now();
  try {
    scanDOM();
    notify();
    if (config.autoScroll !== false) {
      scroller.style.scrollBehavior = "auto";
      scroller.scrollTop = 0;
      let atBottom = 0;
      let previousHeight = -1;
      for (steps = 0; steps < 210 && Date.now() - started < 55000; steps++) {
        if (stopped()) { aborted = true; break; }
        await delay(180);
        scanDOM();
        const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const next = Math.min(max, scroller.scrollTop + Math.max(440, Math.round(scroller.clientHeight * 0.78)));
        scroller.scrollTop = next;
        if (steps % 4 === 0) notify();
        if (max - next <= 3) {
          if (previousHeight === scroller.scrollHeight) atBottom++;
          else atBottom = 0;
          previousHeight = scroller.scrollHeight;
          await delay(420);
          scanDOM();
          if (atBottom >= 2) break;
        } else atBottom = 0;
      }
    }
    scanDOM();
    // Inclure les ressources du même dossier que les planches déjà observées,
    // utile aux lecteurs qui virtualisent/suppriment le DOM après défilement.
    const sources = performance.getEntriesByType("resource").map((item) => asURL(item.name)).filter(Boolean);
    const groups = new Map();
    for (const url of sources) {
      const path = new URL(url).pathname;
      if (!path.includes("/_converted/") && !numbered.test(path)) continue;
      const folder = url.slice(0, url.lastIndexOf("/") + 1);
      if (!groups.has(folder)) groups.set(folder, new Set());
      groups.get(folder).add(url);
    }
    const observedFolders = new Set(collected.map((item) => item.url.slice(0, item.url.lastIndexOf("/") + 1)));
    const relevant = [...groups.entries()].filter(([folder]) => observedFolders.has(folder));
    const chosen = relevant.sort((a, b) => b[1].size - a[1].size)[0] ||
      (collected.length < 2 ? [...groups.entries()].sort((a, b) => b[1].size - a[1].size)[0] : null);
    if (chosen) for (const url of chosen[1]) if (!loadedUrls.has(url)) remember(url, null, "réseau");
    notify();
  } finally {
    scroller.scrollTop = originalTop;
    scroller.style.scrollBehavior = originalBehavior;
    delete globalThis.__bdcbzScanTokens[scanToken];
  }
  const heading = document.querySelector("h1")?.textContent?.trim() || "";
  const title = heading.length >= 6 && heading.length <= 110 ? heading : document.title || "Chapitre BD";
  return { title, pageUrl: location.href, candidates: collected, aborted, steps };
}

function abortReaderScan(scanToken) {
  if (!globalThis.__bdcbzScanTokens) globalThis.__bdcbzScanTokens = Object.create(null);
  globalThis.__bdcbzScanTokens[scanToken] = true;
  return true;
}
