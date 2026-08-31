# Refonte du thème defsquare — Design

**Date** : 2026-08-31
**Statut** : validé (brainstorming section par section avec David)
**Prédécesseur** : `2026-08-30-data-graph-design.md`

## Problème

Le rendu actuel est jugé « trop simpliste et parfois un peu flou ». Le diagnostic,
posé en observant la démo tournante et en relisant le code, distingue trois causes
indépendantes qu'il faut traiter séparément.

**Le flou est réel et mesurable.** `app.init()` (`renderer/src/create.ts`) ne passe ni
`resolution` ni `autoDensity` : sur un écran Retina le canvas est rendu en 1× puis
étiré par le CSS. Indépendamment, `Camera.fitTo` (`renderer/src/camera.ts`) clampe à
`MAX_SCALE = 3`, donc un petit graphe est agrandi jusqu'à 3× — or les `BitmapFont` sont
cuites à 14px en résolution 1, et agrandir un raster de 14px donne exactement le rendu
cotonneux observé.

**Le manque de netteté est un bug de mesure.** `DEFAULT_METRICS.charWidth = 7.2` est
appliqué indifféremment au libellé (IBM Plex Sans Condensed) et à la valeur (Fira Code),
alors que Fira Code a une avance de 0.6em, soit 8.4px à 14px. Le budget de largeur est
donc sous-estimé de ~17% sur la colonne des valeurs : `measureNode` dimensionne des
cartes trop étroites et `truncateToWidth` ne tronque jamais au bon endroit. Résultat
visible : `dupont@example.com` déborde franchement hors de sa carte.

**Le côté simpliste est un problème de design.** Le rouge `#f65e5e` remplit l'en-tête
de chaque entité — soit environ un quart de la surface de chaque carte — alors que dans
le DS defsquare le rouge est un accent : crochets du logo, hover de CTA, surlignage de
titre. Il n'y a par ailleurs aucune hiérarchie typographique (tout est en 14px sans
graisse différenciée), aucun contraste de surface (carte `#ffffff` bordée `#e5e7eb` sur
un canvas `#f7f7f8`), aucune affordance d'expansion malgré un en-tête cliquable, aucune
tête de flèche sur les arêtes de référence, et aucune indication du type d'entité.

## Décisions actées

1. **Direction « encre d'abord, rouge en accent »** — la couleur de type passe d'un
   aplat d'en-tête à un rail fin ; la hiérarchie est portée par la typographie et le
   contraste de surface ; le rouge est réservé à la sélection et au danger.
2. **Shell de démo = vitrine de marque complète** — logo, police de titre, contrôles
   dessinés, panneau de détail structuré, barre d'état.
3. **Thème sombre de premier plan** — `defsquareLight` et `defsquareDark` construits sur
   le même contrat, avec bascule dans la démo.
4. **Tokens sémantiques en couches (approche A)** — réécriture de `theme.ts` en groupes
   par rôle, et purge de toutes les constantes visuelles de `draw.ts`.

Le package n'est pas publié sur npm (`npm view @defsquare/data-graph` → 404), donc la
restructuration de `Theme` et de `NodeMetrics` ne casse aucun consommateur externe.

### Approches rejetées

**Enrichir la forme plate existante** (ajouter des clés à `colors`/`fonts`) : peu de
churn, mais `draw.ts` garde ses rayons, graisses, épaisseurs et espacements en dur, donc
la hiérarchie typographique reste inexprimable depuis un thème et le mode sombre reste
une liste de surcharges à plat que rien ne contraint. C'est reconduire le problème.

**Lire les variables CSS `--color-*` du DOM** : zéro duplication de tokens, mais couple
la lib au document (elle doit rester utilisable hors DOM), coûte une lecture de style au
runtime, et contredit la décision « tokens copiés, pas de dépendance runtime » actée
dans le design doc d'origine.

## Source de vérité

Les tokens sont extraits de `colors_and_type.css` du projet Claude Design « Defsquare
Design System » (projectId `5461f5a0-9092-4f87-ace7-41a6a551c39e`), relu au moment de la
rédaction de ce spec. Toute valeur qui n'y figure pas est marquée **dérivée** ci-dessous.

## Contrat de thème

```ts
export interface TypeStyle {
  family: "body" | "mono"
  size: number
  weight: number
  tracking?: number   // em, défaut 0
}

export interface Theme {
  fonts: { body: string; mono: string }

  surface: {
    canvas: string      // fond du canvas
    card: string        // corps de carte
    cardMuted: string   // carte de conteneur
  }

  ink: {
    primary: string     // libellés, valeurs
    muted: string       // clés
    subtle: string      // compteurs, méta
    onAccent: string    // texte posé sur un aplat d'accent
  }

  accent: {
    entity: string        // rail de repli si `entityPalette` est vide
    selection: string
    match: string         // remplissage lavé des résultats de recherche
    matchStroke: string
    danger: string
  }

  edge: {
    contain: string
    ref: string
    dangling: string
    hairline: string    // séparateur en-tête / lignes
    border: string      // bordure de carte
  }

  typography: {
    header: TypeStyle
    badge: TypeStyle
    key: TypeStyle
    value: TypeStyle
  }

  radii: { card: number; badge: number }

  strokes: {
    border: number      // 1
    edge: number        // 1.5
    selection: number   // 2.5
    match: number       // 2
    matchCurrent: number // 3
  }

  entityPalette: string[]
  byEntityType?: Record<string, { accent: string }>
}
```

`metrics` **ne** figure pas dans `Theme` : `NodeMetrics` reste dans le core, seule source
de vérité pour le layout, et le renderer le consomme directement. Dupliquer les mêmes
nombres dans deux objets garantirait qu'ils divergent.

### Pas d'ombres portées dans le canvas

Pixi n'offre pas de flou en `Graphics`. Une ombre simulée par rectangles arrondis
empilés produit un double-liseré visible. L'élévation dans le canvas se joue donc
uniquement au contraste — bordure 1px nette sur un canvas plus sourd — et les
`--shadow-*` du DS ne servent que dans le shell DOM, où le CSS sait les rendre.

### `defsquareLight`

| Token | Valeur | Origine DS |
|---|---|---|
| `surface.canvas` | `#eef0f3` | **dérivé** (assombri depuis `--color-bg-muted` pour détacher la carte) |
| `surface.card` | `#ffffff` | `--color-bg-card` |
| `surface.cardMuted` | `#f7f7f8` | `--color-bg-muted` |
| `ink.primary` | `#172741` | `--color-ink` |
| `ink.muted` | `#4b5563` | `--color-fg-muted` |
| `ink.subtle` | `#9ca3af` | `--color-fg-subtle` |
| `ink.onAccent` | `#ffffff` | `--color-bg` |
| `accent.entity` | `#1e416e` | `--color-primary-400` |
| `accent.selection` | `#f65e5e` | `--color-accent` |
| `accent.match` | `#EDE2CF` | `--color-beige-soft` |
| `accent.matchStroke` | `#8d7e63` | `--color-beige-deep` |
| `accent.danger` | `#f65e5e` | `--color-danger` |
| `edge.contain` | `#c7cdd6` | **dérivé** (entre `--color-border` et `--color-fg-subtle`) |
| `edge.ref` | `#2a5a98` | `--color-primary-500` |
| `edge.dangling` | `#d97706` | `--color-warning` |
| `edge.hairline` | `#f1f1f3` | `--color-border-soft` |
| `edge.border` | `#dfe3e9` | **dérivé** (`--color-border` assombri pour tenir sur `surface.canvas`) |

### `defsquareDark`

| Token | Valeur | Origine DS |
|---|---|---|
| `surface.canvas` | `#161a2c` | `--color-navy-deep` |
| `surface.card` | `#1e2335` | **dérivé** |
| `surface.cardMuted` | `#1a1f30` | **dérivé** |
| `ink.primary` | `#f0f5fc` | `--color-primary-50` |
| `ink.muted` | `#9BB2D9` | `--color-blue-soft` |
| `ink.subtle` | `#6b7794` | **dérivé** |
| `ink.onAccent` | `#ffffff` | `--color-bg` |
| `accent.entity` | `#3573c3` | `--color-primary-600` |
| `accent.selection` | `#f65e5e` | `--color-accent` |
| `accent.match` | `#3a3323` | **dérivé** (beige désaturé pour fond sombre) |
| `accent.matchStroke` | `#E2CA9E` | `--color-beige` |
| `accent.danger` | `#f65e5e` | `--color-danger` |
| `edge.contain` | `#3a4159` | **dérivé** |
| `edge.ref` | `#3573c3` | `--color-primary-600` |
| `edge.dangling` | `#e0932e` | **dérivé** (`--color-warning` éclairci) |
| `edge.hairline` | `#272d42` | **dérivé** |
| `edge.border` | `#2c3247` | **dérivé** |

### Typographie (commune aux deux thèmes)

| Rôle | Famille | Taille | Graisse | Tracking |
|---|---|---|---|---|
| `header` | body | 13 | 600 | 0 |
| `badge` | body | 9.5 | 600 | 0.08em |
| `key` | body | 12 | 400 | 0 |
| `value` | mono | 12 | 400 | 0 |

Passer les lignes de 14 à 12px n'est pas cosmétique : à 12px l'avance de Fira Code vaut
exactement 7.2px, c'est-à-dire la constante `charWidth` déjà présente dans le core. La
mesure des valeurs redevient exacte au lieu d'être fausse de 17%.

### Palette catégorielle des types d'entité

`entityPalette` (identique dans les deux thèmes, toutes les valeurs tiennent sur fond
clair comme sombre puisqu'elles ne servent qu'en rail de 3px et en pastille) :

```
#1e416e  --color-primary-400
#f65e5e  --color-accent
#3dbf9e  --color-mint
#8d7e63  --color-beige-deep
#3573c3  --color-primary-600
#a0427a  fin de --gradient-heat
```

L'assignation type → couleur se fait par **l'ordre de déclaration des clés dans
`config.entities`**, pas par l'ordre d'apparition dans les données : c'est déterministe
et sous contrôle de l'auteur de la config. Au-delà de six types, la palette boucle.
`byEntityType` surcharge n'importe quelle entrée.

Conséquence sur le code : `drawNode` ne peut plus déduire l'accent depuis `node` et
`theme` seuls. `create.ts` calcule une `Map<entityType, string>` à l'initialisation (et à
chaque `setData` avec une nouvelle config) et la passe à `drawNode`.

## Anatomie de la carte de nœud (LOD 0)

```
┌─┬──────────────────────────────────────┐
│▌│ ▸ Order #o1                    ORDER │  30px — header, hairline en bas
│▌├──────────────────────────────────────┤
│▌│ id                                o1 │  19px
│▌│ customerId                        c1 │  19px
│▌│ total                           99.5 │  19px
└─┴──────────────────────────────────────┘  7px de padding bas
 3px rail
```

- Surface `surface.card`, bordure 1px `edge.border`, rayon 6px (`--radius-md` du DS).
- **Rail** de 3px collé au bord gauche, coins arrondis à gauche uniquement, dans la
  couleur de type. Seul endroit où la couleur de type apparaît en aplat.
- **En-tête** 30px : chevron 10px (uniquement si le nœud a des enfants), libellé en
  style `header` couleur `ink.primary`, et à droite une **pastille de type** en style
  `badge` dans la couleur de type. Filet 1px `edge.hairline` en bas.

  `build.ts` produit déjà `label = "Order #o1"`, type inclus. Afficher la pastille
  `ORDER` à côté serait redondant. Donc en LOD 0, un nœud entité affiche `#o1`
  (`node.entityId`) comme libellé et `ORDER` (`node.entityType`) comme pastille — la
  couleur du rail rend le couple immédiatement lisible. En LOD 1, où la pastille
  disparaît, on réaffiche `node.label` complet. `node.label` reste inchangé côté core :
  c'est lui que la recherche indexe.
- **Lignes** 19px : clé en style `key` couleur `ink.muted`, alignée à gauche ; valeur en
  style `value` couleur `ink.primary`, **alignée à droite** sur le padding droit.
  L'alignement à droite rend la troncature déterministe et fait basculer la lecture de
  « liste » à « table ».

**Nœuds conteneurs** (`orders`, `customers`) : même carte, surface `surface.cardMuted`,
pas de rail ni de pastille de type ; libellé en `ink.primary` et compteur d'enfants en
`ink.subtle` aligné à droite dans l'en-tête.

**LOD 1** (0.15 ≤ scale < 0.5) : carte + rail + libellé tronqué, pas de lignes.
**LOD 2** (scale < 0.15) : rectangle plein dans la couleur de type — inchangé.

## Métriques et correction du débordement

`NodeMetrics` est réécrit. `charWidth` (une seule avance pour deux polices) et
`maxTextChars` (un budget en caractères là où deux polices se partagent la ligne)
disparaissent tous les deux.

```ts
export interface NodeMetrics {
  headerHeight: number      // 30
  rowHeight: number         // 19
  paddingX: number          // 12
  paddingBottom: number     // 7
  railWidth: number         // 4 — largeur de la bande d'accent AVANT que la bordure de
                             // la carte ne la recouvre (elle est centrée sur le tracé
                             // extérieur et repeint le 1px le plus à gauche de la bande),
                             // donc le rail effectivement visible mesure
                             // railWidth - strokes.border = 4 - 1 = 3px
  gapKeyValue: number       // 16
  chevronWidth: number      // 14
  headerCharWidth: number   // 6.5   body 13px/600
  badgeCharWidth: number    // 6.2   body 9.5px/600 + tracking
  keyCharWidth: number      // 6.0   body 12px
  valueCharWidth: number    // 7.2   mono 12px — exact pour Fira Code (0.6em)
  minWidth: number          // 140
  maxWidth: number          // 340
}
```

`measureNode` devient :

```
headerW = railWidth + paddingX
        + (hasChildren ? chevronWidth : 0)
        + len(label) * headerCharWidth
        + gapKeyValue
        + len(badge) * badgeCharWidth
        + paddingX

rowW_i  = railWidth + paddingX
        + len(key_i) * keyCharWidth
        + gapKeyValue
        + len(value_i) * valueCharWidth
        + paddingX

width   = clamp(max(headerW, max_i rowW_i), minWidth, maxWidth)
height  = headerHeight + n_rows * rowHeight + (n_rows > 0 ? paddingBottom : 0)
```

`badge` désigne le texte de la pastille d'en-tête : le type d'entité en capitales pour
un nœud entité, le nombre d'enfants pour un nœud conteneur, la chaîne vide sinon.

`handleNodeTap` (`create.ts`) doit suivre la nouvelle géométrie : l'index de ligne se
calcule sur `rowHeight = 19` et un clic tombant dans les `paddingBottom` pixels du bas ne
correspond à aucune ligne — aujourd'hui il en désignerait une inexistante.

`draw.ts` doit tronquer avec **la même** avance par rôle que celle qu'a utilisée
`measureNode` pour dimensionner. C'est précisément l'invariant que le bug actuel viole,
et il devient un test (voir plus bas).

Les valeurs par défaut restent des constantes déterministes, sans accès au DOM : le core
doit continuer à tourner en Node et ses tests de layout en dépendent. Le renderer, lui,
mesure les avances réelles une fois à l'initialisation via un `CanvasRenderingContext2D`
hors écran (`measureText` sur un échantillon), et injecte les `NodeMetrics` corrigés dans
le moteur de layout. Si la mesure échoue (pas de contexte 2D disponible), on garde les
défauts.

## Netteté du rendu

1. `app.init({ resolution: Math.min(window.devicePixelRatio ?? 1, 2), autoDensity: true })`.
2. **`viewport()` bascule sur `app.renderer.screen`.** Avec `autoDensity`,
   `renderer.width/height` passent en pixels device alors que le `stage` reste en pixels
   CSS ; garder `renderer.width` casserait `fitTo` et `centerOn` sur Retina. C'est une
   correction obligatoire, pas une amélioration.
3. `BitmapFont.install(..., { resolution: 2 })` pour les quatre polices (header, badge,
   key, value) : net jusqu'à 2× de zoom au lieu de baver dès 1.05×.
4. `Camera.fitTo` plafonne son échelle à **1** : on ne grossit plus un raster pour
   remplir l'écran. Le zoom molette conserve `MAX_SCALE = 3` — au-delà de 2× le texte
   redevient doux, mais c'est alors un choix explicite de l'utilisateur.

Quatre polices bitmap en résolution 2, c'est environ 8× la mémoire de texture de
l'unique paire actuelle en résolution 1. À vérifier au bench sur le dataset 2000 nœuds
avant de considérer la tâche finie.

## Arêtes et états

- **Contenance** : bézier horizontal 1.5px `edge.contain`. Géométrie inchangée.
- **Référence** : pointillé 1.5px `edge.ref`, **plus une tête de flèche** de 7px à
  l'arrivée. La flèche est un triangle plein : elle ne peut pas partager l'appel
  `stroke()` des lignes. `drawEdges` les dessine donc dans le **même** `Graphics`, en un
  passage `fill()` distinct émis après le `stroke()` des pointillés de référence. Un seul
  objet, deux instructions de batch.
- **Référence cassée** : pointillé `edge.dangling` terminé par un marqueur de lien rompu.
- **Sélection** : contour 2.5px `accent.selection` sur le nœud, sa chaîne de parenté et
  ses refs sortantes. Comme plus rien d'autre n'est rouge, la sélection devient
  immédiatement lisible — l'inverse de la situation actuelle où elle se noie dans les
  en-têtes rouges.
- **Recherche** : remplissage lavé `accent.match` + contour 2px `accent.matchStroke` sur
  chaque résultat visible ; le résultat courant reprend un contour 3px
  `accent.selection`.

## Shell de démo

**Barre d'app** : logo `defsquare-short-dark-red.svg` (clair) / `defsquare-short-white-red.svg`
(sombre), récupérés depuis le projet DS et vendorisés dans `apps/demo/public/` ; titre
« data-graph » en EB Garamond (ajouté au `<link>` Google Fonts existant) ; champ de
recherche façon barre de recherche d'éditeur — loupe, compteur `3/12` et chevrons ↑↓
intégrés **dans** le champ ; contrôle segmenté pour le dataset ; bascule clair/sombre ;
bouton Fit.

**Barre d'état** en bas : nombre de nœuds logiques, nœuds visibles, et compteur de
diagnostics cliquable qui déplie la liste des références cassées.

**Panneau de détail** : pastille de type teintée, libellé, chemin en mono, puis une liste
clé/valeur alignée à droite comme dans les cartes. Les lignes portant une référence
gagnent un bouton fléché qui appelle `graph.focus()`.

La bascule de thème appelle `setTheme()` — **une nouvelle méthode publique** sur
`DataGraph`, qui reconstruit le rendu sans refaire le layout (le layout ne dépend du
thème que par les `NodeMetrics`, inchangés entre clair et sombre) et met à jour
`app.renderer.background`.

Le CSS de la démo est réécrit sur les tokens DS complets (`--color-*`, `--space-*`,
`--radius-*`, `--shadow-*`, `--font-title`), avec une classe `[data-theme="dark"]` sur
`<html>` qui redéfinit le sous-ensemble de tokens concerné.

## Tests

- **Contrat de thème** : `defsquareLight` et `defsquareDark` définissent chaque token du
  contrat, et `resolveTheme` fusionne correctement les surcharges partielles à chaque
  niveau de profondeur.
- **Accord mesure ↔ troncature** — le bug de débordement transformé en régression
  gardée : pour un jeu de nœuds à valeurs mono longues, le texte tronqué par `draw.ts`
  tient dans la largeur calculée par `measureNode`. C'est le test qui aurait attrapé
  `dupont@example.com`.
- **Palette déterministe** : deux `buildGraph` sur la même config donnent la même
  assignation type → couleur, indépendamment de l'ordre des données.
- **Mise à jour** des tests core qui dépendent de `headerHeight`, `rowHeight` et
  `maxTextChars` (`layout.test.ts` au minimum).
- **E2E démo** étendu : bascule de thème, barre d'état, bouton de suivi de référence
  dans le panneau de détail.
- **Bench** : `pnpm bench` sur 2000 nœuds avant / après, pour chiffrer le coût des
  polices en résolution 2.

## Fichiers touchés

| Fichier | Nature |
|---|---|
| `packages/core/src/measure.ts` | réécriture de `NodeMetrics` et `measureNode` |
| `packages/core/src/layout.ts` | suit la nouvelle signature de métriques |
| `packages/core/test/layout.test.ts` | mise à jour + nouveau test de mesure |
| `packages/renderer/src/theme.ts` | réécriture complète |
| `packages/renderer/src/draw.ts` | réécriture de `drawNode`, arêtes, overlays |
| `packages/renderer/src/create.ts` | `resolution`/`autoDensity`, `viewport()`, mesure de polices, map d'accents, `setTheme()` |
| `packages/renderer/src/camera.ts` | plafond de `fitTo` à 1 |
| `packages/renderer/src/index.ts` | exports des nouveaux thèmes et types |
| `packages/renderer/test/theme.test.ts` | réécriture |
| `apps/demo/index.html` | shell, EB Garamond |
| `apps/demo/src/style.css` | réécriture sur les tokens DS + mode sombre |
| `apps/demo/src/main.ts` | bascule de thème, barre d'état, détail enrichi |
| `apps/demo/public/` | logos SVG vendorisés |
| `apps/demo/e2e/smoke.spec.ts` | nouveaux cas |
| `packages/renderer/README.md`, `README.md` | exemples de thème à jour |

## Hors périmètre

Les thèmes `neutralLightTheme` et `neutralDarkTheme` sont portés vers le nouveau contrat
sans redesign — ils restent des points de départ neutres pour les consommateurs qui ne
veulent pas de la marque defsquare. Aucun travail sur l'export, l'édition, ou les
performances au-delà de la vérification de non-régression au bench.
