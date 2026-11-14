import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/store/user'

const routes = [
  {
    path: '/',
    component: () => import('@/views/Layout.vue'),
    redirect: '/dashboard',
    meta: { requiresAuth: true },
    children: [
      {
        path: 'dashboard',
        name: 'Dashboard',
        component: () => import('@/views/dashboard/index.vue'),
        meta: { title: '控制面板', requiresAuth: true }
      },
      {
        path: 'twin',
        name: 'DigitalTwin',
        redirect: to => ({ path: '/control', query: { ...to.query, mode: 'twin' }, hash: to.hash })
      },
      {
        path: 'monitor',
        name: 'Monitor',
        component: () => import('@/views/monitor/index.vue'),
        meta: { title: '环境监测', requiresAuth: true }
      },
      {
        path: 'control',
        name: 'Control',
        component: () => import('@/views/control/index.vue'),
        meta: { title: '设备控制', requiresAuth: true }
      },
      {
        path: 'alerts',
        name: 'Alerts',
        component: () => import('@/views/alerts/index.vue'),
        meta: { title: '警报管理', requiresAuth: true }
      },
      {
        path: 'data',
        name: 'Data',
        component: () => import('@/views/data/index.vue'),
        meta: { title: '数据分析', requiresAuth: true }
      },
      {
        path: 'users',
        name: 'Users',
        component: () => import('@/views/users/index.vue'),
        meta: { 
          title: '人员管理', 
          requiresAuth: true,
          requiresAdmin: true 
        }
      },
      {
        path: 'profile',
        name: 'Profile',
        component: () => import('@/views/profile/index.vue'),
        meta: { title: '个人信息', requiresAuth: true }
      },
      {
        path: 'history',
        name: 'History',
        component: () => import('@/components/HistoryData.vue'),
        meta: { title: '历史数据', requiresAuth: true }
      },
      {
        path: 'debug',
        name: 'Debug',
        component: () => import('@/views/debug/ApiDebug.vue'),
        meta: { title: 'API调试', requiresAuth: true }
      }
    ]
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/login/index.vue'),
    meta: { title: '登录', requiresAuth: false }
  },
  // 添加404路由
  {
    path: '/:pathMatch(.*)*',
    redirect: '/login'
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// 简化路由守卫逻辑，避免过多的异步操作
router.beforeEach((to, from, next) => {
  // 设置页面标题
  document.title = to.meta.title ? `${to.meta.title} - 智能农业监控系统` : '智能农业监控系统'
  
  console.log(`路由跳转: ${from.path} -> ${to.path}`)
  
  // 检查是否需要登录验证
  const requiresAuth = to.matched.some(record => record.meta.requiresAuth !== false)
  const requiresAdmin = to.matched.some(record => record.meta.requiresAdmin)
  
  // 从localStorage获取token
  const token = localStorage.getItem('access_token')
  const hasToken = !!token
  
  // 获取用户角色
  const userStore = useUserStore()
  const isAdmin = userStore.userRole === 'admin'
  
  console.log('路由守卫检查: token存在?', hasToken, '当前路径:', to.path)
  
  // 不需要登录的路由直接放行
  if (!requiresAuth) {
    if (to.path === '/login' && hasToken) {
      console.log('已登录用户访问登录页，重定向到首页')
      next({ path: '/' })
    } else {
      next()
    }
    return
  }
  
  // 需要登录但没有token，重定向到登录页
  if (!hasToken) {
    console.log('需要登录但未登录，重定向到登录页')
    next({ path: '/login', query: { redirect: to.fullPath } })
    return
  }
  
  // 检查管理员权限
  if (requiresAdmin && !isAdmin) {
    console.log('需要管理员权限但用户不是管理员')
    next({ path: '/' })
    return
  }
  
  // 已登录且访问登录页，重定向到首页
  if (to.path === '/login') {
    next({ path: '/' })
    return
  }
  
  // 已登录且访问其他页面，直接放行
  next()
})

export default router 