import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

type PluginModule = typeof import('../../src/plugin')

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'am-secret-bypass-'))

function writeConfig(config: Record<string, unknown>, dir = TMP_DIR): void {
  fs.writeFileSync(path.join(dir, 'auto-mode.jsonc'), JSON.stringify(config))
}

async function loadPlugin(): Promise<PluginModule> {
  jest.resetModules()
  process.env.OPENCODE_CONFIG_DIR = TMP_DIR
  jest.spyOn(fs.promises, 'appendFile').mockResolvedValue(undefined)
  return import('../../src/plugin')
}

describe('Secret guard: exfiltration bypass via getent and variable expansion', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('flags getent passwd (password database read) as secret sensitive', async () => {
    const M = await loadPlugin()
    expect(M.isSecretSensitive('getent passwd root')).toBe(true)
    expect(M.isSecretSensitive('getent passwd')).toBe(true)
    expect(M.isSecretSensitive('getent shadow root')).toBe(true)
    expect(M.isSecretSensitive('getent group docker')).toBe(true)
  })

  it('flags $TOKEN and $SECRET variable references as secret sensitive', async () => {
    const M = await loadPlugin()
    expect(M.isSecretSensitive('echo $API_KEY')).toBe(true)
    expect(M.isSecretSensitive('echo $TOKEN')).toBe(true)
    expect(M.isSecretSensitive('echo $SECRET')).toBe(true)
    expect(M.isSecretSensitive('echo $AWS_SECRET_ACCESS_KEY')).toBe(true)
    expect(M.isSecretSensitive('echo $PASSWORD')).toBe(true)
    expect(M.isSecretSensitive('echo ${API_KEY}')).toBe(true)
    expect(M.isSecretSensitive('echo ${AWS_SECRET_ACCESS_KEY}')).toBe(true)
  })

  it('flags $HOME expansion that reveals .env or .ssh paths', async () => {
    const M = await loadPlugin()
    expect(M.isSecretSensitive('cat $HOME/.env')).toBe(true)
    expect(M.isSecretSensitive('cat $HOME/.ssh/id_rsa')).toBe(true)
    expect(M.isSecretSensitive('cat ${HOME}/.env')).toBe(true)
    expect(M.isSecretSensitive('cat ${HOME}/.ssh/id_ed25519')).toBe(true)
    expect(M.isSecretSensitive('cat $HOME/.aws/credentials')).toBe(true)
    expect(M.isSecretSensitive('echo $HOME/.env')).toBe(true)
    expect(M.isSecretSensitive('$HOME/.env')).toBe(true)
  })

  it('flags shell variable splitting of secret filenames', async () => {
    const M = await loadPlugin()
    expect(M.isSecretSensitive('cat .e${FILE_EXT}nv')).toBe(true)
    expect(M.isSecretSensitive('cat $ENV/.env')).toBe(true)
    expect(M.isSecretSensitive('cat $SOME_DIR/.ssh/id_rsa')).toBe(true)
  })

  it('treats eval commands with secrets as compound (routes to LLM)', async () => {
    writeConfig({
      llm: {
        enabled: true,
        provider: 'openai',
        baseUrl: 'http://localhost:9999/v1',
        model: 'test-model',
        fallbackModel: '',
        timeout: 1000,
      },
      blockRules: [],
      allowExceptions: [],
      fallback: { onTimeout: 'ask-user', onError: 'ask-user' },
      trustBoundary: { protectedPaths: [], protectedCommands: [] },
    })
    const M = await loadPlugin()
    expect(M.isSecretSensitive('eval "cat .env"')).toBe(true)
    expect(M.isSimpleCommand('eval "cat .env"')).toBe(false)
    expect(M.isSecretSensitive('eval "echo $API_KEY"')).toBe(true)
    expect(M.isSimpleCommand('eval "$CMD"')).toBe(false)
  })

  it('does not flag safe variables with non-secret names', async () => {
    const M = await loadPlugin()
    expect(M.isSecretSensitive('echo $USER')).toBe(false)
    expect(M.isSecretSensitive('echo $HOME')).toBe(false)
    expect(M.isSecretSensitive('echo $PATH')).toBe(false)
    expect(M.isSecretSensitive('echo $PWD')).toBe(false)
    expect(M.isSecretSensitive('echo $SHELL')).toBe(false)
  })

  it('still catches .env after deobfuscation of quotes', async () => {
    const M = await loadPlugin()
    expect(M.isSecretSensitive('cat ".env"')).toBe(true)
    expect(M.isSecretSensitive("cat '.env'")).toBe(true)
    expect(M.isSecretSensitive('cat \'.env\'')).toBe(true)
  })
})
