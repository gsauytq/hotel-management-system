#!/usr/bin/env bash
# 部署与环境配置验证（docs/test-plan.md §7-16；TC-DEP-001~005/007、TC-OPS-002~004）。
#
# 适用环境：Linux / macOS / CI（需要 docker compose、curl、node）。
# 在 Windows 开发机上请使用等价 PowerShell 命令，或在 WSL/Git Bash 中执行。
#
# 前置：仓库根目录存在 .env（从 .env.example 复制并填写真实值），宿主机端口可用。
# 安全性：仅操作 compose.prod 项目（独立卷 hms-prod_hms_mysql_data），不使用生产数据库；
#         seed 仅在 users 空表时创建管理员；冒烟仅执行只读请求。
set -euo pipefail

COMPOSE=(docker compose -f compose.prod.yml --env-file .env)
BASE_URL="http://127.0.0.1:${WEB_HTTP_PORT:-8080}"

step() { printf '\n==> %s\n' "$1"; }

step 'TC-DEP-001 compose 配置校验'
"${COMPOSE[@]}" config --quiet

step 'TC-DEP-002 一键拉起并等待 healthcheck（强制构建，避免复用过期镜像）'
"${COMPOSE[@]}" up -d --build
for service in mysql api web; do
  for _ in $(seq 1 60); do
    container="$("${COMPOSE[@]}" ps -q "$service")"
    status="$(docker inspect --format '{{.State.Health.Status}}' "$container" 2>/dev/null || echo starting)"
    if [ "$status" = 'healthy' ]; then
      printf '  %s: healthy\n' "$service"
      break
    fi
    sleep 2
  done
  if [ "$status" != 'healthy' ]; then
    echo "  [FAIL] $service 未在时限内 healthy（当前：$status）" >&2
    exit 1
  fi
done

step 'TC-DEP-003 Nginx 同源反代与 SPA 回退'
curl -fsS -o /dev/null "${BASE_URL}/"
curl -fsS -o /dev/null "${BASE_URL}/bookings"
status="$(curl -s -o /dev/null -w '%{http_code}' "${BASE_URL}/api/v1/room-types")"
[ "$status" = '401' ] || { echo "  [FAIL] 未登录访问 /api/v1/room-types 期望 401，实际 $status" >&2; exit 1; }
printf '  / 、/bookings 可访问；/api 未登录 401\n'

step 'TC-OPS-005 seed 仅空表执行'
"${COMPOSE[@]}" --profile tools run --rm seed

step 'TC-DEP-005 部署后冒烟'
node scripts/deploy-smoke.mjs

step 'TC-OPS-002 迁移幂等（重启 api 两次）'
"${COMPOSE[@]}" restart api >/dev/null
sleep 3
for _ in $(seq 1 60); do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$("${COMPOSE[@]}" ps -q api)")"
  [ "$status" = 'healthy' ] && break
  sleep 2
done
[ "$status" = 'healthy' ] || { echo "  [FAIL] api 重启后未恢复 healthy" >&2; exit 1; }
node scripts/deploy-smoke.mjs

step 'TC-OPS-004 mysql 重启后数据与服务恢复'
"${COMPOSE[@]}" restart mysql >/dev/null
for _ in $(seq 1 60); do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$("${COMPOSE[@]}" ps -q mysql)")"
  [ "$status" = 'healthy' ] && break
  sleep 2
done
[ "$status" = 'healthy' ] || { echo "  [FAIL] mysql 重启后未恢复 healthy" >&2; exit 1; }
sleep 3
node scripts/deploy-smoke.mjs

step 'TC-DEP-007 暴露面与安全响应头'
if "${COMPOSE[@]}" port mysql 3306 | grep -q .; then
  echo '  [FAIL] mysql 端口不应映射到宿主机' >&2
  exit 1
fi
printf '  mysql 端口未暴露\n'
headers="$(curl -fsSI "${BASE_URL}/")"
printf '%s' "$headers" | grep -qi 'x-content-type-options: nosniff' \
  || { echo '  [FAIL] 缺少 X-Content-Type-Options: nosniff' >&2; exit 1; }
printf '%s' "$headers" | grep -qi 'content-security-policy' \
  || { echo '  [FAIL] 缺少 Content-Security-Policy' >&2; exit 1; }
printf '  安全响应头存在\n'

step 'TC-DEP-004 密钥零入库（可选，需要 gitleaks）'
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks detect --no-banner --redact
else
  echo '  [SKIP] 未安装 gitleaks；CI 中必须执行'
fi

printf '\n全部部署验证检查通过。\n'
