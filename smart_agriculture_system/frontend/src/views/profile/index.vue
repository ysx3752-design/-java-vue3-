<template>
  <div class="profile-container">
    <el-card v-loading="loading" shadow="hover">
      <div class="profile-header">
        <el-avatar :size="72" :src="avatarSrc" />
        <div class="profile-title">
          <h2>{{ profile.username || '-' }}</h2>
          <el-tag :type="profile.role === 'admin' ? 'success' : 'info'" size="small">
            {{ profile.role === 'admin' ? '管理员' : '普通用户' }}
          </el-tag>
        </div>
      </div>
      <el-divider />
      <el-descriptions :column="1" border>
        <el-descriptions-item label="用户 ID">{{ profile.id ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="用户名">{{ profile.username || '-' }}</el-descriptions-item>
        <el-descriptions-item label="邮箱">{{ profile.email || '-' }}</el-descriptions-item>
        <el-descriptions-item label="账号状态">
          <el-tag :type="profile.is_active ? 'success' : 'danger'" size="small">
            {{ profile.is_active ? '正常' : '已禁用' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="注册时间">{{ formatTime(profile.created_at) }}</el-descriptions-item>
      </el-descriptions>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/store/user'
import { getUserProfile } from '@/api/user'
import adminAvatar from '@/assets/avatar-admin.svg'

const userStore = useUserStore()

// 所有角色统一使用线条人形头像（黑白），与顶栏保持一致
const avatarSrc = adminAvatar
const loading = ref(false)
const profile = ref({})

const formatTime = (value) => {
  if (!value) return '-'
  return String(value).replace('T', ' ').slice(0, 19)
}

const fetchProfile = async () => {
  loading.value = true
  try {
    profile.value = await getUserProfile()
  } catch (error) {
    ElMessage.error('获取个人信息失败')
  } finally {
    loading.value = false
  }
}

onMounted(fetchProfile)
</script>

<style scoped>
.profile-container {
  padding: 20px;
}
.profile-header {
  display: flex;
  align-items: center;
  gap: 16px;
}
.profile-title h2 {
  margin: 0 0 8px;
}
</style>
