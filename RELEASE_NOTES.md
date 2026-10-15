# BD Extractor v2.0.1

Mise à jour de l'interface d'analyse des planches.

- Spinner de chargement et barre animée indéterminée pendant la recherche.
- Cartes fantômes (skeletons) dans la galerie avant la première détection.
- Compteur du temps écoulé et détails de la progression (URL repérées, étapes).
- Arrêt de l'analyse conservé, avec restauration de la position de lecture.
- Disparition garantie de l'animation après succès, erreur ou annulation.
- Animations respectueuses de `prefers-reduced-motion`.
- Fonctions d'export CBZ, de sélection, de tri, de reprise et de compression inchangées.

## Installation
Télécharger l'archive `BD-extractor-v2.0.1.zip` dans les assets de la release. La décompresser puis charger le dossier contenant `manifest.json` depuis `chrome://extensions` ou `edge://extensions` avec le mode développeur. Pour une installation existante, remplacer le dossier puis cliquer sur **Actualiser** dans la page des extensions.

Cette extension n'accède qu'aux images accessibles normalement dans votre navigateur et pour lesquelles vous disposez de l'autorisation de sauvegarde.

## Qualité
19 tests automatisés réussis sur GitHub Actions, dont 3 tests dédiés au cycle de vie de l'indicateur de chargement.
