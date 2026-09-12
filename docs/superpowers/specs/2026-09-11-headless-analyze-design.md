# Mode `--check` — valider une config sans ouvrir de fenêtre

Date : 2026-09-11
Statut : validé en discussion, en attente de relecture du spec

## Objectif

Donner à `datagraph` une sortie que le lanceur peut lire :

```
datagraph --check <data.json> -c <config.json> [--json]
```

La commande construit le graphe, écrit un rapport sur stdout et sort avec un
code. Aucune fenêtre ne s'ouvre.

## Problème

`datagraph` n'a aujourd'hui qu'une sortie : une fenêtre. C'est le bon canal pour
un humain et c'est un mur pour un agent, qui peut lancer l'application sans rien
apprendre du document qu'il vient d'ouvrir.

Plus gênant que l'analyse manquante : **l'agent ne peut pas vérifier la config
qu'il vient d'écrire.** `cli.rs` ne valide que la syntaxe JSON avant d'ouvrir la
fenêtre, délibérément, parce que le core TypeScript est la source de vérité
unique du contrat (ADR-0004). Une erreur sémantique (sélecteur malformé, groupe
inconnu, `refs[].to` qui ne correspond à aucun `ids`) est donc rapportée dans
l'application, sur un écran que l'agent ne voit pas. Il croit avoir réussi.

La skill `datagraph` (dans `~/.claude/skills/`) contourne le trou en traduisant
chaque sélecteur en `jq` et en vérifiant que le match est non vide. Le pansement
tient mal : `jq` sait dire qu'un chemin matche, il ne sait pas dire qu'une
référence résout.

Le mode `--check` sert donc deux publics, dans cet ordre. L'agent, qui obtient
une boucle de correction sur sa propre config. L'humain, qui peut valider avant
d'ouvrir.

## Embarquer le core dans le binaire

Le binaire porte la validation lui-même, sans la réimplémenter. Une troisième
entrée du core (`packages/core/src/validate.ts`) est empaquetée en un fichier ES
unique, embarquée par `include_str!` et évaluée par QuickJS lié au binaire.

Mesures qui ont décidé de la faisabilité. La fermeture de validation est
`selector.ts` → `config.ts` → `build.ts` + `model.ts`. elkjs n'est atteint que
par `structure-layout.ts`, qui est un souci de layout, donc hors du chemin.
Empaquetée, cette fermeture pèse **6,5 ko minifiés** et n'attend **aucun global
d'hôte** : ni `console`, ni `async`, ni générateurs, ni `Proxy`, `Symbol`,
`process` ou `structuredClone`. Uniquement `Map`, `Set`, `class extends`, `??`
et `?.`, soit de l'ES2020 nu.

Ce que cela achète : un binaire unique qui marche partout où il est sur le PATH,
sans node et sans WebView, avec un code de sortie synchrone. Et zéro duplication
du contrat, puisque le bundle est généré depuis `packages/core` et jamais
réécrit. Les 14 messages de `ConfigError` se lisent donc à l'identique en
`--check` et sur l'écran de l'application.

### Pourquoi pas une fenêtre Tauri masquée

Réutiliser la WebView avec une fenêtre invisible ne demanderait aucune
dépendance nouvelle. Le coût est disproportionné : on démarre un moteur de rendu
pour imprimer du texte, le code de sortie devient asynchrone, il faut un serveur
d'affichage sous Linux, et la validation passerait par le renderer alors qu'elle
doit rester sèche. Défendable si le bundle avait pesé 500 ko. À 6,5 ko, non.

### Pourquoi pas un portage en Rust

Réécrire la validation en Rust supprimerait QuickJS et donnerait un binaire pur.
La proposition a été examinée sérieusement, avec un mécanisme de test
différentiel pour empêcher la divergence : un corpus généré depuis le TypeScript,
commité, vérifié en fraîcheur et consommé par `cargo test`. La technique est
solide et elle ne résout pas le bon problème. Elle détecte la divergence, elle
n'écrit pas le Rust.

Deux coûts restent entiers.

**Le volume.** Les quatre diagnostics tombent aux lignes 131, 199, 344 et 361 de
`build.ts` : ils ne forment pas un module isolable, ils tombent de la traversée
complète. En retirant le cosmétique (labels, scalar rows, `NodeId`), il reste
environ 330 lignes, plus les 195 de `config.ts` et les 62 de `selector.ts`. Cela
fait à peu près 590 lignes de logique dense à porter et à tenir alignées.

**Les messages.** `apps/demo/src/main.ts:26` peint `error.message` tel quel sur
l'écran d'erreur. Un Rust qui reformule fait lire différemment la même config
selon l'entrée ; un Rust qui duplique les 14 chaînes impose au test différentiel
de les comparer caractère par caractère.

Le chiffre qui a tranché est le churn. Sur 90 jours : `config.ts` 15 commits,
`build.ts` 8, `selector.ts` 3. Sur les 30 derniers jours, 19 commits sur
`config.ts` et `build.ts`, le dernier le 2026-09-08, dont deux ruptures assumées
(`feat(core)!: contrat data-first ids/refs/groups` et
`refactor(core,renderer)!:`). Ce contrat bouge encore vite. Sur le dernier mois,
le portage aurait coûté 19 changements Rust appariés, et autant d'occasions de
voir le test différentiel rougir sur du travail sans rapport avec Rust.

La porte reste ouverte. Si le contrat se stabilise, le portage deviendra
mécanique et se fera dans de meilleures conditions : le corpus sera généré depuis
une implémentation qui tourne, au lieu d'être écrit à la main contre un spec.

## Surface de commande

```
datagraph --check <data.json> -c <config.json>          # rapport texte
datagraph --check <data.json> -c <config.json> --json   # rapport JSON
```

Un drapeau, pas une sous-commande. La boucle de `parse` garde sa forme (une
passe plate sur argv) et ses 13 tests gardent leur sens. `Cli` gagne deux champs
booléens. Surtout, les arguments restent identiques à la forme de lancement : on
valide, puis on retire `--check` sur la même ligne pour ouvrir la fenêtre. C'est
le geste du public humain, et une sous-commande le casserait.

Deux règles nouvelles dans `parse`, dans l'esprit de celle qui existe déjà
(`-c` exige un fichier de données) :

- `--check` exige `-c`. Sans config il n'y a rien à valider, le mode structure
  seule n'ayant pas de contrat. Message : `option '--check' requires a config file`.
- `--json` exige `--check`. C'est le format d'un rapport ; le refuser
  explicitement vaut mieux que l'ignorer en silence.
- `--help` continue de l'emporter sur tout.

`load()` ne bouge pas. Il lit les deux fichiers et vérifie leur syntaxe JSON,
soit exactement la précondition du mode check, dont il hérite le bon
comportement sur fichier manquant ou JSON cassé.

`main.rs` gagne un seul branchement, entre `load` et `run_with`. `run_with` n'est
jamais atteint en mode check, donc aucune fenêtre ne peut s'ouvrir : c'est la
structure du flux qui le garantit, pas une précaution.

`USAGE` s'étend de deux lignes. C'est le seul texte utilisateur touché.

## Rapport et codes de sortie

Le code de sortie répond à une seule question : *puis-je corriger ça en éditant
la config ?* Le rapport répond au reste. Confondre les deux ferait boucler
l'agent sur des trous de données qu'il ne peut pas réparer.

| Code | Sens |
|---|---|
| `0` | Config valide. Le rapport peut contenir des diagnostics de **données**. |
| `1` | Fichier illisible ou JSON invalide (existant, inchangé). |
| `2` | Argument invalide (existant, inchangé). |
| `3` | **Config invalide.** |
| `4` | **Erreur interne.** |

Les quatre codes de diagnostic ne se rangent pas où leur nom le suggère. Tombent
en `3` :

- une `ConfigError`, fatale, aucun graphe n'étant construit ;
- un `unresolved-reference`, c'est-à-dire une déclaration que rien n'a
  satisfaite, donc sans ambiguïté un bug de config ;
- un sélecteur dont le préfixe ne résout pas, ce que le pré-vol `jq` de la skill
  fait aujourd'hui à la main.

Ce dernier point demande une distinction que `jq` ne fait pas, et qu'il serait
facile de rater. Un sélecteur qui rend zéro instance n'est pas forcément faux :
`$.orders[*].id` sur un document où `orders` est un tableau vide décrit
correctement une collection vide. Ce qui dénonce un bug de config, c'est un
préfixe qui ne résout pas, `$.produits[*]` quand le document n'a pas de clé
`produits`. Le rapport porte les deux informations (`matched` et `pathResolves`)
et seul le préfixe non résolu sort en `3`.

Restent en `0` : `dangling-ref`, `duplicate-id`, `missing-id`. Une clé étrangère
qui pointe dans le vide, c'est le document qui a un trou.

Un cas ambigu est délibérément laissé sans code. Si toutes les refs d'une
déclaration pendent, le `to` est probablement faux, mais les données peuvent
aussi être réellement cassées. Deviner serait pire que rapporter : le rapport
affiche le ratio (`12/12 dangling`), assez fort pour être vu, et le code reste
`0`. Un code « valide mais suspect » est écarté : il compliquerait la boucle de
l'agent pour un gain marginal.

Le code `4` est le point important. Un dépassement de pile, une mémoire épuisée
ou un bug du core ne doivent jamais sortir en `3` : dire à un agent que sa config
est fausse quand la faute est la nôtre le condamne à éditer indéfiniment une
config correcte.

### Rapport JSON

```json
{
  "report": 1,
  "ok": false,
  "configErrors": [
    { "code": "selector-syntax", "message": "Selector must start with \"$\": produits[*].id" }
  ],
  "ids": {
    "Customer": { "selector": "$.customers[*].id", "matched": 2, "pathResolves": true }
  },
  "refs": [
    { "from": "$.orders[*].customerId", "to": "$.customers[*].id",
      "matched": 2, "resolved": 2, "dangling": 0 }
  ],
  "diagnostics": [
    { "code": "dangling-ref", "path": "$.orders[1].customerId", "message": "…" }
  ],
  "totals": { "nodes": 11, "logicalNodes": 27, "entities": 4, "refEdges": 2 }
}
```

Les décomptes par sélecteur sont le cœur du rapport, pas les diagnostics : c'est
ce qui remplace le pré-vol `jq`, et en mieux. `totals` tient en une ligne et vaut
son poids, `nodes: 0` disant immédiatement que le document n'a pas été parcouru.

`totals` porte **deux** comptes, et les confondre tendrait un piège au
consommateur visé. `nodes` est la taille du graphe, dans la même unité
qu'`entities` et `refEdges`. `logicalNodes` compte en plus les lignes scalaires,
et c'est **le seul que `maxNodes` borne** : `build.ts` lève
`GraphTooLargeError(logicalNodeCount, maxNodes)`. Sans les deux, un agent qui
dépasse le cap lit `1000001 > 1000000` dans le message, relance avec une borne
relevée, obtient `nodes: 350000`, et n'a aucun moyen de relier les deux nombres
ni de voir qu'il approchait de la limite. Sur `apps/demo/fixtures/shop.json`,
mesuré : 11 et 27.

Le champ `report: 1` va contre le réflexe YAGNI, pour une raison précise : le
consommateur est un fichier de skill posé sur le disque de quelqu'un, qui n'est
pas mis à jour avec le binaire. Une version ne rattrape pas une rupture, elle la
rend diagnosticable. Règle associée : ajouter un champ est permis, renommer ou
retirer est une rupture.

### Rapport texte

```
✓ config valid — 4 entities, 2 references resolved

  ids
    Customer   $.customers[*].id     2 instances
    Order      $.orders[*].id        2 instances
  refs
    $.orders[*].customerId → $.customers[*].id    2/2 resolved

  No diagnostics.
```

En anglais, ce qui applique la convention du dépôt plutôt que d'y déroger.
`CLAUDE.md` réserve le français à la démo et au playground ; le CLI est déjà
anglais de bout en bout, `USAGE` comme `datagraph: cannot read '…'`. Les 14
messages de `ConfigError` du core le sont aussi, y compris quand l'écran
d'erreur français de la démo les affiche. Aucune couche de traduction n'est donc
nécessaire.

## Frontière JS↔Rust

### Des chaînes, pas des objets

```js
globalThis.__datagraph_check = (dataText, configText) => /* rapport JSON, en texte */
```

Une fonction, deux chaînes en entrée, une chaîne en sortie. Rust ne désérialise
rien, le JS parse lui-même, le rapport revient en texte.

Ce choix est déjà celui du fichier. `cli.rs` le documente sur `read_json` :
*« The content is kept as a raw `String`: the frontend does the parsing, there is
no reason to deserialize here only to re-serialize towards the WebView. »*
L'argument vaut mot pour mot pour le moteur embarqué, et `load()` rend déjà des
`String` qui vont directement dedans.

### Aucune liaison d'hôte

Les moteurs embarquables démarrent sur un ES nu : `fetch`, le système de
fichiers, les timers et `console` n'existent que si on les ajoute. La mesure
ci-dessus dit qu'il n'y a rien à ajouter. La posture sûre est donc le défaut, et
la surface de la frontière se réduit à une fonction qui prend deux chaînes.

### Erreurs, en trois étages

1. **Échec de domaine, attendu.** Les 14 `ConfigError` sont rattrapées côté JS et
   deviennent `ok: false` + `configErrors`. Elles ne traversent jamais en
   exception. La fonction JS a une seule sortie : une chaîne.
2. **Entrée pathologique, déjà bornée.** `maxNodes` (défaut 1 000 000) et
   `GraphTooLargeError` sont dans le bundle. Le core se borne lui-même et son
   message nomme la sortie.
3. **Défaillance réelle du moteur.** Rust rattrape, écrit
   `datagraph: internal error: …` sur stderr, sort en `4`.

Les données étant arbitraires, une borne mémoire et une borne de pile sont posées
sur le contexte du moteur, même si le JS exécuté est le nôtre et figé à la
compilation.

### QuickJS plutôt que Boa

Un spike a comparé QuickJS (`rquickjs`) et Boa sur sept cas et quatre paliers.
Harnais Rust jetable, macOS, un run par cellule. Le temps mesuré couvre
l'initialisation du moteur, `JSON.parse`, `buildGraph` et la construction du
rapport, donc plus large que les 814 ms du bench du core, qui ne couvrent que
build + index sous V8.

| Palier | QuickJS | Boa | écart |
|---|---|---|---|
| `shop.json` (27 nœuds) | 1,2 ms / 3 Mo | 3,2 ms / 7 Mo | 2,7× |
| 10 000 nœuds | 48 ms / 9 Mo | 259 ms / 24 Mo | 5,4× |
| 100 000 nœuds | 539 ms / 58 Mo | 3,3 s / 157 Mo | 6,2× |
| 1 000 000 nœuds | 6,0 s / 569 Mo | 39,0 s / 1854 Mo | 6,5× |

**Aucune divergence.** La sortie est identique octet pour octet sur les sept cas,
dont les deux chemins d'échec de la regex de `selector.ts` (`$.orders[*].@id` et
`$.orders[1x].id`), les refs à moitié pendantes et le palier 1 M. La crainte
d'une divergence via `regress`, le moteur de regex de Boa, était infondée.

Ce n'est pas la vitesse qui décide, c'est la mémoire. Boa consomme 1854 Mo au
palier 1 M, au-dessus de la cible de ~1,5 Go qui a fixé `maxNodes` à 1 000 000
dans `packages/core/README.md`. L'adopter invaliderait cette calibration. QuickJS
tient à 569 Mo contre 479 Mo sous V8, soit 1,19×, et la borne du core reste vraie
telle quelle.

À 10 000 nœuds, le cas réaliste d'un agent qui valide une config, Boa répond en
259 ms et la question ne se poserait pas. C'est le cas extrême que `maxNodes` est
précisément censé borner qui tranche.

Boa reste un repli documenté, et le spike l'a rendu plus solide qu'un pari :
sa correction est établie. Si la compilation croisée devient douloureuse, la
bascule coûte un `maxNodes` abaissé pour le chemin `--check`, ce qui est un
arbitrage chiffré.

L'objection « QuickJS est du C, donc friction en compilation croisée » a été
soulevée puis retirée : Tauri lie déjà une WebView et exige les Xcode Command
Line Tools. Le projet traîne plus de complexité de build native que QuickJS n'en
ajoute.

## Câblage du build

`include_str!` exige que le bundle existe à la compilation Rust, ce qui
imposerait un ordre entre deux chaînes d'outils. Cet ordre n'est pas résolu, il
est supprimé : **le bundle est généré et commité.** Cargo ne dépend alors jamais
de pnpm, et la fraîcheur devient une affaire de test.

Le dépôt fait déjà exactement cela pour `apps/demo/src/tokens.css`.

- `packages/core/scripts/generate-check-bundle.ts`, exposé en
  `pnpm --filter @defsquare/data-graph-core generate:check`, sur le calque de
  `generate:css`.
- Sortie commitée dans `apps/demo/src-tauri/generated/check.js`.
- Le générateur pur est séparé du script qui écrit, comme `renderTokensCss()`
  l'est de `scripts/generate-css.ts`. Ici : `buildCheckBundle(): string`, en
  `esbuild.buildSync` pour garder la forme synchrone du test.
- **Non minifié** : 16 ko au lieu de 6,5, ce qui ne pèse rien face à 9,2 Mo, et
  donne en échange un diff lisible en revue et un échec de test intelligible.
- `esbuild` passe en devDependency explicite de `core`. Il n'y est aujourd'hui
  qu'en transitif via tsup, et un test qui compare des octets ne peut pas
  dépendre d'une version qui bouge dans le dos.

Un bump d'esbuild peut changer la sortie et faire rougir le test de fraîcheur.
C'est le mécanisme qui fonctionne, sur le même contrat que `tokens.css` : on
régénère, on relit le diff, on commite.

## Tests

| # | Où | Ce qu'il garde |
|---|---|---|
| 1 | vitest / core | Pureté de `validate.ts` : sa fermeture ne doit pas atteindre `structure-layout.ts`. |
| 2 | vitest / core | Fraîcheur du `check.js` commité, octet pour octet. |
| 3 | vitest / core | Sémantique du rapport, sur fixtures. |
| 4 | cargo / demo | La frontière : le bundle s'évalue, la fonction existe, les chaînes traversent. |
| 5 | cargo / demo | Bout en bout sur les fixtures commitées. |

La couche 1 protège l'investissement. Sans elle, un import ajouté dans
`validate.ts` fait rentrer elkjs dans la fermeture et le binaire prend 1,5 Mo
sans que rien ne le signale. C'est la même marche récursive sur les imports que
`bundle-purity.test.ts` fait déjà pour `graph-layout`.

La couche 3 porte le gros de la couverture, délibérément : sélecteur à zéro
match, `unresolved-reference`, refs pendantes, ids dupliqués, les deux chemins
d'échec de la regex, le ratio `12/12 dangling`. C'est du TypeScript testé en
vitest, sans Rust et sans moteur, donc rapide et riche.

La couche 4 reste mince, et le principe compte plus que sa taille : la sémantique
se teste en TS, la frontière se teste en Rust. Dupliquer le corpus sémantique
côté Rust recréerait la taxe à deux langages que le refus du portage a écartée.
Le mapping des codes de sortie se teste d'ailleurs sans moteur, par une fonction
pure `classify(report) -> code` en test unitaire.

La couche 5 offre un gain gratuit. Le test existant
`load_reads_the_committed_fixtures` porte ce commentaire : *« The semantic
counterpart — is the config valid for the core — lives in `e2e/file-mode.spec.ts`;
here we only prove what `load` promises: the files exist and are JSON. »* Avec
`--check`, le Rust peut prouver que la config des fixtures est réellement valide
pour les données que le README dit de taper, sans passer par Playwright.

Aucune orchestration nouvelle n'est nécessaire. `apps/demo` a pour script de test
`cargo test --manifest-path src-tauri/Cargo.toml`, déjà branché dans `pnpm test` ;
les couches 1 à 3 tombent dans le vitest de `core`, les 4 et 5 dans le cargo
existant. Le seul coût réel est que `cargo build` compile désormais QuickJS en C,
ce qui allonge la première compilation.

## À corriger au passage

Le message de `GraphTooLargeError` est en français :
`relevez "maxNodes" dans la config (option -c de la CLI)`. Les 14 autres messages
du core et tout le CLI sont en anglais. Il sortirait tel quel dans un rapport
`--check`, y compris en `--json`.

## Hors périmètre

L'analyse riche de données (degrés, composantes connexes, cycles, orphelins,
décomptes par type) est écartée pour cette itération. Le rapport est dessiné pour
l'accueillir sans rupture : les champs s'ajoutent, la règle de compatibilité du
`report: 1` le permet.

Un serveur MCP est écarté aussi, et la raison ne changera pas tant que le
consommateur est Claude Code : la skill plus Bash suffisent. La question se
reposerait pour un usage hors Claude Code.
