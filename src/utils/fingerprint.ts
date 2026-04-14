/**
 * Browser fingerprint generator
 * Generates a stable anonymous ID based on browser/device characteristics.
 * No external dependencies. Works on HTTP (no crypto.subtle required).
 */

/**
 * Simple string hash (FNV-1a inspired, 128-bit via 4x32-bit).
 * Not cryptographic — just needs to be stable and well-distributed.
 */
function simpleHash(str: string): string {
  // Use 4 independent FNV-1a 32-bit hashes with different seeds for 128-bit output
  const seeds = [0x811c9dc5, 0x050c5d1f, 0x1a47e90b, 0x3b9aca07]
  const results: number[] = []
  for (const seed of seeds) {
    let h = seed
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    results.push(h >>> 0) // unsigned
  }
  return results.map(n => n.toString(16).padStart(8, '0')).join('')
}

function getCanvasFingerprint(): string {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 200
    canvas.height = 50
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''
    ctx.textBaseline = 'top'
    ctx.font = '14px Arial'
    ctx.fillStyle = '#f60'
    ctx.fillRect(20, 0, 100, 30)
    ctx.fillStyle = '#069'
    ctx.fillText('fingerprint', 2, 15)
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)'
    ctx.fillText('fingerprint', 4, 17)
    return canvas.toDataURL()
  } catch {
    return ''
  }
}

function getWebGLFingerprint(): string {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl') as WebGLRenderingContext | null
    if (!gl) return ''
    const ext = (gl as WebGLRenderingContext).getExtension('WEBGL_debug_renderer_info')
    if (!ext) return ''
    const vendor = (gl as WebGLRenderingContext).getParameter(ext.UNMASKED_VENDOR_WEBGL)
    const renderer = (gl as WebGLRenderingContext).getParameter(ext.UNMASKED_RENDERER_WEBGL)
    return `${vendor}~${renderer}`
  } catch {
    return ''
  }
}

function collectSignals(): string {
  const parts: string[] = [
    // Screen
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    `${screen.availWidth}x${screen.availHeight}`,
    `dpr:${window.devicePixelRatio}`,
    // Timezone
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    `offset:${new Date().getTimezoneOffset()}`,
    // Platform / language
    navigator.platform || '',
    navigator.language || '',
    `cores:${navigator.hardwareConcurrency || 0}`,
    `mem:${(navigator as any).deviceMemory || 0}`,
    `touch:${navigator.maxTouchPoints || 0}`,
    // Canvas
    getCanvasFingerprint(),
    // WebGL
    getWebGLFingerprint(),
  ]
  return parts.join('|')
}

const STORAGE_KEY = 'app_client_id'

/**
 * Get or generate a stable client ID.
 * First checks localStorage for a previously generated ID.
 * If not found, generates one from browser fingerprint and stores it.
 */
export async function getClientId(): Promise<string> {
  // Check localStorage first
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored && stored.length >= 16) return stored

  // Generate from fingerprint (synchronous — no crypto.subtle needed)
  const signals = collectSignals()
  const clientId = simpleHash(signals) // 32 hex chars = 128 bits

  localStorage.setItem(STORAGE_KEY, clientId)
  return clientId
}
