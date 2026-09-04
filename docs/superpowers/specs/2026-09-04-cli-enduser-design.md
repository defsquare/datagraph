# Mode end-user CLI — `datagraph <fichier.json> [-c config.json]`

Date : 2026-09-04
Statut : validé en discussion, en attente de relecture du spec

## Objectif

Donner à un utilisateur final un point d'entrée en ligne de commande :

```
datagraph <data.json> [-c <config.json>]
datagraph --help
```

qui ouvre la fenêtre desktop (Tauri v2) directement sur ses données. Sans
argument, l'app reste en mode démo actuel (données d'exemple embarquées).

## Décisions actées

- **Nature du CLI** : le binaire Tauri existant lit lui-même argv. Pas de
  wrapper Node, pas de serveur local + navigateur.
- **Signature** : le fichier de données est un argument **positionnel**
  (pas de `-d`). La config reste optionnelle via `-c`.
- **Sans `-c`** : l'app ouvre le JSON en vue structure seule (arbre), sans
  entités/références/agrégats ni vue graphe.
- **Une seule app** : `apps/demo` devient l'app. Sans argument → mode démo
  (comportement actuel, conservé pour les e2e). Le chrome spécifique démo
  (bascule jeu réduit/étendu) n'apparaît qu'en mode démo.
- **Pas de watch** en v1 : lecture unique au lancement.
- **Langue** : messages d'erreur CLI et texte de `--help` en **anglais**.
  (Les commentaires de code restent en français, convention du repo.)

## Architecture

### Côté Rust (`apps/demo/src-tauri/src/main.rs` + `lib.rs`)

Première commande Rust custom du projet — assumé, elle reste triviale :

1. Parse d'argv à la main (un positionnel + `-c <path>` + `--help` ;
   pas besoin de clap).
2. Lecture des fichiers en `String`, vérification « c'est du JSON » via
   `serde_json` (déjà dans l'arbre de dépendances Tauri).
3. **Échec en pur CLI** : fichier manquant/illisible, JSON invalide, ou
   argument inconnu → message anglais sur stderr + exit code ≠ 0, **avant**
   toute ouverture de fenêtre. `--help` → usage sur stdout + exit 0.
4. Payload `{ data: String, config: Option<String> }` stocké dans un
   `tauri::State`, servi par une commande `launch_payload`.

La validation **sémantique** de la config (entités connues, sélecteurs)
reste au cœur TypeScript : Rust ne vérifie que la syntaxe JSON. Une config
sémantiquement invalide s'affiche comme écran/dialogue d'erreur simple dans
l'app (la revalider en Rust dupliquerait `validateConfig`).

Le binaire est renommé `datagraph` (`productName`/`mainBinaryName` dans
`tauri.conf.json`), pour aligner commande et artefact.

### Côté frontend (`apps/demo/src/main.ts`)

Au boot :

- Sous Tauri (détection `window.__TAURI_INTERNALS__`) →
  `invoke("launch_payload")`.
  - Payload présent → `JSON.parse` des chaînes, `createDataGraph` avec ces
    données ; erreur de config sémantique → écran d'erreur simple.
  - Payload absent → mode démo.
- Hors Tauri (Vite pur, e2e) → mode démo, comportement actuel inchangé.

En mode fichier, la bascule « jeu réduit/étendu » n'est pas montée. Le
reste du chrome (recherche, thème, bascule de vue, panneau détail, barre
d'état) est commun aux deux modes.

### Cœur (`packages/core`)

Assouplissement : `validateConfig` accepte `entities: {}` (suppression de
l'erreur `empty-config`) — un JSON sans entités est exactement « un
arbre ». Conséquences :

- zéro entité ⇒ pas de références ni d'agrégats possibles ;
- la vue graphe n'a rien à montrer ⇒ en l'absence de config, l'app démarre
  en vue structure et **masque** le bouton de bascule de vue ;
- vérifier que build/layout tolèrent zéro entité (tests unitaires).

## Gestion d'erreurs (récapitulatif)

| Situation | Où | Comportement |
|---|---|---|
| Fichier data absent/illisible | CLI (Rust) | stderr anglais, exit 1, pas de fenêtre |
| Data JSON invalide | CLI (Rust) | idem |
| Config absente/illisible/JSON invalide (avec `-c`) | CLI (Rust) | idem |
| Config sémantiquement invalide | App (TS) | écran d'erreur simple dans la fenêtre |
| Argument inconnu / usage erroné | CLI (Rust) | usage sur stderr, exit ≠ 0 |
| `--help` | CLI (Rust) | usage sur stdout, exit 0 |

## Tests

- Unitaires cœur : `validateConfig({ entities: {} })` passe ; build/layout
  sans entité.
- E2e existants : inchangés (mode démo, hors Tauri).
- Chemin CLI : test manuel via `tauri build` + fixture JSON (Playwright ne
  couvre pas la coquille Tauri).

## Hors scope v1

- Watch/rechargement à chaud.
- Inférence heuristique de config.
- Distribution/installation sur le PATH (README : copie ou `ln -s` du
  binaire produit).
