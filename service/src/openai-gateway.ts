import type { Request, Response } from "express"
import {
  getNextAccount, recordError, refreshAccount,
  proxyFetch, getProxyUrl, CODEX_MODELS,
} from "./codex"
import { deriveSessionId, calculateCache } from "./cache-simulator"
import {
  submitOai, hashApiKey, detectClientType,
  extractFirstUserMessage, extractSystemHead,
} from "./audit"

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

/**
 * Build OpenAI-standard usage object with cache simulation.
 *
 * IMPORTANT: OpenAI prompt caching is FREE for cache writes — only cache reads
 * get a discount (10% of input price). This is different from Anthropic where
 * cache writes cost 1.25x.
 *
 * Therefore we ONLY output `cached_tokens` (cache read) in prompt_tokens_details,
 * matching exactly what Azure/OpenAI returns. No cache_creation / cache_write fields.
 *
 * OpenToken billing for OpenAI semantic (non-Anthropic):
 *   fee = (prompt_tokens - cached_tokens) * 1.0  +  cached_tokens * cache_ratio(0.1)
 *       + completion_tokens * completion_ratio
 */
function buildUsage(
  u: any,
  sessionId: string,
) {
  const promptTokens = u.input_tokens || 0
  const completionTokens = u.output_tokens || 0
  const upstreamCached = u.input_tokens_details?.cached_tokens || 0

  const cache = calculateCache(sessionId, promptTokens, upstreamCached)

  console.log(
    `[OpenAI-GW][Cache] session=${sessionId} prompt=${promptTokens} ` +
    `upstream_cached=${upstreamCached} → cache_read=${cache.cacheReadTokens} cache_write=${cache.cacheWriteTokens}`
  )

  // Return OpenAI-standard format only — no Anthropic cache_creation fields
  // This matches what Azure OpenAI returns for GPT-5.4
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    prompt_tokens_details: {
      cached_tokens: cache.cacheReadTokens,
    },
    completion_tokens_details: {
      reasoning_tokens: u.output_tokens_details?.reasoning_tokens || 0,
    },
  }
}

// ────────────────────────────────────────────────────────────────────
//  OpenAI ↔ Codex Responses API: tool-calling translation layer
// ────────────────────────────────────────────────────────────────────
//
// OpenAI Chat Completions (what clients send us):
//   messages[i] = { role, content?, tool_calls?, tool_call_id?, name? }
//     role="assistant" may have tool_calls=[{id, type:"function", function:{name, arguments}}]
//     role="tool"      carries tool_call_id + content (the tool's return value)
//   tools       = [{ type:"function", function:{ name, description, parameters } }]
//   tool_choice = "auto" | "none" | "required"
//               | { type:"function", function:{ name } }
//
// Codex /backend-api/codex/responses (upstream):
//   input[i] =
//     { role:"user"|"assistant"|"system", content: string }            ← text turns
//     { type:"function_call",        call_id, name, arguments:string } ← assistant's tool invocation
//     { type:"function_call_output", call_id, output: string }         ← the tool's return value
//   tools       = [{ type:"function", name, description, parameters }]  ← FLAT, NOT nested in .function
//   tool_choice = "auto"|"none"|"required" | { type:"function", name }  ← flat too
//
// Quirks to remember:
//   • Codex `tools` and the per-tool `tool_choice` are FLAT (no inner .function wrapper).
//   • `call_id` is the stable correlation id across output_item.added,
//     function_call_arguments.delta, output_item.done and the next turn's
//     function_call_output. We reuse it verbatim as OpenAI `tool_calls[*].id`.
//   • function_call_arguments.delta arrives keyed by `item_id` (Codex's
//     internal item identifier), which can differ from the client-visible
//     `call_id`. The translator aliases both ids to the same slot.

function translateOpenAIToCodex(body: any): {
  input: any[]
  tools: any[] | undefined
  toolChoice: any | undefined
  systemMessage: string | undefined
} {
  const messages: any[] = Array.isArray(body.messages) ? body.messages : []
  const inputItems: any[] = []
  let systemMessage: string | undefined

  const flattenContent = (c: any): string => {
    if (typeof c === "string") return c
    if (Array.isArray(c)) {
      return c.map((p: any) => p?.type === "text" ? (p.text || "") : "").join("")
    }
    if (c == null) return ""
    return String(c)
  }

  for (const msg of messages) {
    const role = msg?.role
    if (role === "system" || role === "developer") {
      const text = flattenContent(msg.content)
      if (text) systemMessage = (systemMessage ? systemMessage + "\n" : "") + text
      continue
    }

    if (role === "tool") {
      // OpenAI tool-result message → Codex function_call_output item.
      if (!msg.tool_call_id) continue
      inputItems.push({
        type: "function_call_output",
        call_id: msg.tool_call_id,
        output: flattenContent(msg.content),
      })
      continue
    }

    if (role === "assistant" && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      // Assistant turn that invoked tools. Emit leading text first (if any),
      // then one function_call item per invocation with its call_id preserved.
      const textContent = flattenContent(msg.content)
      if (textContent) {
        inputItems.push({ role: "assistant", content: textContent })
      }
      for (const tc of msg.tool_calls) {
        if (!tc || tc.type !== "function" || !tc.function || !tc.id) continue
        inputItems.push({
          type: "function_call",
          call_id: tc.id,
          name: tc.function.name,
          arguments: typeof tc.function.arguments === "string"
            ? tc.function.arguments
            : JSON.stringify(tc.function.arguments || {}),
        })
      }
      continue
    }

    if (role === "user" || role === "assistant") {
      inputItems.push({ role, content: flattenContent(msg.content) })
      continue
    }
    // Unknown role: skip.
  }

  // --- tools ---
  let tools: any[] | undefined
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    tools = []
    for (const t of body.tools) {
      if (!t || t.type !== "function") continue
      // Accept both OpenAI-standard (.function nested) and Codex-flat inputs.
      const fn = t.function || t
      if (!fn.name) continue
      tools.push({
        type: "function",
        name: fn.name,
        ...(fn.description ? { description: fn.description } : {}),
        ...(fn.parameters ? { parameters: fn.parameters } : {}),
      })
    }
    if (tools.length === 0) tools = undefined
  }

  // --- tool_choice ---
  let toolChoice: any | undefined
  if (body.tool_choice != null) {
    const tc = body.tool_choice
    if (typeof tc === "string") {
      toolChoice = tc  // "auto" | "none" | "required"
    } else if (typeof tc === "object" && tc.type === "function") {
      const name = tc.function?.name || tc.name
      if (name) toolChoice = { type: "function", name }
    }
  }

  return { input: inputItems, tools, toolChoice, systemMessage }
}

// ── Chat Completions ──
export async function handleChatCompletions(req: Request, res: Response) {
  const startedAt = Date.now()
  const clientIp = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim()
  const userAgent = String(req.headers["user-agent"] || "")
  const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").replace(/^bearer\s+/i, "")
  const apiKeyHash = bearer ? hashApiKey(bearer) : undefined
  const originalBody = req.body || {}
  const clientType = detectClientType(userAgent, originalBody)
  const firstUserMessage = extractFirstUserMessage(originalBody.messages || [])
  const systemPromptHead = extractSystemHead(originalBody)
  try {
    const body = req.body || {}
    let model: string = body.model || "gpt-5.4-mini"
    const messages: Array<{ role: string; content: any }> = body.messages || []
    const stream: boolean = body.stream !== false
    const reasoningEffort: string | undefined = body.reasoning_effort

    // Derive session ID for cache simulation (before model manipulation)
    const sessionId = deriveSessionId(messages)

    // Detect -thinking suffix
    let reasoning = reasoningEffort
    if (model.endsWith("-thinking")) {
      model = model.replace(/-thinking$/, "")
      if (!reasoning) reasoning = "medium"
    }

    // Translate the whole request (messages + tools + tool_choice) to Codex
    // Responses-API shape in one pass. This is where the OpenAI function-
    // calling compatibility layer lives.
    const translated = translateOpenAIToCodex(body)
    const systemMessage = translated.systemMessage
    const input = translated.input.length > 0
      ? translated.input
      : [{ role: "user", content: "hi" }]

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
    if (translated.tools) {
      requestBody.tools = translated.tools
    }
    if (translated.toolChoice !== undefined) {
      requestBody.tool_choice = translated.toolChoice
    }
    // parallel_tool_calls pass-through (OpenAI sets this to signal "I can
    // handle multiple function_call items in one turn").
    if (body.parallel_tool_calls != null) {
      requestBody.parallel_tool_calls = body.parallel_tool_calls
    }

    const url = `${CODEX_BASE_URL}${CODEX_ENDPOINT}`
    const hasTools = Array.isArray(requestBody.tools) && requestBody.tools.length > 0
    console.log(
      `[OpenAI-GW] POST ${url} | model=${model} | account=${account.email} | ` +
      `msgs=${input.length} | tools=${hasTools ? requestBody.tools.length : 0} | ` +
      `stream=${stream} | reasoning=${reasoning || "off"} | sid=${sessionId}`
    )

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
      let accumulatedText = ""
      // Tool-call streaming state. We index tool_calls by *both* the Codex
      // `call_id` (client-visible) and the internal `item.id` (used by the
      // argument delta events), since they can differ.
      const toolCallIndexById = new Map<string, number>()
      const toolCallArgsById = new Map<string, string>()
      const toolCallNameById = new Map<string, string>()
      const toolCallSerialized: Array<{ id: string; name: string; args: string }> = []
      let emittedAnyToolCall = false

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
                accumulatedText += parsed.delta
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

              // ── Function-call support ──
              // Codex fires output_item.added whenever a new function_call
              // begins, carrying both a stable client-visible `call_id` and
              // an internal `item.id`. Later argument deltas address the
              // internal id; the client gets the call_id. Alias both so the
              // delta handler can find the slot either way.
              if (eventType === "response.output_item.added" && parsed.item?.type === "function_call") {
                const callId: string = parsed.item.call_id
                const internalId: string | undefined = parsed.item.id
                const name: string = parsed.item.name
                const idx = toolCallSerialized.length
                toolCallIndexById.set(callId, idx)
                if (internalId && internalId !== callId) toolCallIndexById.set(internalId, idx)
                toolCallNameById.set(callId, name)
                toolCallArgsById.set(callId, "")
                toolCallSerialized.push({ id: callId, name, args: "" })
                emittedAnyToolCall = true
                const startChunk = {
                  id: completionId, object: "chat.completion.chunk", created, model: responseModel,
                  choices: [{
                    index: 0,
                    delta: {
                      tool_calls: [{
                        index: idx,
                        id: callId,
                        type: "function",
                        function: { name, arguments: "" },
                      }],
                    },
                    finish_reason: null,
                  }],
                }
                res.write(`data: ${JSON.stringify(startChunk)}\n\n`)
              }

              if (eventType === "response.function_call_arguments.delta" && parsed.delta) {
                const key = parsed.item_id
                const idx = toolCallIndexById.get(key)
                if (idx != null) {
                  toolCallSerialized[idx].args += parsed.delta
                  const deltaChunk = {
                    id: completionId, object: "chat.completion.chunk", created, model: responseModel,
                    choices: [{
                      index: 0,
                      delta: {
                        tool_calls: [{
                          index: idx,
                          function: { arguments: parsed.delta },
                        }],
                      },
                      finish_reason: null,
                    }],
                  }
                  res.write(`data: ${JSON.stringify(deltaChunk)}\n\n`)
                }
              }

              // function_call_arguments.done and output_item.done are
              // informational — the OpenAI protocol is already satisfied by
              // the argument deltas that preceded them.

              if (eventType === "response.created" && parsed.response?.model) {
                responseModel = parsed.response.model
                if (reasoning && reasoning !== "none") responseModel += "-thinking"
              }

              if (eventType === "response.completed" && parsed.response) {
                const u = parsed.response.usage
                if (u) {
                  usageData = buildUsage(u, sessionId)
                }
                // finish_reason must reflect whether tool calls were emitted.
                const finishReason = emittedAnyToolCall ? "tool_calls" : "stop"
                const finalChunk: any = {
                  id: completionId, object: "chat.completion.chunk", created, model: responseModel,
                  choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
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

      // Audit log (stream end)
      const finalText = accumulatedText
      submitOai({
        session_id: sessionId,
        api_key_hash: apiKeyHash,
        client_ip: clientIp || undefined,
        user_agent: userAgent || undefined,
        client_type: clientType,
        endpoint: "/v1/chat/completions",
        model: responseModel,
        status_code: 200,
        duration_ms: Date.now() - startedAt,
        is_stream: true,
        has_tools: Array.isArray(originalBody.tools) && originalBody.tools.length > 0,
        tool_count: Array.isArray(originalBody.tools) ? originalBody.tools.length : 0,
        finish_reason_norm: emittedAnyToolCall ? "tool_calls" : "stop",
        prompt_tokens: usageData?.prompt_tokens || 0,
        completion_tokens: usageData?.completion_tokens || 0,
        cached_tokens: usageData?.prompt_tokens_details?.cached_tokens || 0,
        cache_write_tokens: 0,
        request_body: originalBody,
        response_text: finalText || (toolCallSerialized.length > 0
          ? `[tool_calls] ${JSON.stringify(toolCallSerialized)}`
          : ""),
        first_user_message: firstUserMessage,
        system_prompt_head: systemPromptHead,
      })
    } else {
      // ── Non-streaming mode ──
      let fullText = ""
      let reasoningText = ""
      let usageData: any = null
      const nsToolCallIndexById = new Map<string, number>()
      const nsToolCalls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = []
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
              // Track function_call items for non-streaming response.
              if (parsed.type === "response.output_item.added" && parsed.item?.type === "function_call") {
                const callId: string = parsed.item.call_id
                const internalId: string | undefined = parsed.item.id
                const idx = nsToolCalls.length
                nsToolCallIndexById.set(callId, idx)
                if (internalId && internalId !== callId) nsToolCallIndexById.set(internalId, idx)
                nsToolCalls.push({
                  id: callId,
                  type: "function",
                  function: { name: parsed.item.name, arguments: "" },
                })
              }
              if (parsed.type === "response.function_call_arguments.delta" && parsed.delta) {
                const idx = nsToolCallIndexById.get(parsed.item_id)
                if (idx != null) nsToolCalls[idx].function.arguments += parsed.delta
              }
              if (parsed.type === "response.output_item.done" && parsed.item?.type === "function_call") {
                // Authoritative arguments string; overwrite whatever we
                // accumulated from deltas.
                const callId: string = parsed.item.call_id
                const idx = nsToolCallIndexById.get(callId)
                if (idx != null && typeof parsed.item.arguments === "string") {
                  nsToolCalls[idx].function.arguments = parsed.item.arguments
                }
              }
              if (parsed.type === "response.completed" && parsed.response?.usage) {
                usageData = buildUsage(parsed.response.usage, sessionId)
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
          message: {
            role: "assistant",
            content: fullText || null,
            ...(nsToolCalls.length > 0 ? { tool_calls: nsToolCalls } : {}),
          },
          finish_reason: nsToolCalls.length > 0 ? "tool_calls" : "stop",
        }],
      }
      if (reasoningText) {
        (result.choices[0].message as any).reasoning_content = reasoningText
      }
      if (usageData) result.usage = usageData
      res.json(result)

      // Audit log (non-stream)
      submitOai({
        session_id: sessionId,
        api_key_hash: apiKeyHash,
        client_ip: clientIp || undefined,
        user_agent: userAgent || undefined,
        client_type: clientType,
        endpoint: "/v1/chat/completions",
        model: responseModel,
        status_code: 200,
        duration_ms: Date.now() - startedAt,
        is_stream: false,
        has_tools: Array.isArray(originalBody.tools) && originalBody.tools.length > 0,
        tool_count: Array.isArray(originalBody.tools) ? originalBody.tools.length : 0,
        finish_reason_norm: nsToolCalls.length > 0 ? "tool_calls" : "stop",
        prompt_tokens: usageData?.prompt_tokens || 0,
        completion_tokens: usageData?.completion_tokens || 0,
        cached_tokens: usageData?.prompt_tokens_details?.cached_tokens || 0,
        cache_write_tokens: 0,
        request_body: originalBody,
        response_text: fullText || (nsToolCalls.length > 0
          ? `[tool_calls] ${JSON.stringify(nsToolCalls)}`
          : ""),
        first_user_message: firstUserMessage,
        system_prompt_head: systemPromptHead,
      })
    }
  } catch (err: any) {
    console.error(`[OpenAI-GW] Unhandled error: ${err.message}`)
    res.status(500).json({ error: { message: err.message, type: "internal_error" } })
  }
}
