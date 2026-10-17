# 经营统计（待决，未批准） — 口径草案与实现前置条件

| 项 | 值 |
| --- | --- |
| 文档版本 | v0.1（**待决，未批准**） |
| 日期 | 2026-10-14 |
| 状态 | **未实现任何统计接口、数据表或字段**；本文仅登记拟议口径与待决问题 |
| 依据 | `requirements-traceability.md` **Q-04 / A-02**：统计看板明确列为 **V2 范围外**；如需纳入**必须先改库设计/契约并走变更评审** |
| 现有实现 | 无 `/statistics`、`/reports` 端点；数据库无统计汇总表；OpenAPI 无对应 path/schema |

> **结论**：本次任务要求"按项目已有定义实现统计接口"，但已批准设计中**不存在统计口径与接口定义**，且明确将统计看板划为 V2 范围外。按 AGENTS.md「范围外先报告、不得自行猜测」，**暂停统计实现**。以下为可供评审的拟议口径（非产品规则，不得直接据此编码上线）。

---

## 1. 拟议指标（全部待产品批准）

| # | 指标 | 拟议定义 | 拟议时间语义 | 拟议排除/过滤 | 数据来源 |
| --- | --- | --- | --- | --- | --- |
| M-1 | 客房总量 | 指定时点/区间内物理客房数（`COUNT(rooms)`） | 时点快照（截止日） | 口径待定：是否排除 `MAINTENANCE`/`DISABLED` | `rooms`（`idx_rooms_type`） |
| M-2 | 可用客房 | 未来某区间可售的客房数 = 可售房数（非维修/停用）− 区间内已被占用房间 | 区间 `[checkInDate, checkOutDate)`（左闭右开，A-05） | 排除 `MAINTENANCE`/`DISABLED`；按 `room_occupancy` 逐日占用 | `rooms` + `room_occupancy`（`uq_occupancy_room_date`） |
| M-3 | 入住率 | 房间夜占用数 ÷ 可售房夜数 | 统计区间 `[from, to)`（酒店本地日） | 拟排除维修/停用房的房夜；分子按 `CHECKED_IN` 在住/已住 stay 的占用夜 | `stays` + `room_occupancy` |
| M-4 | 预订量 | 区间内创建的 `CONFIRMED` 预订笔数（或间夜） | 拟按 `created_at`（创建时间）或 `check_in_date`（入住日），**待定** | 拟排除 `CANCELLED`/`NO_SHOW`（或单独展示） | `bookings`（`idx_bookings_checkin` / `idx_bookings_capacity`） |
| M-5 | 收入 | 账单实收合计 `SUM(orders.paid_amount)`（**不是** `total_amount` 应收，也不含押金抵扣项） | 拟按账单 `created_at`（酒店本地日） | 仅 `status='PAID'`；押金抵扣不计入收入（`DEPOSIT_APPLIED` 仅为抵扣明细） | `orders`（`idx_orders_created`） |

**明确约束（若批准）**：
- 金额一律基于 `DECIMAL(10,2)` 聚合（`SUM`/`DECIMAL`），不得用浮点累计。
- 日期与时区沿用假设 A-10：业务日历日 = `Asia/Shanghai`；时间戳 UTC，按酒店本地日换算 UTC 边界（同 `hotelDayStartUtc` 实现）。
- 统计接口应为只读、`ADMIN` 可见（与"统计看板"管理属性一致，**权限待确认**）。

## 2. 拟议查询策略（避免 N+1 / 全表读取）

- 每个指标使用**单条聚合查询**（`COUNT`/`SUM`/`GROUP BY`），禁止逐行应用层累加或 N+1。
- 使用既有索引：
  - `orders.idx_orders_created (created_at)` → 收入按日聚合；
  - `bookings.idx_bookings_capacity (room_type_id,status,check_in_date,check_out_date)` / `idx_bookings_checkin` → 预订量；
  - `room_occupancy.uq_occupancy_room_date (room_id,date)` → 占用/入住率（逐日区间）；
  - `rooms.idx_rooms_type (room_type_id,status)` → 房间总量/可售房数。
- 区间统计限定单店规模（<10 万行，NFR-PERF-001），必要时按日预聚合（V2 若数据量增长再评估，不引入缓存/汇总表）。

## 3. 待决问题（需产品/业主批准后方可实现）

1. **Q-STAT-01 范围解禁**：统计看板/接口是否正式从 V2 范围外（A-02/Q-04）移入本期？若移入，是否同意新增 `/api/v1/statistics/*` 契约与 `@hms/shared` 类型（走契约变更评审）？
2. **Q-STAT-02 客房总量口径**：是否排除 `MAINTENANCE`/`DISABLED`？按物理房数还是"可售房数"（两者在统计上是否都需展示）？
3. **Q-STAT-03 可用客房口径**：是"当前时点空闲房"（房态 `VACANT_CLEAN/VACANT_DIRTY`），还是"未来区间可售房数"（房数−重叠占用）？是否需要按日曲线？
4. **Q-STAT-04 入住率分母**：可售房夜是否包含维修/停用房？分子是否包含已退房但仍占用过的房夜？统计区间是否按日/周/月聚合？
5. **Q-STAT-05 预订量口径**：按 `created_at` 还是 `check_in_date`？计笔数还是间夜（`room_count × nights`，当前 `room_count` 恒为 1）？`CANCELLED`/`NO_SHOW` 是否剔除或单列？
6. **Q-STAT-06 收入口径**：`paid_amount`（实收，扣除押金抵扣）是否为"收入"？押金抵扣是否计收入？按账单/退房/收款日期？`UNPAID`（预留）是否排除？退款（当前范围外，A-02）如何冲减？
7. **Q-STAT-07 权限**：统计接口仅 `ADMIN`，还是 `RECEPTIONIST` 可看部分指标（如当日房态）？
8. **Q-STAT-08 粒度与导出**：是否需要时间粒度参数（日/月/区间）、导出（CSV）与前后端图表？缓存/预聚合策略？

## 4. 若获批后的实现前置条件（检查清单）

- [ ] 更新 `docs/api-contract.md` + `openapi/openapi.yaml`（新增统计路径/参数/响应 schema）。
- [ ] `@hms/shared` 增加统计 DTO 与查询 zod schema（含日期范围、粒度、排序/分页如需要）。
- [ ] 新增 `modules/statistics`（route → controller → service → repository，单条聚合 SQL，只读）。
- [ ] 权限：`requireRole('ADMIN')` + 权限矩阵更新评审。
- [ ] 测试：聚合口径边界（空区间、跨月/跨年、维修房、取消/未到、押金抵扣）、权限、日期时区（Asia/Shanghai）。
- [ ] 性能：`EXPLAIN` 验证命中既有索引；不新增全表扫描。

**未批准前不得实现**：不得以拟议口径直接上线，也不得把"应收/未支付金额"当作实际收入（约束明确）。
