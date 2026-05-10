import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const host = process.env.TAURI_DEV_HOST

// GitHub Pages 部署时路由前缀
// 在 CI workflow 里显式设 VITE_BASE_PATH='/balatro-game/'，本地/Tauri 保持 '/'
const base = process.env.VITE_BASE_PATH || '/'

// Tauri 推荐配置：固定端口、禁用清屏、忽略 src-tauri 触发 HMR
export default defineConfig({
  base,
  plugins: [vue()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: 'ws', host, port: 1421 }
      : undefined,
    watch: { ignored: ['**/src-tauri/**'] }
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*']
})
