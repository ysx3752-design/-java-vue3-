# 智能温室数字孪生与微气候测控平台

基于物联网的温室环境监测与设备自动化控制平台。通过 TCP 与 WSN 虚拟硬件网关通信，
实时采集空气温湿度、土壤温湿度、光照与 CO₂ 浓度，并对遮阳、通风、天窗、喷灌、
水帘、补光共 8 路继电器设备进行手动或阈值自动控制；前端提供数据看板、历史分析
与程序化三维数字孪生视图。

## 技术栈

### 后端

| 组件 | 选型 |
|---|---|
| 语言 / 运行时 | Java 17 |
| 框架 | Spring Boot 3.2.5（Web MVC + JDBC） |
| 持久层 | Spring JdbcTemplate（手写 SQL，无 ORM） |
| 连接池 | HikariCP |
| 数据库 | MySQL 8 |
| 认证 | JJWT 0.12.6（HS256）+ HandlerInterceptor |
| 密码 | BCrypt（spring-security-crypto） |
| 构建 | Maven（`mvn` / IntelliJ IDEA 内置 Maven） |
| 日志 | SLF4J + Logback |

### 前端

Vue 3.4 + Vite 5 + Pinia + Vue Router + Element Plus + ECharts 5 + Three.js 0.160（自研三维场景）+ GSAP + Axios。

## 目录结构

```
smart_agriculture_system/
├── backend-java/              # Spring Boot 后端
│   ├── pom.xml
│   └── src/main/java/com/smartagriculture/
│       ├── config/            # 配置加载、数据源、设备注册表、Web 配置
│       ├── controller/        # REST 接口
│       ├── device/            # TCP 客户端、设备管理、自动控制
│       ├── model/             # 数据模型
│       ├── repository/        # JdbcTemplate 仓储
│       ├── security/          # JWT、拦截器、密码哈希
│       ├── service/           # 业务服务与后台任务
│       └── util/              # 通用工具
├── frontend/                  # Vue 3 前端
├── reference/                 # 参考资产（硬件驱动示例、接口回归脚本），不参与运行
└── README.md
```

## 启动

### 后端

配置 `backend-java/.env`（参考同目录 `.env.example`），然后任选一种方式：

```bash
# 方式一：Maven 直接运行
cd backend-java
mvn spring-boot:run

# 方式二：打包后运行
cd backend-java
mvn clean package
java -jar target/smart-agriculture-backend.jar
```

也可以直接在 IntelliJ IDEA 中打开 `backend-java/pom.xml`，运行
`SmartAgricultureApplication`。服务默认监听 **5000** 端口。

### 前端

```bash
cd frontend
npm install
npm run dev
```

前端默认 **3000** 端口，通过 Vite 代理将 `/api` 转发到 `http://localhost:5000`。

## 配置项

配置按 `系统环境变量 → JVM 参数 → .env → 默认值` 的顺序读取。

| 键 | 说明 |
|---|---|
| `JDBC_URL` | MySQL 连接串（标准 JDBC 格式） |
| `DB_USERNAME` / `DB_PASSWORD` | 数据库账号 |
| `JWT_SECRET_KEY` | 令牌签名密钥，**至少 32 字节**；过短会由 SHA-256 派生并打印警告 |
| `WSN_HOST` / `WSN_PORT` | WSN 网关地址，默认 `192.168.12.1:4000` |
| `SENSOR_SAMPLE_SECONDS` | 历史数据采样间隔，默认 120 秒 |
| `SENSOR_SIMULATE` | 是否在读取出口叠加昼夜波动，默认开启；设 `false` 返回原始读数 |

## 数据说明

- `sensor_data` 表存储网关返回的真实读数，由后台任务按采样间隔写入。
- 页面上看到的曲线在返回前经过 `SensorSimulator` 处理，围绕日均基准叠加昼夜波动
  （温度 ±3.2℃、湿度 ±8%），**不写回数据库**，可通过 `SENSOR_SIMULATE=false` 关闭。
- 温湿度同时为 0 的记录被视为网关离线时的占位值，查询与展示时会被过滤。

## 与 Flask 版的关系

本项目后端最初为 Python Flask 实现（原作者：唐舒阳，平顶山学院）。当前 Java 版本
是在原系统基础上完成的后端重构，保留了原有的数据库结构、硬件通信协议与接口契约，
并针对原实现的并发模型做了改造：

- 设备状态由「逐台查询、累计等待网关超时」改为「一次广播同步全部通道」；
- TCP 交互移出请求线程，改为后台线程 + 异步连接 + 数据缓存；
- 认证由手写 JWT 改为 JJWT，密码由 PBKDF2 迁移至 BCrypt（登录时自动升级）。

原 Python 驱动示例与接口回归脚本归档在 `reference/`，不参与构建与运行。

## 许可证

MIT
