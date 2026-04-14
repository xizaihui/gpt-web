import { ss } from '@/utils/storage'
import { t } from '@/locales'

const LOCAL_NAME = 'chatStorage'

export function defaultState(): Chat.ChatState {
  return {
    active: null,
    usingContext: true,
    history: [],
    chat: [],
  }
}

// Read old localStorage data (for migration)
export function getLocalState(): Chat.ChatState {
  const localState = ss.get(LOCAL_NAME)
  return { ...defaultState(), ...localState }
}

// Remove old localStorage data after migration
export function removeLocalState() {
  ss.remove(LOCAL_NAME)
}
