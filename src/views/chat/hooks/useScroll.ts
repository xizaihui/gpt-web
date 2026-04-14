import type { Ref } from 'vue'
import { nextTick, onUnmounted, ref } from 'vue'

type ScrollElement = HTMLDivElement | null

interface ScrollReturn {
  scrollRef: Ref<ScrollElement>
  scrollToBottom: () => Promise<void>
  scrollToTop: () => Promise<void>
  scrollToBottomIfAtBottom: () => void
  isAutoScroll: Ref<boolean>
}

export function useScroll(): ScrollReturn {
  const scrollRef = ref<ScrollElement>(null)
  const isAutoScroll = ref(true)
  let lastScrollTop = 0
  let scrollListenerAttached = false
  let rafPending = false

  // Named handler so it can be properly removed
  function onScroll() {
    const el = scrollRef.value
    if (!el) return

    const currentScrollTop = el.scrollTop
    const distanceToBottom = el.scrollHeight - currentScrollTop - el.clientHeight

    if (currentScrollTop < lastScrollTop && distanceToBottom > 100) {
      isAutoScroll.value = false
    }

    if (distanceToBottom <= 30) {
      isAutoScroll.value = true
    }

    lastScrollTop = currentScrollTop
  }

  function attachScrollListener() {
    if (scrollListenerAttached || !scrollRef.value) return
    scrollListenerAttached = true
    scrollRef.value.addEventListener('scroll', onScroll, { passive: true })
  }

  function detachScrollListener() {
    if (!scrollListenerAttached || !scrollRef.value) return
    scrollRef.value.removeEventListener('scroll', onScroll)
    scrollListenerAttached = false
  }

  const doScroll = () => {
    if (scrollRef.value) {
      scrollRef.value.scrollTop = scrollRef.value.scrollHeight
      lastScrollTop = scrollRef.value.scrollTop
    }
  }

  const scrollToBottom = async () => {
    isAutoScroll.value = true
    await nextTick()
    attachScrollListener()
    doScroll()
    requestAnimationFrame(doScroll)
  }

  const scrollToTop = async () => {
    await nextTick()
    if (scrollRef.value)
      scrollRef.value.scrollTop = 0
  }

  const scrollToBottomIfAtBottom = () => {
    attachScrollListener()
    if (!isAutoScroll.value) return

    if (!rafPending) {
      rafPending = true
      requestAnimationFrame(() => {
        rafPending = false
        if (isAutoScroll.value) doScroll()
      })
    }
  }

  // Cleanup on unmount
  onUnmounted(detachScrollListener)

  return {
    scrollRef,
    scrollToBottom,
    scrollToTop,
    scrollToBottomIfAtBottom,
    isAutoScroll,
  }
}
