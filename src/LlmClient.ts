const DEFAULT_BASE_URL = 'http://localhost:18780/v1'
const DEFAULT_MAX_TOKENS = 200

export class LlmHttpError extends Error {
  status: number

  constructor(status: number, statusText: string) {
    super(`LLM API error: ${status} ${statusText}`)
    this.name = 'LlmHttpError'
    this.status = status
  }
}

export class LlmParseError extends SyntaxError {
  constructor(rawBody: string) {
    super(`LLM response parse error: ${rawBody}`)
    this.name = 'LlmParseError'
  }
}

interface LlmApiClientRequest {
  model: string
  messages: Array<{ role: string; content: string }>
  max_tokens: number
  temperature: number
  stream: false
}

interface LlmApiResponse {
  choices: Array<{ message: { content: string } }>
}

interface LlmCallParams {
  baseUrl: string
  apiKey: string
  model: string
  fallbackModel: string
  prompt: string
  timeoutMs: number
  maxTokens?: number
  temperature?: number
  fetchImpl?: typeof fetch
}

export interface LlmCallResult {
  content: string
  usedFallback: boolean
  fallbackError?: string
}

function makeRequest(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  maxTokens: number,
  temperature: number,
  fetchImpl: typeof fetch
): Promise<Response> {
  const request: LlmApiClientRequest = {
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens,
    temperature,
    stream: false,
  }

  return fetchImpl(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(request),
  })
}

function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) return fn()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Request timeout'))
    }, timeoutMs)
    fn()
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timer))
  })
}

function isSuccessResponse(res: Response): boolean {
  return res.ok
}

function isRetryableHttpError(status: number): boolean {
  if (status === 408) return true
  if (status === 429) return true
  if (status === 503) return true
  if (status >= 500) return true
  if (status === 504) return true
  return false
}

function isTimeoutError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  const msg = e.message.toLowerCase()
  const name = e.name.toLowerCase()
  // Timeout-triggered abort: message will contain 'timeout'
  if (name === 'aborterror' && msg.includes('timeout')) return true
  // Explicit timeout / timed out errors
  if (msg.includes('timeout') || msg.includes('timed out')) return true
  // Network-level failures (connection refused, etc.)
  if (name === 'timeouterror') return true
  if (msg.includes('network') || msg.includes('econnrefused')) return true
  return false
}

export async function callLlmWithFallback(
  params: LlmCallParams
): Promise<LlmCallResult> {
  const {
    baseUrl = DEFAULT_BASE_URL,
    apiKey = '',
    model,
    fallbackModel,
    prompt,
    timeoutMs = 8000,
    maxTokens = DEFAULT_MAX_TOKENS,
    temperature = 0,
    fetchImpl = fetch,
  } = params

  let usedFallback = false
  let fallbackError: string | undefined

  const attempt = async (m: string): Promise<Response> => {
    return withTimeout(
      () =>
        makeRequest(
          baseUrl,
          apiKey,
          m,
          prompt,
          maxTokens,
          temperature,
          fetchImpl
        ),
      timeoutMs
    )
  }

  let res: Response

  try {
    res = await attempt(model)
  } catch (e: unknown) {
    if (isTimeoutError(e) && fallbackModel) {
      res = await attempt(fallbackModel)
      usedFallback = true
      fallbackError = 'timeout'
    } else {
      throw e
    }
  }

  if (!isSuccessResponse(res)) {
    const status = res.status
    if (isRetryableHttpError(status) && fallbackModel) {
      res = await attempt(fallbackModel)
      usedFallback = true
      fallbackError = `http:${status}`
      if (!isSuccessResponse(res)) {
        throw new LlmHttpError(
          res.status,
          `and fallback also returned ${res.status}`
        )
      }
    } else {
      throw new LlmHttpError(status, res.statusText)
    }
  }

  let data: unknown
  try {
    data = await res.json()
  } catch (raw: unknown) {
    const rawText =
      raw instanceof Error ? raw.message : String(raw ?? 'unknown')
    throw new LlmParseError(rawText)
  }

  if (data === null || data === undefined || typeof data !== 'object') {
    return {
      content: '',
      usedFallback,
      fallbackError,
    }
  }

  const parsed = data as Record<string, unknown>
  const choices = parsed?.choices as
    | Array<{ message?: { content?: unknown } }>
    | undefined
  const rawContent = choices?.[0]?.message?.content
  return {
    content: typeof rawContent === 'string' ? rawContent : String(rawContent ?? ''),
    usedFallback,
    fallbackError,
  }
}
