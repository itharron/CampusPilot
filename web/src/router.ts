import { createRouter, createWebHistory } from 'vue-router';
import ChatPage from './pages/ChatPage.vue';
import UploadPage from './pages/UploadPage.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'chat', component: ChatPage },
    // 兼容 /chat 深链接：与首页渲染同一个对话页，导航仍指向 /。
    { path: '/chat', name: 'chat-alias', component: ChatPage },
    { path: '/upload', name: 'upload', component: UploadPage },
  ],
});
