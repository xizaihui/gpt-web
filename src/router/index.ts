import type { App } from 'vue'
import type { RouteRecordRaw } from 'vue-router'
import { createRouter, createWebHashHistory } from 'vue-router'
import { setupPageGuard } from './permission'
import { ChatLayout } from '@/views/chat/layout'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Root',
    component: ChatLayout,
    redirect: '/chat',
    children: [
      {
        path: '/chat/:uuid?',
        name: 'Chat',
        component: () => import('@/views/chat/index.vue'),
      },
    ],
  },

  {
    path: '/admin',
    name: 'Admin',
    component: () => import('@/views/admin/Layout.vue'),
    redirect: '/admin/pool',
    children: [
      {
        path: 'pool',
        name: 'AdminPool',
        component: () => import('@/views/admin/Pool.vue'),
      },
      {
        path: 'claude-pool',
        name: 'AdminClaudePool',
        component: () => import('@/views/admin/ClaudePool.vue'),
      },
      {
        path: 'kiro-pool',
        name: 'AdminKiroPool',
        component: () => import('@/views/admin/KiroPool.vue'),
      },
      {
        path: 'clewdr-logs',
        name: 'AdminClewdrLogs',
        component: () => import('@/views/admin/ClewdrLogs.vue'),
      },
      {
        path: 'proxies',
        name: 'AdminProxies',
        component: () => import('@/views/admin/Proxies.vue'),
      },
      {
        path: 'logs',
        name: 'AdminLogs',
        component: () => import('@/views/admin/Logs.vue'),
      },
    ],
  },

  {
    path: '/404',
    name: '404',
    component: () => import('@/views/exception/404/index.vue'),
  },

  {
    path: '/500',
    name: '500',
    component: () => import('@/views/exception/500/index.vue'),
  },

  {
    path: '/:pathMatch(.*)*',
    name: 'notFound',
    redirect: '/404',
  },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ left: 0, top: 0 }),
})

setupPageGuard(router)

export async function setupRouter(app: App) {
  app.use(router)
  await router.isReady()
}
