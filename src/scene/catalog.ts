// Copied from prompt-to-shader/src/scene/catalog.ts (keep in sync).
import { getShaderByName } from 'shaders/registry'

// The subset of the library the model may use. Everything here renders well from
// props alone: no images, video, webcam, custom shapes, or transition `progress`.
// Generators paint pixels; filters (registry `requiresChild`) transform the layers
// stacked beneath them.
export const CURATED = [
  // Generators: backgrounds and textures
  'Aurora', 'MeshGradient', 'FlowingGradient', 'LinearGradient', 'RadialGradient',
  'ConicGradient', 'Plasma', 'Swirl', 'Marble', 'CurlNoise', 'PerlinNoise',
  'SimplexNoise', 'FractalNoise', 'WaveletNoise', 'Voronoi', 'Godrays',
  'StudioBackground', 'Strands', 'Stripes', 'Chevron', 'Spiral', 'SunBurst',
  'Ripples', 'DotGrid', 'FloatingParticles', 'FallingLines', 'Truchet', 'HexGrid',
  'IsometricCubes', 'SolidColor', 'Fog', 'Prism', 'LensFlare', 'LiquidMetal', 'Blob',
  'Text',
  // Filters: stylize, blur, color, distortion
  'Blur', 'ProgressiveBlur', 'TiltShift', 'ZoomBlur', 'Ascii', 'ChromaticAberration',
  'CRTScreen', 'Dither', 'FilmGrain', 'Glitch', 'Glow', 'GradientMap', 'Halftone',
  'LightLeak', 'Paper', 'Pixelate', 'Sparkle', 'VHS', 'Vignette', 'Watercolor',
  'Engraving', 'Duotone', 'Tritone', 'HueShift', 'Saturation', 'Posterize',
  'FilmStock', 'BrightnessContrast', 'Kaleidoscope', 'Twirl', 'WaveDistortion',
  'FlowField', 'Bulge', 'GlassTiles', 'FlutedGlass', 'Glass', 'CursorRipples',
] as const

export type ShaderName = (typeof CURATED)[number]

export type PropKind = 'color' | 'number' | 'select' | 'boolean' | 'text' | 'position' | 'stops'

export type PropSpec = {
  name: string
  kind: PropKind
  label: string
  description: string
  default: unknown
  min?: number
  max?: number
  step?: number
  options?: string[]
}

export type ShaderSpec = {
  name: ShaderName
  role: 'generator' | 'filter'
  description: string
  props: PropSpec[]
}

// Registry UI types we can express as a short string the model writes. Anything
// else (shapes, uploads, font pickers...) keeps the library default.
const KIND_BY_UI: Record<string, PropKind> = {
  color: 'color',
  range: 'number',
  select: 'select',
  checkbox: 'boolean',
  text: 'text',
  position: 'position',
  'gradient-stops': 'stops',
}

// Props that add tokens without adding expressiveness for a text prompt.
const SKIPPED_PROPS = new Set(['colorSpace', 'origin'])

// Per-shader props hidden from the model and the UI. Plasma's `stops` maps
// most of the field onto the last stop, so a dark-to-bright palette renders as
// a flat bright wash; its colorA/colorB form renders as intended. Found by the
// scene-quality eval: all 5 baseline scenes that used Plasma stops scored <= 2.
const HIDDEN_PROPS: Partial<Record<ShaderName, string[]>> = { Plasma: ['stops'] }

function toPropSpec(name: string, meta: Record<string, any>): PropSpec | undefined {
  const uiType = Array.isArray(meta.ui?.type) ? meta.ui.type[0] : meta.ui?.type
  const kind = KIND_BY_UI[uiType]
  if (!kind || SKIPPED_PROPS.has(name)) return undefined
  return {
    name,
    kind,
    label: meta.ui?.label ?? name,
    description: meta.description ?? '',
    default: meta.default,
    min: meta.ui?.min,
    max: meta.ui?.max,
    step: meta.ui?.step,
    options: meta.ui?.options?.map((o: { value: unknown }) => String(o.value)),
  }
}

function buildCatalog(): Map<ShaderName, ShaderSpec> {
  const catalog = new Map<ShaderName, ShaderSpec>()
  for (const name of CURATED) {
    const meta = getShaderByName(name)
    if (!meta) throw new Error(`Curated shader "${name}" is missing from the registry`)
    const hidden = HIDDEN_PROPS[name] ?? []
    const props = Object.entries(meta.propsMetadata ?? {})
      .filter(([propName]) => !hidden.includes(propName))
      .map(([propName, propMeta]) => toPropSpec(propName, propMeta))
      .filter((p): p is PropSpec => p !== undefined)
    catalog.set(name, {
      name,
      role: meta.requiresChild ? 'filter' : 'generator',
      description: meta.description ?? '',
      props,
    })
  }
  return catalog
}

export const catalog = buildCatalog()

function propType(p: PropSpec): string {
  switch (p.kind) {
    case 'number':
      return `number ${p.min}..${p.max}, default ${p.default}`
    case 'select':
      return `one of ${p.options?.join('|')}, default ${p.default}`
    case 'boolean':
      return 'true|false'
    case 'color':
      return 'hex color'
    case 'position':
      return '"x,y" in 0..1'
    case 'stops':
      return 'comma-separated hex colors, overrides colorA/colorB'
    case 'text':
      return 'text'
  }
}

// The registry's description carries meaning a range can't, e.g. Pixelate
// scale is "pixels along the longest edge (higher = smaller pixels)". Without
// it the model guessed the opposite and pixelated text into unreadable blocks.
export const describeProp = (p: PropSpec) => `    ${p.name} (${propType(p)})${p.description ? `: ${p.description}` : ''}`

/** Compact, deterministic text listing of every shader, for the system prompt. */
export function catalogText(): string {
  const lines: string[] = []
  for (const role of ['generator', 'filter'] as const) {
    lines.push(role === 'generator' ? '## Generators (paint pixels)' : '## Filters (transform the layers beneath)')
    for (const s of catalog.values()) {
      if (s.role !== role) continue
      lines.push(`- ${s.name}: ${s.description}`)
      lines.push(...s.props.map(describeProp))
    }
  }
  return lines.join('\n')
}
