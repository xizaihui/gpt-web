/**
 * Smooth text streaming buffer.
 *
 * Instead of dumping large chunks of text at once (which happens with
 * ClewdR's tool-mode buffering), this streams characters out at a
 * steady visual rate, creating a typewriter-like effect.
 *
 * Usage:
 *   const streamer = useTextStreamer(onTick)
 *   // In SSE onProgress:
 *   streamer.push(newFullText)
 *   // When stream ends:
 *   streamer.flush()
 *   // On cleanup:
 *   streamer.stop()
 */

// Characters to emit per animation frame (~16ms).
// 6 chars/frame ≈ 375 chars/sec — fast enough to feel responsive,
// slow enough to look like smooth typing.
const DEFAULT_CHARS_PER_FRAME = 6
// If the pending buffer exceeds this, increase speed to catch up.
const BURST_THRESHOLD = 200
const BURST_CHARS_PER_FRAME = 30

export interface TextStreamer {
  /** Push the full accumulated text so far. Internally diffs to find new chars. */
  push: (fullText: string, meta?: any) => void
  /** Immediately flush all remaining buffered text. */
  flush: () => void
  /** Stop the animation loop. */
  stop: () => void
}

export function useTextStreamer(
  onTick: (displayText: string, meta?: any) => void,
): TextStreamer {
  let displayed = ''        // what the user currently sees
  let target = ''           // full text received from server
  let pending = ''          // chars waiting to be displayed
  let latestMeta: any = null
  let rafId: number | null = null
  let flushing = false

  function tick() {
    if (pending.length === 0) {
      rafId = null
      return
    }

    // Adaptive speed: burst if we're falling behind
    const charsPerFrame = pending.length > BURST_THRESHOLD
      ? BURST_CHARS_PER_FRAME
      : DEFAULT_CHARS_PER_FRAME

    const chunk = pending.slice(0, charsPerFrame)
    pending = pending.slice(charsPerFrame)
    displayed += chunk

    onTick(displayed, latestMeta)

    rafId = requestAnimationFrame(tick)
  }

  function ensureRunning() {
    if (rafId === null && !flushing) {
      rafId = requestAnimationFrame(tick)
    }
  }

  return {
    push(fullText: string, meta?: any) {
      latestMeta = meta
      if (fullText.length > target.length) {
        const newChars = fullText.slice(target.length)
        pending += newChars
        target = fullText
        ensureRunning()
      } else if (fullText !== target) {
        // Text was reset or changed — hard reset
        target = fullText
        displayed = fullText
        pending = ''
        onTick(displayed, latestMeta)
      }
    },

    flush() {
      flushing = true
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      if (pending.length > 0) {
        displayed += pending
        pending = ''
      }
      // Make sure displayed matches target
      displayed = target
      onTick(displayed, latestMeta)
      flushing = false
    },

    stop() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      pending = ''
    },
  }
}
