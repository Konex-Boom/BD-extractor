"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const script = fs.readFileSync(path.join(__dirname, "../workspace.js"), "utf8");

function createWorkspace() {
  const nodes = new Map();
  function element(id) {
    if (nodes.has(id)) return nodes.get(id);
    const listeners = new Map();
    const obj = {
      id, hidden: false, disabled: false, textContent: "", value: "",
      children: [], dataset: {}, attributes: new Map(), listeners,
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute(name, value) { this.attributes.set(name, value); },
      addEventListener(name, fn) { listeners.set(name, fn); },
      replaceChildren(...items) { this.children = items; },
      append(...items) { this.children.push(...items); }
    };
    nodes.set(id, obj);
    return obj;
  }
  let resolveScan, rejectScan, messageCallback;
  const injected = new Promise((resolve, reject) => { resolveScan = resolve; rejectScan = reject; });
  const chrome = {
    tabs: { async get() { return { url: "https://reader.example/chapter" }; } },
    scripting: { executeScript() { return injected; } },
    runtime: { onMessage: { addListener(fn) { messageCallback = fn; } } }
  };
  const core = {
    analyzeCandidates() { return { pages: [], duplicates: 0, missingCount: 0, missing: [], rejected: 0 }; },
    chapterTitle(title) { return title; }
  };
  const ctx = {
    chrome, CBZCore: core, location: { search: "?tab=42" },
    document: { getElementById: element, createDocumentFragment() { return element("fragment"); } },
    URL, crypto: { randomUUID() { return "scan-42"; } },
    scanReader() {}, abortReaderScan() {},
    setInterval, clearInterval, Date, console
  };
  vm.runInNewContext(script, ctx);
  return {
    element, resolveScan, rejectScan,
    emit(message) { messageCallback(message); }
  };
}
async function settle() { await new Promise((resolve) => setImmediate(resolve)); }

test("un spinner et des cartes de chargement apparaissent immédiatement pendant l'analyse", async () => {
  const app = createWorkspace();
  assert.equal(app.element("scan-loading").hidden, false);
  assert.equal(app.element("gallery-loading").hidden, false);
  assert.equal(app.element("empty-message").hidden, true);
  assert.equal(app.element("scan-panel").attributes.get("aria-busy"), "true");
  await settle();
  app.emit({ type: "BDCBZ_SCAN", token: "scan-42", count: 2, steps: 3 });
  assert.match(app.element("scan-loading-title").textContent, /2 lien/);
  assert.match(app.element("scan-loading-hint").textContent, /étape 3/);
  app.resolveScan([{ result: { candidates: [], title: "Chapitre test", pageUrl: "https://reader.example/chapter", steps: 3, aborted: false } }]);
  await settle();
  assert.equal(app.element("scan-loading").hidden, true);
  assert.equal(app.element("gallery-loading").hidden, true);
  assert.equal(app.element("empty-message").hidden, false);
  assert.equal(app.element("scan-panel").attributes.get("aria-busy"), "false");
});

test("le chargement disparaît aussi en cas d'erreur d'analyse", async () => {
  const app = createWorkspace();
  await settle();
  app.rejectScan(new Error("Lecteur inaccessible"));
  await settle();
  assert.equal(app.element("scan-loading").hidden, true);
  assert.equal(app.element("gallery-loading").hidden, true);
  assert.match(app.element("scan-status").textContent, /Lecteur inaccessible/);
  assert.equal(app.element("scan-panel").attributes.get("aria-busy"), "false");
});

test("l'arrêt du scan conserve le chargement jusqu'à la restauration", async () => {
  const app = createWorkspace();
  await settle();
  app.element("stop-scan").listeners.get("click")();
  assert.match(app.element("scan-loading-title").textContent, /Arrêt de l’analyse/);
  assert.equal(app.element("scan-loading").hidden, false);
  app.resolveScan([{ result: { candidates: [], title: "Chapitre test", pageUrl: "https://reader.example/chapter", steps: 1, aborted: true } }]);
  await settle();
  assert.equal(app.element("scan-loading").hidden, true);
  assert.match(app.element("scan-status").textContent, /analyse interrompue/);
});
