import type { z } from 'zod'

export type JsonSchema = z.core.JSONSchema.JSONSchema

const UNBOUNDED = Number.MAX_SAFE_INTEGER
/** Objects with more keys than this are summarised as `object`; their fields get rows of their own. */
const MAX_LISTED_KEYS = 6

function isSchema(value: unknown): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function literal(value: string | number | boolean | null): string {
  return `\`${JSON.stringify(value)}\``
}

function lowerBound(node: JsonSchema): string | undefined {
  if (typeof node.exclusiveMinimum === 'number')
    return `> ${node.exclusiveMinimum}`
  if (node.minimum !== undefined && node.minimum > -UNBOUNDED)
    return `≥ ${node.minimum}`
  return undefined
}

function upperBound(node: JsonSchema): string | undefined {
  if (typeof node.exclusiveMaximum === 'number')
    return `< ${node.exclusiveMaximum}`
  if (node.maximum !== undefined && node.maximum < UNBOUNDED)
    return `≤ ${node.maximum}`
  return undefined
}

function describeNumber(node: JsonSchema, type: string): string {
  if (
    node.minimum !== undefined &&
    node.maximum !== undefined &&
    node.maximum < UNBOUNDED
  )
    return `${type} ${node.minimum}–${node.maximum}`
  const bounds: string[] = []
  for (const bound of [lowerBound(node), upperBound(node)])
    if (bound !== undefined) bounds.push(bound)
  return bounds.length === 0 ? type : `${type} ${bounds.join(', ')}`
}

function describeArray(node: JsonSchema): string {
  if (Array.isArray(node.prefixItems)) {
    const items: string[] = []
    for (const item of node.prefixItems)
      items.push(isSchema(item) ? describeType(item) : 'any')
    return `[${items.join(', ')}]`
  }
  const item = isSchema(node.items) ? describeType(node.items) : 'any'
  return item.includes(' ') ? `(${item})[]` : `${item}[]`
}

function describeObject(node: JsonSchema): string {
  const keys = Object.keys(node.properties ?? {})
  if (keys.length === 0 || keys.length > MAX_LISTED_KEYS) return 'object'
  return `object { ${keys.join(', ')} }`
}

function describeVariants(variants: readonly JsonSchema[]): string {
  const parts: string[] = []
  for (const variant of variants) parts.push(describeType(variant))
  return parts.join(' or ')
}

/** A one-line, Markdown-table-safe summary of a JSON Schema node's type and range. */
export function describeType(node: JsonSchema): string {
  if (node.const !== undefined) return literal(node.const)
  if (node.enum) return node.enum.map(literal).join(' \\| ')
  const variants = node.anyOf ?? node.oneOf
  if (variants) return describeVariants(variants)
  if (Array.isArray(node.type)) {
    const types: JsonSchema[] = []
    for (const type of node.type) types.push({ ...node, type })
    return describeVariants(types)
  }
  switch (node.type) {
    case 'integer':
    case 'number':
      return describeNumber(node, node.type)
    case 'array':
      return describeArray(node)
    case 'object':
      return describeObject(node)
    case 'string':
    case 'boolean':
    case 'null':
      return node.type
    default:
      return 'any'
  }
}
