/* Fonctions sans dépendance DOM. Utilisées aussi dans les tests Node.js. */
"use strict";
(function (root, factory) {
  const core = factory();
  root.CBZCore = core;
  if (typeof module !== "undefined" && module.exports) module.exports = core;
})(globalThis, function () {
  const HTTP = /^https?:$/;
  const IMAGE_PATH = /\.(?:jpe?g|png|webp|gif|avif)$/i;
  const PAGE_NAME = /(?:^|\/)(?:page[-_ ]*)?(\d{1,6})\.(?:jpe?g|png|webp|gif|avif)$/i;

  function normalizedUrl(raw, base) {
    try {
      const url = new URL(raw, base);
      if (!HTTP.test(url.protocol) || !IMAGE_PATH.test(url.pathname)) return null;
      url.hash = "";
      return url.href;
    } catch { return null; }
  }

  function pageNumber(url) {
    const match = new URL(url).pathname.match(PAGE_NAME);
    return match ? Number(match[1]) : null;
  }

  function safeFilename(input) {
    let result = String(input || "Chapitre BD")
      .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, "_")
      .replace(/\s+/g, " ").replace(/^[. ]+|[. ]+$/g, "")
      .slice(0, 100).trim();
    if (!result || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(result)) {
      result = "Chapitre BD";
    }
    return result;
  }

  function chapterTitle(input) {
    const value = String(input || "Chapitre BD")
      .replace(/\s+[|｜–—]\s+(?:lecture en ligne|scan|read online|bdplus|manga[^|]*)$/i, "")
      .trim();
    return safeFilename(value || "Chapitre BD");
  }

  function analyzeCandidates(candidates) {
    const unique = new Map();
    let duplicates = 0;
    let rejected = 0;
    for (const candidate of candidates || []) {
      const raw = typeof candidate === "string" ? candidate : candidate?.url;
      const url = normalizedUrl(raw);
      if (!url) { rejected++; continue; }
      // Certains CDN fournissent plusieurs URL signées pour un même fichier.
      // Conserver le premier exemplaire du même chemin, sans supprimer des pages de chemins différents.
      const parsed = new URL(url);
      const key = `${parsed.origin}${parsed.pathname}`;
      if (unique.has(key)) { duplicates++; continue; }
      unique.set(key, {
        url, name: decodeURIComponentSafe(parsed.pathname.split("/").pop()),
        number: pageNumber(url), directory: `${parsed.origin}${parsed.pathname.slice(0, parsed.pathname.lastIndexOf("/") + 1)}`,
        source: candidate?.source || "lecteur"
      });
    }
    const pages = [...unique.values()];
    const numbered = pages.length > 1 && pages.every((p) => p.number !== null);
    const sameDirectory = new Set(pages.map((p) => p.directory)).size === 1;
    const uniqueNumbers = new Set(pages.map((p) => p.number)).size === pages.length;
    let missing = [];
    let missingCount = 0;
    let numericSort = false;
    if (numbered && sameDirectory && uniqueNumbers) {
      pages.sort((a, b) => a.number - b.number);
      numericSort = true;
      const existing = new Set(pages.map((p) => p.number));
      for (let n = pages[0].number; n < pages.at(-1).number; n++) {
        if (existing.has(n)) continue;
        missingCount++;
        if (missing.length < 40) missing.push(n);
        if (missingCount > 100000) break;
      }
    }
    return { pages, duplicates, rejected, missing, missingCount, numericSort };
  }

  function decodeURIComponentSafe(str) {
    try { return decodeURIComponent(str); } catch { return str; }
  }

  function detectExtension(data, mime = "") {
    const a = data instanceof Uint8Array ? data : new Uint8Array(data);
    const ascii = (start, end) => String.fromCharCode(...a.slice(start, end));
    if (a.length >= 3 && a[0] === 0xff && a[1] === 0xd8 && a[2] === 0xff) return "jpg";
    if (a.length >= 8 && a[0] === 0x89 && ascii(1, 4) === "PNG") return "png";
    if (a.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
    if (a.length >= 6 && ascii(0, 4) === "GIF8") return "gif";
    if (a.length >= 12 && ascii(4, 8) === "ftyp" && /avif|avis|mif1/.test(ascii(8, 20))) return "avif";
    // Préférer les signatures. Un MIME image sert de dernier recours pour des formats atypiques.
    const types = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };
    return a.length > 50 ? (types[String(mime).split(";")[0].toLowerCase()] || null) : null;
  }

  function isAbort(_error, signal) {
    // Un timeout interne n’est pas une annulation demandée par l’utilisateur.
    return Boolean(signal?.aborted);
  }

  function pause(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new DOMException("Annulé", "AbortError"));
      const handle = setTimeout(finish, ms);
      function abort() {
        clearTimeout(handle);
        reject(new DOMException("Annulé", "AbortError"));
      }
      function finish() { signal?.removeEventListener("abort", abort); resolve(); }
      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  async function fetchImageWithRetry(url, options = {}) {
    const fetchFn = options.fetchFn || fetch;
    const signal = options.signal;
    const maxAttempts = options.maxAttempts || 3;
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal?.aborted) throw new DOMException("Annulé", "AbortError");
      const controller = new AbortController();
      let expired = false;
      const deadline = setTimeout(() => { expired = true; controller.abort(); }, options.timeoutMs || 25000);
      const cancel = () => controller.abort();
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        options.onAttempt?.(attempt);
        options.onProgress?.(0);
        const response = await fetchFn(url, { method: "GET", redirect: "follow", credentials: "include", signal: controller.signal });
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}`);
          error.code = response.status;
          throw error;
        }
        const chunks = [];
        let length = 0;
        if (response.body?.getReader) {
          const reader = response.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            length += value.byteLength;
            options.onProgress?.(length);
          }
        } else {
          const array = new Uint8Array(await response.arrayBuffer());
          chunks.push(array);
          length = array.length;
          options.onProgress?.(length);
        }
        if (!length) throw new Error("Image vide");
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        const extension = detectExtension(bytes, response.headers?.get?.("content-type") || "");
        if (!extension) throw new Error("Contenu non reconnu comme une image");
        return { data: bytes, extension, byteLength: length };
      } catch (error) {
        if (isAbort(error, signal)) throw new DOMException("Annulé", "AbortError");
        lastError = expired ? new Error("Délai dépassé") : error;
        const status = error?.code;
        if (status >= 400 && status < 500 && status !== 408 && status !== 429) break;
      } finally {
        clearTimeout(deadline);
        signal?.removeEventListener("abort", cancel);
      }
      if (attempt < maxAttempts) await pause(400 * attempt, signal);
    }
    throw lastError || new Error("Image inaccessible");
  }

  async function createCbz(JSZipClass, entries, errors = [], onProgress = () => {}) {
    const zip = new JSZipClass();
    const digits = Math.max(3, String(entries.length).length);
    let count = 0;
    entries.forEach((entry, index) => {
      if (!entry?.data) return;
      const name = `page_${String(index + 1).padStart(digits, "0")}.${entry.extension}`;
      zip.file(name, entry.data, { binary: true, compression: "STORE" });
      count++;
    });
    if (!count) throw new Error("Aucune page récupérée : impossible de créer un CBZ.");
    if (errors.length) zip.file("ERREURS.txt", [
      `Export incomplet : ${count}/${entries.length} pages.`,
      "Les numéros manquants dans le CBZ correspondent aux pages non récupérées.", "",
      ...errors.map((entry) => `Page ${entry.index + 1} : ${entry.error} — ${entry.url}`)
    ].join("\n"));
    const blob = await zip.generateAsync({ type: "blob", compression: "STORE", mimeType: "application/vnd.comicbook+zip" },
      ({ percent }) => onProgress(percent));
    return { blob, pageCount: count };
  }

  function formatBytes(bytes) {
    return `${(Math.max(0, bytes) / 1048576).toFixed(1).replace(".", ",")} Mo`;
  }

  return {
    normalizedUrl, pageNumber, safeFilename, chapterTitle, analyzeCandidates,
    detectExtension, fetchImageWithRetry, createCbz, formatBytes
  };
});
