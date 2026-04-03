export interface RequestProps {
  prompt: string
  options?: ChatContext
  systemMessage: string
  temperature?: number
  top_p?: number
  model?: string
  history?: Array<{ role: string; content: string }>
  files?: Array<{ name: string; type: string; base64: string }>
}

export interface ChatContext {
  conversationId?: string
  parentMessageId?: string
}

export interface ModelConfig {
  apiModel?: ApiModel
  reverseProxy?: string
  timeoutMs?: number
  socksProxy?: string
  httpsProxy?: string
  usage?: string
  availableModels?: Array<{ id: string; name: string; provider: string }>
  defaultModel?: string
}

export type ApiModel = 'ChatGPTAPI' | undefined
