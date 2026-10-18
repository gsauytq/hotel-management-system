# 复核结论 — review-report1.md

> **历史快照说明（2026-10-18）**：本复核报告记录当时的证据。A-1/A-2/A-3/A-4 已修复并有回归测试；redocly lint 当前通过。当前批准基线与行动项见 [`requirements-traceability-approval-draft.md`](./requirements-traceability-approval-draft.md) 与 [`post-approval-action-register.md`](./post-approval-action-register.md)。

复核方式：逐条重读代码与文档、重跑关键命令、并对 A-1/A-4 补做了**动态复现**（真实 MySQL，临时脚本已清理）。仓库状态与原报告一致（仅新增 `docs/review-report1.md`）。

## 一、确认的问题（复核成立）

### A-1 合并视角超售 — 成立，High 恰当，证据升级，**但修复建议需修正**

- **代码路径复核**：`bookings.repository.ts:180-195` 仅统计 `status='CONFIRMED'`；`stays.repository.ts` createStay 全程无房量校验、**也未锁 room_types 行**（只锁 rooms/bookings 行）。

- **新增动态复现（变体②，纯顺序流程，无 walk-in、无并发）**：

  ```
  A 创建 [today,d+5]: 200 CONFIRMED → A 办理入住: 200 CHECKED_IN（退出计数）
  B 创建 [d+2,d+4]（唯一房间已被 A 占满）: 200 CONFIRMED   ← 超售
  ```

  比原报告的 walk-in 复现更强：

  不需要任何并发或 walk-in

  ，预订入住 → 状态翻 CHECKED_IN → 同区间再售，即产生不可履行预订。

- **修复建议修正（原报告两处不准确）**：

  1. 原报告把 (a) createStay 校验 / (b) createBooking 计入在住 写成“或”（二选一）。实际上**两者堵的是不同方向**：(b) 堵“在住后再售”（变体②），(a) 堵“walk-in 挤占未来预订”（变体①）。除非业务显式接受某一方向，否则**必须双向都做**。
  2. 原报告称 (a) “已持房间行锁” —— 不充分。createStay 未锁 room_types 行，与 createBooking 的房量事务**无共享锁**，加了校验也存在 TOCTOU。正确形态：createStay 事务内补 `SELECT ... FOR UPDATE room_types`；(b) 侧在既有房型行锁内追加 `stay.count({ roomTypeId, status: 'CHECKED_IN', expectedCheckOutDate > :checkIn })`（CHECKED_IN 预订已被 CONFIRMED 过滤排除、其 stay 计入一次，无重复计数）。

- 严重程度 High 维持；db-design §2.4 与 §6.1 的矛盾核实无误（§2.4 声称合并视角由 §6.1 计数保证，§6.1 只计 CONFIRMED）。

### A-2 openapi.yaml redocly lint 失败 — 成立，Medium 恰当

- 重跑 CI 同款命令：**3 errors / 17 warnings，exit 1**；仓库无任何 redocly 配置文件，默认规则生效。
- 三处位置与根因全部核实：1331/1496 `nullable` 无 `type` 兄弟；1536 是 description 未加引号且**含逗号**（`min(depositAmount, totalAmount)`）导致 YAML flow mapping 解析出多余键 —— 这也解释了 1534/1537 同样未加引号为何不报错（无逗号）。原报告根因分析准确，修复建议正确。

### A-3 停用账号分支无恒定时间比较 — 成立，Low 恰当，**定性措辞需修正**

- 代码核实无误：`auth.service.ts:100-108` 直接抛错无 compare；不存在分支（91-98）有 dummy compare。有/无 bcrypt 比较的时序差（bcryptjs cost 12，数百 ms）明确可观测。
- **定性修正**：security-design §1 字面只要求“用户不存在”分支做 dummy compare（已实现）。原报告“与安全设计声明的控制存在偏差”略有夸大；更准确的依据是**代码自述意图未达成**（`auth.service.ts:101` 注释声称“不泄露账号状态（防枚举）”，时序仍泄露“存在且已停用”）。属确认缺陷（低）与加固项的边界，建议按低优先级确认缺陷处理，修复一行不变。

### A-4 锁定复位竞态 — 成立，Low 恰当，**证据升级 + 语境补充 + 修复方式微调**

- **动态复现确认（原报告仅代码论证）**：

  ```
  过期锁后 5 次并发错误登录（3/3 迭代）：failedAttempts=1, lockedUntil=null（未重新锁定）
  对照组（顺序 5 次）        ：failedAttempts=5, lockedUntil=已锁定
  ```

  原报告变体①由“代码语义确定”升级为“运行时复现确认”。

- **语境补充（原报告缺失，可能导致修错）**：`resetFirst`（过期后从 1 重新计数）是**有意设计**，有单测（`auth-service.test.ts:131`）与仓储注释（`auth.repository.ts:24` “避免过期后一次失败立即重新锁定”）。缺陷不是 reset 语义，而是**判定基于 bcrypt 前的陈旧读取（`user` 在 89 行读取、119 行比较后才用）+ 复位为无条件写**导致的非原子性。修复必须保留顺序语义，仅将 read-decide-write 原子化。

- **修复方式微调**：优先“短事务内 `SELECT ... FOR UPDATE` user 行后重算 resetFirst 再写”（与 `completeLogin` 既有模式一致、可测），而非原报告建议的复杂单条条件 UPDATE（IF 嵌套难读易错）。二者均可行。

- 现有测试核对：集成测试只覆盖首次锁定（`auth.integration.test.ts:181`，顺序）；单测为 mock 层，不触库；**并发 relock 无任何测试** —— 原报告测试建议成立，且可近乎直接采用我的复现脚本（seed 过期锁 → 5 并发 → 断言 `lockedUntil != null`，当前实现必失败，即回归保护）。

### B-1 / B-2 / B-3 — 均成立，Low 恰当

- B-1 补充验证：服务端无任何 CORS 头（grep 无 `Access-Control`/`cors(`）→ 跨域 JSON 请求必被预检阻断；`express.json` 未改默认 type → 跨站表单（urlencoded/text/plain）不解析即 422。**结构性防线核实成立**。现有 csrf 测试（`app.test.ts:215-229`）确实未覆盖“无 Origin/Referer”场景，测试建议有效。
- B-2/B-3 属已登记的设计取舍，定位为遗留登记项恰当；`app.ts:66` trust proxy 与 X-Forwarded-For 追加语义核对无误。

### C-1 ~ C-5 — 均成立

- C-1：`test-plan.md:28` 称“仓库无 `.github/`”，实际 `ci.yml` 存在；G-4 称 TC-RT-005 无实现，实际 `room-type-price-snapshot.integration.test.ts:164` 已存在 —— 过时属实。
- C-2：checkout 仅成功审计（`stays.service.ts:235-245`），与 security-design §9 “记录…结果”不符，属实。
- C-3：三处 description 过时文案逐条核实。
- C-4：`ci.yml:44` 使用 `@latest` 属实。
- C-5：`e2e/`、`docs/deployment.md` 均 `Test-Path → False`，属实。

## 二、不成立或证据不足的问题

**无** —— 原报告全部 finding 复核成立，无需要撤销的条目。但有三处**表述/建议层面的错误**需随修复一并纠正（见上）：A-1 修复方向“二选一”表述、A-1 漏掉 createStay 的 room_types 锁、A-4 缺少“resetFirst 是有意设计”的语境。

## 三、需要补充证据的问题

1. **A-3 时序差异量化**：未实测 bcryptjs cost 12 下的具体毫秒差（不改变结论：有无 bcrypt 比较差异为数量级级别）；可选补强，非必须。
2. **CI 真实环境行为**（gitleaks、GitHub corepack pnpm）：本地无法验证，维持原报告“无法验证”结论。
3. **生产 compose 全栈冒烟**：仍未执行，维持原结论。

## 四、阻断发布的问题

| 问题    | 阻断理由                                                     | 复核后状态                                                   |
| ------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| **A-1** | 核心商业承诺（已确认预订不可履行）；动态复现 ×2（walk-in + 纯顺序） | 维持阻断：需业务裁决 + 双向修复（或文档修订 + 显式接受风险） |
| **A-2** | CI 契约门禁必然红（本地复跑 exit 1）                         | 维持阻断：纯 YAML 修复，成本低                               |

A-4 虽升级为动态确认，但残余缓解（IP 限流 + bcrypt-12）充分，**Low 不阻断**，建议合并前顺手修复。

## 五、建议修复顺序

1. **A-2**（分钟级：3 处 YAML + redocly 验证通过）
2. **A-1 设计裁决 → 实现**（补 room_types 锁 + 双向计数 + 2 个集成测试；裁决本身是前置依赖，宜最先发起）
3. **A-4**（FOR UPDATE 事务化 + 并发 relock 回归测试，可直接采用本次复现脚本）
4. **A-3**（一行 dummy compare + spy 单测）
5. B-1（先补“无 Origin/Referer”语义固化测试，再决定拒绝或放行）
6. C-1/C-3/C-4（文档与配置清理，一次性 PR）
7. C-2（退房失败审计）
8. 遗留：C-5（E2E + 部署手册）、Q-09 生产 TLS —— 发布前完成，不阻塞开发合并

**总评**：原报告的事实认定与严重程度全部经得起复核，A-1/A-4 的动态证据较原报告更强；需要修正的仅是 A-1 的修复方案完整性（双向 + 锁补齐）与 A-4 的修复语境（保留有意设计、仅原子化）。