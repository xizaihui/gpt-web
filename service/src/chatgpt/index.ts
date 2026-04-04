import * as dotenv from 'dotenv'
import { sendResponse } from '../utils'
import { isNotEmptyString } from '../utils/is'
import type { RequestOptions } from './types'
import { chatWithCodex, CODEX_MODELS } from '../codex'
import { chatWithClaudePool, CLAUDE_POOL_MODELS } from '../claude-pool'

dotenv.config()

// Default config
const API_BASE_URL = isNotEmptyString(process.env.OPENAI_API_BASE_URL)
  ? process.env.OPENAI_API_BASE_URL
  : 'https://api.catapi.top/v1'

const API_KEY = process.env.OPENAI_API_KEY || ''
const DEFAULT_MODEL = process.env.OPENAI_API_MODEL || 'gpt-4o'

const AVAILABLE_MODELS = [
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI' },
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'Anthropic' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'Anthropic' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'Google' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'Google' },
  { id: 'deepseek-chat', name: 'DeepSeek V3', provider: 'DeepSeek' },
  { id: 'deepseek-reasoner', name: 'DeepSeek R1', provider: 'DeepSeek' },
  ...CODEX_MODELS.map(m => ({ id: m.id, name: m.name, provider: m.provider })),
]

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>
}

type ApiModel = 'ChatGPTAPI'
const apiModel: ApiModel = 'ChatGPTAPI'

interface ChatContext {
  conversationId?: string
  parentMessageId?: string
}

function isTextFileType(mimeType: string, fileName: string): boolean {
  const textMimes = [
    'text/plain', 'text/markdown', 'text/csv', 'text/xml', 'text/html',
    'application/json', 'application/xml', 'application/javascript',
    'application/typescript', 'application/x-yaml', 'application/x-python',
  ]
  if (textMimes.some(m => mimeType.includes(m) || mimeType.startsWith('text/'))) return true
  const textExtensions = [
    '.txt', '.md', '.json', '.csv', '.xml', '.html', '.htm',
    '.py', '.js', '.ts', '.jsx', '.tsx', '.java', '.go', '.rs',
    '.c', '.cpp', '.h', '.hpp', '.cs', '.rb', '.php', '.sh',
    '.bash', '.zsh', '.yaml', '.yml', '.toml', '.ini', '.cfg',
    '.conf', '.env', '.sql', '.r', '.swift', '.kt', '.scala',
    '.vue', '.svelte', '.css', '.scss', '.less', '.sass',
  ]
  const ext = fileName.toLowerCase().substring(fileName.lastIndexOf('.'))
  return textExtensions.includes(ext)
}

// ─── Build user content (handles files + text) ────────────────────────
function buildUserContent(message: string, files: any[] | undefined): string | any[] {
  if (!files || !Array.isArray(files) || files.length === 0) {
    return message
  }
  const content: any[] = []
  if (message && isNotEmptyString(message)) {
    content.push({ type: 'text', text: message })
  }
  for (const file of files) {
    if (file.type && file.type.startsWith('image/')) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:${file.type};base64,${file.base64}` },
      })
    } else if (isTextFileType(file.type, file.name)) {
      try {
        const decoded = Buffer.from(file.base64, 'base64').toString('utf-8')
        content.push({ type: 'text', text: `--- 文件: ${file.name} ---\n${decoded}\n--- 结束 ---` })
      } catch {
        content.push({ type: 'text', text: `[文件: ${file.name} (${file.type}) - 无法解码]` })
      }
    } else {
      content.push({ type: 'text', text: `[已上传文件: ${file.name} (${file.type})]` })
    }
  }
  return content
}

// ─── Claude: Anthropic Native Messages API (/v1/messages) ─────────────
async function chatWithClaude(
  useModel: string, useBaseUrl: string, useApiKey: string,
  systemMessage: string | undefined, history: any[] | undefined,
  message: string, files: any[] | undefined,
  temperature: number | undefined,
  onProgress: ((data: any) => void) | undefined,
  lastContext: any,
) {
  // Build system blocks (top-level, with cache_control)
  const systemBlocks: any[] = []
  if (isNotEmptyString(systemMessage)) {
    systemBlocks.push({ type: 'text', text: systemMessage!, cache_control: { type: 'ephemeral' } })
  }

  // Build messages array (Anthropic format: no "system" role in messages)
  const messages: any[] = []

  if (history && Array.isArray(history) && history.length > 0) {
    history.forEach((msg: any, idx: number) => {
      const isLast = idx === history.length - 1
      if (isLast) {
        // Mark last history message with cache_control for prefix caching
        messages.push({
          role: msg.role,
          content: [{ type: 'text', text: msg.content, cache_control: { type: 'ephemeral' } }],
        })
      } else {
        messages.push({ role: msg.role, content: msg.content })
      }
    })
  }

  // Current user message
  const userContent = buildUserContent(message, files)
  if (typeof userContent === 'string') {
    messages.push({ role: 'user', content: userContent })
  } else {
    // For Anthropic native, convert image_url format to Anthropic's source format
    const anthropicContent = userContent.map((block: any) => {
      if (block.type === 'image_url' && block.image_url?.url) {
        // Convert data:mime;base64,xxx to Anthropic source format
        const match = block.image_url.url.match(/^data:([^;]+);base64,(.+)$/)
        if (match) {
          return {
            type: 'image',
            source: { type: 'base64', media_type: match[1], data: match[2] },
          }
        }
      }
      return block
    })
    messages.push({ role: 'user', content: anthropicContent })
  }

  // Build URL: /v1/messages
  const baseUrl = useBaseUrl.endsWith('/') ? useBaseUrl.slice(0, -1) : useBaseUrl
  const cleanBase = baseUrl.replace(/\/v1$/, '')
  const url = `${cleanBase}/v1/messages`

  const requestBody: Record<string, any> = {
    model: useModel,
    messages,
    max_tokens: 8192,
    stream: true,
  }
  if (systemBlocks.length > 0) {
    requestBody.system = systemBlocks
  }
  if (temperature !== undefined && temperature !== null) {
    requestBody.temperature = temperature
  }

  console.log(`[Claude Native] POST ${url} | model: ${useModel} | system: ${systemBlocks.length} blocks | messages: ${messages.length} | cachePts: system+lastHistory`)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': useApiKey,
      'Authorization': `Bearer ${useApiKey}`,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`API error ${response.status}: ${errorText}`)
  }

  const reader = response.body as any
  const decoder = new TextDecoder()
  let fullText = ''
  let buffer = ''
  let finalUsage: any = null
  let responseModel = useModel

  // Anthropic SSE format
  for await (const chunk of reader) {
    buffer += decoder.decode(chunk, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data: ')) continue
      const data = trimmed.slice(6)
      if (data === '[DONE]') break

      try {
        const parsed = JSON.parse(data)

        // message_start: contains usage info
        if (parsed.type === 'message_start' && parsed.message) {
          responseModel = parsed.message.model || useModel
          if (parsed.message.usage) {
            finalUsage = {
              prompt_tokens: parsed.message.usage.input_tokens || 0,
              completion_tokens: 0,
              total_tokens: parsed.message.usage.input_tokens || 0,
              // Anthropic cache fields
              cache_creation_input_tokens: parsed.message.usage.cache_creation_input_tokens || 0,
              cache_read_input_tokens: parsed.message.usage.cache_read_input_tokens || 0,
            }
          }
        }

        // content_block_delta: streaming text
        if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
          fullText += parsed.delta.text
          onProgress?.({
            id: 'msg',
            text: fullText,
            role: 'assistant',
            model: responseModel,
            detail: parsed,
          })
        }

        // message_delta: final usage (output tokens)
        if (parsed.type === 'message_delta' && parsed.usage) {
          if (finalUsage) {
            finalUsage.completion_tokens = parsed.usage.output_tokens || 0
            finalUsage.total_tokens = (finalUsage.prompt_tokens || 0) + (parsed.usage.output_tokens || 0)
          }
        }
      } catch (e) {
        // skip
      }
    }
  }

  // Send final usage
  if (finalUsage) {
    console.log(`[Claude Native] usage:`, JSON.stringify(finalUsage))
    onProgress?.({
      id: 'usage',
      text: fullText,
      role: 'assistant',
      model: responseModel,
      usage: finalUsage,
    })
  }

  return sendResponse({
    type: 'Success',
    data: { id: 'msg-' + Date.now(), text: fullText, role: 'assistant', conversationId: lastContext?.conversationId },
  })
}

// ─── OpenAI Compatible API (/v1/chat/completions) ─────────────────────
async function chatWithOpenAI(
  useModel: string, useBaseUrl: string, useApiKey: string,
  systemMessage: string | undefined, history: any[] | undefined,
  message: string, files: any[] | undefined,
  temperature: number | undefined,
  onProgress: ((data: any) => void) | undefined,
  lastContext: any,
) {
  const messages: any[] = []

  if (isNotEmptyString(systemMessage)) {
    messages.push({ role: 'system', content: systemMessage! })
  }

  if (history && Array.isArray(history)) {
    messages.push(...history)
  }

  const userContent = buildUserContent(message, files)
  messages.push({ role: 'user', content: userContent })

  const baseUrl = useBaseUrl.endsWith('/') ? useBaseUrl.slice(0, -1) : useBaseUrl
  const url = baseUrl.includes('/v1') ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`

  const requestBody: Record<string, any> = {
    model: useModel,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  }
  if (temperature !== undefined && temperature !== null) {
    requestBody.temperature = temperature
  } else {
    requestBody.temperature = 0.7
  }

  console.log(`[OpenAI] POST ${url} | model: ${useModel} | messages: ${messages.length}`)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${useApiKey}`,
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`API error ${response.status}: ${errorText}`)
  }

  const reader = response.body as any
  const decoder = new TextDecoder()
  let fullText = ''
  let buffer = ''
  let finalUsage: any = null

  for await (const chunk of reader) {
    buffer += decoder.decode(chunk, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data: ')) continue
      const data = trimmed.slice(6)
      if (data === '[DONE]') break

      try {
        const parsed = JSON.parse(data)
        if (parsed.usage) finalUsage = parsed.usage

        const delta = parsed.choices?.[0]?.delta?.content
        if (delta) {
          fullText += delta
          onProgress?.({
            id: parsed.id || 'msg',
            text: fullText,
            role: 'assistant',
            model: parsed.model || useModel,
            detail: parsed,
          })
        }
      } catch (e) {
        // skip
      }
    }
  }

  if (finalUsage) {
    console.log(`[OpenAI] usage:`, JSON.stringify(finalUsage))
    onProgress?.({
      id: 'usage',
      text: fullText,
      role: 'assistant',
      model: useModel,
      usage: finalUsage,
    })
  }

  return sendResponse({
    type: 'Success',
    data: { id: 'msg-' + Date.now(), text: fullText, role: 'assistant', conversationId: lastContext?.conversationId },
  })
}

// ─── Main entry point ─────────────────────────────────────────────────

// Friendly display names for model identity in system prompt
const MODEL_DISPLAY_NAMES: Record<string, string> = {
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
  'gpt-5.4': 'GPT-5.4',
  'gpt-5.4-mini': 'GPT-5.4 Mini',
  'gpt-5.3-codex': 'GPT-5.3 Codex',
  'gpt-5.2': 'GPT-5.2',
  'gpt-5.2-codex': 'GPT-5.2 Codex',
  'gpt-5.1': 'GPT-5.1',
  'gpt-5.1-codex-max': 'GPT-5.1 Codex Max',
  'gpt-5.1-codex-mini': 'GPT-5.1 Codex Mini',
  'claude-opus-4-20250918': 'Claude Opus 4',
  'claude-sonnet-4-20250514': 'Claude Sonnet 4',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'deepseek-chat': 'DeepSeek V3',
  'deepseek-reasoner': 'DeepSeek R1',
}

function injectModelIdentity(systemMsg: string | undefined, model: string): string {
  // Pass through system message as-is, no model identity injection
  if (!systemMsg || !isNotEmptyString(systemMsg))
    return 'You are a helpful assistant. Follow the user\'s instructions carefully. Respond using markdown.'
  return systemMsg
}

async function chatReplyProcess(options: RequestOptions) {
  const { message, lastContext, process: onProgress, systemMessage, temperature, top_p, model: requestModel, apiBaseUrl: reqBaseUrl, apiKey: reqApiKey, files, history, reasoning } = options as any
  try {
    const useModel = requestModel || DEFAULT_MODEL
    const isCodex = useModel && useModel.startsWith('codex:')
    const isClaudePool = useModel && useModel.startsWith('claude-pool:')
    const isClaude = !isClaudePool && useModel && (useModel.startsWith('claude-') || useModel.includes('claude'))
    const useBaseUrl = (reqBaseUrl && isNotEmptyString(reqBaseUrl)) ? reqBaseUrl : API_BASE_URL
    const useApiKey = (reqApiKey && isNotEmptyString(reqApiKey)) ? reqApiKey : API_KEY

    // Resolve actual model name for identity injection
    const actualModel = isCodex
      ? (CODEX_MODELS.find(m => m.id === useModel)?.codexModel || 'gpt-5.4')
      : isClaudePool
      ? (CLAUDE_POOL_MODELS.find(m => m.id === useModel)?.claudeModel || 'claude-sonnet-4-20250514')
      : useModel

    // Inject model identity into system message
    const enrichedSystemMessage = injectModelIdentity(systemMessage, actualModel)

    if (isCodex) {
      const result = await chatWithCodex(actualModel, enrichedSystemMessage, history, message, onProgress, reasoning)
      if (!result.success) {
        return sendResponse({ type: 'Fail', message: result.error || 'Codex API error' })
      }
      return sendResponse({ type: 'Success', data: { id: 'codex-' + Date.now(), text: '', role: 'assistant' } })
    } else if (isClaudePool) {
      const result = await chatWithClaudePool(actualModel, enrichedSystemMessage, history, message, onProgress, reasoning)
      if (!result.success) {
        return sendResponse({ type: 'Fail', message: result.error || 'Claude Pool API error' })
      }
      return sendResponse({ type: 'Success', data: { id: 'claude-pool-' + Date.now(), text: '', role: 'assistant' } })
    } else if (isClaude) {
      return await chatWithClaude(useModel, useBaseUrl, useApiKey, enrichedSystemMessage, history, message, files, temperature, onProgress, lastContext)
    } else {
      return await chatWithOpenAI(useModel, useBaseUrl, useApiKey, enrichedSystemMessage, history, message, files, temperature, onProgress, lastContext)
    }
  } catch (error: any) {
    global.console.error('Chat error:', error)
    return sendResponse({ type: 'Fail', message: error.message ?? 'Unknown error' })
  }
}

async function chatConfig() {
  return sendResponse({
    type: 'Success',
    data: {
      apiModel,
      reverseProxy: '-',
      timeoutMs: 100000,
      socksProxy: '-',
      httpsProxy: '-',
      usage: '-',
      availableModels: AVAILABLE_MODELS,
      defaultModel: DEFAULT_MODEL,
    },
  })
}

function currentModel(): ApiModel {
  return apiModel
}

export type { ChatContext, ChatMessage }
export { chatReplyProcess, chatConfig, currentModel }
