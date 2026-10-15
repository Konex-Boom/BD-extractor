"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require("node:path").join(__dirname, "../scanner.js"), "utf8");

function simulatedReader() {
  const imgs = [];
  const root = {
    naturalWidth: 0, style: { scrollBehavior: "smooth" }, scrollHeight: 1800, clientHeight: 500,
    getBoundingClientRect: () => ({ width: 900, height: 800 }),
    querySelectorAll: selector => selector === "img" || selector === "img, picture, [style*='background-image']" ? imgs : []
  };
  let top = 155;
  Object.defineProperty(root, "scrollTop", {
    get: () => top,
    set: val => {
      top = val;
      if (top > 400 && imgs.length < 2) imgs.push(image("https://bd.test/_converted/ch1/002.webp"));
      if (top > 950 && imgs.length < 3) imgs.push(image("https://bd.test/_converted/ch1/003.webp"));
    }
  });
  function image(url) {
    return {
      naturalWidth: 900, naturalHeight: 1200,
      getBoundingClientRect: () => ({ width: 900, height: 1200 }),
      getAttribute: key => key === "data-src" ? url : null,
      closest: () => null, currentSrc: ""
    };
  }
  imgs.push(image("https://bd.test/_converted/ch1/001.webp"));
  const doc = {
    baseURI: "https://bd.test/ch1", body: root, scrollingElement: root,
    title: "Chapitre 1", querySelector: () => null,
    querySelectorAll: selector => ["main", "article"].includes(selector) ? [root] : []
  };
  const ctx = { document: doc, URL, location: { href: doc.baseURI },
    performance: { getEntriesByType: () => [] },
    getComputedStyle: () => ({ overflowY: "auto" }),
    setTimeout, clearTimeout, Date, Promise, console
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  return { ctx, root, imgs };
}

test("le scanner trouve les pages différées et restaure le défilement", async () => {
  const { ctx, root } = simulatedReader();
  const result = await vm.runInContext("scanReader('test-scan', {autoScroll: true})", ctx);
  assert.deepEqual(Array.from(result.candidates, c => new URL(c.url).pathname.split("/").pop()),
    ["001.webp", "002.webp", "003.webp"]);
  assert.equal(root.scrollTop, 155);
  assert.equal(root.style.scrollBehavior, "smooth");
  assert.equal(result.aborted, false);
});

test("sans défilement automatique, seules les pages présentes sont retrouvées", async () => {
  const { ctx, root } = simulatedReader();
  const result = await vm.runInContext("scanReader('test-no-scroll', {autoScroll: false})", ctx);
  assert.equal(result.candidates.length, 1);
  assert.equal(root.scrollTop, 155);
});

test("l'annulation du scan est coopérative et restaure le défilement", async () => {
  const { ctx, root } = simulatedReader();
  const pending = vm.runInContext("scanReader('cancel-me', {autoScroll: true})", ctx);
  await new Promise(resolve => setTimeout(resolve, 50));
  vm.runInContext("abortReaderScan('cancel-me')", ctx);
  const result = await pending;
  assert.equal(result.aborted, true);
  assert.equal(root.scrollTop, 155);
  assert.equal(root.style.scrollBehavior, "smooth");
});
