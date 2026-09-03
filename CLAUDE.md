# data-graph

## Workflow

**La délégation dépend du modèle de la session courante** (celui annoncé dans l'environnement, réglable par `/model`). La règle existe pour ne pas dépenser Fable sur du travail qu'un modèle moins puissant fait aussi bien — elle n'a donc de sens que quand la session tourne sous Fable.

- **Session sous Fable → déléguer l'implémentation à un sous-agent `model: "opus"`** (Agent tool), par défaut et sans que l'utilisateur ait à le redemander. Le fil principal garde le brainstorming, le design et la revue.
- **Session sous tout autre modèle (Opus, Sonnet, …) → pas de sous-agent : écrire le code directement dans le fil.** Déléguer depuis un modèle déjà moins coûteux que Fable n'économise rien et ne fait qu'ajouter un aller-retour et une perte de contexte.

Deux exceptions rétablissent la délégation quel que soit le modèle : un skill qui l'impose, ou une demande explicite de l'utilisateur.

## Commandes

- Tests : `pnpm test` (racine, tous les packages) ou `pnpm --filter @defsquare/data-graph test` (le package renderer s'appelle `@defsquare/data-graph`, core `@defsquare/data-graph-core`)
- Typecheck : `pnpm typecheck`
- Build : `pnpm build`
- Desktop : `pnpm --filter demo tauri dev` / `tauri build` (Tauri v2, toolchain Rust requise) — le build produit un binaire brut `apps/demo/src-tauri/target/release/data-graph` (`bundle.active: false`, pas de `.app`/`.dmg` : l'app se lance depuis le shell)

## Structure

- `packages/core` — graphe, layout (ELK + moteur deux niveaux pour la vue graphe), agrégats, recherche
- `packages/renderer` — rendu Pixi v8 (`create.ts` orchestration, `draw.ts` dessin pur, `camera.ts`, `drag.ts`, `hover.ts`)
- `apps/demo` — démo Vite + coquille desktop Tauri v2 (`src-tauri/`, boilerplate sans commande Rust custom : tout est frontend)

## Conventions

- Commentaires en français, qui documentent les contraintes/invariants (le « pourquoi »), pas le « quoi ».
- `draw.ts` ne prend que de la donnée nue (pas de graphe/état d'interface) pour rester testable sans instance.
- Toute opération mutante async est gardée par `opGen` + `destroyed` (voir `create.ts`).
