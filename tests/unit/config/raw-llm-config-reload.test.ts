import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { ConfigManager } from '../../../src/config/ConfigManager'

function writeConfig(config: Record<string, unknown>): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-raw-llm-'))
  const configPath = path.join(tmpDir, 'auto-mode.jsonc')
  fs.writeFileSync(configPath, JSON.stringify(config))
  return configPath
}

describe('ConfigManager rawLlmConfig staleness after reload', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('getRawLlmConfig reflects changes to llm.model after reload', () => {
    const configPath = writeConfig({
      llm: {
        provider: 'openai',
        baseUrl: 'http://test.local/v1',
        model: 'gpt-3.5',
        fallbackModel: '',
        timeout: 5000,
      },
      blockRules: [],
      allowExceptions: [],
    })

    const manager = new ConfigManager(configPath)

    // Initially, rawLlmConfig has model = 'gpt-3.5' and fallbackModel = ''
    const rawBefore = manager.getRawLlmConfig()
    expect(rawBefore).toBeDefined()
    expect(rawBefore!.model).toBe('gpt-3.5')
    expect(rawBefore!.fallbackModel).toBe('')

    // Change: add a fallbackModel in the file
    const updatedConfig = manager.getConfig()
    ;(updatedConfig as any).llm.fallbackModel = 'gpt-4'
    fs.writeFileSync(configPath, JSON.stringify(updatedConfig))

    // Reload
    manager.reload(configPath)

    // After reload, rawLlmConfig should reflect the NEW fallbackModel
    const rawAfter = manager.getRawLlmConfig()
    expect(rawAfter).toBeDefined()
    expect(rawAfter!.fallbackModel).toBe('gpt-4')
  })

  it('getRawLlmConfig is undefined when file does not exist', () => {
    const manager = new ConfigManager('/nonexistent/config.jsonc')
    expect(manager.getRawLlmConfig()).toBeUndefined()
  })

  it('getRawLlmConfig is undefined when JSONC parse errors occur', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-raw-llm-'))
    const configPath = path.join(tmpDir, 'auto-mode.jsonc')
    // Write invalid JSONC
    fs.writeFileSync(configPath, '{ "llm": { "model": "test" } // broken')

    const manager = new ConfigManager(configPath)
    expect(manager.getRawLlmConfig()).toBeUndefined()
  })
})
