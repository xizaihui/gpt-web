import { defineStore } from 'pinia'
import { defaultState, getLocalState, removeLocalState } from './helper'
import { router } from '@/router'
import { t } from '@/locales'
import {
  fetchConversations,
  createConversation,
  updateConversationTitle as apiUpdateTitle,
  deleteConversation as apiDeleteConversation,
  clearAllConversations,
  fetchMessages,
  saveMessage,
  deleteMessage as apiDeleteMessage,
  clearMessages as apiClearMessages,
  importState,
} from '@/api'

// Debounce map for streaming saves: key = "uuid:index"
const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>()
const SAVE_DEBOUNCE_MS = 500

function debouncedSave(uuid: number, index: number, msg: Chat.Chat) {
  const key = `${uuid}:${index}`
  const existing = pendingSaves.get(key)
  if (existing) clearTimeout(existing)
  pendingSaves.set(key, setTimeout(() => {
    pendingSaves.delete(key)
    saveMessage(uuid, index, msg).catch(logError)
  }, SAVE_DEBOUNCE_MS))
}

function flushSave(uuid: number, index: number, msg: Chat.Chat) {
  const key = `${uuid}:${index}`
  const existing = pendingSaves.get(key)
  if (existing) clearTimeout(existing)
  pendingSaves.delete(key)
  saveMessage(uuid, index, msg).catch(logError)
}

function logError(e: unknown) {
  if (import.meta.env.DEV) {
    console.error('[ChatStore]', e)
  }
}

export const useChatStore = defineStore('chat-store', {
  state: (): Chat.ChatState => defaultState(),

  getters: {
    getChatHistoryByCurrentActive(state: Chat.ChatState) {
      const index = state.history.findIndex(item => item.uuid === state.active)
      if (index !== -1)
        return state.history[index]
      return null
    },

    getChatByUuid(state: Chat.ChatState) {
      return (uuid?: number) => {
        if (uuid)
          return state.chat.find(item => item.uuid === uuid)?.data ?? []
        return state.chat.find(item => item.uuid === state.active)?.data ?? []
      }
    },
  },

  actions: {
    // Load conversations list from backend
    async loadConversations() {
      try {
        const history = await fetchConversations()
        this.history = history
        // Initialize empty chat data for each
        this.chat = history.map(h => {
          const existing = this.chat.find(c => c.uuid === h.uuid)
          return existing || { uuid: h.uuid, data: [] }
        })
        // If active is not in the list, set to first
        if (!this.active || !this.history.find(h => h.uuid === this.active)) {
          this.active = this.history.length > 0 ? this.history[0].uuid : null
        }
      }
      catch (e) {
        logError(e)
      }
    },

    // Load messages for a specific conversation
    async loadMessages(uuid: number) {
      try {
        const messages = await fetchMessages(uuid)
        const chatIndex = this.chat.findIndex(item => item.uuid === uuid)
        if (chatIndex !== -1) {
          this.chat[chatIndex].data = messages
        }
        else {
          this.chat.push({ uuid, data: messages })
        }
      }
      catch (e) {
        logError(e)
      }
    },

    // One-time migration from localStorage to backend
    async migrateFromLocalStorage() {
      const migrated = localStorage.getItem('chatStorage_migrated')
      if (migrated) return

      const localState = getLocalState()
      if (!localState || !localState.history || localState.history.length === 0) {
        localStorage.setItem('chatStorage_migrated', '1')
        return
      }

      try {
        
        await importState({ history: localState.history, chat: localState.chat })
        localStorage.setItem('chatStorage_migrated', '1')
        // Keep old data for safety, mark it
        removeLocalState()
        
      }
      catch (e) {
        logError(e)
      }
    },

    setUsingContext(context: boolean) {
      this.usingContext = context
    },

    async addHistory(history: Chat.History, chatData: Chat.Chat[] = []) {
      this.history.unshift(history)
      this.chat.unshift({ uuid: history.uuid, data: chatData })
      this.active = history.uuid
      // Save to backend
      try {
        await createConversation(history.uuid, history.title)
      }
      catch (e) {
        logError(e)
      }
      this.reloadRoute(history.uuid)
    },

    async updateHistory(uuid: number, edit: Partial<Chat.History>) {
      const index = this.history.findIndex(item => item.uuid === uuid)
      if (index !== -1) {
        this.history[index] = { ...this.history[index], ...edit }
        if (edit.title) {
          try {
            await apiUpdateTitle(uuid, edit.title)
          }
          catch (e) {
            logError(e)
          }
        }
      }
    },

    async deleteHistory(index: number) {
      const uuid = this.history[index]?.uuid
      this.history.splice(index, 1)
      this.chat.splice(index, 1)

      // Delete from backend
      if (uuid) {
        try {
          await apiDeleteConversation(uuid)
        }
        catch (e) {
          logError(e)
        }
      }

      if (this.history.length === 0) {
        this.active = null
        this.reloadRoute()
        return
      }

      if (index > 0 && index <= this.history.length) {
        const uuid = this.history[index - 1].uuid
        this.active = uuid
        this.reloadRoute(uuid)
        return
      }

      if (index === 0) {
        if (this.history.length > 0) {
          const uuid = this.history[0].uuid
          this.active = uuid
          this.reloadRoute(uuid)
        }
      }

      if (index > this.history.length) {
        const uuid = this.history[this.history.length - 1].uuid
        this.active = uuid
        this.reloadRoute(uuid)
      }
    },

    async setActive(uuid: number) {
      this.active = uuid
      // Load messages for this conversation if not loaded
      const chatItem = this.chat.find(item => item.uuid === uuid)
      if (!chatItem || chatItem.data.length === 0) {
        await this.loadMessages(uuid)
      }
      return await this.reloadRoute(uuid)
    },

    getChatByUuidAndIndex(uuid: number, index: number) {
      if (!uuid || uuid === 0) {
        if (this.chat.length)
          return this.chat[0].data[index]
        return null
      }
      const chatIndex = this.chat.findIndex(item => item.uuid === uuid)
      if (chatIndex !== -1)
        return this.chat[chatIndex].data[index]
      return null
    },

    addChatByUuid(uuid: number, chat: Chat.Chat) {
      if (!uuid || uuid === 0) {
        if (this.history.length === 0) {
          const uuid = Date.now()
          this.history.push({ uuid, title: chat.text, isEdit: false })
          this.chat.push({ uuid, data: [chat] })
          this.active = uuid
          // Save to backend (fire and forget)
          createConversation(uuid, chat.text).catch(logError)
          saveMessage(uuid, 0, chat).catch(logError)
        }
        else {
          const msgIndex = this.chat[0].data.length
          this.chat[0].data.push(chat)
          if (this.history[0].title === t('chat.newChatTitle'))
            this.history[0].title = chat.text
          // Save to backend
          const convUuid = this.chat[0].uuid
          saveMessage(convUuid, msgIndex, chat).catch(logError)
        }
        return
      }

      const index = this.chat.findIndex(item => item.uuid === uuid)
      if (index !== -1) {
        const msgIndex = this.chat[index].data.length
        this.chat[index].data.push(chat)
        if (this.history[index].title === t('chat.newChatTitle')) {
          this.history[index].title = chat.text
          apiUpdateTitle(uuid, chat.text).catch(logError)
        }
        // Save to backend
        saveMessage(uuid, msgIndex, chat).catch(logError)
      }
    },

    updateChatByUuid(uuid: number, index: number, chat: Chat.Chat) {
      if (!uuid || uuid === 0) {
        if (this.chat.length) {
          this.chat[0].data[index] = chat
          debouncedSave(this.chat[0].uuid, index, chat)
        }
        return
      }

      const chatIndex = this.chat.findIndex(item => item.uuid === uuid)
      if (chatIndex !== -1) {
        this.chat[chatIndex].data[index] = chat
        debouncedSave(uuid, index, chat)
      }
    },

    updateChatSomeByUuid(uuid: number, index: number, chat: Partial<Chat.Chat>) {
      if (!uuid || uuid === 0) {
        if (this.chat.length) {
          this.chat[0].data[index] = { ...this.chat[0].data[index], ...chat }
          flushSave(this.chat[0].uuid, index, this.chat[0].data[index])
        }
        return
      }

      const chatIndex = this.chat.findIndex(item => item.uuid === uuid)
      if (chatIndex !== -1) {
        this.chat[chatIndex].data[index] = { ...this.chat[chatIndex].data[index], ...chat }
        flushSave(uuid, index, this.chat[chatIndex].data[index])
      }
    },

    async deleteChatByUuid(uuid: number, index: number) {
      if (!uuid || uuid === 0) {
        if (this.chat.length) {
          this.chat[0].data.splice(index, 1)
          try { await apiClearMessages(this.chat[0].uuid) } catch {}
          // Re-save with correct indices
          this.resaveAllMessages(this.chat[0].uuid, this.chat[0].data)
        }
        return
      }

      const chatIndex = this.chat.findIndex(item => item.uuid === uuid)
      if (chatIndex !== -1) {
        this.chat[chatIndex].data.splice(index, 1)
        try { await apiClearMessages(uuid) } catch {}
        this.resaveAllMessages(uuid, this.chat[chatIndex].data)
      }
    },

    async clearChatByUuid(uuid: number) {
      if (!uuid || uuid === 0) {
        if (this.chat.length) {
          this.chat[0].data = []
          try { await apiClearMessages(this.chat[0].uuid) } catch {}
        }
        return
      }

      const index = this.chat.findIndex(item => item.uuid === uuid)
      if (index !== -1) {
        this.chat[index].data = []
        try { await apiClearMessages(uuid) } catch {}
      }
    },

    async clearHistory() {
      this.$state = { ...defaultState() }
      try { await clearAllConversations() } catch {}
    },

    async reloadRoute(uuid?: number) {
      await router.push({ name: 'Chat', params: { uuid } })
    },

    // Helper: re-save all messages after splice (index shift)
    resaveAllMessages(uuid: number, messages: Chat.Chat[]) {
      for (let i = 0; i < messages.length; i++) {
        saveMessage(uuid, i, messages[i]).catch(logError)
      }
    },

    // No longer needed — kept as no-op for compatibility
    recordState() {},
  },
})
