# Contrat data-first — `ids` / `refs` / `groups`

Date : 2026-09-04
Statut : validé en discussion, en attente de relecture du spec

## Objectif

Débarrasser le contrat public de son vocabulaire DDD (`entities`, `references`,
`aggregates`) au profit d'un vocabulaire centré données et références :

```json
{
  "ids": {
    "Customer": "$.customers[*].id",
    "Order": "$.orders[*].id"
  },
  "refs": [
    { "from": "$.orders[*].customerId", "to": "$.customers[*].id" }
  ],
  "groups": ["Customer"],
  "maxNodes": 50000,
  "rootLabel": "$"
}
```

- **`ids`** : nom → chemin de clé. Le préfixe du chemin (`$.customers[*]`)
  désigne l'ensemble d'instances, le dernier segment (`id`) le champ-clé. Le
  nom est une poignée de présentation (libellés `Customer #c1`, couleurs,
  badges) — pas un concept de domaine.
- **`refs`** : liste de joins `{from, to}` — « la valeur à `from` égale la
  valeur de clé à `to` ». Tableau (pas de collision quand deux refs partent
  du même chemin).
- **`groups`** (optionnel) : les noms de `ids` qui ancrent le regroupement de
  la vue graphe, dans l'ordre d'arbitrage. Absent → vue graphe à plat.
- `maxNodes` et `rootLabel` inchangés.

## Décisions actées

- **Rupture 0.x sans couche de compatibilité** : `entities`/`references`/
  `aggregates` disparaissent du type public (précédent établi :
  `graphLayoutOptions`). Tout fichier `-c` existant doit migrer.
- **Le cœur en aval de `ValidatedConfig` ne bouge pas** : la nouvelle forme se
  compile vers le `ValidatedConfig` actuel (noms → segments + champ-clé, refs
  regroupées par propriétaire). `build.ts`, `aggregate.ts`, layout, renderer,
  libellés et couleurs sont intacts — à une exception d'une ligne près (voir
  Diagnostics).
- **`groups` reste opt-in** : le regroupement à travers les références est une
  intention (choix des racines, ordre d'arbitrage), pas une propriété
  dérivable des données. Le chemin « zéro groupe » existe déjà.
- **Sans `-c`, le CLI synthétise `{ ids: {} }`** : la vue structure seule est
  inchangée.

## Validation (tout vit dans `config.ts`)

1. **Chemin de `ids`** : parsé par la grammaire de sélecteurs existante ; le
   dernier segment doit être une clé nue (pas de joker/indice) — erreur
   `invalid-config` sinon. Préfixe = `segments` du match, dernier segment =
   `idField`.
2. **`refs[].to`** : doit être exactement l'un des chemins de `ids`, comparé
   en **segments parsés** (pas en chaînes brutes). Le nom de l'entrée trouvée
   devient le `targetType` interne. Erreur explicite sinon — c'est la porte
   laissée ouverte pour viser un jour un champ autre que la clé, sans le payer
   maintenant.
3. **`refs[].from`** : doit étendre strictement le préfixe d'instances d'au
   moins une entrée de `ids` ; le plus long préfixe gagne, et le propriétaire
   trouvé devient le type source interne. Le reste du chemin se scinde en
   navigation relative + champ terminal (le dernier segment doit être une
   clé) — exactement ce que `ReferenceDecl {navigate, field}` porte déjà.
4. **`groups[]`** : chaque élément est un nom déclaré dans `ids` ; ordre
   conservé (il arbitre les égalités de distance, comme aujourd'hui).
5. **`ids: {}`** : valide — mode structure seule. La garde `invalid-config`
   existante (« must declare an entities object ») devient « must declare an
   ids object » ; la garde par entrée (match/id chaînes) devient « chemin de
   clé bien formé ».

## Diagnostics

Les messages du cœur citent déjà des noms (`missing-id`, `duplicate-id`,
`dangling-ref`) : inchangés. Une exception d'une ligne dans `build.ts` :
`ReferenceDecl.path` porte désormais la chaîne `from` **absolue** telle
qu'écrite (c'est la déclaration que l'auteur relira), et le gabarit du
diagnostic `unresolved-reference` cite `decl.path` seul au lieu de
`${sourceType}.${decl.path}` (qui produirait « Order.$.orders[*]… »).

## Limitation assumée (régression documentée)

L'ancien contrat acceptait une clé de référence exotique verbatim
(`@odata:id`) quand elle ne contenait ni `.` ni `[`. Avec un `from` absolu,
tout le chemin passe par la grammaire de sélecteurs, dont le token n'accepte
que `[A-Za-z_$][\w$-]*` : un champ `@odata:id` n'est plus déclarable comme
référence. Documenté dans le README ; l'extension de la grammaire (segments
quotés) est un chantier séparé si le besoin revient.

## Surface à migrer (aucune logique aval)

- `packages/core/src/config.ts` : `DataGraphConfig`/`EntityConfig` publics
  remplacés (`ids`/`refs`/`groups`), `validateConfig` réécrit → même
  `ValidatedConfig`.
- `packages/core/test/config.test.ts` : réécrit pour la nouvelle forme.
- Autres tests/fixtures (`fixtures.ts`, `build/references/value-object-refs/
  aggregate/…`), `apps/demo/src/sample-data.ts`, `apps/demo/fixtures/*.json` :
  migration mécanique des configs.
- `apps/demo/src/launch.ts` : config synthétisée `{ ids: {} }` ; `main.ts` :
  check structure-only sur `ids`.
- `apps/demo/src-tauri/src/cli.rs` : texte `--help` (« declaring ids, refs
  and groups ») + tests Rust citant `{"entities": {}}`.
- `README.md` (section config + exemple), `CLAUDE.md` si besoin.

## Tests

- `config.test.ts` : cas nominaux (ids, refs, groups), erreurs (dernier
  segment non-clé, `to` inconnu, `from` sans propriétaire, groupe inconnu,
  `ids` non-objet), `{ ids: {} }` accepté.
- Tout le reste de la suite passe après migration mécanique des configs de
  test — aucune assertion de comportement ne change (libellés, couleurs,
  agrégats, résolution identiques par construction).
- E2e inchangés (la démo migre ses configs, le comportement est identique).

## Hors scope

- Viser un champ cible autre que la clé déclarée (`to` libre).
- Heuristique de groupes automatique.
- Segments quotés dans la grammaire de sélecteurs.
