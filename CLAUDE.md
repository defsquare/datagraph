# data-graph

## Workflow

- **Implémentation : déléguer à un sous-agent avec `model: "opus"`** (Agent tool). Le fil principal garde le brainstorming, le design et la revue ; l'écriture de code part en sous-agent Opus par défaut, sans que l'utilisateur ait à le redemander.

## Commandes

- Tests : `pnpm test` (racine, tous les packages) ou `pnpm --filter @defsquare/data-graph test` (le package renderer s'appelle `@defsquare/data-graph`, core `@defsquare/data-graph-core`)
- Typecheck : `pnpm typecheck`
- Build : `pnpm build`

## Structure

- `packages/core` — graphe, layout (ELK + moteur deux niveaux pour la vue graphe), agrégats, recherche
- `packages/renderer` — rendu Pixi v8 (`create.ts` orchestration, `draw.ts` dessin pur, `camera.ts`, `drag.ts`, `hover.ts`)
- `apps/demo` — démo Vite

## Conventions

- Commentaires en français, qui documentent les contraintes/invariants (le « pourquoi »), pas le « quoi ».
- `draw.ts` ne prend que de la donnée nue (pas de graphe/état d'interface) pour rester testable sans instance.
- Toute opération mutante async est gardée par `opGen` + `destroyed` (voir `create.ts`).
