// Copied from prompt-to-shader/src/scene/schema.ts (keep in sync).
import { z } from 'zod'
import { CURATED, catalog, type PropSpec, type ShaderName } from './catalog.js'

export const MAX_LAYERS = 6

// What the model writes. Every value is a string so the schema stays flat and
// strict-mode friendly; validateScene() parses each one by its registry type.
export const ModelScene = z.object({
  title: z.string().describe('Short evocative name for the scene, 2-5 words'),
  rationale: z.string().describe('One or two sentences on how the layers realize the prompt'),
  layers: z
    .array(
      z.object({
        type: z.enum(CURATED),
        props: z.array(z.object({ name: z.string(), value: z.string() })),
      }),
    )
    .describe('Bottom-to-top stack. First layer must be a generator.'),
})
export type ModelScene = z.infer<typeof ModelScene>

// What the app renders and shares: props parsed into the shapes the library expects.
export type Layer = { type: ShaderName; props: Record<string, unknown> }
export type Scene = { title: string; rationale: string; layers: Layer[] }

export type ValidationResult = {
  scene: Scene
  /** Problems the model must fix; they trigger a repair turn. */
  errors: string[]
  /** Problems we fixed ourselves (clamped, dropped); reported for evals and debugging. */
  fixes: string[]
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

function parseHex(raw: string): string | undefined {
  const m = HEX.exec(raw.trim())
  if (!m) return undefined
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return `#${hex.toLowerCase()}`
}

function parseValue(spec: PropSpec, raw: string): { value?: unknown; error?: string; fix?: string } {
  const where = `"${spec.name}"`
  switch (spec.kind) {
    case 'color': {
      const hex = parseHex(raw)
      return hex ? { value: hex } : { error: `${where} must be a hex color like #1a2b3c, got "${raw}"` }
    }
    case 'number': {
      const n = Number(raw)
      if (!Number.isFinite(n)) return { error: `${where} must be a number, got "${raw}"` }
      const lo = spec.min ?? -Infinity
      const hi = spec.max ?? Infinity
      const clamped = Math.min(hi, Math.max(lo, n))
      return clamped === n ? { value: n } : { value: clamped, fix: `${where} ${n} clamped to ${clamped}` }
    }
    case 'select':
      return spec.options?.includes(raw)
        ? { value: raw }
        : { error: `${where} must be one of ${spec.options?.join('|')}, got "${raw}"` }
    case 'boolean':
      return raw === 'true' || raw === 'false'
        ? { value: raw === 'true' }
        : { error: `${where} must be true or false, got "${raw}"` }
    case 'text':
      return { value: raw.slice(0, 80) }
    case 'position': {
      const [x, y] = raw.split(',').map(Number)
      if (!Number.isFinite(x) || !Number.isFinite(y)) return { error: `${where} must be "x,y", got "${raw}"` }
      const clamp = (v: number) => Math.min(1, Math.max(0, v))
      return { value: { x: clamp(x), y: clamp(y) } }
    }
    case 'stops': {
      const colors = raw.split(',').map(parseHex)
      if (colors.length < 2 || colors.some((c) => !c)) {
        return { error: `${where} must be 2+ comma-separated hex colors, got "${raw}"` }
      }
      return { value: stopsFrom(colors as string[]) }
    }
  }
}

function stopsFrom(colors: string[]) {
  return colors.map((color, i) => ({ color, position: i / (colors.length - 1) }))
}

export function validateScene(input: ModelScene): ValidationResult {
  const errors: string[] = []
  const fixes: string[] = []
  const layers: Layer[] = []

  if (input.layers.length === 0) errors.push('Scene has no layers.')
  if (input.layers.length > MAX_LAYERS) errors.push(`Use at most ${MAX_LAYERS} layers (got ${input.layers.length}).`)

  input.layers.slice(0, MAX_LAYERS).forEach((raw, i) => {
    const spec = catalog.get(raw.type)
    if (!spec) {
      errors.push(`Layer ${i + 1}: unknown shader "${raw.type}".`)
      return
    }
    if (i === 0 && spec.role === 'filter') {
      errors.push(`Layer 1 is the filter ${raw.type}; the bottom layer must be a generator so filters have pixels to transform.`)
    }

    const props: Record<string, unknown> = {}
    for (const { name, value } of raw.props) {
      const propSpec = spec.props.find((p) => p.name === name)
      if (!propSpec) {
        fixes.push(`Layer ${i + 1} ${raw.type}: dropped unknown prop "${name}"`)
        continue
      }
      const parsed = parseValue(propSpec, value)
      if (parsed.error) errors.push(`Layer ${i + 1} ${raw.type}: ${parsed.error}`)
      if (parsed.fix) fixes.push(`Layer ${i + 1} ${raw.type}: ${parsed.fix}`)
      if (parsed.value !== undefined) props[name] = parsed.value
    }

    // Some shaders ship default stops that override colorA/colorB, so colors
    // the model set would silently do nothing. Promote them to stops, but only
    // there: where the default is empty, colorA/colorB already work and
    // converting them changes how the shader maps color.
    const stopsSpec = spec.props.find((p) => p.kind === 'stops')
    const defaultStopsWin = Array.isArray(stopsSpec?.default) && stopsSpec.default.length > 0
    if (defaultStopsWin && props.stops === undefined) {
      const colors = ['colorA', 'colorB', 'colorC', 'colorD'].map((k) => props[k]).filter((c): c is string => typeof c === 'string')
      if (colors.length >= 2) {
        props.stops = stopsFrom(colors)
        fixes.push(`Layer ${i + 1} ${raw.type}: converted colors to stops so they take effect`)
      }
    }

    layers.push({ type: raw.type, props })
  })

  // Each Text layer is a separate font atlas; several of them can crash the renderer.
  if (layers.filter((l) => l.type === 'Text').length > 1) {
    errors.push('Use at most one Text layer; put all words in a single Text.')
  }

  return { scene: { title: input.title.trim(), rationale: input.rationale.trim(), layers }, errors, fixes }
}

/** Library preset format, for `generatePresetCode` and the MCP server. */
export function toPreset(scene: Scene) {
  return { components: scene.layers.map((l) => ({ type: l.type, props: l.props })) }
}

/** Compact the scene back into the string-valued shape the model writes, for refine turns. */
export function toModelScene(scene: Scene): ModelScene {
  const encode = (v: unknown): string => {
    if (Array.isArray(v)) return v.map((s: { color: string }) => s.color).join(',')
    if (v && typeof v === 'object' && 'x' in v) {
      const { x, y } = v as { x: number; y: number }
      return `${x},${y}`
    }
    return String(v)
  }
  return {
    title: scene.title,
    rationale: scene.rationale,
    layers: scene.layers.map((l) => ({
      type: l.type,
      props: Object.entries(l.props).map(([name, value]) => ({ name, value: encode(value) })),
    })),
  }
}
