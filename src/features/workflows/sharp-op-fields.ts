import { z } from 'zod'

import { SHARP_OP_CATEGORIES, sharpOpSchema } from '@/lib/images/sharp/ops'

export enum OpFieldKind {
  Boolean = 'boolean',
  Integer = 'integer',
  Number = 'number',
  String = 'string',
  Enum = 'enum',
  Json = 'json',
  /** A CSS colour string or `{ r, g, b, alpha }`. */
  Colour = 'colour',
  Matrix = 'matrix',
  /** The path of one other image. */
  Image = 'image',
  /** One or several other images. */
  Images = 'images',
}

/** How a matrix field is laid out. */
export type MatrixSpec =
  /** A square grid of one size. */
  | { kind: 'fixed'; size: number }
  /** A square grid, one of several sizes. */
  | { kind: 'choice'; sizes: ReadonlyArray<number> }
  /** A grid as wide and high as the step's `width` and `height` options. */
  | { kind: 'kernel' }

export interface OpField {
  name: string
  label: string
  kind: OpFieldKind
  required: boolean
  description?: string
  min?: number
  max?: number
  choices?: ReadonlyArray<string>
  matrix?: MatrixSpec
}

export interface SharpOpGroup {
  label: string
  ops: ReadonlyArray<string>
}

const CATEGORY_LABELS: Readonly<
  Record<keyof typeof SHARP_OP_CATEGORIES, string>
> = {
  geometry: 'Geometry',
  filter: 'Filters',
  colour: 'Colour',
  output: 'Output',
}

/** Sharp accepts these US spellings as aliases; the UI lists only the UK spelling of each op. */
const US_SPELLING_OPS: ReadonlySet<string> = new Set([
  'grayscale',
  'pipelineColorspace',
  'toColorspace',
])

export const SHARP_OP_GROUPS: ReadonlyArray<SharpOpGroup> = Object.entries(
  SHARP_OP_CATEGORIES,
).map(([category, ops]) => ({
  label: CATEGORY_LABELS[category as keyof typeof SHARP_OP_CATEGORIES],
  ops: ops.filter((op) => !US_SPELLING_OPS.has(op)),
}))

const JsonPropertySchema = z.looseObject({
  type: z.string().optional(),
  enum: z.array(z.unknown()).optional(),
  description: z.string().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  exclusiveMinimum: z.number().optional(),
})

const JsonObjectSchema = z.looseObject({
  properties: z.record(z.string(), JsonPropertySchema).default({}),
  required: z.array(z.string()).default([]),
})

type JsonProperty = z.infer<typeof JsonPropertySchema>

const UNBOUNDED = Number.MAX_SAFE_INTEGER

/** "autoOrient" → "Auto orient". */
export function opLabel(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function opSchema(op: string): z.ZodType {
  const schema = sharpOpSchema.options.find(
    (option) => option.shape.op.value === op,
  )
  if (!schema) throw new RangeError(`Unknown Sharp op "${op}"`)
  return schema
}

function fieldKind(property: JsonProperty): OpFieldKind {
  if (property.enum?.every((value) => typeof value === 'string'))
    return OpFieldKind.Enum
  if (property.type === 'boolean') return OpFieldKind.Boolean
  if (property.type === 'integer') return OpFieldKind.Integer
  if (property.type === 'number') return OpFieldKind.Number
  if (property.type === 'string') return OpFieldKind.String
  return OpFieldKind.Json
}

function lowerBound(
  property: JsonProperty,
  kind: OpFieldKind,
): number | undefined {
  if (property.minimum !== undefined) return property.minimum
  if (property.exclusiveMinimum === undefined) return undefined
  return kind === OpFieldKind.Integer
    ? property.exclusiveMinimum + 1
    : property.exclusiveMinimum
}

type Widget = Pick<OpField, 'kind' | 'matrix'>

/** Fields the JSON schema cannot tell apart from plain JSON but that have a control of their own. */
const WIDGETS: Readonly<Record<string, Widget>> = {
  'affine.matrix': {
    kind: OpFieldKind.Matrix,
    matrix: { kind: 'fixed', size: 2 },
  },
  'recomb.matrix': {
    kind: OpFieldKind.Matrix,
    matrix: { kind: 'choice', sizes: [3, 4] },
  },
  'convolve.kernel': { kind: OpFieldKind.Matrix, matrix: { kind: 'kernel' } },
  'boolean.operand': { kind: OpFieldKind.Image },
  'joinChannel.images': { kind: OpFieldKind.Images },
  'tint.colour': { kind: OpFieldKind.Colour },
}

function widgetFor(op: string, name: string): Widget | undefined {
  if (name === 'background') return { kind: OpFieldKind.Colour }
  return WIDGETS[`${op}.${name}`]
}

function toField(
  op: string,
  name: string,
  property: JsonProperty,
  required: boolean,
): OpField {
  const widget = widgetFor(op, name)
  const kind = widget?.kind ?? fieldKind(property)
  const field: OpField = { name, label: opLabel(name), kind, required }
  if (widget?.matrix) field.matrix = widget.matrix
  if (property.description) field.description = property.description
  const min = lowerBound(property, kind)
  if (min !== undefined) field.min = min
  if (property.maximum !== undefined && property.maximum < UNBOUNDED)
    field.max = property.maximum
  if (kind === OpFieldKind.Enum) field.choices = property.enum as Array<string>
  return field
}

/** The option fields of a Sharp op, derived from the image CLI's own schema. */
export function sharpOpFields(op: string): Array<OpField> {
  const json = JsonObjectSchema.parse(
    z.toJSONSchema(opSchema(op), { unrepresentable: 'any', io: 'input' }),
  )
  const fields: Array<OpField> = []
  for (const [name, property] of Object.entries(json.properties)) {
    if (name === 'op') continue
    fields.push(toField(op, name, property, json.required.includes(name)))
  }
  return fields
}

const GENERAL = '_'
const FALLBACK_PROBLEM = 'Enter a valid value.'

type Issue = z.core.$ZodIssue

const TYPE_PROBLEMS: Readonly<Record<string, string>> = {
  int: 'Must be a whole number.',
  number: 'Enter a number.',
  string: 'Enter text.',
  boolean: 'Turn this on or off.',
  array: 'Enter a JSON list, such as [1, 2].',
  object: 'Enter a JSON object, such as {"key": 1}.',
}

function sizeProblem(
  bound: 'least' | 'most',
  limit: number | bigint,
  inclusive: boolean | undefined,
  origin: string,
): string {
  if (origin === 'string') return `Use at ${bound} ${limit} characters.`
  if (origin === 'array') return `Use at ${bound} ${limit} items.`
  if (inclusive) return `Must be at ${bound} ${limit}.`
  return `Must be ${bound === 'least' ? 'greater' : 'less'} than ${limit}.`
}

/** A plain-words message for one issue; the schema library's own messages are written for developers. */
function problemMessage(issue: Issue): string {
  switch (issue.code) {
    case 'invalid_type':
      return TYPE_PROBLEMS[issue.expected] ?? FALLBACK_PROBLEM
    case 'too_small':
      return sizeProblem('least', issue.minimum, issue.inclusive, issue.origin)
    case 'too_big':
      return sizeProblem('most', issue.maximum, issue.inclusive, issue.origin)
    case 'invalid_value':
      return 'Choose one of the listed options.'
    case 'custom':
      return issue.message
    default:
      return FALLBACK_PROBLEM
  }
}

/**
 * Problems with the options a step has set, keyed by option name (`_` for
 * the step as a whole). Options that are not filled in yet are not problems
 * here; `missingSharpOptions` lists the required ones.
 */
export function sharpOptionProblems(
  op: string,
  options: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const parsed = opSchema(op).safeParse({ ...options, op })
  if (parsed.success) return {}
  const problems: Record<string, string> = {}
  for (const issue of parsed.error.issues) {
    const field = issue.path[0]
    const key = typeof field === 'string' ? field : GENERAL
    if (key !== GENERAL && options[key] === undefined) continue
    problems[key] ??= problemMessage(issue)
  }
  return problems
}

/** The required options of a step that are not filled in yet. */
export function missingSharpOptions(
  op: string,
  options: Readonly<Record<string, unknown>>,
): Array<string> {
  const missing: Array<string> = []
  for (const field of sharpOpFields(op)) {
    if (field.required && options[field.name] === undefined)
      missing.push(field.name)
  }
  return missing
}
