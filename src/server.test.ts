import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { createServer } from './server.js'

// Talks to the server through a real MCP client, the same way Claude does.
let client: Client
beforeAll(async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await createServer().connect(serverSide)
  client = new Client({ name: 'test', version: '0' })
  await client.connect(clientSide)
})

const call = async (name: string, args: Record<string, unknown>) => {
  const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean }
  return { text: res.content.map((c) => c.text).join('\n'), isError: res.isError ?? false }
}

const scene = {
  title: 'Pop Burst',
  rationale: 'test',
  layers: [
    { type: 'SunBurst', props: [{ name: 'color', value: '#ffe600' }, { name: 'background', value: '#e8112d' }] },
    { type: 'Halftone', props: [{ name: 'frequency', value: '500' }] },
  ],
}

describe('shader-mcp', () => {
  it('advertises four read-only tools', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(['create_scene', 'describe_shader', 'export_code', 'list_shaders'])
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true)
  })

  it('lists shaders, optionally by role', async () => {
    const all = await call('list_shaders', {})
    const filters = await call('list_shaders', { role: 'filter' })
    expect(all.text).toContain('Aurora (generator)')
    expect(filters.text).toContain('Halftone (filter)')
    expect(filters.text).not.toContain('Aurora')
  })

  it('describes settings, including what they mean', async () => {
    const res = await call('describe_shader', { names: ['Pixelate', 'Nope'] })
    expect(res.text).toContain('higher = smaller pixels')
    expect(res.text).toContain('Nope: unknown shader')
  })

  it('validates a scene, reports fixes, and returns a preview link that decodes back', async () => {
    const res = await call('create_scene', scene)
    expect(res.isError).toBe(false)
    expect(res.text).toMatch(/clamped/)
    const url = res.text.match(/https:\/\/\S+#s=(\S+)/)
    expect(url).not.toBeNull()
    const decoded = JSON.parse(Buffer.from(url![1], 'base64url').toString())
    expect(decoded.layers.map((l: { type: string }) => l.type)).toEqual(['SunBurst', 'Halftone'])
  })

  it('returns errors the model can act on', async () => {
    const res = await call('create_scene', { ...scene, layers: [scene.layers[1]] })
    expect(res.isError).toBe(true)
    expect(res.text).toMatch(/must be a generator/)
  })

  it('rejects unknown shader names at the schema level', async () => {
    const res = await call('create_scene', { ...scene, layers: [{ type: 'Unicorn', props: [] }] })
    expect(res.isError).toBe(true)
  })

  it('exports React code', async () => {
    const res = await call('export_code', scene)
    expect(res.text).toContain("from 'shaders/react'")
    expect(res.text).toContain('<SunBurst')
  })
})
