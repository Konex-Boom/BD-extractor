# BD Extractor 2.0.0

Première release officielle de l'extension Chrome/Edge **Manifest V3**, par **BOOMTECH / Konex-Boom**.

## Nouveautés
- Galerie de prévisualisation avec sélection individuelle et globale.
- Défilement automatique du lecteur, avec restauration de la position.
- Détection des doublons et diagnostic de numéros manquants.
- Nom du fichier automatiquement proposé, personnalisable.
- Progression détaillée, annulation et reprise.
- Trois tentatives réseau au maximum et réessai ciblé des pages en erreur.
- Export direct en .cbz via JSZip, sans conversion dégradante des images.
- Tests automatisés exécutés avec Node.js 22 et GitHub Actions.

## Installation
1. Télécharger **BD-extractor-v2.0.0.zip** dans les assets de cette release.
2. Décompresser le ZIP.
3. Ouvrir `chrome://extensions` ou `edge://extensions`.
4. Activer le mode développeur, puis charger **le dossier extrait** (celui qui contient `manifest.json`).

> Ne chargez pas directement le ZIP comme une extension. Seules les images accessibles, pour lesquelles vous disposez des droits nécessaires, peuvent être exportées.
