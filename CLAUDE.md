# data-graph

## Workflow

**La délégation dépend du modèle de la session courante** (celui annoncé dans l'environnement, réglable par `/model`). La règle existe pour ne pas dépenser Fable sur du travail qu'un modèle moins puissant fait aussi bien — elle n'a donc de sens que quand la session tourne sous Fable.

- **Session sous Fable → déléguer l'implémentation à un sous-agent `model: "opus"`** (Agent tool), par défaut et sans que l'utilisateur ait à le redemander. Le fil principal garde le brainstorming, le design et la revue.
- **Session sous tout autre modèle (Opus, Sonnet, …) → pas de sous-agent : écrire le code directement dans le fil.** Déléguer depuis un modèle déjà moins coûteux que Fable n'économise rien et ne fait qu'ajouter un aller-retour et une perte de contexte.

Deux exceptions rétablissent la délégation quel que soit le modèle : un skill qui l'impose, ou une demande explicite de l'utilisateur.

## Commandes

- Tests : `pnpm test` (racine, tous les packages — vitest **plus** `cargo test` via `apps/demo`, donc toolchain Rust requise) ou `pnpm --filter @defsquare/data-graph test` (le package renderer s'appelle `@defsquare/data-graph`, core `@defsquare/data-graph-core`)
- Typecheck : `pnpm typecheck`
- Build : `pnpm build`
- Playground du design system : `pnpm --filter design dev` (port 5174, la démo garde 5173 — les deux tournent ensemble)
- Desktop : `pnpm --filter demo tauri dev` / `tauri build` (Tauri v2, toolchain Rust requise) — le build produit un binaire brut `apps/demo/src-tauri/target/release/datagraph` (`bundle.active: false`, pas de `.app`/`.dmg` : l'app se lance depuis le shell) — ce binaire est aussi le CLI end-user : `datagraph <data.json> [-c <config.json>]`, sans argument il ouvre la démo

## Structure

- `packages/tokens` — source de vérité du design system (couleurs, typographie, espacements, rayons). `theme.ts` du renderer en dérive ses thèmes Pixi, et `scripts/generate-css.ts` (`pnpm --filter @defsquare/data-graph-tokens generate:css`) en génère `apps/demo/src/tokens.css`, dont `test/css.test.ts` vérifie la fraîcheur octet à octet — un token modifié sans régénération casse `pnpm test`.
- `packages/core` — graphe, layout (ELK + moteur deux niveaux pour la vue graphe), agrégats, recherche
- `packages/renderer` — rendu Pixi v8 (`create.ts` orchestration, `draw.ts` dessin pur, `camera.ts`, `drag.ts`, `hover.ts`)
- `apps/demo` — démo Vite + coquille desktop Tauri v2 (`src-tauri/`). Le Rust n'est pas du boilerplate : `cli.rs` porte le parseur argv de la CLI (testé par `cargo test`, câblé dans le script `test` du package, donc dans `pnpm test`), et `lib.rs` expose la commande Tauri `launch_payload` consommée par `src/launch.ts`. Le mode fichier est couvert côté TS par `e2e/file-mode.spec.ts`, qui simule `__TAURI_INTERNALS__` et rejoue les vraies `fixtures/`. Détails dans `apps/demo/README.md`.
- `apps/design` — playground du design system (port 5174) : quatre vues, tokens / composants graphe / composants UI / bac à sable, chacune dans les quatre thèmes marque × mode. Jamais publié, donc ses alias Vite pointent **inconditionnellement** sur `packages/*/src` (build compris) : ce qu'il montre est l'état courant des sources, sans `pnpm -r build` préalable. C'est l'inverse du choix de la démo, dont le build de production consomme les `exports` — la raison des deux est dans `apps/design/README.md`.

## Conventions

- Commentaires en français, qui documentent les contraintes/invariants (le « pourquoi »), pas le « quoi ».
- `draw.ts` ne prend que de la donnée nue (pas de graphe/état d'interface) pour rester testable sans instance.
- Toute opération mutante async est gardée par `opGen` + `destroyed` (voir `create.ts`).
