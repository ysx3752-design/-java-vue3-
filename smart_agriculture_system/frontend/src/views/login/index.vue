<template>
  <div class="login-container">
    <div class="login-card">
      <div class="login-header">
        <img src="@/assets/logo.svg" alt="Logo" class="logo">
        <h2>智能农业监控系统</h2>
      </div>
      
      <div class="tabs">
        <div 
          class="tab" 
          :class="{ active: activeTab === 'login' }" 
          @click="activeTab = 'login'"
        >
          登录
        </div>
        <div 
          class="tab" 
          :class="{ active: activeTab === 'register' }" 
          @click="activeTab = 'register'"
        >
          注册
        </div>
      </div>
      
      <!-- 登录表单 -->
      <form v-if="activeTab === 'login'" class="login-form" @submit.prevent="handleLogin">
        <div class="form-item">
          <div class="input-wrapper">
            <i class="icon user-icon"></i>
            <input
              v-model="loginForm.username"
              type="text"
              placeholder="用户名"
              name="username"
              autocomplete="username"
              @input="validateUsername"
            >
          </div>
          <span v-if="errors.username" class="error-message">{{ errors.username }}</span>
        </div>
        
        <div class="form-item">
          <div class="input-wrapper">
            <i class="icon password-icon"></i>
            <input
              v-model="loginForm.password"
              type="password"
              placeholder="密码"
              name="password"
              autocomplete="current-password"
              @input="validatePassword"
            >
          </div>
          <span v-if="errors.password" class="error-message">{{ errors.password }}</span>
        </div>

        <div v-if="errors.server" class="form-item">
          <span class="error-message server-error">{{ errors.server }}</span>
        </div>

        <button 
          type="submit" 
          class="login-button" 
          :disabled="loading || !isFormValid">
          {{ loading ? '登录中...' : '登录' }}
        </button>

        <div class="login-tips">
          默认账号：admin<br>
          默认密码：admin123
        </div>
      </form>
      
      <!-- 注册表单 -->
      <form v-else class="login-form" @submit.prevent="handleRegister">
        <div class="form-item">
          <div class="input-wrapper">
            <i class="icon user-icon"></i>
            <input
              v-model="registerForm.username"
              type="text"
              placeholder="用户名"
              name="reg-username"
              @input="validateRegisterForm"
            >
          </div>
          <span v-if="regErrors.username" class="error-message">{{ regErrors.username }}</span>
        </div>
        
        <div class="form-item">
          <div class="input-wrapper">
            <i class="icon email-icon"></i>
            <input
              v-model="registerForm.email"
              type="email"
              placeholder="邮箱"
              name="email"
              @input="validateRegisterForm"
            >
          </div>
          <span v-if="regErrors.email" class="error-message">{{ regErrors.email }}</span>
        </div>
        
        <div class="form-item">
          <div class="input-wrapper">
            <i class="icon password-icon"></i>
            <input
              v-model="registerForm.password"
              type="password"
              placeholder="密码"
              name="reg-password"
              @input="validateRegisterForm"
            >
          </div>
          <span v-if="regErrors.password" class="error-message">{{ regErrors.password }}</span>
        </div>
        
        <div class="form-item">
          <div class="input-wrapper">
            <i class="icon password-icon"></i>
            <input
              v-model="registerForm.confirmPassword"
              type="password"
              placeholder="确认密码"
              name="confirm-password"
              @input="validateRegisterForm"
            >
          </div>
          <span v-if="regErrors.confirmPassword" class="error-message">{{ regErrors.confirmPassword }}</span>
        </div>
        
        <div class="divider">
          <span>管理员验证</span>
        </div>
        
        <div class="form-item">
          <div class="input-wrapper">
            <i class="icon admin-icon"></i>
            <input
              v-model="registerForm.admin_username"
              type="text"
              placeholder="管理员用户名"
              name="admin-username"
              @input="validateRegisterForm"
            >
          </div>
          <span v-if="regErrors.admin_username" class="error-message">{{ regErrors.admin_username }}</span>
        </div>
        
        <div class="form-item">
          <div class="input-wrapper">
            <i class="icon password-icon"></i>
            <input
              v-model="registerForm.admin_password"
              type="password"
              placeholder="管理员密码"
              name="admin-password"
              @input="validateRegisterForm"
            >
          </div>
          <span v-if="regErrors.admin_password" class="error-message">{{ regErrors.admin_password }}</span>
        </div>

        <div v-if="regErrors.server" class="form-item">
          <span class="error-message server-error">{{ regErrors.server }}</span>
        </div>

        <button 
          type="submit" 
          class="login-button" 
          :disabled="regLoading || !isRegisterFormValid">
          {{ regLoading ? '注册中...' : '注册' }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/store/user'
import { ElMessage } from 'element-plus'

const router = useRouter()
const userStore = useUserStore()
const loading = ref(false)
const regLoading = ref(false)
const activeTab = ref('login')

const loginForm = reactive({
  username: 'admin',
  password: 'admin123'
})

const registerForm = reactive({
  username: '',
  email: '',
  password: '',
  confirmPassword: '',
  admin_username: '',
  admin_password: ''
})

const errors = reactive({
  username: '',
  password: '',
  server: ''
})

const regErrors = reactive({
  username: '',
  email: '',
  password: '',
  confirmPassword: '',
  admin_username: '',
  admin_password: '',
  server: ''
})

const validateUsername = () => {
  errors.username = !loginForm.username.trim()
    ? '请输入用户名'
    : ''
  errors.server = ''
}

const validatePassword = () => {
  errors.password = !loginForm.password.trim()
    ? '请输入密码' 
    : loginForm.password.length < 6
      ? '密码长度不能小于6位'
      : ''
  errors.server = ''
}

const validateRegisterForm = () => {
  // 用户名验证
  regErrors.username = !registerForm.username.trim()
    ? '请输入用户名'
    : ''
  
  // 邮箱验证
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  regErrors.email = !registerForm.email.trim()
    ? '请输入邮箱'
    : !emailRegex.test(registerForm.email)
      ? '请输入有效的邮箱地址'
      : ''
  
  // 密码验证
  regErrors.password = !registerForm.password.trim()
    ? '请输入密码'
    : registerForm.password.length < 6
      ? '密码长度不能小于6位'
      : ''
  
  // 确认密码验证
  regErrors.confirmPassword = !registerForm.confirmPassword.trim()
    ? '请确认密码'
    : registerForm.password !== registerForm.confirmPassword
      ? '两次密码输入不一致'
      : ''
  
  // 管理员用户名验证
  regErrors.admin_username = !registerForm.admin_username.trim()
    ? '请输入管理员用户名'
    : ''
  
  // 管理员密码验证
  regErrors.admin_password = !registerForm.admin_password.trim()
    ? '请输入管理员密码'
    : ''
  
  regErrors.server = ''
}

const isFormValid = computed(() => {
  return loginForm.username.trim() && 
         loginForm.password.trim() && 
         loginForm.password.length >= 6 &&
         !errors.username && 
         !errors.password
})

const isRegisterFormValid = computed(() => {
  return registerForm.username.trim() &&
         registerForm.email.trim() &&
         registerForm.password.trim() &&
         registerForm.password.length >= 6 &&
         registerForm.confirmPassword.trim() &&
         registerForm.password === registerForm.confirmPassword &&
         registerForm.admin_username.trim() &&
         registerForm.admin_password.trim() &&
         !regErrors.username &&
         !regErrors.email &&
         !regErrors.password &&
         !regErrors.confirmPassword &&
         !regErrors.admin_username &&
         !regErrors.admin_password
})

const handleLogin = async () => {
  if (!isFormValid.value) return
  
  loading.value = true
  errors.server = ''
  
  try {
    // 执行登录操作
    const success = await userStore.login(loginForm)
    
    if (success) {
      ElMessage.success('登录成功')
      // 使用普通形式跳转，避免复杂的对象参数
      router.push('/')
    } else {
      errors.server = '登录失败，请检查用户名和密码'
    }
  } catch (error) {
    console.error('Login error:', error)
    errors.server = error?.message || '登录过程中发生错误'
  } finally {
    loading.value = false
  }
}

const handleRegister = async () => {
  if (!isRegisterFormValid.value) return
  
  regLoading.value = true
  regErrors.server = ''
  
  try {
    const success = await userStore.register(registerForm)
    if (success) {
      // 注册成功后清空表单并切换到登录页签
      registerForm.username = ''
      registerForm.email = ''
      registerForm.password = ''
      registerForm.confirmPassword = ''
      registerForm.admin_username = ''
      registerForm.admin_password = ''
      activeTab.value = 'login'
    }
  } catch (error) {
    console.error('Registration error:', error)
    regErrors.server = error.response?.data?.error || '注册失败，请重试'
  } finally {
    regLoading.value = false
  }
}
</script>

<style lang="scss" scoped>
.login-container {
  height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
  background: linear-gradient(135deg, #1f4037 0%, #99f2c8 100%);
}

.login-card {
  width: 400px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
  padding: 24px;
}

.login-header {
  text-align: center;
  margin-bottom: 24px;

  .logo {
    width: 64px;
    height: 64px;
    margin-bottom: 16px;
  }

  h2 {
    margin: 0;
    color: #303133;
    font-size: 20px;
  }
}

.tabs {
  display: flex;
  margin-bottom: 20px;
  border-bottom: 1px solid #e4e7ed;
}

.tab {
  flex: 1;
  text-align: center;
  padding: 10px 0;
  cursor: pointer;
  font-size: 16px;
  color: #606266;
  transition: all 0.3s;
  position: relative;
  
  &.active {
    color: #409eff;
    font-weight: 500;
    
    &:after {
      content: '';
      position: absolute;
      bottom: -1px;
      left: 50%;
      transform: translateX(-50%);
      width: 50%;
      height: 2px;
      background-color: #409eff;
    }
  }
  
  &:hover {
    color: #409eff;
  }
}

.login-form {
  .form-item {
    margin-bottom: 20px;
  }

  .input-wrapper {
    position: relative;
    
    .icon {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      width: 16px;
      height: 16px;
      color: #909399;
    }
  }

  input {
    width: 100%;
    height: 40px;
    line-height: 40px;
    padding: 0 15px 0 35px;
    border: 1px solid #dcdfe6;
    border-radius: 4px;
    transition: border-color 0.2s;
    font-size: 14px;

    &:focus {
      outline: none;
      border-color: #409eff;
    }

    &::placeholder {
      color: #c0c4cc;
    }
  }

  .error-message {
    display: block;
    margin-top: 4px;
    font-size: 12px;
    color: #f56c6c;
  }
}

.divider {
  position: relative;
  height: 20px;
  text-align: center;
  margin: 20px 0;
  
  &:before {
    content: '';
    position: absolute;
    top: 50%;
    left: 0;
    right: 0;
    height: 1px;
    background-color: #e4e7ed;
  }
  
  span {
    position: relative;
    padding: 0 10px;
    background-color: white;
    color: #909399;
    font-size: 14px;
  }
}

.login-button {
  width: 100%;
  height: 40px;
  background-color: #409eff;
  border: none;
  border-radius: 4px;
  color: white;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.3s;

  &:hover {
    background-color: #66b1ff;
  }

  &:disabled {
    background-color: #a0cfff;
    cursor: not-allowed;
  }
}

.login-tips {
  margin-top: 16px;
  font-size: 12px;
  color: #909399;
  text-align: center;
  line-height: 1.5;
}

.icon {
  display: inline-block;
  width: 16px;
  height: 16px;
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
}

.user-icon {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23909399'%3E%3Cpath d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/%3E%3C/svg%3E");
}

.password-icon {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23909399'%3E%3Cpath d='M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z'/%3E%3C/svg%3E");
}

.email-icon {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23909399'%3E%3Cpath d='M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z'/%3E%3C/svg%3E");
}

.admin-icon {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23909399'%3E%3Cpath d='M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z'/%3E%3C/svg%3E");
}
</style> 