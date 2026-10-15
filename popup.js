"use strict";
const api = globalThis.chrome;
const start = document.querySelector("#start");
const status = document.querySelector("#status");
start.addEventListener("click", async () => {
  start.disabled = true;
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:\/\//i.test(tab.url || "")) {
      throw new Error("Ouvre d'abord un chapitre dans un onglet HTTP(S).");
    }
    await api.tabs.create({ url: api.runtime.getURL(`workspace.html?tab=${tab.id}`), active: true });
    window.close();
  } catch (error) {
    status.textContent = `Erreur : ${error.message || String(error)}`;
    start.disabled = false;
  }
});
