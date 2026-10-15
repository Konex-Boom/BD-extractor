"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const JSZip = require("../libs/jszip.min.js");
const core = require("../core.js");
const base = "https://bd.example/_converted/chapitre-5/";
const bytesPng = Uint8Array.from(Buffer.from("89504e470d0a1a0a0000000d4948445200000001", "hex"));
const bytesWebp = Uint8Array.from(Buffer.from("52494646080000005745425056503820", "hex"));

function item(n, ext = "webp") { return { url: `${base}${String(n).padStart(3, "0")}.${ext}` }; }

test("détecte, dédoublonne et classe 003,001,002 en 001,002,003", () => {
  const result = core.analyzeCandidates([
    item(3), item(1), { url: `${base}001.webp?signature=autre` }, item(2), item(2),
    { url: "https://bd.example/logo.svg" }
  ]);
  assert.deepEqual(result.pages.map((p) => p.number), [1, 2, 3]);
  assert.equal(result.duplicates, 2);
  assert.equal(result.rejected, 1);
  assert.equal(result.missingCount, 0);
  assert.equal(result.numericSort, true);
});

test("signale les pages manquantes sans fabriquer d'URL", () => {
  const result = core.analyzeCandidates([item(1), item(3), item(6)]);
  assert.deepEqual(result.missing, [2, 4, 5]);
  assert.equal(result.missingCount, 3);
  assert.equal(result.pages.length, 3);
});

test("conserve l'ordre DOM lorsque la numérotation est ambiguë", () => {
  const other = { url: "https://bd.example/other/001.webp" };
  const result = core.analyzeCandidates([item(3), other, item(1)]);
  assert.deepEqual(result.pages.map((p) => p.url), [item(3).url, other.url, item(1).url]);
  assert.equal(result.numericSort, false);
});

test("filtre URL dangereuses/non-images et normalise les noms Windows", () => {
  assert.equal(core.normalizedUrl("javascript:alert(1)"), null);
  assert.equal(core.normalizedUrl("file:///etc/shadow"), null);
  assert.equal(core.normalizedUrl("https://bd.example/chapter.js"), null);
  assert.equal(core.safeFilename('Chapitre: 02 / fin*?<>'), "Chapitre_ 02 _ fin____");
  assert.equal(core.safeFilename("CON"), "Chapitre BD");
  assert.equal(core.chapterTitle("Titre | Read online"), "Titre");
});

test("reconnaît les signatures PNG, WebP, JPEG, GIF et AVIF", () => {
  assert.equal(core.detectExtension(bytesPng), "png");
  assert.equal(core.detectExtension(bytesWebp), "webp");
  assert.equal(core.detectExtension(Uint8Array.from([0xff,0xd8,0xff,0x00])), "jpg");
  assert.equal(core.detectExtension(Uint8Array.from(Buffer.from("GIF89a"))), "gif");
  assert.equal(core.detectExtension(Uint8Array.from(Buffer.from("00000018667479706176696600000000", "hex"))), "avif");
  assert.equal(core.detectExtension(Uint8Array.from(Buffer.from("<html>Forbidden</html>"))), null);
});

test("récupère une image après une erreur 503 avec progression", async () => {
  let calls = 0, transferred = 0;
  const data = new Uint8Array([...bytesPng, ...Array(70).fill(0)]);
  const fetchFn = async () => {
    calls++;
    if (calls === 1) return { ok: false, status: 503 };
    return { ok: true, headers: { get: () => "image/png" }, body: {
      getReader: () => {
        let read = false;
        return { read: async () => {
          if (read) return { done: true };
          read = true;
          return { done: false, value: data };
        } };
      }
    } };
  };
  const result = await core.fetchImageWithRetry(item(1).url, { fetchFn, onProgress: n => { transferred = n; } });
  assert.equal(calls, 2);
  assert.equal(result.extension, "png");
  assert.equal(result.byteLength, data.length);
  assert.equal(transferred, data.length);
});

test("ne réessaie pas les réponses 403", async () => {
  let calls = 0;
  await assert.rejects(core.fetchImageWithRetry(item(1).url, {
    fetchFn: async () => { calls++; return { ok: false, status: 403 }; }
  }), /HTTP 403/);
  assert.equal(calls, 1);
});

test("une annulation interrompt la requête", async () => {
  const ctl = new AbortController();
  let sent = false;
  const result = core.fetchImageWithRetry(item(1).url, {
    signal: ctl.signal,
    fetchFn: (_url, opts) => new Promise((_resolve, reject) => {
      opts.signal.addEventListener("abort", () => { sent = true; reject(new DOMException("Aborted", "AbortError")); });
    })
  });
  ctl.abort();
  await assert.rejects(result, { name: "AbortError" });
  assert.equal(sent, true);
});

test("construit un vrai CBZ ordonné avec les bonnes extensions", async () => {
  const entries = [
    { data: bytesPng, extension: "png" }, { data: bytesWebp, extension: "webp" }
  ];
  const updates = [];
  const result = await core.createCbz(JSZip, entries, [], p => updates.push(p));
  const archive = await JSZip.loadAsync(await result.blob.arrayBuffer());
  assert.deepEqual(Object.keys(archive.files), ["page_001.png", "page_002.webp"]);
  assert.deepEqual(await archive.file("page_001.png").async("uint8array"), bytesPng);
  assert.equal(result.pageCount, 2);
  assert.ok(updates.length > 0);
});

test("préserve les numéros absents et signale les erreurs dans ERREURS.txt", async () => {
  const entries = [
    { data: bytesPng, extension: "png" },
    { data: null },
    { data: bytesWebp, extension: "webp" }
  ];
  const archive = await core.createCbz(JSZip, entries, [{ index: 1, error: "HTTP 404", url: item(2).url }]);
  const zip = await JSZip.loadAsync(await archive.blob.arrayBuffer());
  assert.deepEqual(Object.keys(zip.files), ["page_001.png", "page_003.webp", "ERREURS.txt"]);
  assert.match(await zip.file("ERREURS.txt").async("string"), /Page 2 : HTTP 404/);
});

test("refuse un CBZ contenant uniquement des pages en erreur", async () => {
  await assert.rejects(core.createCbz(JSZip, [{ data: null }]), /Aucune page/);
});
