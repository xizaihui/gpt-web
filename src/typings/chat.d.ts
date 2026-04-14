declare namespace Chat {

	interface Chat {
		dateTime: string
		text: string
		reasoning?: string
		inversion?: boolean
		error?: boolean
		loading?: boolean
		model?: string
		usage?: TokenUsage | null
		conversationOptions?: ConversationRequest | null
		requestOptions: { prompt: string; options?: ConversationRequest | null }
	}

	interface TokenUsage {
		prompt_tokens?: number
		completion_tokens?: number
		total_tokens?: number
		// OpenAI cached tokens
		prompt_tokens_details?: {
			cached_tokens?: number
		}
		// Anthropic cached tokens
		cache_creation_input_tokens?: number
		cache_read_input_tokens?: number
	}

	interface History {
		title: string
		isEdit: boolean
		uuid: number
		pinned?: boolean
	}

	interface ChatState {
		active: number | null
		usingContext: boolean;
		history: History[]
		chat: { uuid: number; data: Chat[] }[]
	}

	interface ConversationRequest {
		conversationId?: string
		parentMessageId?: string
	}

	interface ConversationResponse {
		conversationId: string
		detail: {
			choices: { finish_reason: string; index: number; logprobs: any; text: string }[]
			created: number
			id: string
			model: string
			object: string
			usage: { completion_tokens: number; prompt_tokens: number; total_tokens: number }
		}
		id: string
		parentMessageId: string
		role: string
		text: string
	}
}
