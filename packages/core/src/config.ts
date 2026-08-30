import { parseSelector, ConfigError, type PathSegment } from "./selector.js"

export interface EntityConfig {
  match: string
  id: string
}

export interface DataGraphConfig {
  entities: Record<string, EntityConfig>
  references?: Record<string, Record<string, string>>
  maxNodes?: number
}

export interface ValidatedConfig {
  entities: Map<string, { segments: PathSegment[]; idField: string }>
  references: Map<string, Map<string, string>>
  maxNodes: number
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

  // Apply default maxNodes
  const maxNodes = config.maxNodes ?? 50_000

  return {
    entities,
    references,
    maxNodes,
  }
}
