import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'pre-stage-v2',
      component: () => import('../views/PreStageV2.vue'),
    },
    {
      path: '/pre-stage',
      name: 'pre-stage',
      component: () => import('../pages/PreStage.vue'),
    },
    {
      path: '/result-stage',
      name: 'result-stage',
      component: () => import('../pages/ResultStage.vue'),
    },
  ],
})

export default router
