// Capture de l'interface réelle avec données locales de démonstration.
// Sans navigation externe ni téléchargement de contenus tiers.
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

function htmlFor(file) {
  const css = readFileSync('style.css', 'utf8');
  return readFileSync(file, 'utf8')
    .replace(/<script\b[^>]*><\/script>/g, '')
    .replace('<link rel="stylesheet" href="style.css">', '<style>' + css + '</style>');
}

mkdirSync('docs/screenshots', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
try {
  const studio = await browser.newPage({ viewport: { width: 1170, height: 960 }, deviceScaleFactor: 1 });
  await studio.setContent(htmlFor('workspace.html'), { waitUntil: 'load' });
  const pics = Object.fromEntries(['001', '002', '004'].map(id => [
    id, 'data:image/webp;base64,' + readFileSync('demo/_converted/chapitre-test/' + id + '.webp').toString('base64')
  ]));
  await studio.evaluate((pics) => {
    const t = (id, content) => { document.getElementById(id).textContent = content; };
    t('domain', 'Lecteur de démonstration');
    t('chapter-title', 'Chapitre test — Galerie de démonstration');
    t('source-url', 'Lecteur local · page 003 absente de la séquence source');
    t('total-count', '3'); t('selected-count', '3'); t('duplicates-count', '1');
    t('scan-status', 'Analyse terminée — 3 planches détectées.');
    t('gallery-hint', '3 sur 3 planches sélectionnées. Ordre conservé.');
    const notice = document.getElementById('notice');
    notice.hidden = false;
    notice.textContent = '1 doublon retiré. Numéro manquant : 003. Aucune URL absente n’est inventée.';
    document.getElementById('empty').hidden = true;
    document.getElementById('gallery').innerHTML = ['001', '002', '004'].map((filename, i) =>
      '<label class="page-card selected"><div class="thumbnail"><img src="' + pics[filename] +
      '" alt="Page de démonstration"><input type="checkbox" checked><span class="number-pill">#' +
      String(i + 1).padStart(3, '0') + '</span></div><div class="page-info"><strong>' + filename +
      '.webp</strong><span class="page-state success">Prête</span></div></label>'
    ).join('');
    document.getElementById('filename').value = 'Chapitre test';
    document.getElementById('export').disabled = false;
    t('phase', 'IMAGES PRÊTES'); t('progress-label', '3 pages prêtes pour l’export');
    t('percent', '100 %'); document.getElementById('progress').value = 100;
    t('progress-count', '3 / 3 pages'); t('progress-size', '0,01 Mo transféré');
    t('export-status', 'Toutes les images sont récupérées. Le fichier CBZ peut être créé.');
  }, pics);
  await studio.screenshot({ path: 'docs/screenshots/studio.png', fullPage: true });
  await studio.close();

  const popup = await browser.newPage({ viewport: { width: 390, height: 260 }, deviceScaleFactor: 1 });
  await popup.setContent(htmlFor('popup.html'), { waitUntil: 'load' });
  await popup.screenshot({ path: 'docs/screenshots/popup.png', fullPage: true });
  await popup.close();
} finally {
  await browser.close();
}
