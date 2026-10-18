# API 契约 — 酒店管理系统（HMS）

| 项 | 值 |
| --- | --- |
| 文档版本 | v1.0（待评审，未冻结） |
| 机器可读契约 | [`openapi/openapi.yaml`](../openapi/openapi.yaml)（OpenAPI 3.0.3，**单一事实来源**） |
| 实现引用 | 前后端一律 `import { ... } from '@hms/shared'`，禁止手写接口类型（架构 ADR-004） |
| 日期 | 2026-10-14 |

---

## 1. 通用约定

### 1.1 基础

- Base URL：`/api/v1`；生产同源（Nginx 反代），开发经 Vite proxy——Cookie 始终同源。
- Content-Type：`application/json; charset=utf-8`（GET 无体）。
- 认证：`Cookie: hms_sid=<sid>`（HttpOnly，见 security-design.md）。OpenAPI 中以 `cookieAuth` 安全方案表达。
- 字段命名：请求/响应一律 `camelCase`；日期 `YYYY-MM-DD`（酒店日历日），时刻 ISO 8601 UTC（如 `2026-10-14T07:30:00.000Z`）。
- 幂等性：除"创建"类 POST 外，重复提交由服务端状态机/唯一约束拒绝（返回 409），前端无需额外防重（但会做按钮 loading 优化体验）。

### 1.2 统一响应信封（ADR-009）

成功（HTTP 2xx）：

```json
{ "data": { } }
```

- 列表：`{ "data": { "items": [ ... ], "pagination": { "page": 1, "pageSize": 20, "total": 57, "totalPages": 3 } } }`
- 204 无-body 场景本期不使用（创建/更新均返回资源）。

失败（HTTP 4xx/5xx）：

```json
{ "error": { "code": "ROOM_TYPE_SOLD_OUT", "message": "所选日期该房型已无可售房间", "details": [ { "field": "checkOutDate", "message": "10-15 至 10-16 已满" } ] } }
```

- `details` 仅 422 必有，其他码可省略。
- 所有 5xx 响应携带 `X-Request-Id` 头（便于报障检索日志）。

### 1.3 分页与排序约定

- 分页参数（query）：`page`（默认 1，≥1）、`pageSize`（默认 20，1–100）。
- 排序参数（query）：`sort=field:asc|desc`，多字段逗号分隔（如 `sort=status:asc,createdAt:desc`）；每端点声明**白名单字段**，越界字段 422。
- 列表默认排序：`id:desc`（最新在前）。
- 计数响应：`total` 为符合条件的总行数；`totalPages = ceil(total/pageSize)`。

### 1.4 状态码使用

| 状态码 | 语义 | 示例错误码 |
| --- | --- | --- |
| 200 | 成功（含业务读） | — |
| 400 | 请求体畸形（非 JSON 等） | INVALID_BODY |
| 401 | 未认证 / 会话过期 / 凭证错误 | SESSION_EXPIRED、INVALID_CREDENTIALS |
| 403 | 已认证但无权限 | FORBIDDEN、PASSWORD_CHANGE_REQUIRED |
| 404 | 资源不存在 | NOT_FOUND |
| 409 | 业务冲突 / 状态机非法 / 唯一冲突 | ROOM_TYPE_SOLD_OUT、ROOM_OCCUPIED、BOOKING_STATUS_INVALID、DUPLICATE_USERNAME、GUEST_EXISTS |
| 422 | 参数校验失败 | VALIDATION_FAILED（details 必有） |
| 423 | 账户锁定 | ACCOUNT_LOCKED |
| 429 | 请求过于频繁（登录限流） | RATE_LIMITED |
| 500 | 服务器内部错误 | INTERNAL_ERROR（含 requestId） |

### 1.5 错误码注册表（`@hms/shared/errorCodes.ts`，前后端共用）

| code | HTTP | 场景 |
| --- | --- | --- |
| INVALID_BODY | 400 | 请求体无法解析 |
| INVALID_CREDENTIALS | 401 | 用户名或密码错误（统一文案，防枚举） |
| SESSION_EXPIRED | 401 | 无有效会话 |
| ACCOUNT_LOCKED | 423 | 连续失败锁定中 |
| RATE_LIMITED | 429 | 登录尝试过于频繁（每 IP 每分钟 10 次，security-design §3） |
| FORBIDDEN | 403 | 角色不满足 |
| PASSWORD_CHANGE_REQUIRED | 403 | 首登未改密，仅允许 me/logout/change-password（A-20 B） |
| NOT_FOUND | 404 | 资源不存在 |
| VALIDATION_FAILED | 422 | 参数校验失败 |
| DUPLICATE_USERNAME | 409 | 员工用户名已存在 |
| ROOM_NUMBER_EXISTS | 409 | 房号已存在 |
| ROOM_TYPE_CODE_EXISTS | 409 | 房型代码已存在 |
| ROOM_TYPE_ARCHIVED | 409 | 房型已归档不可售 |
| ROOM_STATUS_INVALID | 409 | 房态状态机非法迁移 |
| ROOM_NOT_ASSIGNABLE | 409 | 房间处于维修/停用等不可分配状态 |
| ROOM_OCCUPIED | 409 | 目标日期段房间已被占用 |
| ROOM_TYPE_SOLD_OUT | 409 | 房型可售房量不足 |
| GUEST_EXISTS | 409 | 证件号已有档案（返回 existingGuestId） |
| BOOKING_STATUS_INVALID | 409 | 预订状态机非法迁移 |
| BOOKING_DATE_MISMATCH | 409 | 入住/离店日期与预订不符 |
| STAY_STATUS_INVALID | 409 | 入住记录状态机非法迁移 |
| INTERNAL_ERROR | 500 | 兜底（日志 + requestId） |

---

## 2. 接口索引

| # | 方法 + 路径 | 角色 | 需求 | 测试组 |
| --- | --- | --- | --- | --- |
| A1 | POST /auth/login | 公开 | FR-AUTH-001 | TC-AUTH |
| A2 | POST /auth/logout | 登录 | FR-AUTH-002 | TC-AUTH |
| A3 | GET /auth/me | 登录 | FR-AUTH-003 | TC-AUTH |
| A4 | POST /auth/change-password | 登录 | A-20 B | TC-AUTH |
| U1 | GET /users | ADMIN | FR-USER-001 | TC-USER |
| U2 | POST /users | ADMIN | FR-USER-002 | TC-USER |
| U3 | PATCH /users/{id} | ADMIN | FR-USER-003 | TC-USER |
| U4 | PATCH /users/{id}/password | ADMIN | FR-USER-004 | TC-USER |
| U5★ | GET /users/{id} | ADMIN | FR-USER-001 | TC-USER |
| R1 | GET /room-types | 登录 | FR-RT-001 | TC-RT |
| R2 | POST /room-types | ADMIN | FR-RT-002 | TC-RT |
| R3 | PATCH /room-types/{id} | ADMIN | FR-RT-002 | TC-RT |
| R4 | POST /room-types/{id}/archive | ADMIN | FR-RT-002 | TC-RT |
| R5★ | GET /room-types/{id} | 登录 | FR-RT-001 | TC-RT |
| M1 | GET /rooms | 登录 | FR-RM-001 | TC-RM |
| M2 | GET /rooms/available | 登录 | FR-RM-004 | TC-RM |
| M3 | POST /rooms | ADMIN | FR-RM-002 | TC-RM |
| M4 | PATCH /rooms/{id} | ADMIN | FR-RM-002 | TC-RM |
| M5 | PATCH /rooms/{id}/status | 登录（按目标状态细分） | FR-RM-003 | TC-RM |
| M6★ | GET /rooms/{id} | 登录 | FR-RM-001 | TC-RM |

> ★ 详情端点为 T-07 实施期的**契约增量**（任务要求"详情查询"，原契约缺失），实现与 openapi 已同步，需评审追认。
| G1 | GET /guests | 登录 | FR-GS-001 | TC-GS |
| G2 | POST /guests | 登录 | FR-GS-002 | TC-GS |
| G3 | GET /guests/{id} | 登录 | FR-GS-003 | TC-GS |
| G4 | PATCH /guests/{id} | 登录 | FR-GS-004 | TC-GS |
| B1 | POST /bookings | 登录 | FR-BK-001 | TC-BK |
| B2 | GET /bookings | 登录 | FR-BK-002 | TC-BK |
| B3 | GET /bookings/{id} | 登录 | FR-BK-003 | TC-BK |
| B4 | POST /bookings/{id}/cancel | 登录 | FR-BK-004 | TC-BK |
| B5 | POST /bookings/{id}/no-show | 登录 | FR-BK-005 | TC-BK |
| B6 | POST /bookings/{id}/check-in | 登录 | FR-BK-006 | TC-BK/TC-SY |
| S1 | POST /stays | 登录 | FR-SY-001 | TC-SY |
| S2 | GET /stays | 登录 | FR-SY-002 | TC-SY |
| S3 | GET /stays/{id} | 登录 | FR-SY-003 | TC-SY |
| S4 | POST /stays/{id}/checkout | 登录 | FR-SY-004 | TC-SY |
| O1 | GET /orders | 登录 | FR-OD-001 | TC-OD |
| O2 | GET /orders/{id} | 登录 | FR-OD-002 | TC-OD |

---

## 3. 认证域 `/auth`

### A1 登录 `POST /auth/login`

| 角色 | 公开 | 需求 | FR-AUTH-001 | 测试 | TC-AUTH-001 成功；002 密码错误 401 且文案统一；003 第 5 次失败后 423；004 锁定期间正确密码仍 423 |

请求体：

```json
{ "username": "front01", "password": "Plain#2026!" }
```

校验：`username` `^[a-zA-Z0-9_]{3,50}$`；`password` 字符串 1–72（bcrypt 上限 72 字节）。

成功 `200`（`Set-Cookie: hms_sid=...; HttpOnly; SameSite=Strict; Path=/`）：

```json
{ "data": { "id": 2, "username": "front01", "displayName": "王小雅", "role": "RECEPTIONIST", "mustChangePassword": false } }
```

错误 `401`：

```json
{ "error": { "code": "INVALID_CREDENTIALS", "message": "用户名或密码错误" } }
```

错误 `423`：

```json
{ "error": { "code": "ACCOUNT_LOCKED", "message": "失败次数过多，账号已锁定，请 15 分钟后重试" } }
```

错误 `429`（登录限流，security-design §3）：

```json
{ "error": { "code": "RATE_LIMITED", "message": "尝试次数过多，请稍后再试" } }
```

### A2 登出 `POST /auth/logout`

| 角色 | 已登录 | 需求 | FR-AUTH-002 | 测试 | TC-AUTH-005 登出后原 Cookie 访问 A3 得 401 |

请求体：无。成功 `200`：`{ "data": { "ok": true } }`（删除 session 行并清除 Cookie）。错误：`401 SESSION_EXPIRED`。

### A3 当前用户 `GET /auth/me`

| 角色 | 已登录 | 需求 | FR-AUTH-003 | 测试 | TC-AUTH-006 刷新页面后重建会话 |

成功 `200`：同 A1 `data` 结构（另含 `status`、`mustChangePassword`）。错误：`401 SESSION_EXPIRED`（前端据此跳登录）。

### A4 自助改密 `POST /auth/change-password`（A-20 B）

| 角色 | 已登录 | 需求 | A-20 B | 测试 | 首登未改密 → 403；改密后会话/旧密码失效；新密码可登录 |

请求体：

```json
{ "currentPassword": "Old#Pass1234", "newPassword": "New#Pass5678" }
```

- 校验：当前密码必须正确；新密码 ≥10 位、≤72 字节、含字母与数字、不得包含用户名、不得与当前密码相同。
- 成功 `200`：`{ "data": { "ok": true } }`；服务端清除 `must_change_password` 并删除该用户全部 sessions，前端应重新登录。
- 错误：`422 VALIDATION_FAILED`（字段 `currentPassword`/`newPassword`）、`401 SESSION_EXPIRED`。
- 首登未改密期间，除 `GET /auth/me`、`POST /auth/logout`、本端点外，受保护 API 返回 `403 PASSWORD_CHANGE_REQUIRED`。

---

## 4. 员工域 `/users`（均 ADMIN）

### U1 列表 `GET /users?page=1&pageSize=20&role=RECEPTIONIST&status=ACTIVE&keyword=王&sort=createdAt:desc`

| 需求 | FR-USER-001 | 测试 | TC-USER-001 分页/筛选/排序生效；002 非 ADMIN 403 |

校验：`role ∈ {ADMIN,RECEPTIONIST}`、`status ∈ {ACTIVE,DISABLED}`、`keyword` ≤50；sort 白名单 `createdAt,username,lastLoginAt`。
响应 `items[]`：`{ id, username, displayName, role, status, lastLoginAt, createdAt }`（**不含 password_hash**）。

### U2 创建 `POST /users`

| 需求 | FR-USER-002 | 测试 | TC-USER-003 创建成功；004 用户名重复 409；005 弱密码 422 |

```json
{ "username": "front02", "password": "Init#12345", "displayName": "李雷", "role": "RECEPTIONIST" }
```

校验：username 同 A1；`password` ≥10 位且含字母+数字（策略见 security-design.md §3）；成功 `200` 返回用户对象（同 U1 项）。错误 `409 DUPLICATE_USERNAME`。

### U3 修改 `PATCH /users/{id}`

| 需求 | FR-USER-003 | 测试 | TC-USER-006 改角色/启停生效；007 停用后该用户即刻 401 |

```json
{ "displayName": "李雷（值班）", "role": "RECEPTIONIST", "status": "DISABLED" }
```

全部字段可选；服务层规则：ADMIN 不得停用自己（`403 FORBIDDEN` + message 说明原因）。成功返回更新后对象。

### U4 重置密码 `PATCH /users/{id}/password`

| 需求 | FR-USER-004 | 测试 | TC-USER-008 重置后旧密码 401 新密码 200；009 重置后其所有会话失效 |

```json
{ "newPassword": "New#Pass1234" }
```

成功 `200 { "data": { "ok": true } }`；副作用：删除该用户全部 sessions（强制重新登录）。

### U5★ 详情 `GET /users/{id}`（ADMIN）

契约增量（T-06 实施，需评审追认）：返回单个 `UserListItem` 对象；不存在 404；非法 id 422。实现见 `openapi/openapi.yaml`。

---

## 5. 房型域 `/room-types`

### R1 列表 `GET /room-types?status=ACTIVE`

| 角色 | 登录 | 需求 | FR-RT-001 | 测试 | TC-RT-001 返回含价格与房间数 |

响应 `items[]`：`{ id, code, name, basePrice, capacity, description, status, roomCount, createdAt, updatedAt }`。`roomCount` 为该房型未停用房间数（看板展示用）。

### R2 创建 `POST /room-types`（ADMIN）

| 需求 | FR-RT-002 | 测试 | TC-RT-002 成功；003 code 重复 409；004 价格负数 422 |

```json
{ "code": "DLX", "name": "豪华大床房", "basePrice": 388.00, "capacity": 2, "description": "25㎡，高层城景" }
```

校验：`code` `^[A-Z0-9]{2,20}$`；`basePrice` 0–99999.99；`capacity` 1–20；错误示例 `409 ROOM_TYPE_CODE_EXISTS`。

### R3 修改 `PATCH /room-types/{id}`（ADMIN）

| 需求 | FR-RT-002 | 测试 | TC-RT-005 调价不影响存量预订价格（同时回归 TC-BK-001 价格快照断言） |

```json
{ "name": "豪华大床房（翻新）", "basePrice": 428.00 }
```

### R4 归档 `POST /room-types/{id}/archive`（ADMIN）

| 需求 | FR-RT-002 | 测试 | TC-RT-006 归档后不可创建该房型预订；007 存在未完结 CONFIRMED 预订时拒绝归档（409） |

校验：仅当该房型无 `CONFIRMED` 预订且无 `CHECKED_IN` 在住时允许；成功返回 `{ status: "ARCHIVED" }` 对象。

### R5★ 详情 `GET /room-types/{id}`（登录）

契约增量（T-07 实施，需评审追认）：返回单个 `RoomType` 对象；不存在 404；非法 id 422。实现见 `openapi/openapi.yaml`。

---

## 6. 客房域 `/rooms`

### M1 列表 `GET /rooms?status=VACANT_CLEAN&roomTypeId=1&page=1&pageSize=50&sort=roomNumber:asc`

| 角色 | 登录 | 需求 | FR-RM-001 | 测试 | TC-RM-001 筛选与分页；002 房态看板数据（含在住摘要） |

sort 白名单：`roomNumber,status,createdAt`；分页参数 `page/pageSize`（默认 1/20）。
★ 增量参数（T-07 实施，需评审追认）：`roomNumber`（房号前缀筛选，≤20 字符）。响应 `items[]`：

```json
{
  "id": 12, "roomNumber": "0821", "roomTypeId": 1, "roomTypeName": "标准大床房",
  "status": "OCCUPIED", "note": null,
  "currentStay": { "stayId": 501, "guestName": "张三", "checkInAt": "2026-10-13T14:02:11.000Z", "expectedCheckOutDate": "2026-10-15" },
  "createdAt": "2026-09-01T02:00:00.000Z", "updatedAt": "2026-10-13T14:02:11.000Z"
}
```

`currentStay` 仅 OCCUPIED 时非空（最近一条在住，脱敏姓名不加，全名给员工）。

### M2 可分配房间 `GET /rooms/available?roomTypeId=1&checkInDate=2026-10-14&checkOutDate=2026-10-16`

| 角色 | 登录 | 需求 | FR-RM-004 | 测试 | TC-RM-003 排除日期重叠占用房；004 排除维修/停用房 |

校验：`checkOutDate > checkInDate`（422）；响应 `items[]`：`{ id, roomNumber, status }`（仅 `VACANT_CLEAN/VACANT_DIRTY` 且在区间内无 occupancy 行的房间）。

### M3 创建 `POST /rooms`（ADMIN）

| 需求 | FR-RM-002 | 测试 | TC-RM-005 成功；006 房号重复 409；007 房型不存在 404 |

```json
{ "roomNumber": "0822", "roomTypeId": 1, "note": "无窗房" }
```

### M4 修改 `PATCH /rooms/{id}`（ADMIN）

| 需求 | FR-RM-002 | 测试 | TC-RM-008 改房型需房间非在住（409）；009 改房号唯一性 |

```json
{ "roomNumber": "0822", "roomTypeId": 2, "note": "已装新风" }
```

服务层规则：`OCCUPIED` 房间禁止修改房型/房号（仅 note），`409 ROOM_STATUS_INVALID`。

### M5 房态变更 `PATCH /rooms/{id}/status`

| 需求 | FR-RM-003 | 测试 | TC-RM-010 清洁完成 DIRTY→CLEAN；011 非法迁移（CLEAN→OCCUPIED 人工指定）409；012 RECEPTIONIST 报维修 403 |

```json
{ "status": "VACANT_CLEAN" }
```

角色规则：`VACANT_DIRTY→VACANT_CLEAN`（清洁完成）登录用户即可；进入/退出 `MAINTENANCE`、`DISABLED` 仅 ADMIN。全部迁移按 database-design §5.2 状态机校验；`OCCUPIED` 不允许人工设置（只能经退房事务）。维修/停用/恢复在事务内先锁房型行（§6.1 对称规则）。

### M6★ 详情 `GET /rooms/{id}`（登录）

契约增量（T-07 实施，需评审追认）：返回单个 `Room` 对象（含 `currentStay`）；不存在 404；非法 id 422。实现见 `openapi/openapi.yaml`。

---

## 7. 客人域 `/guests`

### G1 列表 `GET /guests?keyword=张&phone=138&page=1&pageSize=20&sort=createdAt:desc`

| 需求 | FR-GS-001 | 测试 | TC-GS-001 关键字模糊姓名/前缀手机；002 分页 |

sort 白名单：`createdAt,name`。`items[]`：`{ id, name, phone, idType, idNumberMasked, remark, createdAt }`。

### G2 创建 `POST /guests`

| 需求 | FR-GS-002 | 测试 | TC-GS-003 成功且证件掩码返回；004 同证件重复 409 带 existingGuestId；005 手机格式 422 |

```json
{ "name": "张三", "phone": "13800138000", "idType": "ID_CARD", "idNumber": "110101199001011234", "remark": "VIP 常客" }
```

校验：`name` 1–100；`phone` `^1[3-9]\d{9}$|^\+?\d{6,20}$`；`idType ∈ {ID_CARD,PASSPORT,OTHER}`；`idNumber` `^[A-Za-z0-9]{5,30}$`。
成功 `200`：

```json
{ "data": { "id": 9, "name": "张三", "phone": "13800138000", "idType": "ID_CARD", "idNumberMasked": "1***********4", "remark": "VIP 常客", "createdAt": "2026-10-14T06:00:00.000Z" } }
```

错误 `409`：

```json
{ "error": { "code": "GUEST_EXISTS", "message": "该证件号已有客人档案", "details": [ { "field": "idNumber", "message": "existingGuestId: 7" } ] } }
```

### G3 详情 `GET /guests/{id}`

| 需求 | FR-GS-003 | 测试 | TC-GS-006 返回掩码证件号且响应中无明文字段；007 404 |

响应同 G2 `data`，另含 `updatedAt`、最近 10 条预订/入住摘要 `recentBookings`（id、日期、状态）。

### G4 修改 `PATCH /guests/{id}`

| 需求 | FR-GS-004 | 测试 | TC-GS-008 改手机/备注；009 证件号不允许修改（409） |

```json
{ "phone": "13900139000", "remark": "已更新联系方式" }
```

服务层规则：`idType/idNumber` 创建后不可改（改证件=新档案），尝试修改返回 `409`（code `GUEST_EXISTS`，message 说明"证件号不可修改"）。**保守做法待评审**【假设 A-16】。
实现说明：`UpdateGuestRequest` 正式字段为 `name/phone/remark`；服务端额外接受可选的 `idType/idNumber` 仅用于识别修改意图并返回 409（与 openapi 的 409 响应定义一致；属 T-08 实施期的文档一致性处理）。

---

## 8. 预订域 `/bookings`

### B1 创建 `POST /bookings`

| 角色 | 登录 | 需求 | FR-BK-001 | 测试 | TC-BK-001 成功（价格快照正确）；002 房量不足 409；003 日期倒挂 422；004 归档房型 409；005 并发 10 请求仅成功 ≤可售数（集成） |

```json
{ "guestId": 9, "roomTypeId": 1, "checkInDate": "2026-10-15", "checkOutDate": "2026-10-17", "pricePerNight": 288.00, "note": "高楼层" }
```

校验：`guestId/roomTypeId` 正整数（存在性 404 由服务层返回）；`checkInDate` ≥ 今日（本地日）、`checkOutDate > checkInDate`；`pricePerNight` 可选 0.01–99999.99（缺省取房型 basePrice）。
成功 `200`：

```json
{
  "data": {
    "id": 301, "guestId": 9, "guestName": "张三", "guestPhone": "13800138000",
    "roomTypeId": 1, "roomTypeName": "标准大床房",
    "checkInDate": "2026-10-15", "checkOutDate": "2026-10-17", "roomCount": 1,
    "pricePerNight": 288.00, "totalPrice": 576.00,
    "status": "CONFIRMED", "note": "高楼层", "createdAt": "2026-10-14T06:10:00.000Z", "updatedAt": "2026-10-14T06:10:00.000Z"
  }
}
```

错误 `409`：

```json
{ "error": { "code": "ROOM_TYPE_SOLD_OUT", "message": "10-15 至 10-17 该房型已无可售房间", "details": [ { "field": "checkOutDate", "message": "剩余可售: 0" } ] } }
```

### B2 列表 `GET /bookings?status=CONFIRMED&guestId=9&checkInDateFrom=2026-10-14&checkInDateTo=2026-10-20&keyword=张&page=1&pageSize=20&sort=createdAt:desc`

| 需求 | FR-BK-002 | 测试 | TC-BK-006 多条件组合；007 日期范围过滤 |

`items[]` 同 B1 `data` 结构（列表含 note）；sort 白名单：`createdAt,checkInDate,status`（默认 `createdAt:desc`）；`keyword` 匹配客人姓名子串或手机号前缀。
★ 增量参数（T-09 实施，需评审追认）：`checkOutDateFrom` / `checkOutDateTo`（按退房日期范围筛选，闭区间）。

### B3 详情 `GET /bookings/{id}`

| 需求 | FR-BK-003 | 测试 | TC-BK-008 详情含客人摘要；009 404；010 已入住预订含 stayId 关联 |

响应为 B1 `data` 的超集：另含 `stayId`（已入住时非空）、`cancelledAt`、`cancelReason`。

### B4 取消 `POST /bookings/{id}/cancel`

| 需求 | FR-BK-004 | 测试 | TC-BK-011 CONFIRMED→CANCELLED 且房量释放（回归 002 场景可再订）；012 重复取消 409；013 CHECKED_IN 不可取消 409 |

```json
{ "reason": "客人行程变更" }
```

成功 `200` 返回更新后 booking（`status: "CANCELLED", cancelledAt`，含 `cancelReason`）；删记录一律不物理删除，仅状态迁移（事务内先锁房型行防与创建竞态）。

### B5 标记未到 `POST /bookings/{id}/no-show`

| 需求 | FR-BK-005 | 测试 | TC-BK-014 CONFIRMED→NO_SHOW 释放房量；015 非 CONFIRMED 409 |

请求体无。仅 `checkInDate <= 今日（酒店本地日 Asia/Shanghai）` 可标记【假设 A-17】；未到入住日返回 `409 BOOKING_STATUS_INVALID`（message「未到入住日，暂不可标记未到」）；释放房量的事务策略同 B4。

### B6 预订入住 `POST /bookings/{id}/check-in`

| 需求 | FR-BK-006 | 测试 | TC-BK-016 成功（booking→CHECKED_IN、room→OCCUPIED、占用行生成）；017 房间已被占用 409 ROOM_OCCUPIED；018 房间状态不可分配 409；019 日期不符 409；020 重复办理入住 409；021 并发同房双入住仅一次成功（唯一约束兜底） |

```json
{ "roomId": 12, "depositAmount": 200.00, "pricePerNight": 288.00 }
```

校验：`roomId` 必填正整数；`depositAmount` 0–99999 可选；`pricePerNight` 可选（缺省取预订价）。服务层校验：房型匹配、房间可分配、日期与预订一致（允许当日提前入住，`checkInDate` 必须等于今日或已到【假设 A-18】）；预订离店日已到或已过（`checkOutDate ≤ 酒店今日`）时不可办理入住，返回 `409 BOOKING_DATE_MISMATCH`（message：「预订离店日期已到或已过，不可办理入住，请重新预订」）。
成功 `200`：

```json
{
  "data": {
    "id": 501, "bookingId": 301, "guestId": 9, "guestName": "张三",
    "roomId": 12, "roomNumber": "0821", "roomTypeId": 1, "roomTypeName": "标准大床房",
    "pricePerNight": 288.00, "checkInAt": "2026-10-15T06:02:11.000Z", "expectedCheckOutDate": "2026-10-17",
    "depositAmount": 200.00, "status": "CHECKED_IN", "note": null, "createdAt": "2026-10-15T06:02:11.000Z", "updatedAt": "2026-10-15T06:02:11.000Z"
  }
}
```

---

## 9. 入住域 `/stays`

### S1 直接入住（walk-in） `POST /stays`

| 需求 | FR-SY-001 | 测试 | TC-SY-001 成功；002 房间占用 409；003 房态非法 409；004 并发双分配仅一次成功 |

```json
{ "guestId": 9, "roomId": 13, "pricePerNight": 318.00, "expectedCheckOutDate": "2026-10-16", "depositAmount": 300.00, "note": "深夜到店" }
```

校验同 B6（无 booking 校验分支）；与 B6 共用 `stayService.createStay()` 核心（架构 §1.3）。响应同 B6 `data`（`bookingId: null`）。

### S2 列表 `GET /stays?status=CHECKED_IN&roomId=12&keyword=张&page=1&pageSize=20&sort=checkInAt:desc`

| 需求 | FR-SY-002 | 测试 | TC-SY-005 在住/已退筛选；006 分页排序 |

`items[]` 同 B6 结构；sort 白名单：`checkInAt,expectedCheckOutDate,status`。

### S3 详情 `GET /stays/{id}`

| 需求 | FR-SY-003 | 测试 | TC-SY-007 费用实时累计正确；008 已退房含订单摘要 |

响应在 B6 基础上增加：

```json
{
  "data": {
    "id": 501, "...": "...",
    "actualCheckOutAt": null,
    "currentCharges": { "roomFee": 576.00, "miscTotal": 38.00, "total": 614.00, "nights": 2 },
    "order": { "id": 900, "totalAmount": 652.00, "status": "PAID" }
  }
}
```

`currentCharges` 在住时实时计算：**房费 = 预计晚数 × 房价（openapi CurrentCharges.nights 定义为「预计晚数」= expected_check_out_date − DATE(check_in_at)；`DATE(check_in_at)` 按酒店本地日历日 Asia/Shanghai 计算，凌晨入住不会多计一晚）**，在住期间 `miscTotal` 恒为 0（【假设 A-19：杂费在退房时一次性录入，在住期间不落库】）；已退房时 `miscTotal` 由账单反推（total − roomFee），`order` 退房后非空（OrderListItem 结构：含 guestName/roomNumber）。

### S4 退房结算 `POST /stays/{id}/checkout`

| 需求 | FR-SY-004 | 测试 | TC-SY-009 成功（订单生成、房态 VACANT_DIRTY、占用释放、当日可再售）；010 重复退房 409；011 金额校验（押金抵扣）；012 并发退房仅一次成功；013 退房后当日该房可再入住（回归 M2） |

```json
{
  "paymentMethod": "WECHAT",
  "miscItems": [ { "name": "迷你吧消费", "amount": 38.00 } ],
  "note": "客人对房费无异议"
}
```

校验：`paymentMethod ∈ {CASH,WECHAT,ALIPAY,BANK_CARD,MIXED}`；`miscItems` 0–20 项，`name` 1–100，`amount` 0.01–99999.99。
成功 `200`：

```json
{
  "data": {
    "orderId": 900, "stayId": 501, "status": "PAID",
    "items": [
      { "type": "ROOM_FEE", "name": "房费 2 晚 × 288.00", "amount": 576.00 },
      { "type": "MISC", "name": "迷你吧消费", "amount": 38.00 },
      { "type": "DEPOSIT_APPLIED", "name": "押金抵扣", "amount": 200.00 }
    ],
    "totalAmount": 614.00, "depositAmount": 200.00, "depositApplied": 200.00, "paidAmount": 414.00,
    "paymentMethod": "WECHAT", "createdAt": "2026-10-17T04:30:00.000Z"
  }
}
```

错误 `409`：

```json
{ "error": { "code": "STAY_STATUS_INVALID", "message": "该入住记录已退房，不可重复结算" } }
```

---

## 10. 订单域 `/orders`（只读）

### O1 列表 `GET /orders?stayId=501&createdFrom=2026-10-01&createdTo=2026-10-31&page=1&pageSize=20&sort=createdAt:desc`

| 需求 | FR-OD-001 | 测试 | TC-OD-001 日期范围+分页 |

`items[]`：`{ id, stayId, guestName, roomNumber, totalAmount, paidAmount, paymentMethod, status, createdAt }`。

日期范围语义（A-10）：`createdFrom/createdTo` 为**酒店本地日历日**（Asia/Shanghai）闭区间，服务端换算为 `[起日 00:00, 止日+1 00:00)` 的 UTC 边界过滤 `createdAt`；sort 白名单 `createdAt`（默认 `createdAt:desc`）。

### O2 详情 `GET /orders/{id}`

| 需求 | FR-OD-002 | 测试 | TC-OD-002 明细完整；003 404 |

响应同 S4 `data` 结构（另含 `stayId`、`note`、`updatedAt`）。

> 说明：账单（orders）由 S4 退房事务生成，本域 `只读`；独立"支付记录"实体、支付失败/取消/退款状态、折扣均不在已批准设计内（见 `database-design.md §2.9`「本期退房即结，UNPAID 仅为扩展预留」、假设 A-02/A-06/A-07），纳入需先走库与契约变更评审。

---

## 11. OpenAPI 规范文件的设计要求

1. **单一事实来源**：`openapi/openapi.yaml`（OpenAPI 3.0.3）是接口契约的权威描述；本 md 与 shared 包与之同步。**冲突时以 yaml 为准并触发变更评审**。
2. **结构要求**：
   - `info.version` 语义化；破坏性变更必须升 major（`/api/v1` 版本路径随之演进）。
   - 全部 schema 收敛到 `components/schemas`，路径引用；错误响应统一 `$ref Error`。
   - 每个操作必须含：`operationId`（与 shared api 函数同名）、`tags`、`security`、请求/响应示例（`requestBody.example` + `responses.'200'.content.example` + 主要错误码示例）、`x-requirement-id`（需求编号）、`x-test-ids`（测试编号）。
   - `components.securitySchemes.cookieAuth`（api key in cookie，名称 `hms_sid`）。
3. **同步机制（防"两端各自猜测"）**：
   - `@hms/shared` 导出全部 DTO 类型 + zod schema，TS 类型与 yaml **同一批 PR 内同步修改**；
   - CI 校验：`@redocly/cli lint openapi/openapi.yaml`（阻断破坏规范的结构变更）；
   - 契约测试：Vitest + Supertest 的集成测试中，关键端点（A1/B1/B6/S4 等）响应经 shared zod schema 二次校验——**实现一旦偏离 shared 类型即测试失败**，shared 与 yaml 的一致性由评审清单保证（yaml→shared 的 diff 是 PR 必查项）。
   - 前端 `apps/web/src/api/**` 函数签名引用 shared 类型；后端 controller 返回值标注 shared 类型——编译期双端锁定。
4. **变更流程**：修改契约 → 更新 yaml + shared（同一提交）→ 更新本文档与测试 → 通过 lint + 双端类型检查 + 契约测试 → 方可合入（协议：未经批准不得修改冻结契约）。
