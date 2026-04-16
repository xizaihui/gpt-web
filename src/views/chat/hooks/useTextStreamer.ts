/**
 * Smooth text streaming buffer.
 *
 * Buffers incoming text chunks and releases them at a steady visual
 * rate, creating a typewriter-like effect instead of jarring bursts.
 */

// Tuning: chars emitted per requestAnimationFrame tick (~16ms)
const CHARS_PER_FRAME = 12       // ~750 chars/sec — fast and fluid
const BURST_THRESHOLD = 300      // if buffer > this, switch to burst mode
const BURST_CHARS_PER_FRAME = 60 // ~3750 chars/sec — catch-up speed

export interface TextStreamer {
  push: (fullText: string, meta?: any) => void
  flush: () => void
  stop: () => void
}

export function useTextStreamer(
  onTick: (displayText: string, meta?: any) => void,
): TextStreamer {
  let displayed = ''
  let target = ''
  let pending = ''
  let latestMeta: any = null
  let rafId: number | null = null
  let stopped = false

  function tick() {
    if (pending.length === 0) {
      rafId = null
      return
    }

    const n = pending.length > BURST_THRESHOLD
      ? BURST_CHARS_PER_FRAME
      : CHARS_PER_FRAME

    const chunk = pending.slice(0, n)
    pending = pending.slice(n)
    displayed += chunk

    onTick(displayed, latestMeta)
    rafId = requestAnimationFrame(tick)
  }

  function ensureRunning() {
    if (rafId === null && !stopped) {
      rafId = requestAnimationFrame(tick)
    }
  }

  return {
    push(fullText: string, meta?: any) {
      latestMeta = meta
      if (fullText.length > target.length) {
        pending += fullText.slice(target.length)
        target = fullText
        ensureRunning()
      } else if (fullText !== target) {
        // Hard reset (text changed/cleared)
        target = fullText
        displayed = fullText
        pending = ''
        onTick(displayed, latestMeta)
      }
    },

    flush() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      if (pending.length > 0) {
        displayed += pending
        pending = ''
      }
      displayed = target
      onTick(displayed, latestMeta)
    },

    stop() {
      stopped = true
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      pending = ''
    },
  }
}
