import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 前端只访问同源的 /api，由 Vite 代理到后端 8787 端口。
// 浏览器侧永远不会直接接触后端进程，也看不到任何密钥。
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});
