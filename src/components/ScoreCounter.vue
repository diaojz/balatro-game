<script setup>
import { ref, watch } from 'vue'
import gsap from 'gsap'

const props = defineProps({
  value: { type: Number, required: true },
  duration: { type: Number, default: 0.8 }
})

const tweenObj = ref({ value: props.value })
const displayValue = ref(props.value)

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
      }
    })
  }
)
</script>

<template>
  <span>{{ displayValue }}</span>
</template>
