import { parseSelector, ConfigError, type PathSegment } from "./selector.js"

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
   * Cet ordre ne joue aucun rôle dans l'appartenance — le chevauchement est
   * autorisé, donc il n'y a rien à arbitrer — seulement dans l'ordre de
   * peinture des enveloppes, pour que le rendu soit reproductible. */
  aggregates?: string[]
}

export interface ValidatedConfig {
  entities: Map<string, { segments: PathSegment[]; idField: string }>
  references: Map<string, Map<string, string>>
  maxNodes: number
  rootLabel: string
  aggregates: string[]
}

export function validateConfig(config: DataGraphConfig): ValidatedConfig {
  // Check if entities is empty
  if (Object.keys(config.entities).length === 0) {
    throw new ConfigError("empty-config", "Entities map cannot be empty")
  }

  // Parse selectors for each entity
  const entities = new Map<string, { segments: PathSegment[]; idField: string }>()
  for (const [name, entityConfig] of Object.entries(config.entities)) {
    const segments = parseSelector(entityConfig.match)
    entities.set(name, { segments, idField: entityConfig.id })
  }

  // Validate references
  const references = new Map<string, Map<string, string>>()
  if (config.references) {
    for (const [sourceType, refs] of Object.entries(config.references)) {
      // Check if source type exists
      if (!entities.has(sourceType)) {
        throw new ConfigError("unknown-entity-type", `Unknown entity type: ${sourceType}`)
      }
      const refsMap = new Map<string, string>()
      for (const [refName, targetType] of Object.entries(refs)) {
        // Check if target type exists
        if (!entities.has(targetType)) {
          throw new ConfigError("unknown-entity-type", `Unknown entity type: ${targetType}`)
        }
        refsMap.set(refName, targetType)
      }
      references.set(sourceType, refsMap)
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
