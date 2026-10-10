import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { generatePresetCode } from 'shaders/react/codegen'
import { z } from 'zod'
import { catalog, describeProp, type ShaderName } from './scene/catalog.js'
import { MAX_LAYERS, ModelScene, toModelScene, toPreset, validateScene } from './scene/schema.js'

export const PREVIEW_BASE = process.env.SHADER_PREVIEW_URL ?? 'https://prompt-to-shader.vercel.app/'

/** Share link into the Prompt-to-Shader app, which renders any scene from its URL hash. */
export function previewUrl(scene: ReturnType<typeof validateScene>['scene']): string {
  const encoded = Buffer.from(JSON.stringify(toModelScene(scene))).toString('base64url')
  return `${PREVIEW_BASE}#s=${encoded}`
}

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] })
const readOnly = { readOnlyHint: true, openWorldHint: false } as const

export function createServer(): McpServer {
  const server = new McpServer({ name: 'shader-mcp', version: '0.1.0' })

  server.registerTool(
    'list_shaders',
    {
      title: 'List shaders',
      description:
        'List the shader effects available for building a scene. Generators paint pixels and go at the bottom of a scene; filters transform everything beneath them. Call this first, then describe_shader for the ones you want to use.',
      inputSchema: { role: z.enum(['generator', 'filter']).optional().describe('Only list generators or only filters') },
      annotations: readOnly,
    },
    async ({ role }) => {
      const lines = [...catalog.values()]
        .filter((s) => !role || s.role === role)
        .map((s) => `- ${s.name} (${s.role}): ${s.description}`)
      return text(lines.join('\n'))
    },
  )

  server.registerTool(
    'describe_shader',
    {
      title: 'Describe shader',
      description:
        'Get every setting of one or more shaders: type, range, default, and what it does. Read this before setting values; several settings work the opposite way from what their name suggests.',
      inputSchema: { names: z.array(z.string()).min(1).max(10).describe('Shader names from list_shaders') },
      annotations: readOnly,
    },
    async ({ names }) => {
      const blocks = names.map((name) => {
        const spec = catalog.get(name as ShaderName)
        if (!spec) return `${name}: unknown shader. Use list_shaders to see valid names.`
        return `${spec.name} (${spec.role}): ${spec.description}\n${spec.props.map(describeProp).join('\n')}`
      })
      return text(blocks.join('\n\n'))
    },
  )

  server.registerTool(
    'create_scene',
    {
      title: 'Create scene',
      description: `Validate a shader scene and get a live preview link. A scene is a bottom-to-top stack of up to ${MAX_LAYERS} layers; the first must be a generator. Prefer 2-4 layers. Write every value as a string: numbers "0.8", booleans "true", positions "0.5,0.3", color lists "#112233,#445566". Out-of-range numbers are clamped and unknown settings dropped (reported as fixes); real problems come back as errors to correct and resubmit.`,
      inputSchema: ModelScene.shape,
      annotations: readOnly,
    },
    async (input) => {
      const { scene, errors, fixes } = validateScene(input)
      if (errors.length) {
        return { ...text(`The scene is invalid. Fix these and call create_scene again:\n- ${errors.join('\n- ')}`), isError: true }
      }
      const lines = [
        `Scene "${scene.title}" is valid (${scene.layers.length} layers: ${scene.layers.map((l) => l.type).join(' → ')}).`,
        `Live preview (opens in a WebGPU browser such as recent Chrome, Edge or Safari): ${previewUrl(scene)}`,
      ]
      if (fixes.length) lines.push(`Adjusted automatically:\n- ${fixes.join('\n- ')}`)
      lines.push('Call export_code with the same scene to get React code.')
      return text(lines.join('\n\n'))
    },
  )

  server.registerTool(
    'export_code',
    {
      title: 'Export React code',
      description:
        'Turn a valid scene into a self-contained React component using the `shaders` npm package. Pass the same scene you gave create_scene.',
      inputSchema: ModelScene.shape,
      annotations: readOnly,
    },
    async (input) => {
      const { scene, errors } = validateScene(input)
      if (errors.length) return { ...text(`Fix the scene first:\n- ${errors.join('\n- ')}`), isError: true }
      const code = generatePresetCode(toPreset(scene))
      return text(`Install with \`npm install shaders\`, then:\n\n\`\`\`tsx\n${code}\n\`\`\``)
    },
  )

  return server
}
