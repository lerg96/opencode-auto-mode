import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { parse } from 'jsonc-parser'
import { ConfigManager } from '../../../src/config/ConfigManager'

const JSONC_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'src',
  'config',
  'default-block-rules.jsonc'
)

function readSourceRules(): { blockRules: any[]; allowExceptions: any[] } {
  const parsed = parse(fs.readFileSync(JSONC_PATH, 'utf-8'), [])
  const blockRules = (parsed as any[]).filter(
    (item) =>
      item !== null &&
      typeof item === 'object' &&
      'severity' in item &&
      'category' in item
  )
  const allowExceptions = (parsed as any[]).filter(
    (item) =>
      item !== null &&
      typeof item === 'object' &&
      !('severity' in item) &&
      !('category' in item)
  )
  return { blockRules, allowExceptions }
}

describe('ConfigManager loads the bundled JSONC defaults', () => {
  it('loads default block rules that match src/config/default-block-rules.jsonc', () => {
    const { blockRules } = readSourceRules()
    const manager = new ConfigManager('/nonexistent/config.jsonc')
    const config = manager.getConfig()

    const loadedIds = config.blockRules.map((r: any) => r.id)
    const sourceIds = blockRules.map((r: any) => r.id)

    expect(loadedIds).toEqual(expect.arrayContaining(sourceIds))
    expect(config.blockRules.length).toBe(sourceIds.length)
  })

  it('loads BR-013 with the JSONC pattern ~/.env (not the old hardcoded chmod)', () => {
    const manager = new ConfigManager('/nonexistent/config.jsonc')
    const config = manager.getConfig()

    const br013 = config.blockRules.find((r: any) => r.id === 'BR-013')
    expect(br013).toBeDefined()
    expect((br013 as any).pattern).toBe('~/.env')
  })

  it('keeps block rule patterns identical to the JSONC source', () => {
    const { blockRules } = readSourceRules()
    const manager = new ConfigManager('/nonexistent/config.jsonc')
    const config = manager.getConfig()

    for (const sourceRule of blockRules) {
      const loaded = config.blockRules.find(
        (r: any) => r.id === (sourceRule as any).id
      )
      expect(loaded).toBeDefined()
      expect((loaded as any).pattern).toBe((sourceRule as any).pattern)
    }
  })

  it('loads default allow exceptions from the bundled JSONC', () => {
    const { allowExceptions } = readSourceRules()
    const manager = new ConfigManager('/nonexistent/config.jsonc')
    const config = manager.getConfig()

    const loadedIds = config.allowExceptions.map((e: any) => e.id)
    const sourceIds = allowExceptions.map((e: any) => e.id)

    expect(loadedIds).toEqual(expect.arrayContaining(sourceIds))
    expect(config.allowExceptions.length).toBe(sourceIds.length)
  })

  it('loads the AE-001 allow exception with the JSONC pattern', () => {
    const manager = new ConfigManager('/nonexistent/config.jsonc')
    const config = manager.getConfig()

    const ae001 = config.allowExceptions.find((e: any) => e.id === 'AE-001')
    expect(ae001).toBeDefined()
    expect((ae001 as any).pattern).toBe(
      'rm\\s+-rf\\s+node_modules\\s+--force'
    )
  })
})