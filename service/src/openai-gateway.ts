import type { Request, Response } from "express"
import {
  getNextAccount, recordError, refreshAccount,
  proxyFetch, getProxyUrl, CODEX_MODELS,
} from "./codex"

const CODEX_BASE_URL = "https://chatgpt.com/backend-api"
const CODEX_ENDPOINT = "/codex/responses"

// ── Models list ──
export async function handleModelsList(_req: Request, res: Response) {
  const now = Math.floor(Date.now() / 1000)
  const models: any[] = []
  for (const m of CODEX_MODELS) {
    models.push({ id: m.codexModel, object: "model", created: now, owned_by: "codex-pool" })
    models.push({ id: m.codexModel + "-thinking", object: "model", created: now, owned_by: "codex-pool" })
  }
  res.json({ object: "list", data: models })
}

// ── Chat Completions ──
export async function handleChatCompletions(req: Request, res: Response) {
  try {
    const body = req.body || {}
    let model: string = body.model || "gpt-5.4-mini"
    const messages: Array<{ role: string; content: any }> = body.messages || []
    const stream: boolean = body.stream !== false
    const reasoningEffort: string | undefined = body.reasoning_effort

    // Detect -thinking suffix
    let reasoning = reasoningEffort
    if (model.endsWith("-thinking")) {
      model = model.replace(/-thinking$/, "")
      if (!reasoning) reasoning = "medium"
    }

    // Separate system message and build input
    let systemMessage: string | undefined
    const input: Array<{ role: string; content: string }> = []

    for (const msg of messages) {
      const content = typeof msg.content === "string"
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map((p: any) => p.type === "text" ? p.text : "").join("")
          : String(msg.content)

      if (msg.role === "system" || msg.role === "developer") {
        systemMessage = (systemMessage ? systemMessage + "\n" : "") + content
      } else {
        input.push({ role: msg.role === "assistant" ? "assistant" : "user", content })
      }
    }

    if (input.length === 0) {
      input.push({ role: "user", content: "hi" })
    }

    // Get account
    const account = getNextAccount()
    if (!account) {
      const err = { error: { message: "No available accounts in pool", type: "pool_exhausted", code: "pool_exhausted" } }
      return res.status(503).json(err)
    }

    // Build Responses API body
    const requestBody: Record<string, any> = {
      model,
      instructions: systemMessage || "You are a helpful assistant.",
      input,
      store: false,
      stream: true,
    }
    if (reasoning && reasoning !== "none") {
      requestBody.reasoning = { effort: reasoning, summary: "auto" }
    }

    const url = `${CODEX_BASE_URL}${CODEX_ENDPOINT}`
    console.log(`[OpenAI-GW] POST ${url} | model=${model} | account=${account.email} | msgs=${input.length} | stream=${stream} | reasoning=${reasoning || "off"}`)

    const proxyUrl = getProxyUrl(account.proxy)
    let response = await proxyFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${account.accessToken}`,
        "accept": "text/event-stream",
        "chatgpt-account-id": account.accountId,
      },
      body: JSON.stringify(requestBody),
      proxy: proxyUrl,
    } as any)

    // Auto-refresh on 401/403
    if (response.status === 401 || response.status === 403) {
      console.log(`[OpenAI-GW] Got ${response.status}, refreshing token for ${account.email}`)
      const refreshResult = await refreshAccount(account.id)
      if (refreshResult.success) {
        // Re-fetch account (token updated)
        const account2 = getNextAccount()
        if (account2) {
          response = await proxyFetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${account2.accessToken}`,
              "accept": "text/event-stream",
              "chatgpt-account-id": account2.accountId,
            },
            body: JSON.stringify(requestBody),
            proxy: getProxyUrl(account2.proxy),
          } as any)
        }
      }
    }

    if (!response.ok) {
      const errorText = await response.text()
      const errMsg = `Codex API error ${response.status}: ${errorText.slice(0, 300)}`
      recordError(account.id, errMsg)
      console.error(`[OpenAI-GW] ${errMsg}`)
      return res.status(response.status >= 500 ? 502 : response.status).json({
        error: { message: errMsg, type: "upstream_error", code: String(response.status) }
      })
    }

    // Parse SSE from upstream
    const completionId = "chatcmpl-" + Math.random().toString(36).slice(2, 14)
    const created = Math.floor(Date.now() / 1000)
    let responseModel = model

    if (stream) {
      // ── Streaming mode ──
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8")
      res.setHeader("Cache-Control", "no-cache")
      res.setHeader("Connection", "keep-alive")
      res.setHeader("X-Accel-Buffering", "no")
      res.flushHeaders()

      // Send initial role chunk
      const roleChunk = {
        id: completionId, object: "chat.completion.chunk", created, model: responseModel,
        choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
      }
      res.write(`data: ${JSON.stringify(roleChunk)}\n\n`)

      const reader = response.body as any
      const decoder = new TextDecoder()
      let buffer = ""
      let usageData: any = null

      try {
        for await (const chunk of reader) {
          buffer += decoder.decode(chunk as any, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() || ""

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith("data: ")) continue
            const data = trimmed.slice(6)
            if (data === "[DONE]") continue

            try {
              const parsed = JSON.parse(data)
              const eventType = parsed.type

              if (eventType === "response.output_text.delta" && parsed.delta) {
                const chunk = {
                  id: completionId, object: "chat.completion.chunk", created, model: responseModel,
                  choices: [{ index: 0, delta: { content: parsed.delta }, finish_reason: null }],
                }
                res.write(`data: ${JSON.stringify(chunk)}\n\n`)
              }

              if (eventType === "response.reasoning_summary_text.delta" && parsed.delta) {
                const chunk = {
                  id: completionId, object: "chat.completion.chunk", created, model: responseModel,
                  choices: [{ index: 0, delta: { reasoning_content: parsed.delta }, finish_reason: null }],
                }
                res.write(`data: ${JSON.stringify(chunk)}\n\n`)
              }

              if (eventType === "response.created" && parsed.response?.model) {
                responseModel = parsed.response.model
                if (reasoning && reasoning !== "none") responseModel += "-thinking"
              }

              if (eventType === "response.completed" && parsed.response) {
                const u = parsed.response.usage
                if (u) {
                  usageData = {
                    prompt_tokens: u.input_tokens || 0,
                    completion_tokens: u.output_tokens || 0,
                    total_tokens: (u.input_tokens || 0) + (u.output_tokens || 0),
                    prompt_tokens_details: { cached_tokens: u.input_tokens_details?.cached_tokens || 0 },
                    completion_tokens_details: { reasoning_tokens: u.output_tokens_details?.reasoning_tokens || 0 },
                    cache_creation_input_tokens: u.cache_creation_input_tokens || 0,
                  }
                }
                // Send final chunk with finish_reason
                const finalChunk: any = {
                  id: completionId, object: "chat.completion.chunk", created, model: responseModel,
                  choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                }
                if (usageData) finalChunk.usage = usageData
                res.write(`data: ${JSON.stringify(finalChunk)}\n\n`)
              }

              if (eventType === "response.failed") {
                const errDetail = parsed.response?.error?.message || "upstream failed"
                recordError(account.id, errDetail)
                const errChunk = {
                  id: completionId, object: "chat.completion.chunk", created, model: responseModel,
                  choices: [{ index: 0, delta: { content: `\n[Error: ${errDetail}]` }, finish_reason: "stop" }],
                }
                res.write(`data: ${JSON.stringify(errChunk)}\n\n`)
              }
            } catch { /* skip bad json */ }
          }
        }
      } catch (streamErr: any) {
        console.error(`[OpenAI-GW] Stream error: ${streamErr.message}`)
        recordError(account.id, streamErr.message)
      }

      res.write("data: [DONE]\n\n")
      res.end()
    } else {
      // ── Non-streaming mode ──
      let fullText = ""
      let reasoningText = ""
      let usageData: any = null
      const reader = response.body as any
      const decoder = new TextDecoder()
      let buffer = ""

      try {
        for await (const chunk of reader) {
          buffer += decoder.decode(chunk as any, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() || ""

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith("data: ")) continue
            const data = trimmed.slice(6)
            if (data === "[DONE]") continue
            try {
              const parsed = JSON.parse(data)
              if (parsed.type === "response.output_text.delta" && parsed.delta) fullText += parsed.delta
              if (parsed.type === "response.reasoning_summary_text.delta" && parsed.delta) reasoningText += parsed.delta
              if (parsed.type === "response.created" && parsed.response?.model) {
                responseModel = parsed.response.model
                if (reasoning && reasoning !== "none") responseModel += "-thinking"
              }
              if (parsed.type === "response.completed" && parsed.response?.usage) {
                const u = parsed.response.usage
                usageData = {
                  prompt_tokens: u.input_tokens || 0,
                  completion_tokens: u.output_tokens || 0,
                  total_tokens: (u.input_tokens || 0) + (u.output_tokens || 0),
                  prompt_tokens_details: { cached_tokens: u.input_tokens_details?.cached_tokens || 0 },
                  completion_tokens_details: { reasoning_tokens: u.output_tokens_details?.reasoning_tokens || 0 },
                    cache_creation_input_tokens: u.cache_creation_input_tokens || 0,
                }
              }
              if (parsed.type === "response.failed") {
                const errDetail = parsed.response?.error?.message || "upstream failed"
                recordError(account.id, errDetail)
                return res.status(502).json({ error: { message: errDetail, type: "upstream_error" } })
              }
            } catch {}
          }
        }
      } catch (e: any) {
        recordError(account.id, e.message)
        return res.status(502).json({ error: { message: e.message, type: "stream_error" } })
      }

      const result: any = {
        id: completionId,
        object: "chat.completion",
        created,
        model: responseModel,
        choices: [{
          index: 0,
          message: { role: "assistant", content: fullText },
          finish_reason: "stop",
        }],
      }
      if (reasoningText) {
        (result.choices[0].message as any).reasoning_content = reasoningText
      }
      if (usageData) result.usage = usageData
      res.json(result)
    }
  } catch (err: any) {
    console.error(`[OpenAI-GW] Unhandled error: ${err.message}`)
    res.status(500).json({ error: { message: err.message, type: "internal_error" } })
  }
}
