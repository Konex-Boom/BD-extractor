"use strict";
const api = globalThis.chrome;
const core = globalThis.CBZCore;
const $ = (id) => document.getElementById(id);
const ui = Object.fromEntries([
  "chapter-title", "source-url", "domain", "total-count", "selected-count", "duplicates-count",
  "rescan", "autoscroll", "scan-status", "scan-dot", "stop-scan", "notice",
  "gallery", "empty", "gallery-hint", "all", "none", "filename", "phase",
  "progress-label", "percent", "progress", "progress-count", "progress-size",
  "progress-errors", "export-status", "export", "cancel", "retry", "incomplete",
  "error-panel", "error-list"
].map((key) => [key.replaceAll("-", "_"), $(key)]));

const state = {
  tabId: Number(new URLSearchParams(location.search).get("tab")),
  scanToken: "", scanning: false, downloading: false,
  pages: [], diagnostics: null, controller: null, transfer: new Map(),
  phase: "idle", totalBytes: 0, downloadId: null, downloadReady: false,
  cancelRequested: false
};

function setText(id, text) { ui[id].textContent = text; }
function setPhase(phase, label) { state.phase = phase; setText("phase", label); }
function progress(percent, message) {
  const amount = Math.max(0, Math.min(100, percent));
  ui.progress.value = amount;
  ui.progress.textContent = `${Math.round(amount)}%`;
  setText("percent", `${Math.round(amount)} %`);
  if (message) setText("progress_label", message);
}
function visible(element, show) { element.hidden = !show; }
function currentSelection() { return state.pages.filter((p) => p.selected); }
function errorItems() { return currentSelection().filter((p) => p.state === "error"); }

function controls() {
  const any = currentSelection().length > 0;
  const hasErrors = errorItems().length > 0;
  const locked = state.scanning || state.downloading;
  ui.export.disabled = !any || locked;
  ui.rescan.disabled = locked;
  ui.autoscroll.disabled = locked;
  ui.all.disabled = locked || !state.pages.length;
  ui.none.disabled = locked || !state.pages.length;
  ui.filename.disabled = state.downloading;
  visible(ui.stop_scan, state.scanning);
  visible(ui.cancel, state.downloading);
  visible(ui.retry, !locked && hasErrors);
  visible(ui.incomplete, !locked && hasErrors && currentSelection().some((p) => p.data));
  ui.retry.textContent = `↻ Réessayer ${errorItems().length} erreur(s)`;
  ui.export.textContent = state.phase === "cancelled" ? "↻ Reprendre l'export" : "↓ Télécharger en .cbz";
}

function drawNotice() {
  const d = state.diagnostics;
  if (!d) { visible(ui.notice, false); return; }
  const messages = [];
  if (d.duplicates) messages.push(`${d.duplicates} doublon(s) retiré(s).`);
  if (d.missingCount) {
    const shown = d.missing.join(", ");
    messages.push(`${d.missingCount} numéro(s) de page manquant(s) dans la séquence détectée${shown ? ` : ${shown}${d.missingCount > d.missing.length ? "…" : ""}` : ""}. Aucune URL absente n'est inventée.`);
  }
  if (d.rejected) messages.push(`${d.rejected} URL non-image ignorée(s).`);
  ui.notice.textContent = messages.join(" ");
  visible(ui.notice, messages.length > 0);
}

function imageCard(item, index) {
  const card = document.createElement("label");
  card.className = `page-card${item.selected ? " selected" : ""}`;
  card.dataset.position = index;
  const picture = document.createElement("div");
  picture.className = "thumbnail";
  const img = document.createElement("img");
  img.loading = "lazy";
  img.alt = `Aperçu de la page ${index + 1}`;
  img.src = item.url;
  img.addEventListener("error", () => { img.hidden = true; picture.classList.add("unavailable"); });
  const fallback = document.createElement("div");
  fallback.className = "fallback";
  fallback.textContent = "Aperçu indisponible";
  picture.append(img, fallback);
  const check = document.createElement("input");
  check.type = "checkbox";
  check.checked = item.selected;
  check.disabled = state.downloading;
  check.setAttribute("aria-label", `Inclure la page ${index + 1}`);
  check.addEventListener("change", () => {
    if (state.downloading) return;
    item.selected = check.checked;
    card.classList.toggle("selected", item.selected);
    syncSelection();
  });
  const pill = document.createElement("span");
  pill.className = "number-pill";
  pill.textContent = `#${String(index + 1).padStart(3, "0")}`;
  picture.append(check, pill);
  const info = document.createElement("div");
  info.className = "page-info";
  const title = document.createElement("strong");
  title.textContent = item.name || `Page ${index + 1}`;
  title.title = title.textContent;
  const flag = document.createElement("span");
  flag.className = `page-state ${item.state || "idle"}`;
  flag.textContent = item.state === "success" ? "Prête" : item.state === "error" ? "Erreur" : item.state === "loading" ? "Chargement" : "À récupérer";
  if (item.error) flag.title = item.error;
  info.append(title, flag);
  card.append(picture, info);
  return card;
}

function renderGallery() {
  ui.gallery.replaceChildren();
  const fragment = document.createDocumentFragment();
  state.pages.forEach((item, index) => fragment.append(imageCard(item, index)));
  ui.gallery.append(fragment);
  visible(ui.empty, state.pages.length === 0);
  syncSelection();
}
function syncSelection() {
  setText("total_count", state.pages.length);
  setText("selected_count", currentSelection().length);
  setText("duplicates_count", state.diagnostics?.duplicates || 0);
  setText("gallery_hint", `${currentSelection().length} sur ${state.pages.length} planche(s) sélectionnée(s). L'ordre affiché sera conservé.`);
  controls();
}

async function stopScan() {
  if (!state.scanning || !state.scanToken) return;
  setText("scan_status", "Arrêt demandé : restauration de la position de lecture…");
  try {
    await api.scripting.executeScript({ target: { tabId: state.tabId }, func: abortReaderScan, args: [state.scanToken] });
  } catch { /* L'onglet a pu être fermé ou naviguer ailleurs. */ }
}

async function scan() {
  if (state.scanning || state.downloading) return;
  state.scanning = true;
  state.scanToken = crypto.randomUUID();
  const token = state.scanToken;
  setPhase("scan", "ANALYSE");
  setText("scan_status", "Recherche et chargement progressif des planches…");
  ui.scan_dot.classList.add("pulsing");
  setText("export_status", "Analyse en cours : prépare la sélection des images.");
  controls();
  try {
    const tab = await api.tabs.get(state.tabId);
    if (!/^https?:\/\//i.test(tab?.url || "")) throw new Error("L'onglet source n'est plus accessible.");
    setText("domain", new URL(tab.url).hostname);
    setText("source_url", tab.url);
    // Chrome attend la résolution de la Promise retournée par la fonction injectée.
    const res = await api.scripting.executeScript({
      target: { tabId: state.tabId }, world: "ISOLATED", func: scanReader,
      args: [token, { autoScroll: ui.autoscroll.checked }]
    });
    const result = res?.[0]?.result;
    if (!result) throw new Error("Le lecteur n'a retourné aucune information.");
    const diagnostic = core.analyzeCandidates(result.candidates);
    state.diagnostics = diagnostic;
    state.pages = diagnostic.pages.map((p) => ({ ...p, selected: true, state: "idle", data: null, extension: null, error: "" }));
    const title = core.chapterTitle(result.title);
    setText("chapter_title", title);
    ui.filename.value = title;
    setText("source_url", result.pageUrl);
    setText("scan_status", `${state.pages.length} image(s) détectée(s) en ${result.steps} étape(s)${result.aborted ? " (analyse interrompue)" : ""}. Position de lecture restaurée.`);
    drawNotice();
    renderGallery();
    setPhase("idle", "PRÊT");
    setText("export_status", state.pages.length ? "Vérifie la sélection, puis lance le téléchargement." : "Aucune planche accessible détectée. Réessaie après avoir ouvert le lecteur.");
    progress(0, "Prêt pour l'exportation.");
  } catch (error) {
    setText("scan_status", `Erreur : ${error?.message || String(error)}`);
    setText("export_status", "Vérifie que l'onglet source est ouvert et accessible, puis réanalyse.");
    setPhase("idle", "ERREUR D'ANALYSE");
  } finally {
    state.scanning = false;
    ui.scan_dot.classList.remove("pulsing");
    controls();
  }
}

function updateProgress(selected, active = 0) {
  const finished = selected.filter((p) => p.state === "success" || p.state === "error").length;
  const good = selected.filter((p) => p.state === "success").length;
  const bad = selected.filter((p) => p.state === "error").length;
  const transferred = selected.reduce((sum, p) => sum + (p.state === "success" ? p.data.byteLength : 0), 0) +
    [...state.transfer.values()].reduce((sum, bytes) => sum + bytes, 0);
  setText("progress_count", `${finished} / ${selected.length} pages traitées · ${good} OK`);
  setText("progress_size", `${core.formatBytes(transferred)} transféré`);
  setText("progress_errors", `${bad} erreur(s)`);
  progress(selected.length ? 80 * finished / selected.length : 0,
    `Récupération des images : ${finished} / ${selected.length}${active ? ` · ${active} en cours` : ""}`);
}

function showFailures(selected) {
  const failed = selected.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.state === "error");
  ui.error_list.replaceChildren();
  for (const item of failed.slice(0, 100)) {
    const li = document.createElement("li");
    li.textContent = `Page ${item.index + 1} : ${item.entry.error}`;
    li.title = item.entry.url;
    ui.error_list.append(li);
  }
  visible(ui.error_panel, failed.length > 0);
  return failed;
}

function drawDownloadStates() {
  // Le DOM complet est réutilisé plutôt que recharger toutes les miniatures.
  for (const card of ui.gallery.children) {
    const item = state.pages[Number(card.dataset.position)];
    const flag = card.querySelector(".page-state");
    if (!flag) continue;
    flag.className = `page-state ${item.state}`;
    flag.textContent = item.state === "success" ? "Prête" : item.state === "error" ? "Erreur" : item.state === "loading" ? "Chargement" : "À récupérer";
    flag.title = item.error || "";
    card.querySelector("input").disabled = state.downloading;
  }
}

function waitForDownload(id, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      api.downloads.onChanged.removeListener(changed);
      signal?.removeEventListener("abort", cancelled);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error); else resolve();
    };
    const cancelled = () => {
      api.downloads.cancel(id).catch(() => {});
      finish(new DOMException("Annulé", "AbortError"));
    };
    const changed = (delta) => {
      if (delta.id !== id || !delta.state) return;
      if (delta.state.current === "complete") finish();
      if (delta.state.current === "interrupted") finish(new Error(`Téléchargement interrompu : ${delta.error?.current || "inconnu"}`));
    };
    api.downloads.onChanged.addListener(changed);
    signal?.addEventListener("abort", cancelled, { once: true });
    if (signal?.aborted) { cancelled(); return; }
    api.downloads.search({ id }).then((records) => {
      if (records?.[0]?.state === "complete") finish();
      if (records?.[0]?.state === "interrupted") finish(new Error("Téléchargement interrompu."));
    }).catch(finish);
  });
}

async function saveBlob(blob, filename, signal) {
  const url = URL.createObjectURL(blob);
  try {
    if (signal?.aborted) throw new DOMException("Annulé", "AbortError");
    const id = await api.downloads.download({ url, filename, saveAs: false, conflictAction: "uniquify" });
    state.downloadId = id;
    await waitForDownload(id, signal);
  } finally {
    state.downloadId = null;
    URL.revokeObjectURL(url);
  }
}

async function buildAndSave(allowIncomplete = false) {
  if (state.downloading) return;
  const selected = currentSelection();
  const failed = selected.map((p, index) => ({ p, index })).filter(({ p }) => p.state !== "success");
  if (!selected.length || (!allowIncomplete && failed.length)) return;
  state.downloading = true;
  state.cancelRequested = false;
  state.controller = new AbortController();
  const signal = state.controller.signal;
  controls();
  try {
    setPhase("zip", "ARCHIVAGE");
    const issues = failed.map(({ p, index }) => ({ index, url: p.url, error: p.error || "Page non récupérée" }));
    const archive = await core.createCbz(JSZip, selected, issues, (percent) => {
      progress(80 + percent * 0.18, `Création de l'archive CBZ : ${Math.round(percent)} %`);
    });
    if (signal.aborted) throw new DOMException("Annulé", "AbortError");
    const filename = core.safeFilename(ui.filename.value) + (issues.length ? "_INCOMPLET" : "") + ".cbz";
    setPhase("download", "ENREGISTREMENT");
    progress(99, `Enregistrement : ${filename}`);
    await saveBlob(archive.blob, filename, signal);
    progress(100, `Terminé : ${archive.pageCount} / ${selected.length} page(s) exportée(s).`);
    setPhase("done", "TERMINÉ");
    setText("export_status", `${filename} a été enregistré dans tes Téléchargements.${issues.length ? " Archive incomplète, voir ERREURS.txt." : ""}`);
  } catch (error) {
    if (signal.aborted) {
      setPhase("cancelled", "ANNULÉ");
      setText("export_status", "Export annulé. Les images déjà récupérées restent disponibles tant que cet onglet est ouvert.");
    } else {
      setPhase("idle", "ERREUR");
      setText("export_status", `Export impossible : ${error?.message || String(error)}`);
    }
  } finally {
    state.downloading = false;
    state.controller = null;
    controls();
  }
}

async function downloadPages(retryOnly = false) {
  if (state.downloading || state.scanning) return;
  const selected = currentSelection();
  if (!selected.length) return;
  state.downloading = true;
  state.cancelRequested = false;
  state.controller = new AbortController();
  state.transfer.clear();
  const signal = state.controller.signal;
  setPhase("download", "RÉCUPÉRATION");
  setText("export_status", retryOnly ? "Nouvelle tentative sur les pages en erreur…" : "Téléchargement des images en cours…");
  visible(ui.error_panel, false);
  controls();
  const pending = selected.filter((p) => !p.data && (!retryOnly || p.state === "error"));
  for (const p of pending) { p.state = "idle"; p.error = ""; }
  drawDownloadStates();
  let index = 0;
  const worker = async () => {
    while (!signal.aborted) {
      const p = pending[index++];
      if (!p) return;
      p.state = "loading";
      drawDownloadStates();
      try {
        const result = await core.fetchImageWithRetry(p.url, {
          signal, maxAttempts: 3, timeoutMs: 25000,
          onProgress: (bytes) => { state.transfer.set(p.url, bytes); updateProgress(selected, pending.filter((x) => x.state === "loading").length); }
        });
        p.data = result.data;
        p.extension = result.extension;
        p.state = "success";
      } catch (error) {
        if (signal.aborted) {
          p.state = "idle";
        } else {
          p.state = "error";
          p.error = error?.message || String(error);
        }
      } finally {
        state.transfer.delete(p.url);
        updateProgress(selected, pending.filter((x) => x.state === "loading").length);
        drawDownloadStates();
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(3, pending.length) }, () => worker()));
    if (signal.aborted) {
      setPhase("cancelled", "ANNULÉ");
      setText("export_status", "Téléchargement annulé. Les images déjà récupérées restent disponibles. Clique sur Reprendre pour continuer.");
      return;
    }
    const failed = showFailures(selected);
    if (failed.length) {
      setPhase("idle", "ERREURS À CORRIGER");
      setText("export_status", `${failed.length} page(s) en erreur. Réessaie uniquement ces pages ou exporte une archive incomplète avec un rapport.`);
    } else {
      setPhase("idle", "IMAGES PRÊTES");
      setText("export_status", "Toutes les pages sont récupérées. Création du CBZ…");
    }
  } finally {
    state.downloading = false;
    state.controller = null;
    controls();
  }
  if (!errorItems().length && selected.every((p) => p.data)) await buildAndSave();
}

ui.rescan.addEventListener("click", scan);
ui.stop_scan.addEventListener("click", stopScan);
ui.all.addEventListener("click", () => {
  state.pages.forEach((p) => { p.selected = true; });
  renderGallery();
});
ui.none.addEventListener("click", () => {
  state.pages.forEach((p) => { p.selected = false; });
  renderGallery();
});
ui.export.addEventListener("click", () => downloadPages(false));
ui.retry.addEventListener("click", () => downloadPages(true));
ui.incomplete.addEventListener("click", () => buildAndSave(true));
ui.cancel.addEventListener("click", () => {
  if (!state.downloading) return;
  state.cancelRequested = true;
  state.controller?.abort();
  setText("export_status", "Annulation demandée…");
});
api.runtime.onMessage.addListener((message) => {
  if (message?.type === "BDCBZ_SCAN" && state.scanning && message.token === state.scanToken) {
    setText("scan_status", `${message.count} URL(s) repérée(s) · étape ${message.steps} du défilement…`);
  }
});

if (!Number.isInteger(state.tabId) || state.tabId < 1) {
  setText("scan_status", "Ouvre cette interface avec le bouton de l'extension depuis un chapitre.");
  setPhase("idle", "ONGLET MANQUANT");
} else {
  scan();
}
