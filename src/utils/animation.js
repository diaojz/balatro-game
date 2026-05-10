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
 * Boss 击败粒子升级版：屏幕白闪 + 爆炸圆环 + 三层粒子（金币/星星/闪光）。
 *
 * 三层节奏（参考小丑牌原作 boss 击败感）：
 * - 内圈 金币 emoji：t=0    短近爆发，0.6s
 * - 中圈 星星 emoji：t=80   中距离，1.0s
 * - 外圈 闪光 emoji：t=180  远距离慢消散，1.5s
 *
 * 签名向后兼容：count 作为整体强度因子（ratio = count / 36）。
 * 默认 count=30 时三层约 10/13/17，调用方传 36 时恰好 12/16/20。
 * 1.8s 后整体 DOM 清理。
 */
export function burstParticles(count = 30) {
  // 屏幕白闪
  const flash = document.createElement('div')
  flash.className = 'boss-flash'
  document.body.appendChild(flash)
  setTimeout(() => flash.remove(), 450)

  // 爆炸圆环
  const ring = document.createElement('div')
  ring.className = 'boss-ring'
  document.body.appendChild(ring)
  setTimeout(() => ring.remove(), 450)

  // 三层粒子容器
  const container = document.createElement('div')
  container.className = 'particle-burst'
  document.body.appendChild(container)

  const ratio = Math.max(0.4, count / 36)
  const tiers = [
    {
      cls: 'tier-inner',
      symbols: ['💰', '🪙'],
      n: Math.round(12 * ratio),
      delay: 0,
      duration: 0.6,
      minDist: 110,
      maxDist: 200
    },
    {
      cls: 'tier-mid',
      symbols: ['⭐', '🌟'],
      n: Math.round(16 * ratio),
      delay: 0.08,
      duration: 1.0,
      minDist: 220,
      maxDist: 360
    },
    {
      cls: 'tier-outer',
      symbols: ['✨', '💫'],
      n: Math.round(20 * ratio),
      delay: 0.18,
      duration: 1.5,
      minDist: 360,
      maxDist: 540
    }
  ]

  tiers.forEach(tier => {
    for (let i = 0; i < tier.n; i++) {
      const p = document.createElement('div')
      p.className = `particle ${tier.cls}`
      p.textContent = tier.symbols[i % tier.symbols.length]
      container.appendChild(p)

      // 全周角随机方向 + 上方偏置
      const angle = Math.random() * Math.PI * 2
      const distance = tier.minDist + Math.random() * (tier.maxDist - tier.minDist)
      const dx = Math.cos(angle) * distance
      const dy = Math.sin(angle) * distance - Math.random() * 120

      gsap.fromTo(
        p,
        { x: 0, y: 0, scale: 0.4, opacity: 1, rotation: 0 },
        {
          x: dx,
          y: dy,
          scale: 1.4,
          opacity: 0,
          rotation: (Math.random() - 0.5) * 540,
          duration: tier.duration,
          delay: tier.delay,
          ease: 'power2.out'
        }
      )
    }
  })

  setTimeout(() => container.remove(), 1800)
}

/**
 * 在指定锚点元素的头顶飘出一段数字 / 文字（用于 chips/mult 实时反馈）。
 * 颜色 / 字号可定制；1s 内淡出消失，DOM 自动清理。
 */
export function floatNumber(anchorEl, text, options = {}) {
  if (!anchorEl) return
  const rect = anchorEl.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top - 8

  const node = document.createElement('div')
  node.className = 'score-pop'
  node.textContent = text
  node.style.cssText = `
    position: fixed;
    left: ${cx}px;
    top: ${cy}px;
    transform: translate(-50%, -50%);
    color: ${options.color ?? '#ffd166'};
    font-family: 'Press Start 2P', monospace;
    font-size: ${options.size ?? 22}px;
    font-weight: 900;
    pointer-events: none;
    z-index: 170;
    text-shadow:
      -2px 0 0 #2a1c33,
      2px 0 0 #2a1c33,
      0 -2px 0 #2a1c33,
      0 2px 0 #2a1c33,
      0 0 14px ${options.glow ?? 'rgba(255,209,102,0.8)'};
    letter-spacing: 1px;
    white-space: nowrap;
    will-change: transform, opacity;
  `
  document.body.appendChild(node)

  const tl = gsap.timeline({ onComplete: () => node.remove() })
  tl.fromTo(
    node,
    { y: 0, scale: 0.5, opacity: 0 },
    { y: -16, scale: 1.2, opacity: 1, duration: 0.18, ease: 'power2.out' }
  )
  tl.to(node, { y: -32, scale: 1, duration: 0.16, ease: 'power2.out' })
  tl.to(node, { y: -60, opacity: 0, duration: 0.34, ease: 'power2.in' })
}

/**
 * 把一个数字 / 文字从 srcEl 抛物线飞到 hudColEl 中心，
 * 到达时调用 onArrive（一般用于触发 HUD 框脉冲 + 数值跳变）。
 * 整段动画约 0.55s。
 */
export function flyToHud(srcEl, hudColEl, text, options = {}) {
  if (!srcEl || !hudColEl) {
    if (options.onArrive) options.onArrive()
    return
  }
  const src = srcEl.getBoundingClientRect()
  const dst = hudColEl.getBoundingClientRect()
  const startX = src.left + src.width / 2
  const startY = src.top - 4
  const endX = dst.left + dst.width / 2
  const endY = dst.top + dst.height / 2

  const node = document.createElement('div')
  node.className = 'fly-to-hud'
  node.textContent = text
  node.style.cssText = `
    position: fixed;
    left: ${startX}px;
    top: ${startY}px;
    color: ${options.color ?? '#ffd166'};
    font-family: 'Press Start 2P', monospace;
    font-size: ${options.size ?? 26}px;
    font-weight: 900;
    pointer-events: none;
    z-index: 175;
    text-shadow:
      -2px 0 0 #2a1c33,
      2px 0 0 #2a1c33,
      0 -2px 0 #2a1c33,
      0 2px 0 #2a1c33,
      0 0 14px ${options.glow ?? 'rgba(255,209,102,0.85)'};
    letter-spacing: 1px;
    white-space: nowrap;
    will-change: left, top, transform, opacity;
  `
  document.body.appendChild(node)
  gsap.set(node, { xPercent: -50, yPercent: -50, scale: 0.5 })

  const duration = options.duration ?? 0.55
  const tl = gsap.timeline({
    onComplete: () => {
      if (options.onArrive) options.onArrive()
      node.remove()
    }
  })
  tl.to(node, { scale: 1.1, duration: 0.18, ease: 'back.out(2)' })
  tl.to(
    node,
    {
      left: endX,
      top: endY,
      scale: 0.75,
      opacity: 0.9,
      duration,
      ease: 'power2.in'
    },
    '+=0.05'
  )
  tl.to(node, { opacity: 0, duration: 0.1 }, '-=0.05')
}

/**
 * 给 HUD 列添加 .receiving class 触发"接收脉冲"动画，0.4s 后自动移除。
 */
export function pulseHudCol(hudColEl) {
  if (!hudColEl) return
  hudColEl.classList.remove('receiving')
  // 强制 reflow 让 animation 能再次触发
  void hudColEl.offsetWidth
  hudColEl.classList.add('receiving')
  setTimeout(() => hudColEl.classList.remove('receiving'), 420)
}

/**
 * Joker 触发时，从指定 DOM 元素（卡牌）位置飞溅出少量金色粒子。
 * 0.7s 内消失，DOM 自动清理。
 */
export function burstJokerParticles(anchorEl, count = 6) {
  if (!anchorEl) return
  const rect = anchorEl.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const symbols = ['✨', '⭐', '💫']

  for (let i = 0; i < count; i++) {
    const p = document.createElement('div')
    p.className = 'joker-particle'
    p.textContent = symbols[i % symbols.length]
    p.style.left = `${cx}px`
    p.style.top = `${cy}px`
    document.body.appendChild(p)

    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6
    const distance = 60 + Math.random() * 50
    gsap.fromTo(
      p,
      { x: 0, y: 0, scale: 0.4, opacity: 1, rotation: 0 },
      {
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance - 30,
        scale: 1.2,
        opacity: 0,
        rotation: (Math.random() - 0.5) * 360,
        duration: 0.7,
        ease: 'power2.out',
        onComplete: () => p.remove()
      }
    )
  }
}
