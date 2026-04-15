/**
 * Prompt Cache Simulator for OpenAI Gateway
 *
 * Since Codex Responses API does not return cache token data,
 * this module simulates OpenAI prompt caching behavior.
 *
 * OpenAI prompt caching facts:
 * - Automatic for prompts ≥1024 tokens, exact prefix match
 * - In-memory TTL: 5-10 min (up to 1h during off-peak)
 * - Extended (gpt-5.4): up to 24h
 * - Cache writes are FREE — only cache reads get 90% discount
 * - cached_tokens is always ≤ prompt_tokens
 * - uncached_input = prompt_tokens - cached_tokens
 *
 * Billing formula (per OpenAI docs):
 *   fee = uncached_input * input_price
 *       + cached_tokens * cached_input_price   (10% of input_price)
 *       + completion_tokens * output_price
 *
 * Simulation logic:
 * - First request in session: cached_tokens = 0
 * - Subsequent requests (same session, within TTL):
 *   cached_tokens = previous request's prompt_tokens
 *   (because the entire previous prefix is still in cache)
 * - TTL: 1 hour (conservative estimate for gpt-5.4 extended caching)
 */

import crypto from "crypto"

// OpenAI extended caching for gpt-5.4 can last up to 24h,
// in-memory can last up to 1h. We use 1h as a safe default.
const CACHE_TTL_MS = 3_600_000 // 1 hour
const CLEANUP_INTERVAL_MS = 300_000 // clean up every 5 min

interface SessionState {
  prevPromptTokens: number
  lastRequestTime: number // Date.now()
  requestCount: number
}

const sessions = new Map<string, SessionState>()
let lastCleanup = Date.now()

function maybeCleanup() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return
  lastCleanup = now
  const expiry = now - CACHE_TTL_MS * 2
  for (const [sid, state] of sessions) {
    if (state.lastRequestTime < expiry) sessions.delete(sid)
  }
}

/**
 * Derive a session ID from the messages array.
 * Uses system prompt (first 200 chars) + first user message (first 100 chars).
 * Same system + same first user message = same conversation session.
 */
export function deriveSessionId(messages: Array<{ role: string; content: any }>): string {
  const parts: string[] = []
  for (const m of messages) {
    const content = typeof m.content === "string"
      ? m.content
      : Array.isArray(m.content)
        ? m.content.map((p: any) => (p.type === "text" ? p.text : "")).join("")
        : String(m.content ?? "")

    if (m.role === "system" || m.role === "developer") {
      parts.push(content.slice(0, 200))
    } else if (m.role === "user" && parts.length < 2) {
      parts.push(content.slice(0, 100))
    }
    if (parts.length >= 2) break
  }
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16)
}

export interface CacheResult {
  promptTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/**
 * Calculate simulated cache tokens for a request.
 *
 * If the upstream already returned real cached_tokens > 0, those are used
 * (pass-through mode). Otherwise we simulate.
 *
 * Returns:
 *   cacheReadTokens = cached_tokens (to be billed at 10% rate)
 *   cacheWriteTokens = uncached new tokens (for logging only, NOT billed extra)
 */
export function calculateCache(
  sessionId: string,
  promptTokens: number,
  upstreamCachedTokens: number = 0,
): CacheResult {
  // If upstream already provides real cache data, pass it through
  if (upstreamCachedTokens > 0) {
    return {
      promptTokens,
      cacheReadTokens: upstreamCachedTokens,
      cacheWriteTokens: Math.max(0, promptTokens - upstreamCachedTokens),
    }
  }

  maybeCleanup()

  const now = Date.now()
  const state = sessions.get(sessionId)

  // Case 1: First request or expired — no cache hit
  if (!state || (now - state.lastRequestTime) > CACHE_TTL_MS) {
    sessions.set(sessionId, {
      prevPromptTokens: promptTokens,
      lastRequestTime: now,
      requestCount: 1,
    })
    return { promptTokens, cacheReadTokens: 0, cacheWriteTokens: promptTokens }
  }

  // Case 2: Subsequent request within TTL — previous prompt is cached
  // cached_tokens = prev prompt_tokens (the entire previous prefix)
  let cacheRead = state.prevPromptTokens
  if (cacheRead > promptTokens) cacheRead = promptTokens
  const cacheWrite = Math.max(0, promptTokens - cacheRead)

  state.prevPromptTokens = promptTokens
  state.lastRequestTime = now
  state.requestCount++

  return { promptTokens, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite }
}
