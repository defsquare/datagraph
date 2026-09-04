import { parseSelector, parseRelativePath, ConfigError, type PathSegment } from "./selector.js"

export interface EntityConfig {
  match: string
  id: string
}

export interface DataGraphConfig {
  entities: Record<string, EntityConfig>
  references?: Record<string, Record<string, string>>
  maxNodes?: number
  /** Libellé du nœud racine. Défaut `"$"` — le symbole racine de la syntaxe de
   * sélecteur que `entities[].match` utilise déjà, donc cohérent avec la
   * config plutôt que dénué de sens. Une chaîne vide est respectée. */
  rootLabel?: string
  /** Types d'entités qui sont racines d'agrégat, dans l'ordre de déclaration.
   * Cet ordre est PORTEUR : il arbitre les égalités de distance, donc il décide
   * de l'agrégat d'une entité qui atteint deux racines aussi près l'une que
   * l'autre (voir `buildAggregates`). Il fixe aussi l'ordre de peinture des
   * enveloppes, pour que le rendu soit reproductible. */
  aggregates?: string[]
}

/**
 * Une référence déclarée, découpée en ce dont la construction a besoin : la
 * NAVIGATION depuis l'entité déclarante (vide pour la forme historique
 * `customerId`, qui porte la ligne en propre) et la clé de la ligne TERMINALE
 * qui porte l'identifiant.
 *
 * `path` garde la clé telle qu'écrite dans la config : la reconstruire depuis
 * `navigate` perdrait l'écriture d'origine (`lines[*]` et `lines.*` se
 * ramènent aux mêmes segments), et `unresolved-reference` doit citer la
 * déclaration que l'auteur relira.
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

/**
 * Découpe une clé de `references[Type]` en navigation + clé terminale.
 *
 * Une clé SANS `.` ni `[` n'est pas parsée : elle reste une clé de ligne
 * verbatim. Le token du sélecteur n'accepte que `[A-Za-z_$][\w$-]*`, or une
 * clé JSON peut contenir n'importe quoi — parser inconditionnellement casserait
 * des configs qui marchent aujourd'hui.
 *
 * Le dernier segment doit être une CLÉ : le chemin désigne une ligne, et une
 * ligne a un nom. `lines[*]` ou `lines[*].*` ne désignent qu'un nœud.
 *
 * Limitation assumée : une clé de champ contenant littéralement `.` ou `[` est
 * lue comme un chemin.
 */
function parseReferenceKey(key: string): { navigate: PathSegment[]; field: string } {
  if (!key.includes(".") && !key.includes("[")) return { navigate: [], field: key }
  const segments = parseRelativePath(key)
  const last = segments[segments.length - 1]!
  if (last.kind !== "key") {
    throw new ConfigError(
      "selector-syntax",
      `Reference path must end on a field name: ${key}`,
    )
  }
  return { navigate: segments.slice(0, -1), field: last.key }
}

export function validateConfig(config: DataGraphConfig): ValidatedConfig {
  // Parse selectors for each entity
  const entities = new Map<string, { segments: PathSegment[]; idField: string }>()
  for (const [name, entityConfig] of Object.entries(config.entities)) {
    const segments = parseSelector(entityConfig.match)
    entities.set(name, { segments, idField: entityConfig.id })
  }

  // Validate references
  const references = new Map<string, ReferenceDecl[]>()
  if (config.references) {
    for (const [sourceType, refs] of Object.entries(config.references)) {
      // Check if source type exists
      if (!entities.has(sourceType)) {
        throw new ConfigError("unknown-entity-type", `Unknown entity type: ${sourceType}`)
      }
      const decls: ReferenceDecl[] = []
      for (const [refPath, targetType] of Object.entries(refs)) {
        // Check if target type exists
        if (!entities.has(targetType)) {
          throw new ConfigError("unknown-entity-type", `Unknown entity type: ${targetType}`)
        }
        const { navigate, field } = parseReferenceKey(refPath)
        decls.push({ navigate, field, targetType, path: refPath })
      }
      references.set(sourceType, decls)
    }
  }

  // Valider les agrégats
  const aggregates: string[] = []
  for (const name of config.aggregates ?? []) {
    if (!entities.has(name)) {
      throw new ConfigError("unknown-entity-type", `Unknown entity type: ${name}`)
    }
    aggregates.push(name)
  }

  // Apply default maxNodes
  const maxNodes = config.maxNodes ?? 50_000

  // `??` et non `||` : une chaîne vide est un libellé valide que l'appelant a
  // le droit de vouloir.
  const rootLabel = config.rootLabel ?? "$"

  return {
    entities,
    references,
    maxNodes,
    rootLabel,
    aggregates,
  }
}
