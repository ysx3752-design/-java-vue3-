import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  server: {
    port: 3000,
    open: true,
    cors: true,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
        ws: true,
        rewrite: (path) => path,
        configure: (proxy, options) => {
          proxy.on('error', (err, req, res) => {
            console.warn('代理请求错误:', err);
          });
          proxy.on('proxyReq', (proxyReq, req, res) => {
            console.log('发送代理请求:', req.method, req.url);
          });
          proxy.on('proxyRes', (proxyRes, req, res) => {
            console.log('收到代理响应:', proxyRes.statusCode, req.url);
          });
        }
      }
    }
  },
  // 配置静态资源处理
  build: {
    assetsInlineLimit: 4096, // 小于此大小的资源将内联为base64
    rollupOptions: {
      output: {
        // 指定静态资源文件名格式
        assetFileNames: 'assets/[name]-[hash][extname]',
        // 分包策略
        manualChunks: {
          'vendor': ['vue', 'vue-router', 'pinia'],
          'element-plus': ['element-plus'],
          'echarts': ['echarts', 'vue-echarts']
        }
      }
    },
    // 启用CSS代码分割
    cssCodeSplit: true,
    // 启用源码映射以便于调试
    sourcemap: true,
    // 启用压缩以减小文件体积
    minify: 'esbuild',
    // 启用gzip压缩
    brotliSize: false
  },
  // CSS相关配置
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: '@import "@/styles/variables.scss";'
      }
    }
  },
  // 性能优化
  optimizeDeps: {
    include: ['vue', 'vue-router', 'pinia', 'element-plus', 'echarts', 'vue-echarts', 'gsap', 'axios']
  }
})
