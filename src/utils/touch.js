import { ref, onBeforeUnmount } from 'vue'

const LONG_PRESS_MS = 400
const SUPPRESS_CLICK_MS = 300

/**
 * 长按 hook：≥ 400ms 触发 onLongPress，结束后 300ms 内吞掉 click（双击守卫）。
 * 用原生 PointerEvent，桌面鼠标 + 移动端触摸通用。
 */
export function useLongPress({ onLongPress } = {}) {
  let timer = null
  let suppressUntil = 0
  const pressing = ref(false)

  function start(e) {
    pressing.value = true
    timer = setTimeout(() => {
      timer = null
      pressing.value = false
      suppressUntil = Date.now() + SUPPRESS_CLICK_MS
      if (typeof onLongPress === 'function') onLongPress(e)
    }, LONG_PRESS_MS)
  }

  function cancel() {
    if (timer) { clearTimeout(timer); timer = null }
    pressing.value = false
  }

  function shouldSuppressClick() {
    return Date.now() < suppressUntil
  }

  onBeforeUnmount(cancel)

  return {
    pressing,
    handlers: {
      onPointerdown: start,
      onPointerup: cancel,
      onPointerleave: cancel,
      onPointercancel: cancel
    },
    shouldSuppressClick
  }
}
