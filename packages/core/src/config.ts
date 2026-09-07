import { parseSelector, ConfigError, type PathSegment } from "./selector.js"

/**
 * Contrat data-first : tout s'exprime en chemins.
 *
 * - `ids` : nom → chemin de clé. Le préfixe (`$.customers[*]`) désigne
 *   l'ensemble d'instances, le dernier segment (`id`) le champ-clé. Le nom
 *   n'est qu'une poignée de présentation (libellés, couleurs, badges).
 * - `refs` : joins `{from, to}` — « la valeur à `from` égale la valeur de clé
 *   à `to` ». Un tableau, pas une map : deux refs peuvent partir du même
 *   chemin sans collision de clé.
 * - `groups` : les noms de `ids` qui ancrent le regroupement de la vue
 *   graphe. L'ordre est PORTEUR : il arbitre les égalités de distance (voir
 *   `buildAggregates`) et fixe l'ordre de peinture des enveloppes.
 */
export interface DataGraphConfig {
  ids: Record<string, string>
  refs?: { from: string; to: string }[]
  groups?: string[]
  maxNodes?: number
  /** Libellé du nœud racine. Défaut `"$"` — le symbole racine de la syntaxe
   * de sélecteur que `ids` utilise déjà. Une chaîne vide est respectée. */
  rootLabel?: string
}

/**
 * Une référence déclarée, découpée en ce dont la construction a besoin : la
 * NAVIGATION depuis l'entité propriétaire (vide pour un champ direct) et la
 * clé de la ligne TERMINALE qui porte l'identifiant.
 *
 * `path` porte le `from` ABSOLU tel qu'écrit dans la config : c'est la
 * déclaration que l'auteur relira quand `unresolved-reference` la citera.
 */
export interface ReferenceDecl {
  navigate: PathSegment[]
  field: string
  targetType: string
  path: string
}

export interface ValidatedConfig {
  entities: Map<string, { segments: PathSegment[]; idField: string }>
  references: Map<string, ReferenceDecl[]>
  maxNodes: number
  rootLabel: string
  aggregates: string[]
}

function segmentsEqual(a: PathSegment[], b: PathSegment[]): boolean {
  if (a.length !== b.length) return false
  return a.every((seg, i) => {
    const other = b[i]!
    if (seg.kind !== other.kind) return false
    if (seg.kind === "key" && other.kind === "key") return seg.key === other.key
    if (seg.kind === "index" && other.kind === "index") return seg.index === other.index
    return true
  })
}

/**
 * LA frontière de traduction du package, et la seule.
 *
 * En entrée, le vocabulaire PUBLIC data-first : `ids` / `refs` / `groups`. En
 * sortie, le vocabulaire INTERNE du graphe : `entities` / `references` /
 * `aggregates`. Rien d'autre dans le package ne connaît le vocabulaire public —
 * ni `build.ts`, ni `aggregate.ts`, ni le renderer, qui ne voient jamais que le
 * `ValidatedConfig`. Corollaire : renommer un mot du contrat public ne doit
 * toucher que ce fichier (et `DataGraphConfig` ci-dessus).
 */
export function validateConfig(config: DataGraphConfig): ValidatedConfig {
  // Une config chargée du disque (option `-c` de la CLI) peut être n'importe
  // quel JSON : le type ne garantit rien, et un TypeError brut remonterait
  // tel quel jusqu'à l'écran d'erreur de l'utilisateur final.
  if (typeof config.ids !== "object" || config.ids === null || Array.isArray(config.ids)) {
    throw new ConfigError("invalid-config", "Config must declare an ids object")
  }

  // `ids` : chaque chemin se scinde en préfixe d'instances + champ-clé.
  const entities = new Map<string, { segments: PathSegment[]; idField: string }>()
  // Les segments COMPLETS (champ-clé inclus), pour comparer `refs[].to` en
  // segments parsés plutôt qu'en chaînes brutes.
  const idPathSegments = new Map<string, PathSegment[]>()
  for (const [name, idPath] of Object.entries(config.ids)) {
    if (typeof idPath !== "string") {
      throw new ConfigError("invalid-config", `Id path for '${name}' must be a string selector`)
    }
    const segments = parseSelector(idPath)
    const last = segments[segments.length - 1]!
    if (last.kind !== "key") {
      throw new ConfigError(
        "invalid-config",
        `Id path for '${name}' must end on a field name: ${idPath}`,
      )
    }
    entities.set(name, { segments: segments.slice(0, -1), idField: last.key })
    idPathSegments.set(name, segments)
  }

  // `refs` : la cible doit être un chemin de `ids` (viser un champ non-clé
  // est hors scope v1 — la porte reste ouverte sans être payée) ; la source
  // doit étendre STRICTEMENT un préfixe d'instances, le plus long gagne (à
  // longueur égale, l'ordre de déclaration de `ids` tranche — cas dégénéré
  // de deux noms sur le même préfixe).
  const references = new Map<string, ReferenceDecl[]>()
  // Garde avant `for...of` : une config migrée depuis l'ancienne forme MAP
  // (`references: {...}`) arrive ici en objet, et un objet n'est pas
  // itérable (TypeError brut) — pareil pour `groups` plus bas, où une
  // chaîne serait en plus silencieusement itérée caractère par caractère.
  if (config.refs !== undefined && !Array.isArray(config.refs)) {
    throw new ConfigError("invalid-config", "Config 'refs' must be an array of {from, to} entries")
  }
  for (const ref of config.refs ?? []) {
    if (
      typeof ref !== "object" || ref === null ||
      typeof (ref as { from?: unknown }).from !== "string" ||
      typeof (ref as { to?: unknown }).to !== "string"
    ) {
      throw new ConfigError("invalid-config", "Each ref must declare string 'from' and 'to' paths")
    }
    const toSegments = parseSelector(ref.to)
    let targetType: string | undefined
    for (const [name, segs] of idPathSegments) {
      if (segmentsEqual(segs, toSegments)) { targetType = name; break }
    }
    if (targetType === undefined) {
      throw new ConfigError("invalid-config", `Ref target must be a declared id path: ${ref.to}`)
    }

    const fromSegments = parseSelector(ref.from)
    let owner: string | undefined
    let ownerLen = -1
    for (const [name, entity] of entities) {
      const prefix = entity.segments
      if (
        prefix.length < fromSegments.length &&
        prefix.length > ownerLen &&
        segmentsEqual(prefix, fromSegments.slice(0, prefix.length))
      ) {
        owner = name
        ownerLen = prefix.length
      }
    }
    if (owner === undefined) {
      throw new ConfigError(
        "invalid-config",
        `Ref source must extend a declared instance prefix: ${ref.from}`,
      )
    }
    // `<` strict ci-dessus : le reste est non vide par construction.
    const remainder = fromSegments.slice(ownerLen)
    const last = remainder[remainder.length - 1]!
    if (last.kind !== "key") {
      throw new ConfigError(
        "invalid-config",
        `Ref source must end on a field name: ${ref.from}`,
      )
    }
    const decl: ReferenceDecl = {
      navigate: remainder.slice(0, -1),
      field: last.key,
      targetType,
      path: ref.from,
    }
    const list = references.get(owner)
    if (list) list.push(decl)
    else references.set(owner, [decl])
  }

  // `groups` → `aggregates` interne, ordre conservé.
  const aggregates: string[] = []
  if (config.groups !== undefined && !Array.isArray(config.groups)) {
    throw new ConfigError("invalid-config", "Config 'groups' must be an array of ids names")
  }
  for (const name of config.groups ?? []) {
    if (!entities.has(name)) {
      throw new ConfigError("unknown-group", `Unknown group: '${name}' is not declared in ids`)
    }
    aggregates.push(name)
  }

  // Garde MÉMOIRE, plus garde de coût : la vue graphe borne elle-même ce qu'elle
  // dispose, donc le plafond ne protège plus que buildGraph + buildSearchIndex,
  // tous deux linéaires. Défaut calibré au bench (`pnpm bench`, section
  // « échelle mémoire ») : 1 M nœuds logiques = ~430 Mo de heap (net ; ~479 Mo
  // absolus, baseline du bench comprise — cf. `bench/bench.ts`), ~0,8 s de
  // build+index sous les options node PAR DÉFAUT — la webview n'aura pas de
  // `--max-old-space-size` non plus.
  const maxNodes = config.maxNodes ?? 1_000_000

  // `??` et non `||` : une chaîne vide est un libellé valide que l'appelant a
  // le droit de vouloir.
  const rootLabel = config.rootLabel ?? "$"

  return { entities, references, maxNodes, rootLabel, aggregates }
}
