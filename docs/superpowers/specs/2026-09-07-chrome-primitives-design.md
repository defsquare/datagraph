# Primitives du chrome : une source unique pour la démo et le catalogue

Date : 2026-09-07
Statut : approuvé (brainstorming en session, design validé par David)

## Problème

Le playground du design system (`apps/design`, livré par le chantier
précédent) a une vue « Composants UI » qui **reconstitue** le chrome de la
démo : ~360 lignes de CSS recopiées de `apps/demo/src/style.css` et les tracés
SVG des icônes recopiés de `apps/demo/index.html`. La feuille du playground le
documente elle-même comme une dette.

C'est le défaut central d'un catalogue : deux sources à maintenir. Si le chrome
de la démo évolue, la planche montre un composant qui n'existe plus, et **rien
ne casse** pour le signaler. La vue « Composants graphe » n'a pas ce problème —
elle appelle les vraies fonctions de `packages/renderer/src/draw.ts`. La vue UI
doit rejoindre ce régime : montrer le composant réel, pas sa photographie.

## Objectif

Extraire les **primitives visuelles** du chrome en un package partagé, consommé
par la démo *et* par le catalogue. Après ce chantier, la vue UI du playground
n'a plus une seule ligne de CSS ni un seul SVG recopiés.

**Aucun changement visuel** : les règles sont déplacées, pas réécrites.

## Décision 1 — `packages/chrome`, package privé

`@defsquare/data-graph-chrome`, `"private": true`, sans build tsup : les
`exports` pointent directement sur `src/`. Les deux consommateurs sont des
applications Vite, elles compilent la source. Le rendre publiable plus tard ne
coûterait qu'un `tsup.config.ts` et un README public — rien de structurel.

Contenu :

- **`src/chrome.css`** — les règles des primitives, déplacées telles quelles
  depuis `apps/demo/src/style.css` : `.float` ; `.cluster` / `.cluster-sep` ;
  `.ibtn` / `.ibtn-sm` avec `:hover`, `:active`, `:disabled`, `:focus-visible`,
  `[aria-expanded="true"]`, `[aria-busy="true"]:disabled`, ses keyframes et sa
  garde `prefers-reduced-motion` ; `.findbar`, `.findbar:focus-within`,
  `.findbar-icon`, `.findbar-input`, `.findbar-counter`, `.findbar-nav` ;
  `.menu`, `.menu-item` ; `.badge` ; `.status-link` ; `.ref-btn`.
- **`src/icons.ts`** — les neuf tracés SVG du chrome (`search`, `fit`, `tidy`,
  `graph`, `structure`, `dots`, `close`, `up`, `down`) et la fabrique `icon()`.
  Ils vivent aujourd'hui en dur dans `apps/demo/index.html` **et** recopiés dans
  `apps/design/src/views/ui-components.ts`.
- **Les fabriques de markup** — `createFloat`, `createCluster`,
  `createIconButton`, `createFindbar`, `createMenu` / `createMenuItem`,
  `createBadge`, `createStatusLink`, `createRefButton`.

Trois primitives passent d'un sélecteur d'id à un sélecteur de classe :
`#search` → `.findbar-input`, `#match-counter` → `.findbar-counter`,
`#selection-type` → `.badge`. Les ids restent **posés sur les instances** : dix-huit
d'entre eux sont utilisés par les tests e2e et par le câblage TS de la démo. Les
fabriques acceptent donc un `id` en option.

### Aucun comportement dans le package

Le pattern « panneau dépliant » de `chrome.ts` (aria-expanded, fermeture au clic
extérieur, Échap) n'entre PAS dans le package. Le catalogue n'en a pas besoin —
il montre `aria-expanded="true"` comme un état statique — donc ce code ne serait
pas *partagé* mais seulement *déplacé*. Et la politique d'Échap de la démo (un
seul niveau à la fois, le plus récent d'abord ; `preventDefault` pour éviter que
le champ de recherche ne se vide sans émettre d'`input`) est une décision
produit sur ces deux panneaux-là, pas une propriété d'une primitive.

## Décision 2 — La frontière : primitives, pas assemblages

Le package ne porte que le **vocabulaire visuel**. Les **assemblages produit**
restent dans la démo : le contenu de la barre d'outils (quels boutons, dans quel
ordre), les entrées du menu, la structure du panneau de détail
(`.detail-head`, `#selection-rows .row`, `dt`/`dd`), la barre de statut, l'écran
d'erreur de chargement, et toute la mise en place en `position: fixed`
(`#toolbar`, `#detail`, `#statusbar`, `#logo`, `#load-error`).

Conséquence assumée : le catalogue montre les primitives, pas des écrans
entiers. C'est le périmètre d'un design system — au-delà, le package hériterait
de choix produit et deviendrait le passage obligé de toute évolution de l'UI.

## Décision 3 — Les consommateurs

**La démo.** `apps/demo/src/style.css` importe `chrome.css` après `tokens.css`
et perd les règles des primitives. `apps/demo/index.html` perd le markup des
primitives et garde les conteneurs positionnés. `chrome.ts` construit le contenu
de ces conteneurs par les fabriques, puis câble exactement comme aujourd'hui ;
`detail-panel.ts` utilise `createBadge` et `createRefButton`.

**Le playground.** `apps/design/src/views/ui-components.css` tombe de 361 à
environ 80 lignes — il ne garde que l'ossature de la planche (`.uic-section`,
`.uic-row`, `.uic-cell`, le damier). `ui-components.ts` perd son bloc `ICONS` et
construit ses spécimens avec les fabriques du package.

## Tests

- **Nouveau : un environnement DOM.** Le monorepo n'en a pas. `packages/chrome`
  prend `happy-dom` en devDep et teste que chaque fabrique produit les bonnes
  classes, les bons ids et les bons attributs ARIA — c'est le contrat que la
  démo et le catalogue partagent désormais.
- **Filet d'intégration : les e2e Playwright de la démo, inchangés.** Ce sont
  eux qui prouvent que le refactor du markup n'a rien cassé ; ils doivent passer
  sans modification. Ils ne font pas partie de `pnpm test` : il faut lancer
  `pnpm --filter demo e2e` explicitement.
- Aucun test de fraîcheur à écrire : la duplication disparaît au lieu d'être
  surveillée.

## Hors périmètre

- Les trois manques que la planche avait révélés — pas de `:active` sur
  `.menu-item`, pas de `:disabled` sur `.findbar-nav`, encre `#ffffff` en dur
  sur la pastille faute d'un token « encre sur accent ». Ce sont des décisions
  de design, pas du refactor ; elles restent au backlog.
- Publier le package.
- Tout rebranding ou nouveau composant.

## Contraintes connues

- Les dix-huit ids utilisés par les e2e doivent survivre au refactor.
- `chrome.css` doit être importé après `tokens.css` : il consomme les variables
  `--ds-*`, `--float-*`, `--radius-*`, `--space-*`, `--transition`.
- Les `@import` restent en tête de `style.css` (règle CSS).
- La démo est empaquetée dans une coquille Tauri : le CSS est bundlé, aucune
  requête sortante n'est introduite.
- Le markup des primitives passe de statique (dans `index.html`) à construit en
  TS. Le chrome apparaît donc après l'exécution du script — sans conséquence
  pratique, le canvas exige déjà JS, et les panneaux concernés sont `hidden` au
  départ.
