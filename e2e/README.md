# Playwright E2E

真实 compose 栈的浏览器级主流程测试。覆盖：A-20 首登强制改密、预订/入住/退房/订单、walk-in、RECEPTIONIST 访问 ADMIN 页面 403。

## 前置

- Docker Compose v2 可用。
- 已安装依赖：`pnpm install`。
- 安装浏览器：`pnpm --filter @hms/e2e exec playwright install chromium`（CI 使用 `--with-deps`）。

## 本地运行（必须在干净数据卷上）

```bash
# 1) 启动独立 E2E 栈（HTTP 80；不影响 hms-prod/hms-dev）
docker compose -p hms-e2e -f compose.prod.yml -f e2e/compose.e2e.yml --env-file e2e/compose.env up -d --build

# 2) 初始化管理员（仅空表执行；首登强制改密）
docker compose -p hms-e2e -f compose.prod.yml -f e2e/compose.e2e.yml --env-file e2e/compose.env --profile tools run --rm seed

# 3) 运行测试
$env:HMS_E2E_BASE_URL='http://127.0.0.1:80'
$env:HMS_E2E_ADMIN_INITIAL_PASSWORD='E2e#Init12345'
$env:HMS_E2E_ADMIN_PASSWORD='E2e#Flow12345'
pnpm --filter @hms/e2e test

# 4) 清理（含数据卷；下次运行前必须清理，否则首登改密测试会失败）
docker compose -p hms-e2e -f compose.prod.yml -f e2e/compose.e2e.yml --env-file e2e/compose.env down -v
```

Bash 环境把 `$env:...` 换成 `export ...`。

## 说明

- `e2e/compose.env` 为测试专用固定值，不得用于任何真实环境。
- `e2e/compose.e2e.yml` 将 API `NODE_ENV` 覆盖为 `test`，使 HTTP 下 Cookie 不带 `Secure`，浏览器才能携带会话。
- 测试按文件内 serial 顺序执行；第一步会修改管理员密码。重复运行前必须 `down -v` 清理数据卷。
- 失败时保留 `test-results/` 与 `playwright-report/`（已在 `.gitignore` 中）。
