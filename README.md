# BD vers CBZ 2.0 — Chrome & Edge (Manifest V3)

Extension pour prévisualiser, sélectionner et exporter en `.cbz` les **images accessibles** d'un chapitre, sans envoyer le contenu à un serveur externe. Compatible avec les lecteurs HTML exposant des fichiers JPEG, PNG, WebP, GIF ou AVIF. JSZip 3.10.1 est embarqué **localement**.

## Installer

1. Décompresser `BD-vers-CBZ-v2.zip` dans un dossier durable.
2. Ouvrir `chrome://extensions` (Chrome) ou `edge://extensions` (Edge).
3. Activer **Mode développeur**.
4. Cliquer sur **Charger l'extension non empaquetée**.
5. Sélectionner le dossier `BD-vers-CBZ-v2` qui contient `manifest.json`.
6. Si la V1 est installée, la désactiver pour éviter deux boutons identiques.

> **Important** : ne pas sélectionner le ZIP directement. L'extension reste chargée depuis le dossier extrait.

## Utiliser

1. Ouvrir le chapitre sur un site HTTP(S), attendre l'affichage des premières images.
2. Cliquer sur l'extension, puis sur **Télécharger en .cbz**.
3. Un onglet « Studio d'exportation » s'ouvre et analyse **l'onglet source**. Le défilement automatique tente de charger les images différées, puis restaure la position de lecture. Ne pas naviguer ailleurs dans l'onglet source pendant cette étape.
4. Examiner la galerie, décocher les planches non souhaitées, lire le diagnostic de doublons/pages manquantes et modifier le titre si nécessaire.
5. Cliquer sur **Télécharger en .cbz**. Le moteur télécharge jusqu'à **3 images à la fois**, réessaie les erreurs transitoires jusqu'à 3 fois, puis crée le CBZ.
6. En cas d'échec, cliquer sur **Réessayer les erreurs**. Si les images restent inaccessibles, utiliser **Exporter malgré les erreurs** pour produire un CBZ `_INCOMPLET.cbz` incluant `ERREURS.txt`.
7. Cliquer sur **Annuler** pour interrompre les requêtes. Le bouton Reprendre réutilise les images déjà récupérées dans cet onglet.
8. Retrouver le CBZ dans le dossier **Téléchargements**.

## Ce qui change depuis la version 1

- **Prévisualisation :** miniatures individuelles, cocher/décocher, tout sélectionner/tout retirer.
- **Progression :** nombre de pages, octets reçus, pourcentage, phase archive et erreurs.
- **Annulation :** arrêt des requêtes en cours et reprise sans retélécharger les pages validées.
- **Nom automatique :** titre de chapitre extrait de la page, renommable, caractères Windows invalides filtrés.
- **Doublons :** les URL provenant du même chemin d'origine sont éliminées, y compris avec paramètres d'URL différents.
- **Pages manquantes :** affichées si **toutes** les images suivent une numérotation comparable dans un même dossier ; aucune URL manquante n'est inventée.
- **Erreurs :** 3 tentatives pour les erreurs transitoires (pas de nouvelle tentative automatique sur 401/403/404), action manuelle pour les pages en échec et export incomplet explicite.
- **Défilement :** jusqu'à 210 étapes, maximum ~55 secondes, restauration de la position ; option pour désactiver le défilement.
- **Formats :** images conservées en JPEG/PNG/WebP/GIF/AVIF ; archive ZIP stockant les images sans recompression dégradante.

## Tests automatisés

Node.js 20 ou supérieur, aucune installation de dépendances requise :

```bash
cd BD-vers-CBZ-v2
npm run check
```

Les tests couvrent la sélection logique, l'ordre, les doublons, les numéros absents, les noms Windows, les signatures d'image, les nouvelles tentatives HTTP, l'annulation d'une requête, la génération du CBZ avec JSZip, le contenu des archives incomplètes et un lecteur simulé à chargement progressif, y compris le rétablissement du défilement.

### Démonstration facultative

Dans le dossier racine de l'extension :

```bash
python -m http.server 8765
```

Ouvrir `http://localhost:8765/demo/reader.html` dans Chrome/Edge puis lancer l'extension. Les images de démonstration sont créées spécialement pour ce projet. La page **003** est volontairement manquante et **002** est affichée deux fois ; l'extension doit signaler ces anomalies et exporter `page_001.webp`, `page_002.webp`, `page_003.webp` pour les **trois** images détectées (réindexées pour le CBZ).

## Organisation

- `manifest.json` : Manifest V3 et permissions.
- `popup.html` / `popup.js` : bouton d'ouverture du studio.
- `workspace.html` / `workspace.js` : interface galerie, téléchargement, annulation et export.
- `scanner.js` : script d'analyse injecté dans le lecteur.
- `core.js` : traitement des liens, numéros, réponses réseau et archive CBZ.
- `style.css` : thème sombre et disposition responsive.
- `libs/jszip.min.js` et `libs/JSZip-LICENSE.md` : dépendance locale et licence.
- `tests/` : tests Node.js.
- `demo/` : lecteur de démonstration local.

## Permissions et confidentialité

Permissions : `activeTab` (accès à la page visitée), `tabs` (retrouver l'onglet source), `scripting` (analyser le DOM), `downloads` (enregistrer le CBZ). Les hôtes `http://*/*` et `https://*/*` permettent la lecture d'images provenant de différents CDN. Pour restreindre cette autorisation, modifier `host_permissions` avec les domaines du lecteur et du CDN.

Aucun compte externe, service cloud ou script hébergé à distance. Le téléchargement et la création du fichier ont lieu **localement** dans le navigateur. L'onglet du studio doit rester ouvert pendant le traitement.

## Limitations

- L'extension lit uniquement les URL d'images accessibles et exposées dans le DOM ou les ressources effectivement chargées : **pas d'exploration de répertoires serveur, pas de devinette d'URL, pas de contournement DRM, de paywall, d'authentification ou d'anti-hotlinking**.
- Les lecteurs `<canvas>` exclusifs, contenus chiffrés ou contenus contenus dans certains cadres tiers peuvent ne pas être compatibles.
- Certains CDN empêchent la prévisualisation depuis la page d'extension ; l'image peut néanmoins être téléchargée, ou apparaître en erreur si le serveur bloque aussi la requête.
- Les archives très volumineuses peuvent utiliser beaucoup de mémoire : les fichiers image sont maintenus en RAM pendant la création du CBZ.
- L'annulation est immédiate pendant la récupération d'images, mais peut être **différée pendant la compression ZIP**, qui n'est pas interruptible via `generateAsync` ; le téléchargement final ne sera pas lancé si l'utilisateur a annulé.
- La récupération d'un chapitre complet dépend de ce que le lecteur charge réellement ; le résultat doit être vérifié dans la galerie.
- Les tests automatisés passent sur un lecteur DOM simulé. Les sites tiers, dont `bdplus.cc`, ne sont **pas** couverts par une validation d'intégration réelle.

Le projet est conçu pour des copies autorisées et pour les pages auxquelles tu as déjà accès normalement.
