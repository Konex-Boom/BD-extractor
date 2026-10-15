"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const base = path.resolve(__dirname, "..");

test("manifeste V3 chargé sans dépendance ni code distant", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(base, "manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "2.0.0");
  for (const name of ["activeTab", "scripting", "downloads"]) assert.ok(manifest.permissions.includes(name));
  assert.equal(manifest.action.default_popup, "popup.html");
  assert.ok(!manifest.background?.service_worker);
});

test("fichiers HTML, scripts locaux et contrôles d'interface présents", () => {
  const popup = fs.readFileSync(path.join(base, "popup.html"), "utf8");
  const workspace = fs.readFileSync(path.join(base, "workspace.html"), "utf8");
  assert.match(popup, /Télécharger en \.cbz/);
  for (const id of ["gallery", "filename", "export", "retry", "cancel", "stop-scan", "autoscroll", "notice", "progress", "error-panel"]) {
    assert.ok(workspace.includes(`id="${id}"`), `Contrôle manquant : ${id}`);
  }
  for (const script of ["core.js", "scanner.js", "workspace.js", "libs/jszip.min.js"]) {
    assert.ok(workspace.includes(`src="${script}"`));
    assert.ok(fs.existsSync(path.join(base, script)));
  }
  assert.doesNotMatch(workspace, /<script[^>]+src="https?:/);
});
