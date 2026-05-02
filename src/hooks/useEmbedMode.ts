import { computed } from 'vue'

function hasEmbedParam(params: URLSearchParams) {
  const value = params.get('embed') || params.get('embedded')
  return value === '1' || value === 'true' || value === 'yes'
}

function isInFrame() {
  try {
    return window.self !== window.top
  }
  catch {
    return true
  }
}

function detectEmbedMode() {
  if (typeof window === 'undefined')
    return false

  if (hasEmbedParam(new URLSearchParams(window.location.search)))
    return true

  const [, hashQuery = ''] = window.location.hash.split('?')
  if (hashQuery && hasEmbedParam(new URLSearchParams(hashQuery)))
    return true

  return isInFrame()
}

export function useEmbedMode() {
  const isEmbedMode = computed(() => detectEmbedMode())

  return { isEmbedMode }
}
