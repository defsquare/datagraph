# Mode end-user CLI `datagraph` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le binaire Tauri devient un CLI `datagraph <data.json> [-c <config.json>]` qui ouvre la fenêtre desktop directement sur les données de l'utilisateur ; sans argument, l'app reste la démo actuelle.

**Architecture:** Le Rust (`src-tauri`) parse argv, lit et pré-valide les fichiers (syntaxe JSON uniquement), échoue en pur CLI (stderr + exit ≠ 0) avant toute fenêtre, puis expose le contenu via une commande Tauri `launch_payload`. Le frontend (`apps/demo/src/main.ts`) interroge cette commande au boot : payload présent → mode fichier (chrome démo masqué, vue structure seule si config absente) ; absent ou hors Tauri → mode démo inchangé. Le cœur est assoupli pour accepter `entities: {}`.

**Tech Stack:** Tauri v2 (Rust, serde_json déjà en dépendance), TypeScript/Vite, Vitest (cœur), `cargo test` (CLI Rust), Playwright (e2e démo).

**Spec:** `docs/superpowers/specs/2026-09-04-cli-enduser-design.md`

## Global Constraints

- Messages d'erreur CLI et texte de `--help` en **anglais** ; commentaires de code en **français** (convention repo : ils documentent le « pourquoi »).
- Erreurs CLI : préfixe `datagraph: `, usage errors → exit 2, erreurs fichier/JSON → exit 1, `--help` → stdout + exit 0. Aucune fenêtre ne s'ouvre dans ces cas.
- Le binaire produit s'appelle `datagraph` (plus `data-graph`).
- Pas de nouvelle dépendance Rust (pas de clap : argv se parse à la main). Une seule dépendance npm ajoutée : `@tauri-apps/api`.
- L'écran d'erreur in-app (config sémantiquement invalide) est en français comme le reste du chrome, avec le message d'erreur brut (anglais) en dessous.
- Le mode démo (sans argument / hors Tauri) doit rester strictement identique : les e2e existants passent sans modification.
- Commandes de vérification : `pnpm typecheck`, `pnpm build` puis `pnpm test`, `cargo test --manifest-path apps/demo/src-tauri/Cargo.toml`, `pnpm --filter @defsquare/data-graph build` puis `pnpm --filter demo e2e`.

---

### Task 1: Cœur — `validateConfig` accepte une config sans entités

**Files:**
- Modify: `packages/core/src/config.ts:77-81`
- Test: `packages/core/test/config.test.ts:65-68`
- Test: `packages/core/test/build.test.ts`

**Interfaces:**
- Consumes: `validateConfig(config: DataGraphConfig): ValidatedConfig`, `buildGraph(data: unknown, config: DataGraphConfig): Graph` (existants).
- Produces: `validateConfig({ entities: {} })` retourne un `ValidatedConfig` avec `entities` vide au lieu de lever `ConfigError("empty-config")`. Aucun changement de signature. Les tâches 4-5 s'appuient sur `{ entities: {} }` comme « config structure seule ».

- [ ] **Step 1: Écrire les tests qui échouent**

Dans `packages/core/test/config.test.ts`, remplacer le test `"rejects an empty entities map and bad selectors"` (lignes 65-68) par :

```ts
  it("accepts an empty entities map (structure-only mode)", () => {
    // Un JSON sans entités est exactement « un arbre » : le CLI end-user ouvre
    // un document sans config en vue structure seule.
    const v = validateConfig({ entities: {} })
    expect(v.entities.size).toBe(0)
    expect(v.references.size).toBe(0)
    expect(v.aggregates).toEqual([])
  })

  it("rejects bad selectors", () => {
    expect(() => validateConfig({ entities: { X: { match: "nope", id: "id" } } })).toThrow(ConfigError)
  })
```

Dans `packages/core/test/build.test.ts`, ajouter dans le `describe("buildGraph")` :

```ts
  it("builds a plain structure tree with an empty entities config", () => {
    const g2 = buildGraph(shopData, { entities: {} })
    // Aucune entité reconnue : que du containment, pas de références.
    for (const node of g2.nodes.values()) expect(node.kind).not.toBe("entity")
    expect(g2.entityIndex.size).toBe(0)
    expect(g2.refEdges).toEqual([])
    expect(g2.diagnostics).toEqual([])
  })
```

(`refEdges: RefEdge[]` et `entityIndex` sont les noms exacts de `packages/core/src/model.ts:146-154`.)

- [ ] **Step 2: Vérifier qu'ils échouent**

Run: `pnpm --filter @defsquare/data-graph-core exec vitest run test/config.test.ts test/build.test.ts`
Expected: FAIL — `accepts an empty entities map` lève `ConfigError` (« Entities map cannot be empty »).

- [ ] **Step 3: Implémentation minimale**

Dans `packages/core/src/config.ts`, supprimer les lignes 78-81 :

```ts
  // Check if entities is empty
  if (Object.keys(config.entities).length === 0) {
    throw new ConfigError("empty-config", "Entities map cannot be empty")
  }
```

et ne rien mettre à la place. Une map d'entités vide traverse ensuite toutes les boucles sans effet (aucune référence ni agrégat ne peut la citer : `unknown-entity-type` les rejetterait, comportement déjà testé et inchangé).

- [ ] **Step 4: Vérifier que les tests passent**

Run: `pnpm --filter @defsquare/data-graph-core exec vitest run test/config.test.ts test/build.test.ts`
Expected: PASS (tous).

- [ ] **Step 5: Suite complète du cœur**

Run: `pnpm build && pnpm test`
Expected: PASS — `pnpm build` d'abord (bundle-purity lit `dist/`). Aucun autre test ne dépend d'`empty-config` (vérifié : `rg "empty-config"` ne matche que `config.ts` et `config.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/config.ts packages/core/test/config.test.ts packages/core/test/build.test.ts
git commit -m "feat(core): accepter une config sans entités (vue structure seule)"
```

---

### Task 2: Rust — module `cli` (parse argv + chargement des fichiers), testé par cargo

**Files:**
- Create: `apps/demo/src-tauri/src/cli.rs`
- Modify: `apps/demo/src-tauri/src/lib.rs:1-4` (seulement `pub mod cli;` — le reste du branchement est en Task 3)

**Interfaces:**
- Consumes: rien (std + serde_json, déjà en dépendances).
- Produces (utilisé par Task 3) :
  - `cli::Cli { data_path: Option<String>, config_path: Option<String>, help: bool }`
  - `cli::parse(args: &[String]) -> Result<Cli, String>` — argv SANS le nom du programme.
  - `cli::load(cli: &Cli) -> Result<Option<LaunchPayload>, String>` — `None` si pas de fichier (mode démo).
  - `cli::LaunchPayload { data: String, config: Option<String> }` — dérive `Clone, Debug, PartialEq, serde::Serialize` ; sérialisé vers le frontend en `{ data: string, config: string | null }`.
  - `cli::USAGE: &str` — texte d'aide anglais.

- [ ] **Step 1: Écrire le module avec ses tests (tests d'abord dans le fichier)**

Créer `apps/demo/src-tauri/src/cli.rs` :

```rust
//! Parsing de la ligne de commande et chargement des fichiers, AVANT toute
//! fenêtre : les erreurs de lancement doivent arriver là où un utilisateur de
//! CLI les attend — sur stderr, avec un code de sortie — pas dans une WebView.
//!
//! Volontairement sans clap : deux arguments ne justifient pas une dépendance.
//! Messages et aide en anglais (décision de spec) ; seule la validation
//! SYNTAXIQUE du JSON se fait ici — la validation sémantique de la config
//! (entités connues, sélecteurs) reste au cœur TypeScript, la dupliquer en
//! Rust créerait deux vérités.

pub const USAGE: &str = "datagraph - explore a JSON document as an entity graph

Usage:
  datagraph [<data.json>] [-c <config.json>]

Arguments:
  <data.json>       Path to the JSON document to open.
                    Without it, the app opens on the built-in demo dataset.

Options:
  -c <config.json>  Path to a JSON config declaring entities, references
                    and aggregates. Without it, the document opens in
                    structure view only.
  -h, --help        Show this help and exit.";

#[derive(Debug, PartialEq)]
pub struct Cli {
  pub data_path: Option<String>,
  pub config_path: Option<String>,
  pub help: bool,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct LaunchPayload {
  pub data: String,
  pub config: Option<String>,
}

/// Parse argv (sans le nom du programme). Pur : aucune lecture disque, pour
/// rester testable sans fixtures.
pub fn parse(args: &[String]) -> Result<Cli, String> {
  let mut data_path: Option<String> = None;
  let mut config_path: Option<String> = None;
  let mut help = false;
  let mut it = args.iter();
  while let Some(arg) = it.next() {
    match arg.as_str() {
      "-h" | "--help" => help = true,
      "-c" => {
        let value = it.next().ok_or_else(|| "option '-c' expects a path".to_string())?;
        config_path = Some(value.clone());
      }
      s if s.starts_with('-') => return Err(format!("unknown option '{s}'")),
      s => {
        if data_path.is_some() {
          return Err(format!("unexpected argument '{s}'"));
        }
        data_path = Some(s.to_string());
      }
    }
  }
  // `-c` seul n'a pas de sens : la config qualifie un document.
  if !help && config_path.is_some() && data_path.is_none() {
    return Err("option '-c' requires a data file argument".to_string());
  }
  Ok(Cli { data_path, config_path, help })
}

/// Lit les fichiers du `Cli` et vérifie que chacun est du JSON syntaxiquement
/// valide. `Ok(None)` = pas de fichier demandé (mode démo).
pub fn load(cli: &Cli) -> Result<Option<LaunchPayload>, String> {
  let Some(data_path) = &cli.data_path else { return Ok(None) };
  let data = read_json(data_path)?;
  let config = match &cli.config_path {
    Some(path) => Some(read_json(path)?),
    None => None,
  };
  Ok(Some(LaunchPayload { data, config }))
}

/// Le contenu est gardé en `String` brute : c'est le frontend qui parse, il n'y
/// a aucune raison de désérialiser ici pour re-sérialiser vers la WebView.
fn read_json(path: &str) -> Result<String, String> {
  let text = std::fs::read_to_string(path).map_err(|e| format!("cannot read '{path}': {e}"))?;
  serde_json::from_str::<serde_json::de::IgnoredAny>(&text)
    .map_err(|e| format!("'{path}' is not valid JSON: {e}"))?;
  Ok(text)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn args(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
  }

  #[test]
  fn no_args_means_demo_mode() {
    let cli = parse(&args(&[])).unwrap();
    assert_eq!(cli, Cli { data_path: None, config_path: None, help: false });
  }

  #[test]
  fn positional_is_the_data_path() {
    let cli = parse(&args(&["data.json"])).unwrap();
    assert_eq!(cli.data_path.as_deref(), Some("data.json"));
    assert_eq!(cli.config_path, None);
  }

  #[test]
  fn dash_c_takes_the_next_value() {
    let cli = parse(&args(&["data.json", "-c", "conf.json"])).unwrap();
    assert_eq!(cli.config_path.as_deref(), Some("conf.json"));
    // L'ordre inverse marche aussi.
    let cli = parse(&args(&["-c", "conf.json", "data.json"])).unwrap();
    assert_eq!(cli.data_path.as_deref(), Some("data.json"));
    assert_eq!(cli.config_path.as_deref(), Some("conf.json"));
  }

  #[test]
  fn help_flags_are_recognized() {
    assert!(parse(&args(&["--help"])).unwrap().help);
    assert!(parse(&args(&["-h"])).unwrap().help);
    // `--help` gagne même accompagné : l'utilisateur demande l'aide, on la donne.
    assert!(parse(&args(&["data.json", "--help"])).unwrap().help);
  }

  #[test]
  fn dash_c_without_value_is_an_error() {
    let err = parse(&args(&["data.json", "-c"])).unwrap_err();
    assert!(err.contains("'-c' expects a path"), "{err}");
  }

  #[test]
  fn unknown_option_is_an_error() {
    let err = parse(&args(&["--watch"])).unwrap_err();
    assert!(err.contains("unknown option '--watch'"), "{err}");
  }

  #[test]
  fn second_positional_is_an_error() {
    let err = parse(&args(&["a.json", "b.json"])).unwrap_err();
    assert!(err.contains("unexpected argument 'b.json'"), "{err}");
  }

  #[test]
  fn dash_c_alone_is_an_error() {
    let err = parse(&args(&["-c", "conf.json"])).unwrap_err();
    assert!(err.contains("requires a data file"), "{err}");
  }

  // --- load : fixtures écrites dans le dossier temporaire du système, nommées
  // par PID + nom de test pour que les tests parallèles ne se marchent pas dessus.
  fn temp_file(name: &str, contents: &str) -> String {
    let path = std::env::temp_dir().join(format!("datagraph-cli-{}-{name}", std::process::id()));
    std::fs::write(&path, contents).unwrap();
    path.to_string_lossy().into_owned()
  }

  #[test]
  fn load_without_data_path_is_none() {
    let cli = Cli { data_path: None, config_path: None, help: false };
    assert_eq!(load(&cli).unwrap(), None);
  }

  #[test]
  fn load_reads_data_and_optional_config() {
    let data = temp_file("data.json", r#"{"customers": []}"#);
    let conf = temp_file("conf.json", r#"{"entities": {}}"#);
    let cli = Cli { data_path: Some(data), config_path: Some(conf), help: false };
    let payload = load(&cli).unwrap().unwrap();
    assert_eq!(payload.data, r#"{"customers": []}"#);
    assert_eq!(payload.config.as_deref(), Some(r#"{"entities": {}}"#));
  }

  #[test]
  fn load_missing_file_is_an_error() {
    let cli = Cli {
      data_path: Some("/nonexistent/nope.json".to_string()),
      config_path: None,
      help: false,
    };
    let err = load(&cli).unwrap_err();
    assert!(err.contains("cannot read '/nonexistent/nope.json'"), "{err}");
  }

  #[test]
  fn load_invalid_json_is_an_error() {
    let data = temp_file("bad.json", "{not json");
    let cli = Cli { data_path: Some(data.clone()), config_path: None, help: false };
    let err = load(&cli).unwrap_err();
    assert!(err.contains("is not valid JSON"), "{err}");
    assert!(err.contains(&data), "{err}");
  }
}
```

Déclarer le module : dans `apps/demo/src-tauri/src/lib.rs`, ajouter en tête (après le commentaire existant, avant `#[cfg_attr...]`) :

```rust
pub mod cli;
```

- [ ] **Step 2: Vérifier que les tests tournent et passent**

Run: `cargo test --manifest-path apps/demo/src-tauri/Cargo.toml`
Expected: PASS — 12 tests du module `cli`. (Le module est écrit d'un bloc, tests inclus : le cycle rouge/vert classique s'applique mal à un fichier neuf dont les tests ne compilent pas sans l'implémentation ; la vérification est que chaque assertion décrit bien le contrat.)

Si la compilation échoue sur `serde_json::de::IgnoredAny`, utiliser `serde::de::IgnoredAny` (réexport selon les versions) : `serde_json::from_str::<serde::de::IgnoredAny>(&text)`.

- [ ] **Step 3: Commit**

```bash
git add apps/demo/src-tauri/src/cli.rs apps/demo/src-tauri/src/lib.rs
git commit -m "feat(desktop): module cli — parse argv et chargement JSON testés"
```

---

### Task 3: Rust — branchement main/lib, commande `launch_payload`, binaire `datagraph`

**Files:**
- Modify: `apps/demo/src-tauri/src/main.rs`
- Modify: `apps/demo/src-tauri/src/lib.rs`
- Modify: `apps/demo/src-tauri/Cargo.toml`
- Modify: `apps/demo/src-tauri/tauri.conf.json`

**Interfaces:**
- Consumes: `cli::{parse, load, Cli, LaunchPayload, USAGE}` (Task 2).
- Produces (utilisé par Task 4) : commande Tauri `launch_payload` sans argument, retournant `LaunchPayload | null` côté JS, soit `{ data: string, config: string | null } | null`. Et `data_graph_lib::run_with(payload: Option<cli::LaunchPayload>)`.

- [ ] **Step 1: `main.rs` — CLI d'abord, fenêtre ensuite**

Remplacer `apps/demo/src-tauri/src/main.rs` par :

```rust
// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Tout l'aiguillage CLI vit AVANT `run_with` : aide et erreurs ne doivent
// jamais ouvrir de fenêtre. (Sur Windows en release, `windows_subsystem =
// "windows"` prive println/eprintln de console — assumé : la cible primaire
// est le lancement depuis un shell macOS/Linux.)
fn main() {
  let args: Vec<String> = std::env::args().skip(1).collect();
  let cli = match data_graph_lib::cli::parse(&args) {
    Ok(cli) => cli,
    Err(message) => {
      eprintln!("datagraph: {message}\n\n{}", data_graph_lib::cli::USAGE);
      std::process::exit(2);
    }
  };
  if cli.help {
    println!("{}", data_graph_lib::cli::USAGE);
    return;
  }
  let payload = match data_graph_lib::cli::load(&cli) {
    Ok(payload) => payload,
    Err(message) => {
      eprintln!("datagraph: {message}");
      std::process::exit(1);
    }
  };
  data_graph_lib::run_with(payload);
}
```

- [ ] **Step 2: `lib.rs` — état géré + commande**

Remplacer `apps/demo/src-tauri/src/lib.rs` par :

```rust
pub mod cli;

use cli::LaunchPayload;

/// Seule commande exposée : le payload de lancement lu par `main.rs`. Les
/// commandes d'application (invoke_handler) ne passent pas par les capabilities
/// — celles-ci ne gardent que les permissions des plugins et du core.
#[tauri::command]
fn launch_payload(state: tauri::State<'_, Option<LaunchPayload>>) -> Option<LaunchPayload> {
  state.inner().clone()
}

/// `payload` est `None` en mode démo (aucun fichier sur la ligne de commande).
pub fn run_with(payload: Option<LaunchPayload>) {
  tauri::Builder::default()
    .manage(payload)
    .invoke_handler(tauri::generate_handler![launch_payload])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

// L'entrée mobile ne porte pas d'argv : elle démarre toujours en mode démo.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  run_with(None)
}
```

- [ ] **Step 3: Renommer le binaire en `datagraph`**

Dans `apps/demo/src-tauri/Cargo.toml`, ajouter après la section `[lib]` :

```toml
# Le binaire s'appelle comme la commande que l'utilisateur tape — `datagraph` —
# et non comme le paquet. `mainBinaryName` (tauri.conf.json) doit rester aligné.
[[bin]]
name = "datagraph"
path = "src/main.rs"
```

Dans `apps/demo/src-tauri/tauri.conf.json`, ajouter au niveau racine (à côté de `productName`) :

```json
  "mainBinaryName": "datagraph",
```

- [ ] **Step 4: Vérifier compilation et tests**

Run: `cargo check --manifest-path apps/demo/src-tauri/Cargo.toml && cargo test --manifest-path apps/demo/src-tauri/Cargo.toml`
Expected: check OK, les 12 tests `cli` passent toujours.

- [ ] **Step 5: Vérifier le comportement CLI sans fenêtre (binaire debug)**

```bash
cargo build --manifest-path apps/demo/src-tauri/Cargo.toml
BIN=apps/demo/src-tauri/target/debug/datagraph
$BIN --help                       # → usage sur stdout, exit 0
$BIN /nonexistent.json; echo $?   # → "datagraph: cannot read ..." sur stderr, 1
$BIN --watch; echo $?             # → "datagraph: unknown option '--watch'" + usage, 2
```

Expected: exactement ces sorties, et AUCUNE fenêtre. (Ne pas lancer `$BIN` sans argument ici : sans `dist/` frontend la fenêtre serait vide — le bout-en-bout se vérifie en Task 6.)

- [ ] **Step 6: Commit**

```bash
git add apps/demo/src-tauri/src/main.rs apps/demo/src-tauri/src/lib.rs apps/demo/src-tauri/Cargo.toml apps/demo/src-tauri/tauri.conf.json
git commit -m "feat(desktop): CLI datagraph — argv, erreurs stderr, commande launch_payload"
```

---

### Task 4: Frontend — `launch.ts`, dépendance `@tauri-apps/api`, cible es2022

**Files:**
- Create: `apps/demo/src/launch.ts`
- Modify: `apps/demo/package.json` (dépendance)
- Modify: `apps/demo/vite.config.ts:22-42`

**Interfaces:**
- Consumes: commande Tauri `launch_payload` → `{ data: string, config: string | null } | null` (Task 3) ; type `DataGraphConfig` réexporté par `@defsquare/data-graph`.
- Produces (utilisé par Task 5) :
  - `type Launch = { mode: "demo" } | { mode: "file"; data: unknown; config: DataGraphConfig }`
  - `resolveLaunch(): Promise<Launch>`

- [ ] **Step 1: Ajouter la dépendance**

Run: `pnpm --filter demo add @tauri-apps/api`

- [ ] **Step 2: Créer `apps/demo/src/launch.ts`**

```ts
import { invoke } from "@tauri-apps/api/core";
import type { DataGraphConfig } from "@defsquare/data-graph";

/** Ce que la ligne de commande a demandé. `"demo"` couvre deux cas que le
 * frontend n'a pas à distinguer : hors Tauri (Vite/e2e) et binaire lancé sans
 * argument. */
export type Launch =
  | { mode: "demo" }
  | { mode: "file"; data: unknown; config: DataGraphConfig };

/** Miroir du `LaunchPayload` Rust : contenus BRUTS des fichiers. Rust n'a
 * validé que la syntaxe JSON ; c'est ici que les chaînes deviennent des
 * valeurs, et la validation sémantique de la config reste à `createDataGraph`. */
interface RawPayload {
  data: string;
  config: string | null;
}

export async function resolveLaunch(): Promise<Launch> {
  // Détection Tauri : l'objet d'internals n'existe que dans la WebView.
  if (!("__TAURI_INTERNALS__" in window)) return { mode: "demo" };
  const payload = await invoke<RawPayload | null>("launch_payload");
  if (payload === null) return { mode: "demo" };
  const data: unknown = JSON.parse(payload.data);
  // Sans `-c` : config vide = vue structure seule (le cœur l'accepte depuis
  // que `empty-config` a disparu).
  const config: DataGraphConfig =
    payload.config === null ? { entities: {} } : (JSON.parse(payload.config) as DataGraphConfig);
  return { mode: "file", data, config };
}
```

- [ ] **Step 3: Cible de build es2022 pour le top-level await**

Dans `apps/demo/vite.config.ts`, ajouter au retour de `defineConfig` (même niveau que `resolve`) :

```ts
  // main.ts attend `resolveLaunch()` en top-level await : la cible par défaut
  // de Vite (chrome87) le refuse à la minification. Les WebViews de Tauri
  // (WKWebView, WebView2) et les navigateurs des e2e sont largement au-delà.
  build: { target: "es2022" },
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. (`launch.ts` est inclus par `"include": ["src"]`.)

- [ ] **Step 5: Commit**

```bash
git add apps/demo/src/launch.ts apps/demo/package.json apps/demo/vite.config.ts pnpm-lock.yaml
git commit -m "feat(demo): resolveLaunch — source de données du lancement (démo ou fichier)"
```

---

### Task 5: Frontend — brancher `main.ts`, chrome conditionnel, écran d'erreur

**Files:**
- Modify: `apps/demo/src/main.ts:1-30` (tête) et `main.ts:412-418` (IIFE finale)
- Modify: `apps/demo/index.html:133` (ajout de l'écran d'erreur avant `#statusbar`)
- Modify: `apps/demo/src/style.css` (fin de fichier)

**Interfaces:**
- Consumes: `resolveLaunch(): Promise<Launch>` (Task 4), `createDataGraph`, type `DataGraph` (réexporté par `@defsquare/data-graph`).
- Produces: rien de nouveau pour les autres tâches — c'est la couture finale.

- [ ] **Step 1: Écran d'erreur dans `index.html`**

Insérer avant `<div id="statusbar">` :

```html
    <!-- Écran d'erreur de chargement (mode fichier) : la validation sémantique
         de la config n'a lieu qu'ici, côté TS — Rust n'a vérifié que la syntaxe
         JSON. Le message brut (anglais, ConfigError du cœur) est cité tel quel :
         c'est la déclaration que l'auteur de la config doit relire. -->
    <div id="load-error" class="float" hidden>
      <h2>Impossible d'ouvrir le document</h2>
      <pre id="load-error-message"></pre>
    </div>
```

- [ ] **Step 2: Styles de l'écran d'erreur**

À la fin de `apps/demo/src/style.css` :

```css
/* ---------- Écran d'erreur de chargement (mode fichier) ---------- */

#load-error {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  max-width: min(560px, calc(100vw - 2 * var(--space-6)));
  padding: var(--space-4) var(--space-6);
  z-index: 10;
}

#load-error h2 {
  margin: 0 0 var(--space-2);
  font-family: var(--font-title);
  font-size: 20px;
  font-weight: 600;
  color: var(--ds-ink);
}

#load-error pre {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--ds-muted);
}
```

- [ ] **Step 3: Brancher `main.ts`**

Remplacer les lignes 9-29 de `apps/demo/src/main.ts` (de l'import de `sample-data` jusqu'à `window.__graph = graph;` inclus — les imports de la lib restent, ajouter `type DataGraph` à la liste importée de `@defsquare/data-graph`) par :

```ts
import { shopData, shopConfig, bigShopData, bigShopConfig } from "./sample-data";
import { resolveLaunch } from "./launch";

const container = document.getElementById("app");
if (!container) throw new Error("#app container not found");

// Top-level await (cible es2022, voir vite.config.ts) : tout le reste du
// module dépend du mode de lancement, l'attendre ici évite d'envelopper le
// fichier entier dans une fonction.
const launch = await resolveLaunch();

// Le chrome se taille AVANT que les gestionnaires plus bas ne relisent le
// DOM : un bouton retiré donne `getElementById` → null, et tous les
// gestionnaires savent déjà vivre sans leur élément.
if (launch.mode === "file") {
  // La bascule petit/grand jeu de données est un outil de démo.
  document.getElementById("toggle-dataset")?.remove();
  if (Object.keys(launch.config.entities).length === 0) {
    // Sans entités la vue graphe n'a rien à montrer : structure seule.
    document.getElementById("toggle-view")?.remove();
  }
}

function showLoadError(error: unknown): void {
  const messageEl = document.getElementById("load-error-message");
  if (messageEl) messageEl.textContent = error instanceof Error ? error.message : String(error);
  document.getElementById("load-error")?.removeAttribute("hidden");
}

let graph: DataGraph;
try {
  graph = createDataGraph(container, {
    data: launch.mode === "file" ? launch.data : shopData,
    config: launch.mode === "file" ? launch.config : shopConfig,
    // Real Web Worker offload for elk layout is best-effort here: elkjs's
    // bundled ELK falls back to an in-process "fake worker" under Vite/browser
    // (see task-11-report.md). The option is still wired end-to-end.
    elkWorkerUrl: new URL("elkjs/lib/elk-worker.min.js", import.meta.url),
  });
} catch (error) {
  // `createDataGraph` valide la config en synchrone : une config
  // sémantiquement invalide s'arrête ici, en écran d'erreur — pas en fenêtre
  // blanche. Le `throw` stoppe l'évaluation du module : rien plus bas n'a de
  // sens sans instance.
  showLoadError(error);
  throw error;
}

// Exposed for manual/E2E inspection (Task 14 relies on this).
declare global {
  interface Window {
    __graph?: typeof graph;
  }
}
window.__graph = graph;
```

Puis remplacer l'IIFE finale (actuelles lignes 412-418) par :

```ts
void (async () => {
  try {
    await graph.ready;
  } catch (error) {
    // Les échecs asynchrones (GraphTooLargeError, worker) arrivent par
    // `ready` : même écran que les échecs synchrones.
    showLoadError(error);
    return;
  }
  graph.fit();
  applyTheme();
  syncViewButton(graph.currentView());
  updateStatus();
})();
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. Si `type DataGraph` manque à l'import : l'ajouter dans la liste `import { ... } from "@defsquare/data-graph"` (il est réexporté par le renderer).

- [ ] **Step 5: E2e — le mode démo doit être intact**

Run: `pnpm --filter @defsquare/data-graph build && pnpm --filter demo e2e`
Expected: PASS sans modifier aucun test — hors Tauri, `resolveLaunch()` retourne `{ mode: "demo" }` sans rien invoquer.

- [ ] **Step 6: Commit**

```bash
git add apps/demo/src/main.ts apps/demo/index.html apps/demo/src/style.css
git commit -m "feat(demo): mode fichier — payload CLI, chrome conditionnel, écran d'erreur"
```

---

### Task 6: Fixtures, vérification bout-en-bout, documentation

**Files:**
- Create: `apps/demo/fixtures/shop.json`
- Create: `apps/demo/fixtures/shop.config.json`
- Modify: `README.md:543,558-568`
- Modify: `CLAUDE.md` (section Commandes, ligne Desktop)

**Interfaces:**
- Consumes: le binaire `datagraph` complet (Tasks 1-5).
- Produces: fixtures rejouables pour tout test manuel futur ; docs à jour.

- [ ] **Step 1: Fixtures**

`apps/demo/fixtures/shop.json` :

```json
{
  "customers": [
    { "id": "c1", "name": "Ada Lovelace", "email": "ada@example.com" },
    { "id": "c2", "name": "Alan Turing", "email": "alan@example.com" }
  ],
  "orders": [
    { "id": "o1", "customerId": "c1", "total": 120.5, "lines": [{ "sku": "SKU-1", "qty": 2 }] },
    { "id": "o2", "customerId": "c2", "total": 42, "lines": [{ "sku": "SKU-9", "qty": 1 }] }
  ]
}
```

`apps/demo/fixtures/shop.config.json` :

```json
{
  "entities": {
    "Customer": { "match": "$.customers[*]", "id": "id" },
    "Order": { "match": "$.orders[*]", "id": "id" }
  },
  "references": {
    "Order": { "customerId": "Customer" }
  },
  "aggregates": ["Customer"]
}
```

- [ ] **Step 2: Build release et vérification manuelle des 5 scénarios**

```bash
pnpm --filter @defsquare/data-graph build
pnpm --filter demo tauri build
BIN=apps/demo/src-tauri/target/release/datagraph

$BIN --help                                    # usage stdout, exit 0, pas de fenêtre
$BIN missing.json; echo "exit=$?"              # stderr "cannot read", exit=1, pas de fenêtre
$BIN apps/demo/fixtures/shop.json -c apps/demo/fixtures/shop.config.json
                                               # fenêtre : entités Customer/Order, arêtes de
                                               # référence, bascule de vue présente,
                                               # PAS de bascule de jeu de données
$BIN apps/demo/fixtures/shop.json              # fenêtre : arbre pur, PAS de bascule de vue
$BIN                                           # fenêtre : démo actuelle, bascule de jeu
                                               # de données présente
```

Expected: chaque scénario se comporte comme commenté. Si le binaire release ne s'appelle pas `datagraph`, vérifier la cohérence `[[bin]]`/`mainBinaryName` (Task 3, Step 3).

- [ ] **Step 3: README**

Ligne 543 : `│       └── src-tauri/  Tauri v2 desktop shell around the demo (ships as a raw \`datagraph\` binary)`.

Ligne 562 : le chemin devient `apps/demo/src-tauri/target/release/datagraph`.

Après le paragraphe **Desktop shell.** (ligne 565-568), ajouter :

````markdown
**CLI usage.** The desktop binary doubles as an end-user CLI:

```bash
datagraph data.json -c config.json  # open a JSON document with an entity config
datagraph data.json                 # no config: structure view only
datagraph                           # no argument: built-in demo dataset
datagraph --help
```

File and JSON errors are reported on stderr with a non-zero exit code before
any window opens. Only JSON *syntax* is checked upfront; a semantically
invalid config (unknown entity type, bad selector) is reported in-app. Try it
with the sample files in `apps/demo/fixtures/`. The binary is not on your
`PATH` by default — copy or symlink
`apps/demo/src-tauri/target/release/datagraph` somewhere on it.
````

- [ ] **Step 4: CLAUDE.md**

Dans la section Commandes, remplacer la fin de la ligne Desktop : le binaire produit est `apps/demo/src-tauri/target/release/datagraph` (renommé), et ajouter : `— ce binaire est aussi le CLI end-user : datagraph <data.json> [-c <config.json>], sans argument il ouvre la démo`.

- [ ] **Step 5: Vérification finale globale**

Run: `pnpm typecheck && pnpm build && pnpm test && cargo test --manifest-path apps/demo/src-tauri/Cargo.toml`
Expected: tout PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/demo/fixtures README.md CLAUDE.md
git commit -m "docs: usage CLI datagraph + fixtures d'exemple"
```
