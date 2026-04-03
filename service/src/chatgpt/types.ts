export interface RequestOptions {
  message: string
  lastContext?: { conversationId?: string; parentMessageId?: string }
  process?: (chat: any) => void
  systemMessage?: string
  temperature?: number
  top_p?: number
  model?: string
  history?: Array<{ role: string; content: string }>
  apiBaseUrl?: string
  apiKey?: string
  files?: Array<{ name: string; type: string; base64: string }>
}

export interface SetProxyOptions {
  fetch?: any
}

export interface UsageResponse {
  total_usage: number
}
