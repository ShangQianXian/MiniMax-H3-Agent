# MiniMax H3 Agent

画布 + 节点式的 MiniMax H3 视频生成工作流 WebUI。纯工作流引擎形态：**节点直接调用 H3 接口，不引入任何 LLM 编排**，行为完全可预测、零额外成本。

- 前端：React 19 + Vite + `@xyflow/react`（React Flow）+ zustand + Tailwind CSS 4
- 后端：Node 24 + Express 5 + **`node:sqlite`（Node 内置，无需编译原生模块）**
- 共享契约层：接口类型、限制台账、计价规则、请求组装、校验规则全部集中在一处，前后端共用

---

## 快速开始

### 方式一：一键启动（推荐）

**Windows 直接双击 `启动.cmd`** 就行。它会自动完成全部准备工作：

```
✓ 检查 Node 版本
✓ 缺依赖就自动 pnpm install（fresh clone 直接双击也能跑）
✓ 没有 .env 就从 .env.example 生成一份
✓ 端口被占用就自动往后找空闲端口
✓ 同时拉起后端与前端，等后端健康检查通过
✓ 自动打开浏览器
```

**停止**：在启动窗口按 `Ctrl+C` 即可（会把两个服务干净地收掉）。
如果窗口被强行关闭，双击 `停止.cmd` 清理残留进程。

想先看看界面而不消耗额度：双击 **`启动-模拟模式.cmd`**。

命令行等价写法与更多选项：

```bash
node scripts/start.mjs              # 正常启动
node scripts/start.mjs --mock       # 模拟模式，不调用真实接口
node scripts/start.mjs --stop       # 停止上次启动的服务
node scripts/start.mjs --fresh      # 重新探测端口（忽略上次记住的）
node scripts/start.mjs --no-open    # 不自动开浏览器
node scripts/start.mjs --help       # 全部选项
```

### 方式二：手动分步

```bash
# 1. 安装依赖（store 已固定在仓库内的 .pnpm-store，避免全局缓存不可写）
pnpm install

# 2. 配置 API Key
cp .env.example .env      # Windows: copy .env.example .env
# 编辑 .env，填入 MINIMAX_API_KEY

# 3. 启动（前端 5173 + 后端 8787）
pnpm dev
```

打开 <http://127.0.0.1:5173> 即可。

> API Key 也可以不写进 `.env`，直接在界面右上角「设置」里填 —— 它只保存在本机服务端。

### 没有 API Key 也能跑通全链路

```bash
pnpm dev:mock
```

MOCK 模式会回放一套符合接口契约的响应（含真实的 160 字节 MP4 产物），可以完整走一遍
「建节点 → 运行 → 排队 → 运行中 → 成功 → 产物转存」的流程，不消耗任何额度。
界面右上角「设置」里也可以手动勾选 MOCK 模式。

### 其他命令

| 命令 | 说明 |
| :--- | :--- |
| `node scripts/start.mjs` | 一键启动（带环境检查、自动装依赖、端口探测、自动开浏览器） |
| `pnpm dev` | 前端 + 后端一起启动（开发者用的简易版） |
| `pnpm dev:mock` | 同上，但后端跑在 MOCK 模式 |
| `pnpm dev:web` / `pnpm dev:server` | 单独启动 |
| `pnpm typecheck` | TypeScript 全量类型检查 |
| `pnpm test` | 完整测试（单测 + 前端交互 + 后端端到端 + 启动器集成） |
| `pnpm build:web` | 构建前端产物到 `apps/web/dist` |

---

## 目录结构

```
启动.cmd                  # 一键启动（Windows 双击）
启动-模拟模式.cmd          # 一键启动 + MOCK 模式
停止.cmd                  # 清理残留进程
scripts/
  start.mjs               # 启动器本体（跨平台，node scripts/start.mjs）
  start.test.mjs          # 启动器集成测试

packages/shared/src/      # 唯一事实来源：类型 / 限制 / 计价 / 组装 / 校验 / 图谱 schema
  types.ts                #   接口契约类型（对齐 docs/api）
  limits.ts               #   全部限制台账（分辨率、时长、素材规格、64MB 上限…）
  pricing.ts              #   按量计费价格表与费用计算
  build-request.ts        #   画布槽位 → content 数组
  validate.ts             #   前端即时校验（带 nodeId 的问题列表）
  api-validation.ts       #   服务端权威校验（schema + prompt + 模型能力 + 场景规则）
  node-params.ts          #   节点定义、端口定义、场景自动判定
  presets.ts              #   生成方式（全能参考 / 首尾帧 / 首帧 / 文生视频）与比例规则
  skills.ts               #   8 个内置 Skill 模板
  error-codes.ts          #   内部错误码 → 中文可读提示
  workflow-schema.ts      #   zod schema（图谱 / 项目 / 工作流 / Skill / 设置）

apps/server/src/          # 后端
  bin.ts / app.ts         #   启动与装配（Node 原生跑 TS，无构建步骤）
  context.ts              #   共享状态（DB / 客户端 / 轮询器 / 各仓储）
  db.ts                   #   node:sqlite 建表与迁移
  routes/                 #   h3 / projects / workflows / skills / assets / settings / quote
  services/minimax.ts     #   H3 接口客户端 + 错误翻译
  services/poller.ts      #   自适应轮询器（进程重启后自动恢复）
  services/task-store.ts  #   任务镜像仓库
  services/assets.ts      #   素材落盘与产物转存
  services/mock.ts        #   MOCK 回放器

apps/web/src/             # 前端
  layout/                 #   AppShell / TopBar / LeftSidebar / InspectorPanel / StatusBar / SettingsDialog
  canvas/                 #   FlowCanvas / NodeShell / workflow-types
  nodes/index.tsx         #   10 种节点的渲染实现
  engine/                 #   resolve（槽位解析）/ validate / estimate / executor / layout / restore
  store/graph.ts          #   画布图状态 + 撤销重做 + 持久化
  api/client.ts           #   同源 /api 客户端
```

---

## 界面

**画布 + 点击弹出的设置面板 + 底部创作台**：

- **顶部**：一行菜单栏 —— `MiniMax Design` · 文件 / 窗口 / 帮助 · 项目/工作流面包屑 · 预估费用 · 运行全图 · 设置
- **左侧栏**：品牌行 → `＋ 开始创作` → `项目库 / Skill / 节点库 / 任务中心` →
  可折叠的**项目树**（工作流条目带缩略图）→ 底部账号行
- **画布**：无限点阵画布。极简节点卡片（默认几乎无边框，选中才描边）、端口类型校验、
  右上角悬浮控件（缩放 / 网格 / 自动布局 / 小地图 / **仅画布**）、底部居中圆形工具栏
- **右侧检查器**：默认收起，`Ctrl+I` 展开 —— 校验结果 / 费用明细 / 请求体 JSON + curl / 任务用量

### 核心交互：点节点 → 弹设置 → 比例随生成方式变

```
点视频节点      → 卡片下方展开设置面板
点「全能参考」   → 比例 7 项：自适应 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16 / 21:9
点「首尾帧」     → 比例只剩「自适应」（宽高比由输入图片决定，接口会忽略其他值）
```

设置面板分五区：**生成方式**（分段控件）→ **比例**（图标卡片）→ **清晰度** → **时长** → **有声视频**，
另附模型切换、AIGC 水印、运行前确认与「本次请求」摘要。

界面上**不会出现「能点但接口会忽略」的假选项** —— 比例可选项直接来自官方规则：

| 生成方式 | 场景 | 比例选项 |
| :--- | :--- | :--- |
| 全能参考 | r2va | 7 项全给 |
| 首尾帧 / 首帧 | i2va | 仅「自适应」 |
| 文生视频 | t2va | 6 项（**不含**自适应） |

> **关于「有声视频」**：官方接口没有「是否配音」参数，声音由提示词与参考音频决定。
> 因此这个开关落成一段附加提示词（幂等、可反复切换），界面里也如实标注了这一点。

### 节点一览

| 分组 | 节点 | 说明 |
| :--- | :--- | :--- |
| 输入 | 提示词、图片、视频、音频 | 本地上传（转 data URI）或公网 URL / `mm_file://` |
| 组织 | 帧角色 | 把上游图片标记为 first_frame / last_frame / reference_image |
| 任务 | 视频生成、Context-IR 增强、视频再生成 | 真实调用 `/v2/video_generation`、`/v2/h3_context_ir`、`/v2/video_regeneration` |
| 管理 | 任务状态、任务列表 | 轮询、取消 / 删除、产物转存、把远端任务同步进来 |

**场景自动判定**：视频生成节点会根据上游素材实时显示 `t2va` / `i2va` / `r2va` 徽标。

### 底部创作台

素材缩略图条（`+` 添加）+ 提示词（7000 字符计数）+ 参数一行
（模型 │ 生成方式 · 比例 · 清晰度 · 时长 │ 输出数量 ｜ `✳ 预估费用` ｜ `↑ 发送`）。
点参数摘要即可打开完整设置面板，新建节点前也能配置。

它**不是画布节点**：点「发送」时把草稿落地成画布节点（素材 + 提示词 + 按需的帧角色 + 生成节点）
并自动连好线，再执行 —— 画布始终是唯一的图谱事实来源。

### 快捷键

| 快捷键 | 作用 |
| :--- | :--- |
| `Ctrl+Enter` | 创作台里直接发送 |
| `Ctrl+I` | 展开 / 收起右侧检查器 |
| 双击空白 | 新建「提示词」节点 |
| `Shift` + 拖拽 | 框选 |
| `Delete` | 删除选中节点（连带连线） |
| `Ctrl+Z` / `Ctrl+Shift+Z` | 撤销 / 重做 |
| `Ctrl+D` | 复制选中节点 |
| `Shift+L` | 自动布局（按依赖分层） |

---

## 关键设计决策

**为什么所有请求都走后端代理？** 密钥只留在服务端、前端零 CORS 问题、并且可以在真正调用上游之前做一遍权威校验——参数错误永远不会变成一次白花钱的请求。

**为什么用轮询而不是 `callback_url`？** 回调要求 MiniMax 服务器能访问到我们的地址，本地 `127.0.0.1` 不可达，且回调前要先原样回显 `challenge`。轮询是本地部署的可靠选择：后端轮询器按 `queued` 立即查、`running` 逐步退避到 15s 的策略执行，进程重启后自动从数据库恢复未完成任务；前端另有一套 4 秒的轻量同步，只负责把状态推给界面（**执行引擎每完成一步就把 `lastTaskId` 写进节点参数**，所以刷新页面后也能把状态、产物、增强提示词重新贴回节点上）。

**为什么素材走 data URI？** 接口的 `content` 只接受公网 URL、`mm_file://` 或 data URI。本地文件直接内联最简单，但请求体总计上限 64 MB（Base64 还会放大约 33%）。因此前端在选文件时就会预判：超限的文件立刻给出「改用公网 URL / 先压缩 / 裁剪」三条可执行建议，而不是等接口报错。

**素材与产物为什么要落盘？** 产物是**限时下载链接**，任务记录只保留 **7 天**。所以任务成功后会自动把产物转存到 `data/artifacts/`，本地素材放在 `data/assets/`，并通过支持 Range 的 `/api/assets/:id/content` 回放——刷新页面、链接过期都不影响预览。

**再生成为什么要保留两份 prompt？** 视频再生成要求**原样重放**生成 768P 源视频时送入模型的全部输入，且 `text` 必须用当时实际送入的**最终 prompt**（不能用 Context-IR 处理前的原始 prompt）。所以任务表同时存 `prompt_raw` 与 `prompt_final`。

---

## 计费预估

内置 `docs/api/7.按量计费.md` 的价格表，逐节点与全图都会实时显示预估费用：

| 项目 | 价格 |
| :--- | :--- |
| H3 输出 · 768P / 2K | 0.50 / 0.80 元/秒 |
| H3-Max 输出 · 480P / 768P | 0.33 / 0.50 元/秒 |
| 输入图片 | 5 张内免费，超出 0.20 元/张 |
| 输入参考视频 | 2K 0.80、768P 0.50 元/秒（音频免费） |
| 视频再生成输出 | 0.30 元/秒（原任务素材需重新计费：图片 0.15 元/张、视频 0.30 元/秒） |
| H3-Context-IR | 输入 5.80、输出 23.00 元/百万 tokens |

任务成功后会依据接口返回的 `usage` 折算**实际花费**显示在节点上。

---

## 安全性

- API Key 只保存在本机服务端的 SQLite（或 `.env`），不进入浏览器存储、不写入前端产物
- 读接口永远只返回掩码（`********abcd`），任何响应体都不会出现明文
- 服务默认只监听 `127.0.0.1`，无多用户与鉴权体系，请勿直接暴露到公网

---

## 已知边界

- 视频再生成的「按任务 ID」模式需要 MiniMax 侧**开通白名单**；界面会提示，默认走「按源视频」模式
- 仅支持查询最近 **7 天**内的任务，超出窗口的记录只能看本地缓存
- `running` 与 `cancelled` 状态的任务**无法取消或删除**，这是接口的硬限制，界面会禁用对应按钮
- v1 不暴露 `callback_url`（本地不可达），不做 H3 之外的 MiniMax 能力（语音 / 图像 / 音乐）
- 端口号可在 `.env` 里改（`PORT`），前端 Vite 代理目标在 `apps/web/vite.config.ts`

---

## 接口文档

7 份官方文档原件在 `docs/api/`，实现与它们逐条对齐：

| 文件 | 覆盖能力 |
| :--- | :--- |
| `1.创建视频生成任务.md` | `POST /v2/video_generation` |
| `2.查询任务.md` | `GET /v2/query/video_generation/{task_id}` |
| `3.查询任务列表.md` | `GET /v2/query/video_generation` |
| `4.取消或删除任务.md` | `DELETE /v2/video_generation/{task_id}` |
| `5.创建 H3-Context-IR 任务.md` | `POST /v2/h3_context_ir` |
| `6.创建视频再生成任务.md` | `POST /v2/video_regeneration` |
| `7.按量计费.md` | 价格表（费用预估依据） |

## 界面与交互更新

本轮参考图适配、问题修复和验证范围见 [界面优化说明](docs/界面优化说明.md)。

## 项目与工作流管理

- 在左侧「项目库」点击「新建项目」；每个项目默认创建一个空白工作流。
- 选择项目后点击「新建工作流」，输入名称即可打开独立画布。
- 项目和工作流每一行右侧的铅笔按钮用于重命名，垃圾桶按钮用于删除。名称为 1–80 个字符，保存后立即更新。
- 删除会先显示确认弹窗。删除项目会删除其全部工作流画布；历史任务、已下载素材继续保留，正在生成的任务不会因此取消。
- 切换项目或工作流前会先保存画布；保存失败时保留当前编辑内容并提示错误。
- 窄屏下点击侧栏「项目库」图标即可展开管理面板。
