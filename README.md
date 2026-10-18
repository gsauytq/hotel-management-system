# 酒店管理系统（HMS）

小型酒店管理系统（模块化单体）。后端业务模块（认证、员工、客房、客人、预订、入住/退房、订单）已实现；前端已完成**工程基础设施、管理后台布局、登录认证、房型/客房、预订、入住/退房、账单、员工与客人管理页面**。经营看板因统计接口与口径仍为 V2 范围外，仅提供明确的未接入页面，不展示 Mock 指标。

> **需求基线**：v1.0 已于 2026-10-18 批准（[批准工作稿](./docs/requirements-traceability-approval-draft.md) / [决策摘要](./docs/requirements-approval-decision-summary.md)）。walk-in 前端入口、A-20 首登强制改密、E2E 与部署文档仍待完成，见[批准后行动登记](./docs/post-approval-action-register.md)。

## 技术栈

| 层       | 技术                                                                         |
| -------- | ---------------------------------------------------------------------------- |
| 后端     | Node.js 22 LTS · TypeScript（strict）· Express 5 · Prisma 7（MySQL 8.4 LTS） |
| 前端     | Vue 3 · Vite · Element Plus · Pinia · Vue Router（`apps/web`）               |
| 共享契约 | `packages/shared`（类型 / 错误码 / 枚举，无构建产物）                        |
| 质量     | Vitest · Supertest · ESLint · Prettier · TypeScript 严格模式                 |
| 部署     | Docker Compose（web + api + mysql）                                          |

## 目录结构

```
apps/server       后端 API（路由/控制器/服务/数据访问分层 + 统一错误处理）
apps/web          前端 SPA（核心业务页面已实现；walk-in 入口待补）
packages/shared   前后端共享类型、错误码表、枚举
docs/             架构、数据库、API 契约、安全与开发计划
openapi/          OpenAPI 3.0.3 契约（单一事实来源）
docker-compose.yml   本地开发 Compose（仅 MySQL 8.4）
compose.prod.yml     生产形态 Compose（web + api + mysql）
```

## 环境要求

- Node.js `>=22.12 <23`
- pnpm `12.6`（已在 `package.json` 的 `packageManager` 锁定；可用 `corepack enable` 或 `npm i -g pnpm@12.6.0` 安装）
- Docker（本地 MySQL 与全栈验收）

## 快速开始（本地开发）

```bash
# 1. 安装依赖（工作区）
pnpm install

# 2. 准备环境变量（复制后替换全部占位值；两个文件均不入库）
cp .env.example .env                        # 供 docker compose（MySQL）使用
cp apps/server/.env.example apps/server/.env # 供后端进程使用

# 3. 启动本地 MySQL 8.4（宿主端口默认 3307，避免与本机既有 MySQL 冲突）
docker compose up -d mysql

# 4. 应用数据库迁移（幂等）；首次可执行 seed 创建管理员
pnpm db:deploy
pnpm db:seed            # 仅当 users 表为空时执行；密码来自 ADMIN_INITIAL_PASSWORD

# 5. 启动
pnpm dev:server         # 后端 http://localhost:3000
pnpm dev:web            # 前端 http://localhost:5173（/api 代理到 3000）
```

生成密钥 / 密码示例（无特殊字符，避免 URL 编码问题）：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"  # GUEST_ID_* 密钥
node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))" # 数据库密码等
```

## 环境变量

后端进程读取 `apps/server/.env`（启动时经 zod 严格校验，**缺失/非法立即拒绝启动并逐字段提示**，提示中引用示例文件；ADR-007 fail-fast）。

| 变量                     | 必填   | 默认                | 说明                                       |
| ------------------------ | ------ | ------------------- | ------------------------------------------ |
| `NODE_ENV`               | 否     | `development`       | `development` / `test` / `production`      |
| `PORT`                   | 否     | `3000`              | HTTP 监听端口                              |
| `DATABASE_URL`           | **是** | —                   | 运行库连接（DML 最小权限账号）             |
| `MIGRATION_DATABASE_URL` | 否     | 回退 `DATABASE_URL` | 迁移专用连接（DDL 账号）                   |
| `SESSION_TTL_HOURS`      | 否     | `8`                 | 会话有效期（待 T-05 使用）                 |
| `GUEST_ID_HMAC_KEY`      | **是** | —                   | 证件号查重 HMAC 密钥（base64，32 字节）    |
| `GUEST_ID_CIPHER_KEY`    | **是** | —                   | 证件号 AES-256-GCM 密钥（base64，32 字节） |
| `LOG_LEVEL`              | 否     | `info`              | pino 日志级别                              |
| `CORS_ORIGIN`            | 否     | 空                  | 显式跨域白名单；同源部署不启用             |

根目录 `.env`（供 `docker compose` 使用，见 `.env.example`）：`MYSQL_ROOT_PASSWORD`、`MYSQL_DATABASE`、`MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_HOST_PORT`（默认 3307）、`SESSION_TTL_HOURS`、`LOG_LEVEL`、`GUEST_ID_HMAC_KEY`、`GUEST_ID_CIPHER_KEY`、`ADMIN_INITIAL_PASSWORD`、`WEB_HTTP_PORT`（默认 8080）。

> 连接串中的密码如含 `#`、`@`、`:` 等特殊字符必须 URL 编码；`.env` 中未编码的 `#` 会被解析为行内注释（推荐使用 base64url 随机密码）。

## 健康检查

`GET /api/health` —— 同时反映**应用运行状态**与**数据库连接状态**（对 MySQL 执行真实 `SELECT 1`，2 秒超时）：

| 场景                 | 状态码 | 响应体               |
| -------------------- | ------ | -------------------- |
| 应用运行且数据库可达 | `200`  | `{"status":"ok"}`    |
| 数据库探测失败/超时  | `503`  | `{"status":"error"}` |

- 失败详情（含 `requestId`）只写入服务端日志，响应不泄露版本/依赖信息（security-design §11）。
- 进程启动时数据库连接失败会 **fail-fast**（输出结构化错误日志并退出，退出码非 0）。
- Docker `api` 容器 healthcheck 基于该接口；数据库不可用时 api 标记为 unhealthy。

## 认证与授权（T-05）

服务器端 Session + HttpOnly Cookie（ADR-002，**不使用 JWT**），实现于 `apps/server/src/modules/auth/`。

| 接口                       | 说明                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/v1/auth/login`  | 公开；限流 → zod 校验 → bcrypt 校验 → 会话签发。错误：401 `INVALID_CREDENTIALS`（统一文案防枚举）、422、423 `ACCOUNT_LOCKED`、429 `RATE_LIMITED` |
| `POST /api/v1/auth/logout` | 需登录；删除会话并清除 Cookie                                                                                                                    |
| `GET /api/v1/auth/me`      | 需登录；返回会话用户 + `status`（刷新后重建会话）                                                                                                |

- **会话**：sid 为 256-bit 随机 hex，仅存于 `sessions` 表（8h 绝对过期，每小时清理过期行，单用户最多 10 个会话）；Cookie 属性 `HttpOnly; SameSite=Strict; Path=/; Max-Age=TTL(28800)`，生产环境附加 `Secure`。
- **密码**：bcrypt cost=12（`bcryptjs`），不保存明文/可逆值；用户不存在时执行等效 dummy 比较防时序探测。
- **登录防护**：连续失败 5 次锁定 15 分钟（第 6 次起返回 423）；每 IP 每分钟 10 次限流（429 + `Retry-After`）。
- **授权**：`sessionMiddleware → requireAuth（401）→ requireRole(...roles)（403）`，路由必须显式声明角色（默认拒绝）；后续业务模块（T-06+）在路由上挂载 `requireRole('ADMIN')` 等守卫，前端隐藏按钮不构成权限控制。
- **审计日志**：登录成功/失败/锁定、登出写入 `channel: audit` 结构化日志（含 requestId、结果、原因），绝不记录密码、哈希、Cookie/会话 id（pino redact）。

## 房型与客房（T-07）

实现于 `apps/server/src/modules/room-types/` 与 `apps/server/src/modules/rooms/`，接口与 `openapi/openapi.yaml` 同步。

| 接口                                   | 角色  | 说明                                                                                                                                |
| -------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/room-types`               | 登录  | 房型列表（含未停用房间数 `roomCount`；`status` 过滤）                                                                               |
| `POST /api/v1/room-types`              | ADMIN | 创建房型（code `^[A-Z0-9]{2,20}$`、价格 0–99999.99、容量 1–20）；code 重复 409 `ROOM_TYPE_CODE_EXISTS`                              |
| `GET /api/v1/room-types/{id}` ★        | 登录  | 房型详情（契约增量，待评审追认）                                                                                                    |
| `PATCH /api/v1/room-types/{id}`        | ADMIN | 修改名称/价格/容量/描述（code 不可改；未知字段 422）                                                                                |
| `POST /api/v1/room-types/{id}/archive` | ADMIN | 归档（软停用）；存在 CONFIRMED 预订或 CHECKED_IN 在住 → 409 `ROOM_TYPE_ARCHIVED`                                                    |
| `GET /api/v1/rooms`                    | 登录  | 房态看板（分页 + `status/roomTypeId` + `roomNumber` 前缀★；sort 白名单 `roomNumber,status,createdAt`；OCCUPIED 含 `currentStay`）   |
| `GET /api/v1/rooms/available`          | 登录  | 按房型+日期区间查询可分配房间（排除维修/停用与区间内已占用）                                                                        |
| `GET /api/v1/rooms/{id}` ★             | 登录  | 客房详情（契约增量，待评审追认）                                                                                                    |
| `POST /api/v1/rooms`                   | ADMIN | 创建客房（默认 `VACANT_DIRTY`）；房号重复 409 `ROOM_NUMBER_EXISTS`；房型不存在 404；归档房型 409                                    |
| `PATCH /api/v1/rooms/{id}`             | ADMIN | 修改房号/房型/备注；`OCCUPIED` 仅可改 note（违者 409 `ROOM_STATUS_INVALID`）                                                        |
| `PATCH /api/v1/rooms/{id}/status`      | 登录  | 房态变更（database-design §5.2 状态机）：`DIRTY→CLEAN` 登录即可；维修/停用进入与退出仅 ADMIN（403）；`OCCUPIED` 不可人工设置（409） |

- **并发防护**：影响可售房数的操作（创建房间、修改房型、进入/退出维修与停用）在事务内先 `SELECT ... FOR UPDATE` 锁定房型行（database-design §6.1 对称规则）；房态变更使用「状态守卫更新 + 冲突重试提示」。
- **保留规则**：客房与房型不做物理删除（软停用/归档）；归档前校验未完结引用。
- **楼层筛选未实现**：已批准数据库设计无 `floor` 字段、API 无该参数；如需支持须先走 schema/契约变更评审（当前以房号前缀筛选替代）。
- ★ 标记为实施期契约增量（T-07），已同步 openapi/api-contract，需评审追认。

## 客房预订（T-09）

实现于 `apps/server/src/modules/bookings/`，**预订按房型而非具体房间**（假设 A-03）；具体房间占用在入住时由 `room_occupancy` 唯一约束兜底（T-10）。

| 接口                                 | 角色 | 说明                                                                                                                                                                                                                  |
| ------------------------------------ | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/bookings`              | 登录 | 创建预订；`checkInDate ≥ 酒店今日`、`checkOutDate > checkInDate`；价格快照（缺省取房型基准价，可覆盖）；总价服务端计算（晚数 × 房价，拒绝客户端总价）；409 `ROOM_TYPE_SOLD_OUT` / `ROOM_TYPE_ARCHIVED`、404 房型/客人 |
| `GET /api/v1/bookings`               | 登录 | 分页列表：`status/guestId/keyword`、`checkInDateFrom/To`、`checkOutDateFrom/To`★；sort 白名单 `createdAt,checkInDate,status`（默认 `createdAt:desc`）                                                                 |
| `GET /api/v1/bookings/{id}`          | 登录 | 详情（超集：另含 `stayId`、`cancelledAt`、`cancelReason`）                                                                                                                                                            |
| `POST /api/v1/bookings/{id}/cancel`  | 登录 | 仅 `CONFIRMED → CANCELLED`（状态机校验）；释放房量；**不物理删除历史**                                                                                                                                                |
| `POST /api/v1/bookings/{id}/no-show` | 登录 | 仅 `CONFIRMED` 且入住日 ≤ 酒店今日；释放房量                                                                                                                                                                          |

**事务与并发（防超售，ADR-005 / database-design §6.1）**：创建/取消/NO_SHOW 均在单个事务内先对房型行执行 `SELECT ... FOR UPDATE`（串行化同房型全部房量操作），再做**半开区间 `[checkIn, checkOut)` 重叠计数**并与可售房数（`rooms` 中非维修/停用房数）比较；写事务使用 `READ COMMITTED`，确保计数读取最新已提交数据（避免 RR 快照误判）。并发 10 请求仅成功数 = 可售房数（集成测试实测 2 房型 2 成功/8 拒绝）。
**日期语义（A-10 / A-05）**：业务日历日按 `Asia/Shanghai` 计算（`src/utils/hotel-date.ts`，不依赖服务器时区）；DB `DATE` 字段以 UTC 零点读写；占用区间左闭右开，退房日当日可再售。
★ 退房日期范围参数为实施期契约增量（T-09），需评审追认。

## 入住与退房（T-10 / T-11 写入部分）

实现于 `apps/server/src/modules/stays/`；预订入住路由挂在 `/bookings/{id}/check-in`（B6），其余为 `/stays`（S1–S4）。订单查询 O1/O2 已实现，见下文“账单查询与金额处理”。

| 接口                                  | 角色 | 说明                                                                                                                                                                                                                                                                |
| ------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/bookings/{id}/check-in` | 登录 | 预订入住：房间行锁 + 预订行锁；校验预订 `CONFIRMED`、房型匹配、`入住日 ≤ 酒店今日`（A-18）、`离店日 > 酒店今日`；`pricePerNight` 缺省取预订价；409 `ROOM_OCCUPIED` / `ROOM_NOT_ASSIGNABLE` / `BOOKING_DATE_MISMATCH`（含离店日已到/已过）/ `BOOKING_STATUS_INVALID` |
| `POST /api/v1/stays`                  | 登录 | 无预订入住（walk-in，FR-SY-001）：`pricePerNight` 必填、`expectedCheckOutDate > 酒店今日`；响应 `bookingId: null`                                                                                                                                                   |
| `GET /api/v1/stays`                   | 登录 | 列表：`status/roomId/keyword`、分页、sort 白名单 `checkInAt,expectedCheckOutDate,status`（默认 `checkInAt:desc`）                                                                                                                                                   |
| `GET /api/v1/stays/{id}`              | 登录 | 详情：`actualCheckOutAt`、`currentCharges`（预计晚数×房价；杂费在住为 0）、`order` 摘要（退房后非空）                                                                                                                                                               |
| `POST /api/v1/stays/{id}/checkout`    | 登录 | 退房结算：同一事务生成账单 → 入住 `CHECKED_OUT` → 房态 `VACANT_DIRTY` → 删除当日及未来占用行；押金抵扣 `min(押金, 总额)`；重复/并发退房 409 `STAY_STATUS_INVALID`                                                                                                   |

**事务范围（database-design §6.2/§6.3）**：

- 入住：单事务内 `rooms FOR UPDATE` → 校验房态/房型/日期 → `bookings FOR UPDATE` → 插入 `stays` → 批量插入 `room_occupancy`（按日、区间左闭右开）→ 房态 `OCCUPIED` → 预订 `CHECKED_IN`；`uq_occupancy_room_date` 与 `uq_bookings_booking_stay` 为并发最终兜底（ADR-006）。
- 退房：单事务内 `stays FOR UPDATE`（状态非 `CHECKED_IN` → 409）→ `rooms FOR UPDATE` → 计费（按预计离店日计晚数，A-06；晚数按酒店本地日历日 Asia/Shanghai 计算，A-10）→ 插入 `orders` + `order_items` → 入住 `CHECKED_OUT` + `actual_check_out_at` → 房态 `VACANT_DIRTY` → 释放占用；`uq_orders_stay` 兜底并发重复结算。
- 写事务统一 `READ COMMITTED`（与预订模块一致）；房态/预订状态**只经这些事务迁移**，不提供绕过入口。

## 账单查询与金额处理（T-11 读取 + 本任务加固）

实现于 `apps/server/src/modules/orders/`（只读）+ `src/utils/money.ts`。

| 接口                      | 角色 | 说明                                                                                                                      |
| ------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/orders`      | 登录 | 账单分页列表：`stayId`、`createdFrom/createdTo`（酒店本地日历日闭区间）、sort 白名单 `createdAt`（默认 `createdAt:desc`） |
| `GET /api/v1/orders/{id}` | 登录 | 账单详情：费用明细（`ROOM_FEE/MISC/DEPOSIT_APPLIED`）、总额/押金/抵扣/实收/支付方式；不存在 404                           |

- **账单创建**：仅由 **S4 退房事务**生成（无独立创建接口）；`UNIQUE(stay_id)` + 入住行锁防止重复退房重复出账。
- **金额处理**：数据库 `DECIMAL(10,2)`；服务端计算全程使用 **Prisma Decimal（decimal.js）** 或 **整数「分」运算**（`src/utils/money.ts`），**禁止浮点累计**；客户端提交的金额一律不信任（严格 schema 拒绝 `totalAmount` 等未知字段）。
- **展示口径**：房费（预计晚数 × 房价）+ 额外费用（退房录入选填杂费）− 押金抵扣 = 最终应付（`paidAmount`）；**已批准设计无折扣概念**（A-06 提前退房不退差价），未实现。
- **支付语义（重要）**：`payment_method`/`paid_amount`/`status=PAID` 表示**前台收银落账**（线下收款记录），**不是第三方支付渠道回调结果**；未接入任何真实支付渠道，也不伪造支付成功回调。
- **未实现（需变更评审后另行实现）**：独立支付流水表、支付失败/取消/退款状态机、挂账（`UNPAID` 预留）、折扣。依据：`database-design.md §2.9`（本期退房即结）、假设 A-02/Q-04（退款/挂账范围外，纳入须先改库设计）、A-07（押金超收部分线下退还不入账）。

## 员工与客户档案（T-06 / T-08）

| 接口                                | 角色  | 说明                                                                                                                                                       |
| ----------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/users`                 | ADMIN | 员工分页列表：`role/status/keyword`（姓名或用户名模糊）、sort 白名单 `createdAt,username,lastLoginAt`（默认 `createdAt:desc`）；**永不返回 password_hash** |
| `POST /api/v1/users`                | ADMIN | 创建员工：用户名唯一（409 `DUPLICATE_USERNAME`）；密码 ≥10 位、≤72 字节、含字母+数字、**不得包含用户名**（422）                                            |
| `PATCH /api/v1/users/{id}`          | ADMIN | 修改姓名/角色/启停；**ADMIN 不可停用自己**（403）；停用即删除该员工全部会话（即时踢出，会话中间件每请求查库双保险）                                        |
| `PATCH /api/v1/users/{id}/password` | ADMIN | 重置密码（同密码策略）；副作用：该员工全部会话失效                                                                                                         |
| `GET /api/v1/users/{id}` ★          | ADMIN | 员工详情（实施期契约增量，待评审追认）                                                                                                                     |
| `GET /api/v1/guests`                | 登录  | 客人分页列表：`keyword`（姓名模糊/手机前缀）、`phone`（前缀）、sort 白名单 `createdAt,name`（默认 `createdAt:desc`）；证件号恒掩码                         |
| `POST /api/v1/guests`               | 登录  | 创建客人：姓名/手机号/证件类型/证件号校验；**证件号 AES-256-GCM 加密存储 + HMAC-SHA256 查重**，重复 → 409 `GUEST_EXISTS`（details 含 `existingGuestId`）   |
| `GET /api/v1/guests/{id}`           | 登录  | 详情：掩码证件号 + 最近 10 条预订摘要                                                                                                                      |
| `PATCH /api/v1/guests/{id}`         | 登录  | 更新姓名/手机/备注；**证件号不可修改**（尝试修改 → 409 `GUEST_EXISTS`）                                                                                    |

- **个人信息保护**：明文证件号仅存在于请求瞬间与内存；DB 仅存密文（`iv(12)‖tag(16)‖ciphertext`）与 64 位 HMAC；响应仅掩码（前 1 后 1，中间 `*`）；日志 redact 已覆盖 `idNumber`；错误响应不含明文。
- **数据保留**：员工/客人均不做物理删除（dormant 语义：员工 `DISABLED` 软停用；客人档案无删除接口），历史预订/入住/账单通过 `ON DELETE RESTRICT` 外键保护。
- **权限**：员工管理端点全部 `requireRole('ADMIN')`（默认拒绝，路由级 + 资源级双重校验）；客人档案读/写为登录角色均可（architecture §1.7 权限矩阵）。前端隐藏不构成权限控制。
- ★ 员工详情为实施期契约增量（T-06），已同步 openapi/api-contract，需评审追认。

## 经营统计（未实现，待决）

已批准设计将**统计看板列为 V2 范围外**（`requirements-traceability.md` Q-04 / A-02），且当前 OpenAPI 与数据库均无统计接口/字段/口径定义。按协议「范围外先报告、不得自行猜测」，本次**未实现任何统计端点**；拟议指标（客房总量、可用客房、入住率、预订量、收入）的定义、时区/排除状态/计算口径以及 8 个待决问题见 [`docs/statistics-design.md`](./docs/statistics-design.md)，需产品/业主批准并从契约变更评审开始。

## 前端基础设施（apps/web）

前端为 Vue 3 + TypeScript（strict）+ Vite + Element Plus + Pinia + Vue Router 的 SPA。当前已完成**工程基础设施、管理后台布局、登录认证、房型/客房、预订、入住/退房、账单、员工与客人管理页面**；walk-in（S1）前端入口尚未实现；经营看板等待统计接口与口径批准。

### 环境与 API 地址

| 环境 | 文件                        | API 基础路径 | 说明                                                                                |
| ---- | --------------------------- | ------------ | ----------------------------------------------------------------------------------- |
| 开发 | `apps/web/.env.development` | `/api/v1`    | Vite proxy 将 `/api` 转发到 `http://localhost:3000`（`VITE_DEV_PROXY_TARGET` 可改） |
| 测试 | `apps/web/.env.test`        | `/api/v1`    | Vitest 使用；HTTP 由测试适配器接管                                                  |
| 生产 | `apps/web/.env.production`  | `/api/v1`    | Nginx 同源托管并反代 `/api`（ADR-010）                                              |

- `.env.example` 仅含占位值，可复制为 `.env.local` 覆盖本机配置；`.env.local` 已被 `.gitignore` 排除。
- 禁止在 `VITE_*` 变量中放任何真实密钥（Vite 会将其注入浏览器代码）。
- `VITE_REQUEST_TIMEOUT_MS` 控制请求超时（默认 15000 ms）。

### HTTP 客户端与响应处理

- 单例 Axios 实例：`apps/web/src/api/request.ts`（`baseURL`、超时、`Accept`、`withCredentials` 统一配置，业务代码不得另建实例）。
- **认证**：遵循 ADR-002 的服务器端 Session + HttpOnly Cookie，浏览器自动携带 Cookie；前端不读取、不存储令牌，因此没有 `Authorization` 注入。401 会话失效由 `main.ts` 注入的处理器统一清态并跳转登录页；登录凭证错误（`INVALID_CREDENTIALS`）不触发该跳转。
- **响应**：`request` 自动解包标准成功信封 `{ data }`；`requestRaw` 原样返回裸响应。不假设所有接口使用同一包装（例如 `GET /api/health` 为裸 `{ status }`，见 `src/api/system.ts`）。
- **错误**：`src/utils/errors.ts` 将 Axios/网络/信封错误归一化为 `ApiRequestError`；全局错误提示唯一出口为 `notifyApiError`，404 由页面决定空态，5xx 展示 `X-Request-Id`；422 可通过 `extractFieldErrors()` 映射到 `ElForm`。
- **类型**：接口 DTO 与请求类型一律来自 `@hms/shared`；前端仅保留 HTTP 层辅助类型（`src/types/api.ts`）。
- **示例页**：`/dashboard`（`src/views/dashboard/DashboardView.vue`）会调用 `/api/health` 展示后端与数据库连通性，带加载/错误/重试三态。

### 管理后台布局与导航

- **单一事实来源**：路由、页面标题、菜单名称、图标、分组、排序、角色限制全部定义在 `src/router/routes.ts` 的路由 `meta` 中；`src/router/menu.ts` 从路由派生菜单、选中项与面包屑，不在布局中重复维护。
- **布局**：`src/layouts/DefaultLayout.vue` 提供侧边导航、顶部栏、面包屑、用户菜单与主内容区。
- **折叠**：侧边栏折叠状态持久化到 localStorage（`src/stores/ui.ts`）；窗口宽度小于 1100px 时自动折叠，仍可手动切换。
- **认证与会话**：登录页调用真实 `POST /auth/login`；应用启动时守卫调用 `GET /auth/me` 重建会话（HttpOnly Cookie，不写入 localStorage）；未登录访问受保护路由 → `/login?redirect=...`；已登录访问登录页 → 安全 redirect 或 `/rooms`；退出登录调用 `POST /auth/logout` 并清理本地状态。
- **登录失败提示**：登录页内联区分凭证错误、账号锁定、限流、权限不足、网络/超时、5xx（展示 requestId）与输入校验失败；提交中禁用表单并拒绝重复提交；会话失效跳转登录时提示重新登录。
- **角色**：`/room-types`、`/users` 标记 `roles: ['ADMIN']`，菜单隐藏且守卫跳转 `/403`。按钮/操作入口使用 `v-permission="'ADMIN'"` 指令（示例：`RoomsView` 维修/停用入口）。**前端隐藏/拦截仅为 UX，后端仍对每个 API 独立鉴权**（架构 §2.9）。
- **路由骨架**：`/` → `/rooms`；`/dashboard`；`/rooms`；`/room-types`；`/guests`；`/bookings`、`/bookings/:id`；`/stays`、`/stays/:id`；`/orders`、`/orders/:id`；`/users`；`/403`；未知路由 → 404。详情路由通过 `meta.activeMenu` 保持所属菜单高亮。
- **经营看板**：`/dashboard` 为占位骨架；经营统计属 V2 范围外，未接入统计 API（见「经营统计（未实现，待决）」）。
- **页面规范**：统一使用 `src/components/page/` 下的 `PageContainer`（标题/说明/操作区）、`FilterBar`（筛选区）、`TableCard`（表格/工具栏/分页区）；页面标题与说明缺省读取路由 `meta`，避免重复维护。

### 房型与客房管理（3.3.4）

- **API 分层**：`src/api/room-types.ts`、`src/api/rooms.ts`；DTO/请求类型全部来自 `@hms/shared`，页面不手写接口类型。
- **房型管理** `/room-types`（ADMIN）：
  - 列表支持按 `status` 查询；契约不支持分页/排序参数，因此页面在客户端分页，不发送不存在的 `page/pageSize`。
  - 新建（`POST /room-types`）、编辑（`PATCH /room-types/{id}`，code 不可改）、详情（`GET /room-types/{id}`）。
  - 停用使用归档端点 `POST /room-types/{id}/archive`，归档前二次确认；**后端无删除接口**，未实现物理删除。
- **客房管理** `/rooms`：
  - 列表使用真实分页/筛选：`page/pageSize/status/roomTypeId/roomNumber/sort`；`roomNumber` 为房号前缀筛选。
  - 新建/编辑（ADMIN，`POST /rooms`、`PATCH /rooms/{id}`）、详情（`GET /rooms/{id}`）。
  - 房态操作使用 `PATCH /rooms/{id}/status`；可执行迁移与 ADMIN 限制来自 `@hms/shared` 的状态机常量，后端仍独立裁决。
  - 停用通过房态变更为 `DISABLED` 完成；**后端无客房删除接口**。数据库与 API 均无 `floor` 字段，楼层筛选未实现，使用房号前缀检索。
- **交互**：统一加载/空/失败/成功状态；列表读失败内联展示并可重试，写失败由请求层统一提示；表单提交中禁用并防重复提交；归档/停用/维修二次确认。
- **组件**：`RoomTypeFormDialog`、`RoomTypeDetailDialog`、`RoomFormDialog`、`RoomDetailDialog`、`RoomStatusTag`；房态操作逻辑集中在 `src/views/rooms/room-status.ts`。

### 预订管理（3.3.5）

- **API 分层**：`src/api/bookings.ts`、`src/api/guests.ts`；DTO 来自 `@hms/shared`。
- **列表** `/bookings`：
  - 真实分页与筛选：`page/pageSize/status/keyword/checkInDateFrom/To/checkOutDateFrom/To/sort`。
  - `keyword` 匹配客人姓名或手机号前缀；日期范围分别对应入住日期与退房日期（闭区间）。
  - 列表接口不支持按预订编号筛选，页面提供“编号直达”按 B3 详情接口打开；不伪造列表参数。
  - 状态、房价、总价均来自后端响应。
- **创建** `BookingCreateDialog`：
  - 客人通过 `GuestPicker` 调用 G1 动态搜索选择（需要客人档案已存在）。
  - 房型通过 `GET /room-types?status=ACTIVE` 动态加载；不选择具体房间（预订按房型，入住时才分配房间）。
  - 入住日期按酒店本地日 `Asia/Shanghai` 校验，`checkOutDate > checkInDate`；提交前使用共享 `createBookingSchema` 复核。
  - 不提交 `pricePerNight/totalPrice`，不计算最终业务金额；界面只展示房型参考价与后端返回金额。
  - 失败内联展示日期错误、409 售罄/归档冲突、404 资源不存在、403/网络/5xx 等信息。
- **详情/取消/未到**：`BookingDetailView` 使用 B3、B4、B5；仅 `CONFIRMED` 显示取消；仅 `CONFIRMED` 且入住日 ≤ 酒店今日显示“标记未到”；操作以服务端状态机为准。
- **未实现**：办理入住（B6）属入住流程；新建客人档案属客人管理任务；API 无“人数”字段，页面只展示房型可住人数，不保存入住人数。

### 入住与退房（3.3.6A）

- **在住管理** `/stays`：
  - “待入住预订”页签使用 B2：`status=CONFIRMED`、`checkInDateTo=酒店今日`、`checkOutDateFrom=明日`，只展示可办理入住的预订。
  - “在住 / 历史入住”页签使用 S2：支持 `CHECKED_IN/CHECKED_OUT/全部`、客人关键字、排序与分页。
  - walk-in（S1）前端入口尚未实现；后端 S1 已实现并有集成测试，前端任务见批准后行动登记。
- **办理入住** `CheckInDialog`：
  - B3 读取预订详情；M2 `GET /rooms/available` 按房型与今日→预计离店日期动态加载可分配房间。
  - 选择房间、可选押金；不提交 `pricePerNight`，使用预订价快照；二次确认后调用 B6。
  - 成功/失败均以服务端状态为准；网络超时或 5xx 时通过 B3 核对预订是否已 `CHECKED_IN` 且存在 `stayId`，只有服务端确认才展示成功。
- **退房结算** `CheckoutDialog` + `CheckoutResult`：
  - S3 展示服务端实时费用；S4 提交支付方式、杂费、备注，二次确认后生成账单。
  - 直接展示 S4 返回的账单明细/金额；网络超时或 5xx 时通过 S3 核对 `CHECKED_OUT`，再通过 O2 加载完整账单；账单明细加载失败时展示 S3 账单摘要并支持重试。
  - 退房成功后刷新列表/详情，不本地伪造房态或入住状态。
- **状态与权限**：入住/退房入口由服务端状态决定（`CONFIRMED` / `CHECKED_IN`），所有登录角色可操作；后端仍独立校验重复入住、重复退房、房间占用与权限。
- **待实现**：walk-in 入住（S1）前端入口；订单独立页面已实现（见“账单查询”章节）。

### 账单查询（3.3.6B）

- **接口**：O1 `GET /orders` 分页列表；O2 `GET /orders/{id}` 详情。账单由 S4 退房事务生成，前端只读。
- **列表筛选**：后端仅支持 `createdFrom/createdTo`（酒店本地日闭区间）、`stayId`、分页与 `createdAt` 排序；页面没有提供后端不支持的“状态/客户”筛选参数。
- **金额展示**：应付总额 `totalAmount`、押金登记 `depositAmount`、押金抵扣 `depositApplied`、实收金额 `paidAmount` 全部直接使用服务端字段；费用明细来自 O2 `items`。
- **契约缺字段**：无折扣、剩余金额、独立支付流水实体；前端未计算或伪造这些字段。
- **支付提示**：未接入第三方支付渠道；页面明确标注“支付方式/状态为前台收银内部落账记录，不代表真实资金到账”。
- **只读**：没有支付、退款、修改账单等按钮；仅提供返回列表与查看关联入住记录。
- **关联**：详情可跳转 `/stays/{stayId}` 查看入住记录。

### 员工与客户管理（3.3.7A/B）

- **员工管理** `/users`（ADMIN）：
  - U1 分页列表：`keyword/role/status/sort`；U5 详情；U2 创建；U3 修改姓名/角色；U4 重置密码。
  - 启停通过 U3 `status` 完成，二次确认；停用后员工所有会话立即失效。当前登录账号不显示启停入口，编辑自身时角色控件禁用且请求体不包含角色。
  - 响应字段仅使用 `UserListItemDto`；页面不展示密码哈希、会话或令牌。
- **客户管理** `/guests`（登录角色）：
  - G1 分页搜索、G3 详情（含最近预订）、G2 创建、G4 编辑。
  - 证件号创建时输入并加密提交，列表/详情仅展示服务端掩码；编辑不提交证件字段，前端不保存证件明文。
  - 后端无删除接口，页面不提供删除；客户管理表单使用共享 zod schema 校验姓名、手机号、证件号与备注。

### 经营看板（3.3.7C，受接口阻塞）

- 已批准设计将统计看板列为 V2 范围外（Q-04/A-02），当前**无统计接口、统计表/字段与已批准口径**。
- `/dashboard` 明确展示“未接入”状态与待批准指标说明，不使用 Mock 数据，也不通过前端拼接业务明细推算入住率、客房数、预订量或收入。
- 系统连通性检查仅用于工程状态，不作为经营指标。

### 前端命令

```bash
pnpm install                     # 安装工作区依赖
pnpm dev:web                     # 开发服务器 http://localhost:5173
pnpm --filter @hms/web typecheck # vue-tsc 类型检查
pnpm --filter @hms/web lint      # ESLint
pnpm --filter @hms/web test      # Vitest（含 HTTP 客户端行为测试）
pnpm --filter @hms/web build     # 类型检查 + 生产构建
pnpm --filter @hms/web format:check
pnpm --filter @hms/web check     # typecheck + lint + format:check + test
```

## 常用命令

| 命令                                | 说明                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `pnpm dev:server` / `pnpm dev:web`  | 启动后端 / 前端开发服务                                                  |
| `pnpm build`                        | 递归构建（server: tsc；web: vue-tsc + vite build；shared: tsc --noEmit） |
| `pnpm typecheck`                    | 递归类型检查                                                             |
| `pnpm lint`                         | ESLint（含 `vue/no-v-html`）                                             |
| `pnpm format` / `pnpm format:check` | Prettier 格式化 / 校验                                                   |
| `pnpm test`                         | 递归运行 Vitest                                                          |
| `pnpm check`                        | `typecheck + lint + format:check + test` 一键质量门禁                    |
| `pnpm db:deploy`                    | 应用已有迁移（幂等，部署入口）                                           |
| `pnpm db:migrate`                   | 开发模式生成并应用迁移（`prisma migrate dev`）                           |
| `pnpm db:seed`                      | 初始化管理员（仅空表执行，密码来自环境变量）                             |
| `pnpm compose:config`               | 校验两套 Compose 配置（使用 `.env.example` 占位值）                      |

## 测试

- 位置：`apps/server/tests/`（Vitest + Supertest）、`apps/web/tests/`（Vue Test Utils）、`packages/shared/tests/`。
- 前端基础设施测试覆盖：环境化 `baseURL`/超时、`withCredentials` 与请求头、成功信封解包、裸响应（健康检查）透传、401 会话失效与登录凭证错误分流、409/422/5xx 错误归一化、`X-Request-Id` 提取、超时映射、`silent` 抑制提示。
- 前端布局与导航测试覆盖：ADMIN/RECEPTIONIST 菜单过滤与顺序、菜单名称与路由 `meta.title` 一致性、列表/详情面包屑与 `activeMenu` 高亮、未登录 redirect、ADMIN 路由 403、安全 redirect 拒绝外部地址、侧边栏折叠持久化、布局组件渲染与用户菜单位置。
- 前端登录与认证测试覆盖：正确凭据跳转安全 redirect、错误凭据/账号锁定/网络异常内联提示、会话过期提示、空表单不提交、提交中重复提交仅调用一次接口、登录失败分类不泄露内部错误、`v-permission` 按钮级角色过滤、`fetchMe` 会话重建与登出清理。
- 房型/客房前端测试覆盖：API 路径、方法、查询参数与请求体契约；房型列表加载/空态/错误重试；客房列表分页参数、房态与在住摘要展示、空态/错误重试；ADMIN/RECEPTIONIST 操作入口过滤；房态迁移与 ADMIN 限制的 UI 可执行操作矩阵。
- 预订前端测试覆盖：B2 筛选/分页参数与 B1/B3/B4/B5 路径、方法、请求体；G1 客人搜索参数；酒店本地日/跨日与晚数计算；列表加载/空态/错误重试与编号直达；详情价格/状态展示、CONFIRMED 取消/未到按钮条件、取消后刷新服务端状态；空表单阻止创建。
- 入住/退房前端测试覆盖：B6 入住、S2 列表、S3 详情、S4 退房、O2 账单与 M2 可分配房间的路径/参数/请求体；待入住与在住页签加载/错误重试；入住/退房按钮状态；超时/5xx 时“只有服务端确认才判定成功”的核对逻辑；账单明细与摘要展示。
- 账单前端测试覆盖：O1 日期/入住记录/分页/排序参数与 O2 详情路径；列表字段、金额、状态、支付方式与内部收银提示；详情费用明细/押金抵扣/实收金额；只读页面无支付/退款/修改按钮；加载失败重试与关联入住跳转。
- 员工/客人前端测试覆盖：U1/U5/U2/U3/U4 与 G1/G3/G2/G4 路径/参数/请求体；员工列表、自身账号启停入口隐藏、空态/错误重试；客人列表掩码展示、空态/错误重试；员工/客人空表单阻止提交；自身编辑时角色修改提示。
- 后端基础设施测试覆盖：健康检查（数据库可达 → 200 / 不可达 → 503）、数据库探测真实执行 `SELECT 1` 与超时、统一错误信封（400/401/403/404/409/422/500）、CSRF、环境变量 fail-fast、日志敏感字段 redact。
- 认证模块测试覆盖：登录成功/失败/锁定/停用、会话解析（未登录/无效/过期/停用）、登出、限流、角色越权（403）、日志无敏感信息。
- 房型/客房测试覆盖：CRUD 与分页（page/pageSize/totalPages、排序白名单注入 422、非法分页 422）、房号/房型/价格/容量校验、归档引用限制（CONFIRMED 预订 / CHECKED_IN 在住）、房态状态机与角色矩阵（清洁完成前台可做、维修/停用仅 ADMIN、OCCUPIED 不可人工设置）、可分配房间的占用区间判定、在住摘要。
- 预订模块测试覆盖：价格快照与总价服务端计算、客人/房型校验、归档房型拒绝、半开区间重叠判定（相邻区间允许、部分重叠拒绝）、售罄释放（取消/未到后可再订）、状态机（重复取消、CHECKED_IN 不可取消、未到入住日不可 NO_SHOW）、上海时区日期边界（`hotelToday` 跨日）、**并发防超售（10 并发仅可售数成功）**、退房日期范围筛选★、排序注入 422。
- 入住/退房测试覆盖：预订入住与 walk-in 成功（房态/预订/占用/操作员工联动）、未到入住日/维修房/房型不匹配/重复办理/占用冲突全部 409 且**回滚**（预订与房态不变）、**并发同房入住仅一次成功（TC-BK-021/TC-SY-004）**、预订离店日已到/已过入住 409 `BOOKING_DATE_MISMATCH`（含回滚断言）、凌晨入住按酒店本地日历日计晚数（不多收一晚）、退房账单计算与押金抵扣（含押金超过总额）、重复/并发退房仅生成一张账单（TC-SY-012）、退房释放占用、列表筛选与排序注入 422、未登录 401。
- 账单测试覆盖：O1 筛选（含酒店本地日边界）与分页、O2 明细完整、金额边界（0.01 最小额、押金=总额封顶、两位小数累计不漂移、99999.99 大额）、伪造 `totalAmount` 422、重复账单冲突 409 且**事务整体回滚**（房态/入住/占用不变）、权限与 404/422。
- 员工/客人测试覆盖：员工 CRUD/分页/筛选/排序注入、用户名唯一 409、弱密码与"密码含用户名" 422、非 ADMIN 403、**停用自己 403**、**停用后会话即时失效**、**重置密码后旧会话/旧密码失效**、响应无密码哈希；客人证件 AES-GCM 加密落库（密文布局/HMAC 查重）与掩码返回、重复证件 409（existingGuestId）、不同证件类型可复用号码、列表关键字/手机前缀/排序、详情近期预订、证件号修改 409、输入校验与 401/403。
- 单元测试不依赖真实数据库（数据库探测与仓储通过依赖注入替换）；真实数据库行为用 `docker compose up -d mysql` + `curl http://localhost:3000/api/health` 冒烟验证（停库应返回 503，恢复后返回 200）。
- 集成测试（Supertest + 真实 MySQL）默认跳过，需显式启用：`docker compose up -d mysql` 后运行
  `HMS_INTEGRATION=1 pnpm --filter @hms/server test`（测试数据以 `itest_`/随机后缀创建并自动清理）。
- CI（2026-10-18 实际结果）：`static-and-unit`、`integration`、`secret-scan` 三个 job 全绿；单元测试 318（shared 37 + server 146 + web 135），integration job 249 passed / 35 files（含 server 单测与真库用例）。E2E 仍未实现。

## 生产形态部署

```bash
cp .env.example .env    # 替换全部占位值
docker compose -f compose.prod.yml up -d --build
docker compose -f compose.prod.yml --profile tools run --rm seed   # 可选：初始化管理员
```

- `api` 容器启动时自动执行 `prisma migrate deploy`（只应用未执行迁移，幂等；失败则容器不启动）。
- 迁移采用前滚策略，禁止手工改生产库结构（详见 `docs/database-design.md` §7）。
- MySQL 不映射宿主端口，仅 Compose 内网可达。
- **生产上线门禁**：Q-09 A（TLS/域名、`Secure`/HSTS）与 Q-08 B（PII 合规/保留期评审）必须先完成；A-20 B（首登强制改密）已批准但**尚未实现**，上线前必须补齐。

## 故障排查

| 症状                                   | 处理                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm` 命令不可用/报 corepack 模块错误 | 重新安装：`npm i -g pnpm@12.6.0`                                                      |
| 启动报“环境变量校验失败”               | 按提示字段对照 `apps/server/.env.example` 补齐                                        |
| 数据库密码含特殊字符导致连接失败       | 对密码做 URL 编码，或改用 base64url 随机密码                                          |
| 端口冲突                               | `MYSQL_HOST_PORT`（默认 3307）、`PORT`（3000）、Vite（5173）、`WEB_HTTP_PORT`（8080） |

## 文档索引

- 项目协议与约束：`docs/00-project-charter.md`、`docs/AGENTS.md`
- 架构：`docs/architecture.md`
- 数据库：`docs/database-design.md`
- API 契约：`docs/api-contract.md` + `openapi/openapi.yaml`
- 安全：`docs/security-design.md`
- 开发计划：`docs/development-plan.md`
- 需求追踪（批准前历史）：`docs/requirements-traceability.md`
- 已批准需求基线：`docs/requirements-traceability-approval-draft.md`
- 业务假设决议：`docs/business-assumptions-decision-list.md`
- 批准决策摘要：`docs/requirements-approval-decision-summary.md`
- 批准后行动登记：`docs/post-approval-action-register.md`
