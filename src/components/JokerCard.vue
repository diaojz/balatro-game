<script setup>
import { computed } from 'vue'
import { getRarityColor, getRarityLabel } from '../config/jokers.js'
import { useLongPress } from '../utils/touch.js'

const props = defineProps({
  joker: {
    type: Object,
    default: null
  },
  empty: {
    type: Boolean,
    default: false
  },
  size: {
    type: String,
    default: 'normal' // 'normal' | 'small' | 'shop'
  },
  showTooltip: {
    type: Boolean,
    default: true
  },
  triggering: {
    type: Boolean,
    default: false
  },
  shimmering: {
    type: Boolean,
    default: false
  },
  context: {
    type: String,
    default: 'owned' // 'shop' | 'owned'
  },
  /**
   * v3.1.0：商店建议高亮枚举
   * - 'buy'  → 金色描边 + 脉冲（AI 推荐购买）
   * - 'sell' → 红色描边（AI 推荐卖出）
   * - null   → 无高亮
   */
  recommended: {
    type: String,
    default: null,
    validator: (v) => v === null || v === 'buy' || v === 'sell'
  }
})

const emit = defineEmits(['click', 'longpress'])

const { handlers, shouldSuppressClick } = useLongPress({
  onLongPress: () => {
    if (props.joker) emit('longpress', props.joker, props.context)
  }
})

function handleClick() {
  if (shouldSuppressClick()) return
  if (props.joker) emit('click', props.joker)
}

const rarityColor = computed(() => props.joker ? getRarityColor(props.joker.rarity) : '#43295e')
const rarityLabel = computed(() => props.joker ? getRarityLabel(props.joker.rarity) : '')
const artType = computed(() => props.joker?.art || 'jimbo')
</script>

<template>
  <div
    v-if="empty"
    class="joker-card empty"
    :class="`size-${size}`"
  >
    <div class="empty-plus">+</div>
    <div class="empty-label">空槽</div>
  </div>

  <div
    v-else
    class="joker-card"
    :class="[`size-${size}`, `rarity-${joker.rarity}`, { triggering, shimmering, 'is-recommended-buy': recommended === 'buy', 'is-recommended-sell': recommended === 'sell' }]"
    :style="{ '--rarity': rarityColor }"
    v-bind="handlers"
    @click="handleClick"
  >
    <!-- 卡片背景层（多层渐变 + 内描边） -->
    <div class="card-frame">
      <div class="card-paper"></div>
      <div class="card-inner-border"></div>
    </div>

    <!-- 顶部名称带 -->
    <div class="card-name-band">
      <div class="card-name">{{ joker.name }}</div>
    </div>

    <!-- 中央像素插画 -->
    <div class="card-art">
      <component :is="`art-${artType}`" />
      <!-- art slot：根据 artType 渲染对应像素图案 -->
      <div class="art-stage" :class="`art-${artType}`">
        <!-- Jimbo 主小丑 -->
        <template v-if="artType === 'jimbo'">
          <div class="px-hat px-hat-left"></div>
          <div class="px-hat px-hat-mid"></div>
          <div class="px-hat px-hat-right"></div>
          <div class="px-bell px-bell-l"></div>
          <div class="px-bell px-bell-r"></div>
          <div class="px-face"></div>
          <div class="px-eye px-eye-l"></div>
          <div class="px-eye px-eye-r"></div>
          <div class="px-cheek px-cheek-l"></div>
          <div class="px-cheek px-cheek-r"></div>
          <div class="px-mouth"></div>
          <div class="px-collar"></div>
        </template>

        <!-- 花色系列 -->
        <template v-else-if="artType.startsWith('suit-')">
          <div class="px-face suit"></div>
          <div class="px-eye px-eye-l"></div>
          <div class="px-eye px-eye-r"></div>
          <div class="px-mouth small"></div>
          <div class="px-suit-icon">
            <span v-if="artType === 'suit-heart'">♥</span>
            <span v-else-if="artType === 'suit-diamond'">♦</span>
            <span v-else-if="artType === 'suit-club'">♣</span>
            <span v-else-if="artType === 'suit-spade'">♠</span>
          </div>
        </template>

        <!-- 表情系列 -->
        <template v-else-if="['smile', 'wink', 'angry', 'tongue', 'fish', 'glasses', 'smiley', 'skull', 'duo', 'trio', 'order'].includes(artType)">
          <div class="px-face"></div>
          <!-- 眼睛 -->
          <div v-if="artType === 'wink'" class="px-eye px-eye-l closed"></div>
          <div v-else class="px-eye px-eye-l"></div>
          <div class="px-eye px-eye-r"></div>
          <!-- 眼镜 -->
          <template v-if="artType === 'glasses'">
            <div class="px-glasses-l"></div>
            <div class="px-glasses-r"></div>
            <div class="px-glasses-bridge"></div>
          </template>
          <!-- 骷髅 -->
          <template v-if="artType === 'skull'">
            <div class="px-skull-eye px-skull-l"></div>
            <div class="px-skull-eye px-skull-r"></div>
            <div class="px-skull-tooth"></div>
          </template>
          <!-- 嘴巴 -->
          <div v-if="artType === 'smile' || artType === 'smiley'" class="px-mouth smile"></div>
          <div v-else-if="artType === 'angry'" class="px-mouth angry"></div>
          <div v-else-if="artType === 'tongue'" class="px-mouth tongue"></div>
          <div v-else-if="artType === 'fish'" class="px-mouth fish"></div>
          <div v-else-if="artType === 'wink'" class="px-mouth small"></div>
          <!-- 二/三/秩序 数字标记 -->
          <div v-if="artType === 'duo'" class="px-badge">2</div>
          <div v-if="artType === 'trio'" class="px-badge">3</div>
          <div v-if="artType === 'order'" class="px-badge">★</div>
        </template>

        <!-- 偶/奇数 -->
        <template v-else-if="artType === 'even' || artType === 'odd'">
          <div class="px-face"></div>
          <div class="px-eye px-eye-l"></div>
          <div class="px-eye px-eye-r"></div>
          <div class="px-mouth small"></div>
          <div class="px-num-row">
            <span v-if="artType === 'even'">2 4 6</span>
            <span v-else>1 3 5</span>
          </div>
        </template>

        <!-- 抽象 / 半身 -->
        <template v-else-if="artType === 'abstract'">
          <div class="px-abstract-1"></div>
          <div class="px-abstract-2"></div>
          <div class="px-abstract-3"></div>
        </template>
        <template v-else-if="artType === 'half'">
          <div class="px-face half"></div>
          <div class="px-eye px-eye-r"></div>
          <div class="px-mouth small half-mouth"></div>
        </template>

        <!-- 斐波那契螺旋 -->
        <template v-else-if="artType === 'spiral'">
          <div class="px-spiral-1"></div>
          <div class="px-spiral-2"></div>
          <div class="px-spiral-3"></div>
          <div class="px-spiral-core"></div>
        </template>

        <!-- 学者书 -->
        <template v-else-if="artType === 'book'">
          <div class="px-book"></div>
          <div class="px-book-line px-book-line-1"></div>
          <div class="px-book-line px-book-line-2"></div>
          <div class="px-book-line px-book-line-3"></div>
        </template>

        <!-- 对讲机 -->
        <template v-else-if="artType === 'radio'">
          <div class="px-radio"></div>
          <div class="px-radio-antenna"></div>
          <div class="px-radio-button"></div>
          <div class="px-radio-grill"></div>
        </template>

        <!-- 公车 -->
        <template v-else-if="artType === 'bus'">
          <div class="px-bus"></div>
          <div class="px-bus-window"></div>
          <div class="px-bus-wheel px-bus-wheel-l"></div>
          <div class="px-bus-wheel px-bus-wheel-r"></div>
        </template>

        <!-- 王冠 -->
        <template v-else-if="artType === 'crown'">
          <div class="px-crown"></div>
          <div class="px-crown-jewel"></div>
          <div class="px-face crown-face"></div>
          <div class="px-eye px-eye-l"></div>
          <div class="px-eye px-eye-r"></div>
          <div class="px-mouth small"></div>
        </template>

        <!-- 终极小丑 / Jester -->
        <template v-else-if="artType === 'jester'">
          <div class="px-hat px-hat-left big"></div>
          <div class="px-hat px-hat-mid big"></div>
          <div class="px-hat px-hat-right big"></div>
          <div class="px-bell px-bell-l shine"></div>
          <div class="px-bell px-bell-r shine"></div>
          <div class="px-face golden"></div>
          <div class="px-eye px-eye-l shine"></div>
          <div class="px-eye px-eye-r shine"></div>
          <div class="px-mouth smile"></div>
          <div class="px-collar gold"></div>
          <div class="px-sparkle px-sparkle-1"></div>
          <div class="px-sparkle px-sparkle-2"></div>
        </template>
      </div>
    </div>

    <!-- 底部描述 -->
    <div class="card-desc-band">
      <div class="card-desc">{{ joker.description }}</div>
    </div>

    <!-- 稀有度边角标记（角落小三角，颜色对应稀有度） -->
    <div class="card-corner card-corner-tl"></div>
    <div class="card-corner card-corner-tr"></div>
    <div class="card-corner card-corner-bl"></div>
    <div class="card-corner card-corner-br"></div>

    <!-- Tooltip（悬停显示稀有度）-->
    <div v-if="showTooltip" class="card-tooltip">
      <span class="tooltip-rarity">{{ rarityLabel }}</span>
    </div>
  </div>
</template>

<style scoped>
/* ========== 卡片本体 ========== */
.joker-card {
  position: relative;
  width: 86px;
  height: 116px;
  cursor: pointer;
  user-select: none;
  font-family: 'Press Start 2P', 'VT323', monospace;
  transition: transform 0.18s ease, filter 0.18s ease;
  --rarity: #6cb4d3;
}

.joker-card.size-small {
  width: 72px;
  height: 96px;
}
.joker-card.size-shop {
  width: 220px;
  height: 304px;
}

.joker-card:hover:not(.empty) {
  transform: translateY(-4px) scale(1.04);
  filter: drop-shadow(0 0 10px var(--rarity));
}

/* 多层卡框（仿原作的纸质纸边 + 双层描边）*/
.card-frame {
  position: absolute;
  inset: 0;
  border-radius: 8px;
  background:
    linear-gradient(180deg, #f7e9c4 0%, #e9d6a4 50%, #d6bd84 100%);
  border: 2px solid #1a0f24;
  box-shadow:
    inset 0 0 0 2px var(--rarity),
    inset 0 0 0 4px #f7e9c4,
    0 4px 0 rgba(0,0,0,.55);
  overflow: hidden;
}

.card-paper {
  position: absolute;
  inset: 4px;
  background:
    repeating-linear-gradient(0deg, rgba(0,0,0,0.025) 0 1px, transparent 1px 3px),
    repeating-linear-gradient(90deg, rgba(0,0,0,0.025) 0 1px, transparent 1px 3px),
    radial-gradient(circle at 30% 20%, rgba(255,255,255,.5), transparent 60%);
  border-radius: 4px;
}

.card-inner-border {
  position: absolute;
  inset: 6px;
  border: 1px dashed rgba(26,15,36,.3);
  border-radius: 3px;
  pointer-events: none;
}

/* ========== 顶部名称带 ========== */
.card-name-band {
  position: absolute;
  top: 6px;
  left: 6px;
  right: 6px;
  height: 18px;
  background: linear-gradient(180deg, #2a1a3f, #160a23);
  border: 1px solid #000;
  border-radius: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 4;
  box-shadow: 0 1px 0 rgba(255,255,255,.06) inset;
}
.card-name {
  font-size: 6px;
  font-weight: 400;
  color: #ffd166;
  letter-spacing: 0.4px;
  text-shadow: 1px 1px 0 #000, 0 0 6px rgba(255,209,102,.6);
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0 2px;
}
.size-small .card-name { font-size: 5px; }
.size-shop .card-name-band {
  height: 36px;
  top: 14px;
  left: 22px;
  right: 22px;
  border-radius: 4px;
  z-index: 6;
}
.size-shop .card-name {
  font-size: 14px;
  letter-spacing: 1px;
  padding: 0 6px;
}

/* ========== 像素插画区 ========== */
.card-art {
  position: absolute;
  top: 26px;
  left: 6px;
  right: 6px;
  height: 56px;
  z-index: 3;
  background:
    radial-gradient(ellipse at center, #fff8e1 0%, #f0e2b8 70%, #d6bd84 100%);
  border-radius: 3px;
  box-shadow: inset 0 0 0 1px rgba(26,15,36,.35);
  overflow: hidden;
}
.size-small .card-art { height: 44px; top: 22px; }
.size-shop .card-art {
  top: 56px;
  left: 12px;
  right: 12px;
  height: 160px;
  border-radius: 6px;
}

.art-stage {
  position: relative;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
}

/* ----- 通用像素元件（采用 box-shadow 模拟像素方块）----- */

/* 脸 */
.px-face {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 32px;
  height: 26px;
  background: #f7d5a1;
  border: 2px solid #1a0f24;
  border-radius: 4px;
  transform: translate(-50%, -40%);
  box-shadow: inset 0 -4px 0 rgba(0,0,0,.08);
}
.px-face.suit { background: #ffe7b8; }
.px-face.golden { background: #ffd166; box-shadow: inset 0 -4px 0 rgba(0,0,0,.1), 0 0 8px rgba(255,209,102,.4); }
.px-face.crown-face { transform: translate(-50%, -25%); }
.px-face.half { width: 16px; border-right: 0; border-radius: 4px 0 0 4px; }

/* 帽子三角（菱形帽尖）*/
.px-hat {
  position: absolute;
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-bottom: 10px solid #2a1a3f;
}
.px-hat.big {
  border-left-width: 7px;
  border-right-width: 7px;
  border-bottom-width: 12px;
  border-bottom-color: #4b2a72;
  filter: drop-shadow(0 0 4px rgba(181,119,255,.6));
}
.px-hat-left  { left: 18%; top: 6%; transform: rotate(-22deg); }
.px-hat-mid   { left: 50%; top: 0%; transform: translateX(-50%); }
.px-hat-right { right: 18%; top: 6%; transform: rotate(22deg); }

/* 帽子铃铛 */
.px-bell {
  position: absolute;
  width: 5px;
  height: 5px;
  background: #ffd166;
  border: 1px solid #1a0f24;
  border-radius: 50%;
  box-shadow: 0 0 4px rgba(255,209,102,.8);
}
.px-bell.shine { background: #ffe580; box-shadow: 0 0 6px rgba(255,209,102,1); }
.px-bell-l { left: 14%; top: 14%; }
.px-bell-r { right: 14%; top: 14%; }

/* 眼睛 */
.px-eye {
  position: absolute;
  top: 42%;
  width: 4px;
  height: 4px;
  background: #1a0f24;
  border-radius: 1px;
  z-index: 2;
}
.px-eye.shine { background: #1a0f24; box-shadow: 0 0 4px #fff; }
.px-eye.closed { height: 1px; top: 44%; background: #1a0f24; }
.px-eye-l { left: 36%; }
.px-eye-r { right: 36%; }

/* 腮红 */
.px-cheek {
  position: absolute;
  top: 54%;
  width: 5px;
  height: 3px;
  background: #ef476f;
  opacity: 0.5;
  border-radius: 50%;
}
.px-cheek-l { left: 28%; }
.px-cheek-r { right: 28%; }

/* 嘴 */
.px-mouth {
  position: absolute;
  bottom: 24%;
  left: 50%;
  width: 10px;
  height: 3px;
  background: #1a0f24;
  border-radius: 1px;
  transform: translateX(-50%);
  z-index: 2;
}
.px-mouth.smile {
  height: 5px;
  border-radius: 0 0 6px 6px;
  border-top: 0;
}
.px-mouth.small { width: 6px; height: 2px; }
.px-mouth.angry {
  width: 8px;
  height: 3px;
  background: #ef476f;
  transform: translateX(-50%) rotate(180deg);
  border-radius: 0 0 4px 4px;
}
.px-mouth.tongue {
  width: 8px;
  height: 6px;
  background: #ef476f;
  border-radius: 0 0 4px 4px;
}
.px-mouth.fish {
  width: 6px;
  height: 6px;
  background: transparent;
  border: 2px solid #1a0f24;
  border-radius: 50%;
}
.px-mouth.half-mouth { transform: translateX(-100%); width: 4px; }

/* 衣领 */
.px-collar {
  position: absolute;
  bottom: 4%;
  left: 50%;
  width: 26px;
  height: 6px;
  background:
    linear-gradient(90deg, #ef476f 0 33%, #ffd166 33% 66%, #38c5ff 66%);
  border: 1px solid #1a0f24;
  border-radius: 1px;
  transform: translateX(-50%);
}
.px-collar.gold {
  background: linear-gradient(90deg, #ffd166, #ffe580, #ffd166);
  box-shadow: 0 0 6px rgba(255,209,102,.8);
}

/* 花色图标 */
.px-suit-icon {
  position: absolute;
  bottom: 4%;
  right: 6%;
  font-family: serif;
  font-size: 14px;
  z-index: 4;
  text-shadow: 1px 1px 0 #000;
}
.art-suit-heart .px-suit-icon span,
.art-suit-diamond .px-suit-icon span { color: #d6234a; }
.art-suit-club .px-suit-icon span,
.art-suit-spade .px-suit-icon span { color: #1a0f24; }

/* 眼镜 */
.px-glasses-l, .px-glasses-r {
  position: absolute;
  top: 40%;
  width: 8px;
  height: 8px;
  border: 2px solid #1a0f24;
  border-radius: 50%;
  z-index: 3;
}
.px-glasses-l { left: 30%; }
.px-glasses-r { right: 30%; }
.px-glasses-bridge {
  position: absolute;
  top: 46%;
  left: 50%;
  width: 6px;
  height: 1px;
  background: #1a0f24;
  transform: translateX(-50%);
  z-index: 3;
}

/* 骷髅 */
.px-skull-eye {
  position: absolute;
  top: 38%;
  width: 6px;
  height: 7px;
  background: #1a0f24;
  border-radius: 50%;
  z-index: 3;
}
.px-skull-l { left: 32%; }
.px-skull-r { right: 32%; }
.px-skull-tooth {
  position: absolute;
  bottom: 22%;
  left: 50%;
  width: 12px;
  height: 4px;
  background: repeating-linear-gradient(90deg, #1a0f24 0 2px, #f7d5a1 2px 3px);
  transform: translateX(-50%);
  z-index: 3;
}

/* badge（数字徽章）*/
.px-badge {
  position: absolute;
  top: 6%;
  right: 8%;
  font-size: 8px;
  font-family: 'Press Start 2P', monospace;
  color: #ffd166;
  text-shadow: 1px 1px 0 #000;
  z-index: 5;
}

/* 数字行（偶/奇数）*/
.px-num-row {
  position: absolute;
  bottom: 6%;
  left: 50%;
  transform: translateX(-50%);
  font-family: 'Press Start 2P', monospace;
  font-size: 6px;
  color: #ef476f;
  text-shadow: 1px 1px 0 #fff;
  letter-spacing: 1px;
  z-index: 4;
}

/* 抽象（几何）*/
.px-abstract-1 {
  position: absolute;
  top: 20%;
  left: 20%;
  width: 18px;
  height: 18px;
  background: #ef476f;
  transform: rotate(45deg);
  border: 2px solid #1a0f24;
}
.px-abstract-2 {
  position: absolute;
  top: 30%;
  right: 18%;
  width: 12px;
  height: 12px;
  background: #38c5ff;
  border-radius: 50%;
  border: 2px solid #1a0f24;
}
.px-abstract-3 {
  position: absolute;
  bottom: 14%;
  left: 36%;
  width: 14px;
  height: 8px;
  background: #ffd166;
  border: 2px solid #1a0f24;
}

/* 斐波那契螺旋 */
.px-spiral-1, .px-spiral-2, .px-spiral-3 {
  position: absolute;
  top: 50%;
  left: 50%;
  border: 2px solid #1a0f24;
  border-radius: 50%;
  transform: translate(-50%, -50%);
}
.px-spiral-1 { width: 36px; height: 36px; border-color: #b388ff; border-right-color: transparent; }
.px-spiral-2 { width: 24px; height: 24px; border-color: #38c5ff; border-bottom-color: transparent; }
.px-spiral-3 { width: 14px; height: 14px; border-color: #ffd166; border-left-color: transparent; }
.px-spiral-core {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 4px;
  height: 4px;
  background: #ef476f;
  border-radius: 50%;
  transform: translate(-50%, -50%);
}

/* 学者书 */
.px-book {
  position: absolute;
  top: 20%;
  left: 50%;
  width: 30px;
  height: 30px;
  background: linear-gradient(180deg, #b388ff, #6b3fa0);
  border: 2px solid #1a0f24;
  transform: translateX(-50%);
}
.px-book-line {
  position: absolute;
  left: 50%;
  height: 1px;
  background: #ffd166;
  transform: translateX(-50%);
}
.px-book-line-1 { top: 30%; width: 18px; }
.px-book-line-2 { top: 40%; width: 14px; }
.px-book-line-3 { top: 50%; width: 16px; }

/* 对讲机 */
.px-radio {
  position: absolute;
  top: 28%;
  left: 50%;
  width: 24px;
  height: 30px;
  background: linear-gradient(180deg, #2a1a3f, #160a23);
  border: 2px solid #1a0f24;
  border-radius: 2px;
  transform: translateX(-50%);
}
.px-radio-antenna {
  position: absolute;
  top: 6%;
  left: 50%;
  width: 1px;
  height: 12px;
  background: #1a0f24;
  transform: translateX(50%);
}
.px-radio-button {
  position: absolute;
  top: 36%;
  left: 50%;
  width: 6px;
  height: 6px;
  background: #ef476f;
  border-radius: 50%;
  transform: translateX(-50%);
  border: 1px solid #1a0f24;
}
.px-radio-grill {
  position: absolute;
  bottom: 20%;
  left: 50%;
  width: 14px;
  height: 8px;
  background: repeating-linear-gradient(0deg, #ffd166 0 1px, transparent 1px 3px);
  transform: translateX(-50%);
}

/* 公车 */
.px-bus {
  position: absolute;
  top: 30%;
  left: 50%;
  width: 36px;
  height: 22px;
  background: linear-gradient(180deg, #ffd166, #f08a3a);
  border: 2px solid #1a0f24;
  border-radius: 4px 6px 2px 2px;
  transform: translateX(-50%);
}
.px-bus-window {
  position: absolute;
  top: 36%;
  left: 50%;
  width: 24px;
  height: 8px;
  background: #5ac8fa;
  border: 1px solid #1a0f24;
  transform: translateX(-50%);
}
.px-bus-wheel {
  position: absolute;
  bottom: 18%;
  width: 8px;
  height: 8px;
  background: #1a0f24;
  border-radius: 50%;
}
.px-bus-wheel-l { left: 28%; }
.px-bus-wheel-r { right: 28%; }

/* 王冠 */
.px-crown {
  position: absolute;
  top: 6%;
  left: 50%;
  width: 30px;
  height: 12px;
  background:
    linear-gradient(180deg, #ffd166 0%, #f08a3a 100%);
  border: 2px solid #1a0f24;
  transform: translateX(-50%);
  clip-path: polygon(0 100%, 0 40%, 15% 0, 30% 60%, 50% 0, 70% 60%, 85% 0, 100% 40%, 100% 100%);
}
.px-crown-jewel {
  position: absolute;
  top: 8%;
  left: 50%;
  width: 4px;
  height: 4px;
  background: #ef476f;
  border-radius: 50%;
  transform: translateX(-50%);
  z-index: 4;
  box-shadow: 0 0 4px #ef476f;
}

/* 闪光 */
.px-sparkle {
  position: absolute;
  width: 4px;
  height: 4px;
  background: #fff;
  clip-path: polygon(50% 0, 60% 40%, 100% 50%, 60% 60%, 50% 100%, 40% 60%, 0 50%, 40% 40%);
  z-index: 5;
  animation: sparkle-pulse 1.6s ease-in-out infinite;
}
.px-sparkle-1 { top: 10%; right: 8%; }
.px-sparkle-2 { bottom: 14%; left: 10%; animation-delay: 0.6s; }

@keyframes sparkle-pulse {
  0%, 100% { opacity: 0.4; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.4); }
}

/* ========== 底部描述带 ========== */
.card-desc-band {
  position: absolute;
  bottom: 6px;
  left: 6px;
  right: 6px;
  height: 24px;
  background: linear-gradient(180deg, #fff8e1, #f0e2b8);
  border: 1px solid rgba(26,15,36,.5);
  border-radius: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1px 3px;
  z-index: 4;
}
.card-desc {
  font-family: 'VT323', 'Press Start 2P', monospace;
  font-size: 9px;
  font-weight: 600;
  color: #1a0f24;
  text-align: center;
  line-height: 1.05;
  word-break: break-word;
}
.size-small .card-desc { font-size: 8px; }
.size-shop .card-desc-band {
  height: 60px;
  bottom: 12px;
  left: 12px;
  right: 12px;
  padding: 6px 10px;
  border-radius: 4px;
}
.size-shop .card-desc {
  font-size: 16px;
  line-height: 1.15;
}

/* ========== size-shop 像素元素放大覆盖 ========== */
/* 卡片放大到 220×304 后，内部固定像素元素需要按比例放大保持视觉协调 */
.size-shop .px-face {
  width: 64px;
  height: 52px;
  border-width: 3px;
  border-radius: 6px;
}
.size-shop .px-face.half { width: 32px; }
.size-shop .px-eye {
  width: 7px;
  height: 7px;
  border-radius: 2px;
}
.size-shop .px-eye.closed { height: 2px; }
.size-shop .px-cheek {
  width: 10px;
  height: 5px;
}
.size-shop .px-mouth {
  width: 18px;
  height: 5px;
}
.size-shop .px-mouth.smile {
  height: 9px;
  border-radius: 0 0 10px 10px;
}
.size-shop .px-mouth.small { width: 11px; height: 3px; }
.size-shop .px-mouth.angry { width: 14px; height: 5px; }
.size-shop .px-mouth.tongue { width: 14px; height: 10px; border-radius: 0 0 7px 7px; }
.size-shop .px-mouth.fish {
  width: 11px;
  height: 11px;
  border-width: 3px;
}
.size-shop .px-collar {
  width: 50px;
  height: 11px;
  border-width: 2px;
}
.size-shop .px-bell {
  width: 9px;
  height: 9px;
  border-width: 2px;
}
.size-shop .px-hat {
  border-left-width: 11px;
  border-right-width: 11px;
  border-bottom-width: 18px;
}
.size-shop .px-hat.big {
  border-left-width: 13px;
  border-right-width: 13px;
  border-bottom-width: 21px;
}
.size-shop .px-suit-icon { font-size: 26px; }
.size-shop .px-glasses-l,
.size-shop .px-glasses-r {
  width: 14px;
  height: 14px;
  border-width: 3px;
}
.size-shop .px-glasses-bridge {
  width: 10px;
  height: 2px;
}
.size-shop .px-skull-eye {
  width: 11px;
  height: 13px;
}
.size-shop .px-skull-tooth {
  width: 22px;
  height: 7px;
}
.size-shop .px-badge { font-size: 14px; }
.size-shop .px-num-row { font-size: 12px; }
.size-shop .px-abstract-1 {
  width: 32px;
  height: 32px;
  border-width: 3px;
}
.size-shop .px-abstract-2 {
  width: 22px;
  height: 22px;
  border-width: 3px;
}
.size-shop .px-abstract-3 {
  width: 26px;
  height: 14px;
  border-width: 3px;
}
.size-shop .px-spiral-1 { width: 64px; height: 64px; border-width: 3px; }
.size-shop .px-spiral-2 { width: 42px; height: 42px; border-width: 3px; }
.size-shop .px-spiral-3 { width: 24px; height: 24px; border-width: 3px; }
.size-shop .px-spiral-core { width: 7px; height: 7px; }
.size-shop .px-book {
  width: 54px;
  height: 54px;
  border-width: 3px;
}
.size-shop .px-book-line { height: 2px; }
.size-shop .px-book-line-1 { width: 32px; }
.size-shop .px-book-line-2 { width: 24px; }
.size-shop .px-book-line-3 { width: 28px; }
.size-shop .px-radio {
  width: 42px;
  height: 54px;
  border-width: 3px;
}
.size-shop .px-radio-antenna {
  width: 2px;
  height: 22px;
}
.size-shop .px-radio-button {
  width: 11px;
  height: 11px;
  border-width: 2px;
}
.size-shop .px-radio-grill {
  width: 24px;
  height: 14px;
}
.size-shop .px-bus {
  width: 64px;
  height: 40px;
  border-width: 3px;
}
.size-shop .px-bus-window {
  width: 42px;
  height: 14px;
  border-width: 2px;
}
.size-shop .px-bus-wheel {
  width: 14px;
  height: 14px;
}
.size-shop .px-crown {
  width: 54px;
  height: 22px;
  border-width: 3px;
}
.size-shop .px-crown-jewel {
  width: 7px;
  height: 7px;
}
.size-shop .px-sparkle {
  width: 7px;
  height: 7px;
}

/* ========== 角落稀有度三角 ========== */
.card-corner {
  position: absolute;
  width: 0;
  height: 0;
  z-index: 5;
  pointer-events: none;
}
.card-corner-tl {
  top: 0;
  left: 0;
  border-top: 8px solid var(--rarity);
  border-right: 8px solid transparent;
}
.card-corner-tr {
  top: 0;
  right: 0;
  border-top: 8px solid var(--rarity);
  border-left: 8px solid transparent;
}
.card-corner-bl {
  bottom: 0;
  left: 0;
  border-bottom: 8px solid var(--rarity);
  border-right: 8px solid transparent;
}
.card-corner-br {
  bottom: 0;
  right: 0;
  border-bottom: 8px solid var(--rarity);
  border-left: 8px solid transparent;
}
.size-shop .card-corner-tl {
  border-top-width: 12px;
  border-right-width: 12px;
}
.size-shop .card-corner-tr {
  border-top-width: 12px;
  border-left-width: 12px;
}
.size-shop .card-corner-bl {
  border-bottom-width: 12px;
  border-right-width: 12px;
}
.size-shop .card-corner-br {
  border-bottom-width: 12px;
  border-left-width: 12px;
}

/* ========== 稀有度光晕（外发光）========== */
.joker-card.rarity-uncommon .card-frame {
  box-shadow:
    inset 0 0 0 2px #5bc97a,
    inset 0 0 0 4px #f7e9c4,
    0 0 8px rgba(91,201,122,.4),
    0 4px 0 rgba(0,0,0,.55);
}
.joker-card.rarity-rare .card-frame {
  box-shadow:
    inset 0 0 0 2px #e34b6f,
    inset 0 0 0 4px #f7e9c4,
    0 0 12px rgba(227,75,111,.5),
    0 4px 0 rgba(0,0,0,.55);
}
.joker-card.rarity-legendary .card-frame {
  box-shadow:
    inset 0 0 0 2px #b577ff,
    inset 0 0 0 4px #f7e9c4,
    0 0 16px rgba(181,119,255,.7),
    0 4px 0 rgba(0,0,0,.55);
  animation:
    legendary-pulse-aura 1.2s ease-in-out infinite,
    legendary-hue 2.4s linear infinite;
}
@keyframes legendary-pulse-aura {
  0%, 100% {
    box-shadow:
      inset 0 0 0 2px #b577ff,
      inset 0 0 0 4px #f7e9c4,
      0 0 12px rgba(181,119,255,.5),
      0 4px 0 rgba(0,0,0,.55);
  }
  50% {
    box-shadow:
      inset 0 0 0 2px #d3a8ff,
      inset 0 0 0 4px #fff5d0,
      0 0 28px 4px rgba(181,119,255,1),
      0 4px 0 rgba(0,0,0,.55);
  }
}
@keyframes legendary-hue {
  0%, 100% { filter: hue-rotate(-60deg); }
  50%      { filter: hue-rotate(60deg); }
}

/* ========== 空槽 ========== */
.joker-card.empty {
  background:
    repeating-linear-gradient(45deg, rgba(255,255,255,.04) 0 6px, rgba(255,255,255,.08) 6px 12px);
  border: 2px dashed rgba(255,255,255,.18);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  cursor: default;
}
.empty-plus {
  font-family: 'Press Start 2P', monospace;
  font-size: 18px;
  color: rgba(255,255,255,.25);
}
.empty-label {
  font-family: 'Press Start 2P', monospace;
  font-size: 6px;
  color: rgba(255,255,255,.35);
  letter-spacing: 1px;
}

/* ========== Tooltip ========== */
.card-tooltip {
  position: absolute;
  top: -8px;
  right: -8px;
  z-index: 10;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.18s ease;
}
.joker-card:hover .card-tooltip { opacity: 1; }
.tooltip-rarity {
  font-family: 'Press Start 2P', monospace;
  font-size: 6px;
  padding: 3px 5px;
  background: var(--rarity);
  color: #fff;
  border: 1px solid #000;
  border-radius: 2px;
  text-shadow: 1px 1px 0 rgba(0,0,0,.6);
  white-space: nowrap;
  letter-spacing: 0.5px;
}

/* ========== 响应式 ========== */
@media (max-width: 768px) {
  .joker-card {
    width: 76px;
    height: 102px;
  }
  .card-art { height: 48px; }
  .card-desc { font-size: 8px; }
}

/* ========== v3.1.0：商店建议推荐高亮 ========== */

/* buy：金色描边 + 脉冲动画（AI 推荐购买） */
.joker-card.is-recommended-buy {
  outline: 3px solid var(--gold, #ffd166);
  outline-offset: 2px;
  box-shadow: 0 0 18px 4px rgba(255, 209, 102, .55);
  animation: joker-recommend-pulse 1.6s ease-in-out infinite;
}

/* sell：红色描边（AI 推荐卖出，无脉冲以区别 buy） */
.joker-card.is-recommended-sell {
  outline: 3px solid var(--danger, #e34b6f);
  outline-offset: 2px;
  box-shadow: 0 0 18px 4px rgba(227, 75, 111, .55);
  animation: joker-recommend-pulse-sell 1.6s ease-in-out infinite;
}

@keyframes joker-recommend-pulse {
  0%, 100% { box-shadow: 0 0 12px 2px rgba(255, 209, 102, .4); }
  50%      { box-shadow: 0 0 22px 6px rgba(255, 209, 102, .85); }
}

@keyframes joker-recommend-pulse-sell {
  0%, 100% { box-shadow: 0 0 12px 2px rgba(227, 75, 111, .4); }
  50%      { box-shadow: 0 0 22px 6px rgba(227, 75, 111, .85); }
}
</style>
