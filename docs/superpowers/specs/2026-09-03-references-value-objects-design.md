# Références portées par un value object

Date : 2026-09-03 · Statut : validé en brainstorming (fil de session)

## Problème

Une référence ne peut aujourd'hui être déclarée que sur un type d'entité, et
résolue que sur une ligne directe de l'entité. Le cas `Cart.lines: CartLine[]`
où `CartLine.productRef` référence un `Product` est **inexprimable** :

- déclarer `CartLine` comme entité sans `id` produit des diagnostics
  `missing-id` trompeurs et **zéro** arête, en silence ;
- déclarer la référence sur un type absent d'`entities` est rejeté
  (`unknown-entity-type`) ;
- la déclarer sur `Cart` ne résout rien, `Cart` ne portant pas la ligne.

Sujet lié : en vue graphe, le jeton `[ n items ]` d'une ligne-tableau est
inerte sans le dire. Ce design le résout par construction — le jeton devient
l'ancre visuelle des arêtes issues des value objects cachés dedans — donc le
sujet « jeton en vue graphe » n'a plus d'existence propre.

## Décisions (actées avec l'utilisateur)

1. **Toute clé de `references[Type]` est un chemin relatif à l'entité**, dans
   la grammaire de `match` (`parseSelector`), ancrée sur l'entité au lieu de
   `$`. `customerId` est le cas dégénéré à un segment : les configs existantes
   sont déjà valides, migration nulle. Pas de section `valueObjects`.
2. **L'arête atterrit sur le nœud qui porte la ligne terminale** (le value
   object, ou l'entité pour un chemin à un segment), avec `field` = dernier
   segment. L'invariant « `field` est une clé de ligne de `from` » tient
   partout ; la vue structure (teinte, souligné, clic, croix) ne change pas.
3. **Vue graphe : hissage, pas de dépliage.** L'arête se dessine depuis le
   plus proche ancêtre visible — la carte du value object si elle est à
   l'écran, la bande de la ligne du jeton sinon. La vue graphe garde sa
   prémisse « une carte = une identité ».

## 1. Config (`config.ts`, `selector.ts`)

- `selector.ts` gagne `parseRelativePath(path: string): PathSegment[]` :
  même grammaire que `parseSelector` mais sans le préfixe `$` (implémentation
  suggérée : parser `"$." + path` si `path` ne commence pas par `.`/`[`, ou
  factoriser la boucle de tokens). Erreur → `ConfigError("selector-syntax")`.
- `validateConfig` : une clé de `references[Type]` qui contient `.` ou `[` est
  parsée comme chemin relatif ; sinon elle reste une **clé de ligne verbatim**
  (le token du sélecteur n'accepte que `[A-Za-z_$][\w$-]*`, or une clé JSON
  peut contenir n'importe quoi — les configs existantes ne doivent pas casser).
  Sémantiquement les deux formes sont le même chemin ; seule la contrainte de
  grammaire diffère. Limitation documentée : une clé de champ contenant
  littéralement `.` ou `[` est interprétée comme chemin.
- Le **dernier segment d'un chemin doit être `{ kind: "key" }`** (c'est une
  clé de ligne) : `lines[*]` seul ou `lines[*].*` → `ConfigError`.
- La cible reste un nom d'`entities`, validé comme aujourd'hui.
- `ValidatedConfig.references` devient
  `Map<string, { navigate: PathSegment[]; field: string; targetType: string }[]>`
  (chemin découpé en segments de navigation + clé terminale ; `navigate` vide
  pour la forme actuelle).

## 2. Construction (`build.ts`, `model.ts`)

- `RefEdge` gagne **`fromEntity: NodeId`** : l'entité déclarante, calculée à
  la construction. Pour un chemin à zéro navigation, `fromEntity === from`.
- Post-passe : pour chaque nœud entité du type déclarant, descendre
  `navigate` dans le sous-arbre par correspondance de `path` (les segments
  naviguent des NŒUDS : `key` matche un segment de chemin string, `index` un
  segment number, `wildcard` les deux) ; sur chaque nœud atteint, chercher la
  ligne `field`. Ligne trouvée non nulle → arête
  `{ from: nœud atteint, fromEntity: entité, field, targetType, targetId, to, dangling }`,
  résolue via `entityIndex` comme aujourd'hui. Une ligne de `valueType:
  "array"` est écartée (règle existante). `dangling-ref` pointe sur `from`.
- **Diagnostic `unresolved-reference`** (nouveau code) : une déclaration qui,
  alors qu'au moins une instance du type existe, ne résout la ligne terminale
  sur AUCUNE instance — très probablement une faute de frappe, aujourd'hui
  silencieuse. Une absence sur certaines instances seulement reste silencieuse
  (champ optionnel). Aucune instance du type du tout → silencieux (comportement
  actuel).

## 3. Tracé (`layout.ts`, `draw.ts`)

- `layout.ts` gagne `visibleAnchorRectFor(graph, positions, id, metrics)` :
  remonte depuis `id` via `parentId` et rend le premier rect que
  `anchorRectFor` sait produire (carte dessinée, ou bande de ligne d'un
  tableau élidé dont le parent est positionné) ; `undefined` si rien n'est
  visible. Exporté.
- `drawEdges` (passe ref) : le DÉPART utilise `visibleAnchorRectFor(…,
  edge.from)` au lieu de `positions.get(edge.from)`. L'ARRIVÉE garde
  `positions.get(edge.to)` (cible cachée → arête non tracée, comme
  aujourd'hui). Effets : vue structure dépliée → départ de la carte value
  object ; repliée → départ de la bande `lines [ n items ]` ; vue graphe →
  idem sur la carte de l'entité. Deux arêtes de même (départ, arrivée) se
  superposent exactement — recouvrement invisible, assumé.
- L'estompage `inPass` considère l'arête pleine si `from`, `fromEntity` OU
  `to` est dans `focusIds` (en vue structure la sélection peut être le value
  object lui-même ; en vue graphe c'est l'entité).

## 4. Consommateurs hissés (`aggregate.ts`, `layout-two-level.ts`, `focus.ts`)

`buildAggregates` (BFS d'appartenance), les deux boucles d'adjacence de
`layout-two-level.ts` (~l.769 et ~l.841) et les deux fonctions de `focus.ts`
(~l.58 et ~l.92) lisent **`edge.fromEntity`** au lieu de `edge.from`.
Sémantique : la relation d'un value object est celle de son entité — `Cart`
rejoint l'agrégat de `Product` comme s'il portait la référence en propre.
Substitutions mécaniques, aucun algorithme ne change.

## 5. Inchangé

`followRef`, la sélection, `refEdges(from)` de l'API publique, le panneau de
détail de la démo, `CollapseState`, l'élision des tableaux, `measureNode`.

## 6. Tests

- **Cœur** : `parseRelativePath` (formes valides, erreurs, dernier segment
  non-key rejeté) ; résolution (un segment ≡ comportement actuel à
  l'identique, `lines[*].productRef`, chemin profond `lines[*].discount.
  couponRef`, champ absent sur une instance = silencieux, jamais résolu =
  `unresolved-reference`, référence cassée portée par un value object →
  `dangling-ref` sur le nœud VO) ; `fromEntity` correct dans les deux formes ;
  appartenance d'agrégat via arête hissée ; `visibleAnchorRectFor` (carte
  visible, carte cachée → bande du jeton, tout caché → undefined).
- **Renderer** : départ d'arête sur la bande du jeton quand le tableau est
  replié (géométrie lue dans le contexte Graphics, comme `edges.test.ts`).
- **E2E** : fixture `Cart/CartLine/Product` injectée par `setData` ; en vue
  graphe, arête `Cart → Product` tracée et appartenance d'agrégat correcte ;
  en vue structure, dépliage du jeton puis clic sur la ligne `productRef`
  d'une carte `CartLine` → navigation vers `#prod-1`.
