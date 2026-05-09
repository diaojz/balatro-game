import gsap from 'gsap'

/**
 * 把卡牌元素从其当前 DOM 位置飞到 targetEl 位置（FLIP 思路）。
 * 调用方需在动画结束后处理 DOM 更新（例如把牌移出手牌）。
 */
export function flyToTable(cardEl, targetEl, options = {}) {
  if (!cardEl || !targetEl) return null
  const src = cardEl.getBoundingClientRect()
  const dst = targetEl.getBoundingClientRect()
  const dx = dst.left + dst.width / 2 - (src.left + src.width / 2)
  const dy = dst.top + dst.height / 2 - (src.top + src.height / 2)

  return gsap.fromTo(
    cardEl,
    { x: 0, y: 0, scale: 1 },
    {
      x: dx,
      y: dy,
      scale: options.scale ?? 1.1,
      duration: options.duration ?? 0.45,
      ease: options.ease ?? 'power2.out',
      delay: options.delay ?? 0,
      onComplete: options.onComplete
    }
  )
}

/**
 * 在屏幕中心爆出一组随机方向飘散的 emoji 粒子。
 * Boss 击败时调用。1.8s 后自动清理 DOM。
 */
export function burstParticles(count = 30) {
  const container = document.createElement('div')
  container.className = 'particle-burst'
  document.body.appendChild(container)

  const symbols = ['💰', '⭐', '✨']
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div')
    p.className = 'particle'
    p.textContent = symbols[i % symbols.length]
    container.appendChild(p)

    gsap.fromTo(
      p,
      { x: 0, y: 0, scale: 0.5, opacity: 1 },
      {
        x: (Math.random() - 0.5) * 800,
        y: -Math.random() * 600 - 100,
        scale: 1.5,
        opacity: 0,
        duration: 1.5,
        ease: 'power2.out'
      }
    )
  }

  setTimeout(() => container.remove(), 1800)
}
