# `apps/design` — playground du design system

Banc d'essai des tokens et des composants de `data-graph`. Ce n'est ni un
produit ni une démo : `apps/demo` montre le viewer à un utilisateur, `apps/design`
montre le **design system à ceux qui le modifient** — chaque token, chaque
variante de composant, dans les quatre thèmes, côte à côte.

```sh
pnpm --filter design dev     # http://localhost:5174
pnpm --filter design build
pnpm --filter design typecheck
```

Le port 5174 laisse la démo sur 5173 : les deux tournent ensemble, ce qui est le
seul moyen honnête de comparer un token à son rendu réel dans le viewer.

## Pourquoi les alias sources

Tout le code du playground importe les paquets du workspace par des **alias vers
leurs sources** — `@tokens/index.ts`, `@tokens/css.ts`, `@renderer/theme.ts`,
`@core/…` — et jamais par leur nom de paquet. Ces alias sont **inconditionnels**
(`vite.config.ts`), c'est-à-dire valables en `build` autant qu'en `dev`, ce qui
est l'inverse du choix fait dans `apps/demo`.

La différence tient à ce que chaque application doit prouver :

- La démo consomme les paquets par leurs `exports` au build, comme le ferait un
  consommateur externe. C'est ce qui garde honnêtes les mesures de taille prises
  sur ce bundle.
- Le playground n'est jamais publié et ne sert de référence à personne. Sa seule
  raison d'être est de montrer l'état **courant** de `packages/*/src`. Un `dist/`
  périmé y serait un mensonge ; un `pnpm -r build` obligatoire avant chaque essai
  de couleur serait exactement le va-et-vient que ce banc supprime.

Corollaire : le playground peut importer des modules internes qu'aucun `exports`
ne publie (les alias sont des préfixes, ils couvrent tout l'arbre des sources).
C'est voulu — un banc d'essai a le droit de regarder sous le capot.

`tsconfig.json` porte les mêmes chemins en `paths`, sinon `tsc --noEmit`
résoudrait vers les `dist/` là où le bundler sert les sources : deux résolutions
divergentes, donc un typecheck qui valide autre chose que ce qui tourne.

## Structure

- `src/theme-state.ts` — l'état de thème (marque × mode) et l'unique endroit qui
  le mute. `setTheme()` pose `data-theme` sur `<html>` et notifie les abonnés ;
  `currentTheme()` en dérive le thème Pixi du renderer.
- `src/main.ts` — la coquille : registre de vues, routage par hash (`#/tokens`,
  `#/graph`, `#/ui`, `#/sandbox`), barre latérale, contrôles de thème. Une vue
  est un `{ id, label, mount(root, state): () => void }` ; le shell appelle le
  cleanup retourné avant tout remontage.
- `src/style.css` — le shell, écrit **uniquement** avec les variables générées
  par le paquet de tokens.
- `src/pixi-stage.ts` — une scène de spécimens : un `Application` Pixi de taille
  fixe et, surtout, les pièges de son cycle de vie (init asynchrone démontée en
  vol, densité d'écran) résolus une fois pour toutes. Utilisé par la vue
  Composants graphe, qui en pose une par planche.
- `src/contrast.ts` — le ratio WCAG affiché par la vue Tokens. Une mesure **sur**
  les tokens, pas un token : d'où sa place ici et non dans le paquet.

Les quatre vues, dans l'ordre de la barre latérale :

- `src/views/tokens.ts` (`#/tokens`) — la planche des tokens : couleurs, avec
  leur ratio de contraste, typographie, espacements, rayons, ombres.
- `src/views/graph-components.ts` (`#/graph`) — ce que `draw.ts` peint, hors
  produit : carte de nœud par état, styles d'arêtes, enveloppes d'agrégats,
  paliers du zoom sémantique. Les états d'interface y sont **forcés**, puisque
  c'est `create.ts` qui les décide dans le produit.
- `src/views/ui-components.ts` (`#/ui`) — les primitives DOM du chrome (surface
  flottante, bouton d'icône, barre de recherche, pastille, item de menu),
  chacune en rangée d'états **réels** — on survole, on tabule ; aucune classe
  jumelle du genre `.is-hover`. Les spécimens sortent des fabriques de
  `@defsquare/data-graph-chrome` et sont habillés par sa feuille, celle que la
  démo charge : même régime que la vue Composants graphe vis-à-vis de `draw.ts`.
  Cette planche a commencé par recopier le CSS et les icônes de la démo, faute
  de pouvoir les importer — c'est ce constat qui a fait extraire le paquet.
- `src/views/sandbox.ts` (`#/sandbox`) — une instance complète du renderer
  (`createDataGraph`) sur `apps/demo/fixtures/shop.json`, câblée comme la démo,
  worker de mise en page compris. C'est le seul endroit du playground où un
  token se juge sur l'assemblage plutôt que sur une pièce isolée.

Toute vue est **remontée** à chaque changement de thème, marque comme mode : le
shell détruit puis recrée. Le bac à sable ne se sert donc pas de
`graph.setTheme()`, dont la sûreté est conditionnée à une typographie identique
entre les deux thèmes — condition que rien ne vérifie à l'exécution, là où une
instance recréée est cohérente par construction.

Les variables CSS ne sont pas importées depuis un fichier généré comme dans la
démo : `main.ts` appelle `renderTokensCss()` et injecte le résultat. Le module
est alors du code, donc soumis au HMR — modifier un token dans
`packages/tokens/src` repeint le playground sans régénération.

Le `publicDir` pointe sur `../demo/public` : les woff2 et les logos sont ceux de
la démo, servis tels quels. Les dupliquer garantirait surtout de les voir
diverger.
