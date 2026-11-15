import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 前端只访问同源的 /api，由 Vite 代理到后端 8787 端口。
// 浏览器侧永远不会直接接触后端进程，也看不到任何密钥。
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    // 演示时用 cloudflared / ngrok 临时隧道指向本机 5173，
    // 这些隧道域名要显式放行，否则 Vite 会以「host 不在白名单」返回 403
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok.io'],
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
