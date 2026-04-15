/**
 * Prompt Cache Simulator for OpenAI Gateway
 *
 * Since Codex Responses API may not return cache token data,
 * this module simulates Anthropic-style prompt caching to provide
 * accurate cache_read / cache_write token counts for NewAPI billing.
 *
 * Logic mirrors kiro-gateway/kiro/cache_simulator.py:
 * - First request in session: cache_write = prompt_tokens, cache_read = 0
 * - Subsequent requests (same session, within TTL): cache_read = prev prompt_tokens
 * - Cache TTL: 300s (matches Anthropic)
 */

import crypto from "crypto"

const CACHE_TTL_MS = 300_000 // 5 minutes
const CLEANUP_INTERVAL_MS = 60_000

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

  // Case 1: First request or expired
  if (!state || (now - state.lastRequestTime) > CACHE_TTL_MS) {
    sessions.set(sessionId, {
      prevPromptTokens: promptTokens,
      lastRequestTime: now,
      requestCount: 1,
    })
    return { promptTokens, cacheReadTokens: 0, cacheWriteTokens: promptTokens }
  }

  // Case 2: Subsequent request within TTL
  let cacheRead = state.prevPromptTokens
  if (cacheRead > promptTokens) cacheRead = promptTokens
  const cacheWrite = Math.max(0, promptTokens - cacheRead)

  state.prevPromptTokens = promptTokens
  state.lastRequestTime = now
  state.requestCount++

  return { promptTokens, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite }
}
