import { ss } from '@/utils/storage'

const LOCAL_NAME = 'settingsStorage'

export interface SettingsState {
  systemMessage: string
  temperature: number
  top_p: number
  apiBaseUrl: string
  apiKey: string
  apiMode: 'newapi' | 'custom'
  newApiTokenId: number | null
  newApiTokenName: string
  contextRounds: number
}

const DEFAULT_API_BASE_URL = import.meta.env.VITE_DEFAULT_API_BASE_URL || ''

export function defaultSetting(): SettingsState {
  return {
    systemMessage: 'You are a helpful assistant. Follow the user\'s instructions carefully. Respond using markdown.',
    temperature: 0.8,
    top_p: 1,
    apiBaseUrl: DEFAULT_API_BASE_URL,
    apiKey: '',
    apiMode: 'newapi',
    newApiTokenId: null,
    newApiTokenName: '',
    contextRounds: 20,
  }
}

export function getLocalState(): SettingsState {
  const localSetting: SettingsState | undefined = ss.get(LOCAL_NAME)
  return { ...defaultSetting(), ...localSetting }
}

export function setLocalState(setting: SettingsState): void {
  ss.set(LOCAL_NAME, setting)
}

export function removeLocalState() {
  ss.remove(LOCAL_NAME)
}
