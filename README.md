# 💡 智慧路灯 IoT 管理平台 - 前端

面向市政道路照明的物联网管理系统 Web 前端，配套后端 [SmartLightingExp](https://github.com/smart-lighting-backend/SmartLightingExp) 使用。覆盖设备管理、自动策略控制、告警、能耗分析、AI 智能运维全流程，支持 Web / 移动端 / 真实硬件（小熊派）多端协同。

> 🎬 **演示视频**：https://b23.tv/BV1bJub6sEBi
> 📱 **移动端**（Kotlin + Jetpack Compose）：https://github.com/smart-lighting-backend/SmartLightingAndroid

## 🚀 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | Vue 3（Composition API + `<script setup>`） |
| 构建 | Vite 5 |
| UI 组件库 | Element Plus 2.14 |
| 图表 | ECharts 6（仪表盘、能耗报表、趋势图） |
| 3D 可视化 | Three.js（数字孪生场景） |
| 地图 | 高德地图 JS API 2.0 |
| MQTT | mqtt.js（WebSocket 实时遥测/控制） |
| 表格导出 | xlsx（Excel 导入导出） |
| 状态/路由 | Pinia 风格 composables + Vue Router 4 |

## ✨ 功能模块（21 个页面）

| 模块 | 页面 | 说明 |
|------|------|------|
| 数字孪生 | Dashboard | 3D 路灯场景 + 设备在线率/告警/能耗概览 + 分区状态 |
| 设备管理 | Devices / DeviceDetail / AreaManagement | 台账、批量导入导出、高德地图选点、实时控制（手动/策略） |
| 数据报表 | Analytics / EnergyTrend | 能耗统计、节能率、碳减排、分区能耗占比 |
| 告警中心 | Warning / AlarmDetail | 离线/故障/健康分过低三类告警，自动恢复与手动处理 |
| 策略配置 | Strategy / StrategyCreate | 照明策略规则引擎（条件 JSON、优先级、模拟测试） |
| AI 智能助手 | AIAssistant | RAG 维修诊断、自然语言对话调参 |
| 事件中心 | EventCenter | AI 视觉（行人/车辆）与语音事件 |
| 系统管理 | UserManagement / RoleManagement / PermissionManagement / MenuManagement / SystemLog | RBAC 权限体系（4 角色 × 17 权限码）+ 操作审计日志 |

## 🏗️ 项目结构

```
src/
├── api/            # 接口封装（auth/devices/control/strategy/telemetry/alarm/dashboard...）
│   └── request.js  # Axios 实例（JWT 拦截器、Mock 降级）
├── components/     # 公共组件（DeviceMap、LocationPicker、BatchImport、PerceptionPanel...）
├── composables/    # 组合式函数（useAMap、useMqtt、useAutoRefresh、useThreeScene、useUserInfo...）
├── layouts/        # MainLayout 主布局（动态菜单 + 权限导航）
├── router/         # 路由（beforeEach 守卫：Token 校验 + 权限码校验 + adminOnly 校验）
├── utils/          # 工具（coordinate、excelTemplate、streetlightIcon、controlStateStore...）
├── views/          # 21 个页面
├── App.vue
└── main.js
```

## 🛠️ 快速开始

### 环境要求

- Node.js ≥ 18
- 后端服务已启动（[SmartLightingExp](https://github.com/smart-lighting-backend/SmartLightingExp)，含 MySQL / TDengine / EMQX / MaxKB）

### 安装与运行

```bash
npm install
npm run dev        # 开发模式 http://localhost:5173
npm run build      # 生产构建
npm run preview    # 预览生产构建
```

### 环境变量

```bash
# .env.development 示例
VITE_API_BASE_URL=http://localhost:8080    # 后端接口地址
VITE_MQTT_URL=ws://localhost:8083/mqtt     # MQTT WebSocket 地址
VITE_AMAP_KEY=your_amap_key                # 高德地图 Key
```

## 🔐 权限体系

- 路由级：`router.beforeEach` 校验 `meta.permission`，无权限重定向
- 页面级：`v-if="hasPerm('xxx')"` 控制按钮显隐
- 菜单级：按用户权限动态渲染导航菜单（`/api/menus/visible`）
- 4 角色：SUPER_ADMIN / MAINTENANCE（路灯管理员）/ MUNICIPAL（市政人员）/ EMERGENCY（应急人员）

## 📡 Mock 降级

后端不可用时自动降级为本地 Mock 数据（`api/adminMock.js`、`utils/mockStore.js`），保证演示与开发不被环境阻断。

## 🤝 关联项目

| 项目 | 仓库 |
|------|------|
| 后端服务 | https://github.com/smart-lighting-backend/SmartLightingExp |
| 移动端（Kotlin + Jetpack Compose） | https://github.com/smart-lighting-backend/SmartLightingAndroid |

## 📄 许可证

MIT License
