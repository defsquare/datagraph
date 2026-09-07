# @defsquare/data-graph-chrome

Les primitives DOM du chrome de data-graph : surface flottante, bouton d'icône,
recherche dépliante, menu, pastille d'entité, lien de statut, bouton de
référence. Trois choses, et rien d'autre :

- `src/chrome.css` — l'habillage des primitives ;
- `src/icons.ts` — les neuf icônes du chrome, seule source ;
- `src/factories.ts` — les fabriques de markup (`createIconButton`,
  `createFindbar`, `createMenu`, `createBadge`, …).

```ts
import { createIconButton, createFindbar } from "@defsquare/data-graph-chrome";
import "@defsquare/data-graph-chrome/chrome.css"; // APRÈS les tokens
```

## Pourquoi ce paquet existe

`apps/design` catalogue le design system. Sa planche des composants graphe
appelle les vraies fonctions de dessin du renderer, donc un spécimen ne peut pas
mentir sur ce que le produit peint. Sa planche des composants UI ne pouvait pas
en faire autant : les primitives vivaient dans `apps/demo`, et la planche les
**recopiait** — CSS et tracés SVG. Deux sources dérivent, et rien ne casse quand
elles dérivent.

Les deux applications consomment désormais ce paquet. La recopie a disparu, elle
n'est donc plus à surveiller.

## Ce que ce paquet ne contient pas

- **Aucun comportement.** Pas de gestion d'ouverture, pas d'écouteur global, pas
  d'état. Les fabriques produisent du DOM inerte. La politique d'Échap de la
  démo — un seul niveau à la fois, `preventDefault` pour que le champ de
  recherche ne se vide pas en silence — est une décision sur SES deux panneaux.
- **Aucun assemblage.** Le contenu de la barre d'outils, les entrées du menu, la
  structure du panneau de détail et la barre d'état appartiennent à
  l'application : ce sont des choix produit, et les héberger ici ferait de ce
  paquet le passage obligé de toute évolution de l'interface.

## Forme du paquet

Privé, sans build : les `exports` pointent directement sur `src/`. Les deux
consommateurs sont des applications Vite, elles compilent la source. Le rendre
publiable coûterait un `tsup.config.ts` et un README public — rien de
structurel.

Les fabriques acceptent toutes un `id` : les instances de la démo sont désignées
par id, par son câblage comme par ses tests de bout en bout.

`pnpm --filter @defsquare/data-graph-chrome test` — les fabriques sont testées
sous happy-dom, le premier environnement DOM du dépôt. Ce que ces tests figent
(classes, ids, attributs ARIA) est le contrat que la démo et le catalogue
partagent.

Décision et alternatives rejetées :
[`docs/adr/0029-chrome-primitives-shared-package.md`](../../docs/adr/0029-chrome-primitives-shared-package.md).
