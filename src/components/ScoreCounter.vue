<script setup>
import { ref, watch } from 'vue'
import gsap from 'gsap'
import * as audio from '../utils/audio.js'

const props = defineProps({
  value: { type: Number, required: true },
  duration: { type: Number, default: 0.8 }
})

const tweenObj = ref({ value: props.value })
const displayValue = ref(props.value)

let lastTickAt = 0

watch(
  () => props.value,
  (newVal) => {
    gsap.to(tweenObj.value, {
      value: newVal,
      duration: props.duration,
      ease: 'power2.out',
      snap: { value: 1 },
      onUpdate: () => {
        displayValue.value = Math.floor(tweenObj.value.value)
        const now = performance.now()
        if (now - lastTickAt > 50) {
          audio.playSfx('scoreTick')
          lastTickAt = now
        }
      }
    })
  }
)
</script>

<template>
  <span>{{ displayValue }}</span>
</template>
