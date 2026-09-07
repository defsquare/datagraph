# Design system unifié + playground de consultation

Date : 2026-09-07
Statut : approuvé (brainstorming en session, design validé par David)

## Problème

Le projet a déjà un design system de fait, mais **dupliqué à la main en deux
endroits** :

- `packages/renderer/src/theme.ts` — le contrat de thème du canvas Pixi
  (4 thèmes : `defsquareLight/Dark`, `neutralLight/Dark`), consommé par
  `create.ts`/`draw.ts`.
- `apps/demo/src/style.css` — les variables `--ds-*`, `--space-*`,
  `--radius-*`, transitions et familles de polices du chrome DOM, recopiées
  manuellement depuis `theme.ts` (elles-mêmes issues du projet Claude Design
  « Defsquare Design System »).

Rien ne garantit la synchro (pas de test, pas de génération). Et il n'existe
aucun moyen de **consulter** le système : pour voir l'effet d'un token il faut
lancer la démo et provoquer les états à la main (hover, sélection, zoom
sémantique…).

## Objectif

1. **Une source de vérité unique** pour les tokens, qui alimente les deux
   surfaces (thèmes Pixi et variables CSS).
2. **Un playground** où chaque token et chaque composant s'exerce dans ses
   différents états, avec hot-reload pour itérer en développeur.

**Aucun changement visuel** : les valeurs actuelles deviennent les tokens ;
seule la plomberie change.

## Décision 1 — `packages/tokens`, source de vérité unique

Nouveau package `@defsquare/data-graph-tokens` : TypeScript pur, zéro
dépendance, zéro DOM (même contrainte que le renderer : utilisable hors
navigateur).

Contenu :

- **Primitives** : échelles de couleurs, familles de polices (EB Garamond,
  IBM Plex Sans Condensed, Fira Code — noms contractuels, `@font-face` côté
  démo et mesure BitmapFont côté renderer les référencent par ce nom).
- **Tokens sémantiques par thème** (`defsquare`/`neutral` × `light`/`dark`) :
  `surface`, `ink`, `accent`, `edge`, `typography`, `radii`, `spacing`,
  `strokes`, `motion`, `entityPalette`.

Consommation :

- **Pixi** : `packages/renderer/src/theme.ts` construit ses 4 thèmes depuis le
  package tokens au lieu de littéraux. Son API publique (`Theme`,
  `ThemeOverride`, `TypeStyle`, `resolveTheme`, `entityAccentMap`, les
  4 thèmes) **ne change pas**. Les tests de contrat existants
  (`theme.test.ts`, `api-surface.test.ts`) doivent passer inchangés — c'est la
  preuve de neutralité du refactor.
- **CSS** : un script du package génère `tokens.css` (blocs `:root` light et
  `html[data-theme="dark"]`) — fichier **généré et commité** dans
  `apps/demo/src/`, importé par `style.css` qui perd ses valeurs en dur. Un
  test de fraîcheur régénère en mémoire et compare au fichier commité (même
  philosophie que les tests de contrat du repo).

Alternative écartée : style-dictionary — grosse dépendance, tokens JSON non
typés, sur-outillé pour deux cibles.

## Décision 2 — `apps/design`, le playground

App Vite légère (pas de Tauri), `pnpm --filter design dev`, hot-reload sur les
tokens. Elle reprend le pattern d'alias dev de `apps/demo/vite.config.ts`
(résolution des paquets workspace vers leurs **sources**), ce qui lui permet
d'importer les modules internes du renderer (`draw.ts`, `theme.ts`,
`font-registry.ts`…) **sans élargir l'API publique** figée par
`api-surface.test.ts`.

Quatre vues, avec un toggle global light/dark et un sélecteur de thème
defsquare/neutral :

1. **Tokens** — swatches de couleurs light/dark côte à côte avec ratio de
   contraste ; spécimens typographiques rendus à la fois en DOM et en
   `BitmapFont` Pixi (pour voir ce que le canvas rend vraiment) ; échelles
   spacing/radius/strokes ; palette d'entités avec le mécanisme d'assignation
   par type (`entityAccentMap`).
2. **Composants graphe** — la convention « `draw.ts` ne prend que de la donnée
   nue » permet des mini-canvas Pixi qui appellent directement les fonctions
   de dessin avec des états forcés : carte de nœud (normal / hover /
   sélectionné / match / ref cassée / replié-déplié), arêtes (contain / ref /
   dangling, avec labels), enveloppes de clusters, disques sémantiques à
   plusieurs niveaux de zoom, pilules de tableau.
3. **Composants UI** — les éléments du chrome de la démo (boutons, panneaux
   flottants, champ de recherche, badges), chacun décliné dans ses états
   (repos / hover / focus / active / disabled), stylés par le même
   `tokens.css` + le CSS du chrome.
4. **Bac à sable** — une vraie instance `createDataGraph` sur une fixture
   existante d'`apps/demo/fixtures/`, pour juger les tokens en situation.

## Hors périmètre (volontairement)

- Exposer le theming à l'utilisateur CLI (`-c config.json`) — vrai manque,
  chantier séparé.
- Tokeniser les ~25 constantes de géométrie de `draw.ts` (flèches, ratios de
  disques…) — invariants de dessin, pas des choix de design.
- Persistance du choix light/dark, `prefers-color-scheme`.
- Tout rebranding : mêmes valeurs, nouvelle plomberie.

## Contraintes connues

- `setTheme()` ne redessine que les couleurs : changer typographie/polices
  impose de recréer l'instance (métriques mesurées à l'init). Le playground
  doit recréer ses canvas quand la typo change.
- L'ordre des clés de `config.ids` détermine l'assignation des couleurs
  d'`entityPalette` (délibéré, documenté dans `theme.ts`).
- CSP Tauri `font-src 'self'` : les woff2 restent auto-hébergés ; le
  playground les sert depuis son propre `public/` (copie ou lien vers ceux de
  la démo).

## Tests & garde-fous

- Test de fraîcheur `tokens.css` (généré vs commité) dans `packages/tokens`.
- `theme.test.ts` et `api-surface.test.ts` passent **sans modification**.
- Le playground est un outil de dev : pas d'e2e dédiés, mais son `pnpm build`
  est branché dans le build racine pour qu'il ne pourrisse pas.
