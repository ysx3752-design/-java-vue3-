<template>
  <el-breadcrumb class="app-breadcrumb" separator="/">
    <transition-group name="breadcrumb">
      <el-breadcrumb-item v-for="(item, index) in breadcrumbs" :key="item.path" class="breadcrumb-item">
        <span 
          class="breadcrumb-text"
          :class="{ 'last-item': index === breadcrumbs.length - 1 }"
          @click="handleClick(item)" 
          v-if="item.meta && item.meta.title">
          <el-icon v-if="item.meta.icon" class="breadcrumb-icon"><component :is="item.meta.icon" /></el-icon>
          {{ item.meta.title }}
        </span>
      </el-breadcrumb-item>
    </transition-group>
  </el-breadcrumb>
</template>

<script setup>
import { ref, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import * as ElementPlusIconsVue from '@element-plus/icons-vue';

const route = useRoute();
const router = useRouter();
const breadcrumbs = ref([]);

// 处理面包屑导航点击事件
const handleClick = (item) => {
  // 如果不是当前路由，则导航
  if (item.path !== route.path) {
    router.push(item.path);
  }
};

// 根据当前路由生成面包屑数据
const getBreadcrumb = () => {
  let matched = route.matched.filter(item => item.meta && item.meta.title);
  
  // 添加首页
  const home = {
    path: '/dashboard',
    meta: { title: '首页', icon: 'HomeFilled' }
  };
  
  if (matched[0] && matched[0].path !== '/dashboard') {
    matched = [home, ...matched];
  } else if (matched.length === 0) {
    matched = [home];
  }
  
  breadcrumbs.value = matched.map(item => {
    const result = { ...item };
    
    // 支持动态路由参数的替换
    if (result.path && route.params) {
      Object.keys(route.params).forEach(key => {
        if (result.path.includes(':' + key)) {
          result.path = result.path.replace(':' + key, route.params[key]);
        }
      });
    }
    
    return result;
  });
};

// 监听路由变化
watch(
  () => route.path,
  () => {
    getBreadcrumb();
  }
);

// 组件挂载时初始化
onMounted(() => {
  getBreadcrumb();
});
</script>

<style lang="scss" scoped>
.app-breadcrumb {
  display: inline-block;
  font-size: 14px;
  margin-left: 10px;
  
  .breadcrumb-item {
    transition: all 0.3s;
    
    .breadcrumb-text {
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      color: #606266;
      transition: all 0.3s;
      
      &:hover {
        color: #409EFF;
        transform: translateY(-2px);
        text-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
      }
      
      &.last-item {
        color: #409EFF;
        font-weight: 600;
        text-shadow: 0 1px 4px rgba(64, 158, 255, 0.2);
      }
      
      .breadcrumb-icon {
        margin-right: 5px;
        transition: all 0.3s;
        filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.1));
      }
      
      &:hover .breadcrumb-icon {
        transform: scale(1.1) translateZ(5px);
        filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.2));
      }
    }
  }
}

/* 面包屑动画 */
.breadcrumb-enter-active,
.breadcrumb-leave-active {
  transition: all 0.5s;
}

.breadcrumb-enter-from,
.breadcrumb-leave-to {
  opacity: 0;
  transform: translateX(20px);
}

.breadcrumb-leave-active {
  position: absolute;
}

.breadcrumb-move {
  transition: all 0.5s;
}
</style> 