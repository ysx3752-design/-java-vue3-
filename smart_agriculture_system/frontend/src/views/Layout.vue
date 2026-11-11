<template>
  <el-container class="layout-container">
    <!-- 侧边栏 -->
    <el-aside :width="isCollapse ? '64px' : '200px'" class="sidebar-container">
      <div class="logo">
        <img src="@/assets/logo.svg" alt="Logo" class="logo-image">
        <span v-show="!isCollapse" class="logo-text">智能农业监控系统</span>
      </div>
      <el-menu
        :default-active="route.path"
        class="el-menu-vertical"
        :router="true"
        :collapse="isCollapse"
        background-color="#304156"
        text-color="#bfcbd9"
        active-text-color="#409EFF">
        <el-menu-item index="/dashboard" class="menu-item">
          <el-icon class="menu-icon"><Monitor /></el-icon>
          <span>控制面板</span>
        </el-menu-item>
        <el-menu-item index="/twin" class="menu-item">
          <el-icon class="menu-icon"><Box /></el-icon>
          <span>数字孪生</span>
        </el-menu-item>
        <el-menu-item index="/monitor" class="menu-item">
          <el-icon class="menu-icon"><DataLine /></el-icon>
          <span>环境监测</span>
        </el-menu-item>
        <el-menu-item index="/control" class="menu-item">
          <el-icon class="menu-icon"><Setting /></el-icon>
          <span>设备控制</span>
        </el-menu-item>
        <el-menu-item index="/alerts" class="menu-item">
          <el-icon class="menu-icon"><Bell /></el-icon>
          <span>警报管理</span>
        </el-menu-item>
        <el-menu-item index="/data" class="menu-item">
          <el-icon class="menu-icon"><Document /></el-icon>
          <span>数据分析</span>
        </el-menu-item>
        <el-menu-item index="/users" class="menu-item" v-if="userStore.userRole === 'admin'">
          <el-icon class="menu-icon"><User /></el-icon>
          <span>人员管理</span>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <!-- 主要内容区 -->
    <el-container class="main-container">
      <!-- 顶部导航栏 -->
      <el-header class="main-header">
        <div class="header-left">
          <el-icon class="toggle-sidebar" @click="toggleSidebar">
            <Fold v-if="!isCollapse" />
            <Expand v-else />
          </el-icon>
          <Breadcrumb />
        </div>
        <div class="header-right">
          <el-dropdown trigger="click">
            <span class="user-info">
              <el-avatar :size="32" :src="userStore.avatar" class="user-avatar" />
              <span>{{ userStore.username }}</span>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="handleProfile">个人信息</el-dropdown-item>
                <el-dropdown-item @click="handleLogout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <!-- 内容区 -->
      <el-main class="content-container">
        <router-view v-slot="{ Component }">
          <transition name="fade-transform" mode="out-in">
            <keep-alive>
              <component :is="Component" />
            </keep-alive>
          </transition>
        </router-view>
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { ref, onMounted, onBeforeMount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import Breadcrumb from '@/components/Breadcrumb.vue'
import { useUserStore } from '@/store/user'
import { getAvatarUrl } from '@/utils/common'
import gsap from 'gsap'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

// 获取需要的图标组件
const {
  Monitor,
  DataLine,
  Setting,
  Bell,
  Document,
  Fold,
  Expand,
  User,
  Box
} = ElementPlusIconsVue

const isCollapse = ref(false)

// 处理退出登录 - 改为同步函数
const handleLogout = () => {
  try {
    userStore.logout()
  } catch (error) {
    // 即使发生错误，也强制跳转到登录页
    router.push('/login')
  }
}

// 切换侧边栏
const toggleSidebar = () => {
  isCollapse.value = !isCollapse.value
  // 保存状态到本地存储，下次加载时保持相同状态
  localStorage.setItem('sidebar_collapsed', isCollapse.value ? '1' : '0')
}

// 处理个人信息
const handleProfile = () => {
  router.push('/profile')
}

// 预加载关键图标
onBeforeMount(() => {
  // 从本地存储恢复侧边栏状态
  const savedCollapsed = localStorage.getItem('sidebar_collapsed')
  if (savedCollapsed !== null) {
    isCollapse.value = savedCollapsed === '1'
  }
})

// 添加页面载入动画，但确保基本界面元素已显示
onMounted(() => {
  // 首先确保菜单项可见
  document.querySelectorAll('.menu-item').forEach(item => {
    item.style.opacity = '1'
    item.style.transform = 'translateX(0)'
  })
  
  // 使用更轻量的动画效果，减少渲染压力
  const timeline = gsap.timeline({
    defaults: { 
      duration: 0.3,  // 缩短动画时间
      ease: 'power1.out' // 使用更简单的缓动函数
    }
  })
  
  // 应用轻量级动画
  timeline.from('.sidebar-container', {
    x: -10,
    opacity: 0.8,
    duration: 0.3,
  }, 0)
  
  timeline.from('.main-header', {
    y: -10,
    opacity: 0.8,
    duration: 0.3
  }, 0)
  
  timeline.from('.content-container', {
    opacity: 0.8,
    duration: 0.3
  }, 0)
})
</script>

<style lang="scss" scoped>
.layout-container {
  height: 100vh;
  overflow: hidden;

  .sidebar-container {
    background-color: #304156;
    color: #bfcbd9;
    transition: width 0.3s cubic-bezier(0.34, 0.69, 0.1, 1);
    overflow: hidden;
    box-shadow: 2px 0 10px rgba(0, 0, 0, 0.1);
    z-index: 10;
    user-select: none;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;

    .logo {
      height: 60px;
      display: flex;
      align-items: center;
      padding: 0 16px;
      background-color: #2b3649;
      overflow: hidden;

      .logo-image {
        width: 32px;
        height: 32px;
        margin-right: 12px;
        transition: all 0.3s;
        filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.2));
      }

      .logo-text {
        color: #fff;
        font-size: 16px;
        font-weight: 600;
        white-space: nowrap;
        transition: all 0.3s;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
      }
    }

    .el-menu {
      border: none;
      text-rendering: optimizeLegibility;
    }
    
    .menu-icon {
      margin-right: 10px;
      transition: all 0.3s;
    }
    
    .menu-item {
      transition: all 0.3s;
      position: relative;
      overflow: hidden;
      font-weight: 500;
      /* 确保菜单项默认是可见的 */
      opacity: 1;
      transform: translateX(0);
      
      &::before {
        content: '';
        position: absolute;
        left: 0;
        top: 0;
        height: 100%;
        width: 4px;
        background-color: #409EFF;
        transform: scaleY(0);
        transition: transform 0.3s;
      }
      
      &:hover, &.is-active {
        .menu-icon {
          transform: translateZ(0);
          filter: drop-shadow(0 2px 8px rgba(64, 158, 255, 0.5));
        }
      }
      
      &.is-active::before {
        transform: scaleY(1);
      }
    }
  }

  .main-container {
    transition: all 0.3s;
    position: relative;
    
    .main-header {
      background-color: #fff;
      border-bottom: 1px solid #e6e6e6;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
      box-shadow: 0 1px 10px rgba(0, 0, 0, 0.05);
      position: relative;
      z-index: 2;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;

      .header-left {
        display: flex;
        align-items: center;

        .toggle-sidebar {
          font-size: 20px;
          cursor: pointer;
          margin-right: 20px;
          transition: all 0.3s;
          
          &:hover {
            transform: scale(1.1);
            filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.15));
          }
        }
      }

      .header-right {
        .user-info {
          display: flex;
          align-items: center;
          cursor: pointer;
          transition: all 0.3s;
          
          .user-avatar {
            transition: all 0.3s;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
          }

          span {
            margin-left: 8px;
            transition: all 0.3s;
          }
          
          &:hover {
            .user-avatar {
              transform: translateY(-2px);
              box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            }
            
            span {
              color: #409EFF;
            }
          }
        }
      }
    }

    .content-container {
      background-color: #f0f2f5;
      padding: 20px;
      overflow: auto;
      position: relative;
      z-index: 1;
      
      &::-webkit-scrollbar {
        width: 8px;
      }

      &::-webkit-scrollbar-track {
        background: #f1f1f1;
        border-radius: 4px;
      }

      &::-webkit-scrollbar-thumb {
        background: #c1c1c1;
        border-radius: 4px;
        
        &:hover {
          background: #a8a8a8;
        }
      }
    }
  }
}

// 路由切换动画 - 使用更轻量的动画
.fade-transform-enter-active,
.fade-transform-leave-active {
  transition: all 0.2s ease;
}

.fade-transform-enter-from {
  opacity: 0;
  transform: translateX(-10px);
}

.fade-transform-leave-to {
  opacity: 0;
  transform: translateX(10px);
}
</style> 