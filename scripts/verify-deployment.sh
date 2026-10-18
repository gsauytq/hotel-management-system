#!/usr/bin/env bash
# 部署与环境配置验证（docs/test-plan.md §7-16；TC-DEP-001~005/007、TC-OPS-002~004）。
#
# 适用环境：Linux / macOS / CI（需要 docker compose、curl、openssl、node）。
# 在 Windows 开发机上请在 Git Bash 中执行。
#
# 前置：仓库根目录存在 .env（从 .env.example 复制并填写真实值），宿主机 80/443 可用。
# 安全性：仅操作 compose.prod 项目（独立卷 hms-prod_hms_mysql_data），不使用生产数据库；
#         seed 仅在 users 空表时创建管理员；冒烟仅执行只读请求。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f .env ]; then
  echo '[FAIL] 缺少 .env；请从 .env.example 复制并填写真实值' >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# 兼容 Windows CRLF；source 后 compose 与冒烟看到同一份配置。
tr -d '\r' < .env > "$TMP_DIR/env"
set -a
# shellcheck disable=SC1090
source "$TMP_DIR/env"
set +a

: "${HMS_SMOKE_PASSWORD:=${ADMIN_INITIAL_PASSWORD:-}}"
export HMS_SMOKE_PASSWORD

COMPOSE=(docker compose -f compose.prod.yml --env-file .env)
HTTP_BASE_URL="${HMS_HTTP_BASE_URL:-http://127.0.0.1:${WEB_HTTP_PORT:-80}}"
HTTPS_BASE_URL="${HMS_SMOKE_BASE_URL:-https://127.0.0.1:${WEB_HTTPS_PORT:-443}}"
export HMS_SMOKE_BASE_URL="$HTTPS_BASE_URL"

# 生产使用系统信任链；私有 CA/自签证书可设置 HMS_TLS_CA_FILE。
# 本地自签验证可额外设置 HMS_TLS_INSECURE=1 供 curl 使用（openssl 仍按 CA 文件校验证书）。
CURL=(curl -sS)
if [ -n "${HMS_TLS_CA_FILE:-}" ]; then
  export NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-$HMS_TLS_CA_FILE}"
fi
if [ "${HMS_TLS_INSECURE:-0}" = '1' ]; then
  CURL+=(-k)
elif [ -n "${HMS_TLS_CA_FILE:-}" ]; then
  CURL+=(--cacert "$HMS_TLS_CA_FILE")
fi

step() { printf '\n==> %s\n' "$1"; }
fail() { echo "  [FAIL] $1" >&2; exit 1; }

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

step 'TC-DEP-003 Nginx HTTPS 同源反代与 SPA 回退'
"${CURL[@]}" -f -o /dev/null "${HTTPS_BASE_URL}/"
"${CURL[@]}" -f -o /dev/null "${HTTPS_BASE_URL}/bookings"
status="$("${CURL[@]}" -o /dev/null -w '%{http_code}' "${HTTPS_BASE_URL}/api/v1/room-types")"
[ "$status" = '401' ] || fail "未登录访问 /api/v1/room-types 期望 401，实际 $status"
printf '  / 、/bookings 可访问；/api 未登录 401\n'

step 'TC-DEP-008 HTTP→HTTPS、HSTS 与证书有效性'
redirect_headers="$(curl -sS -D - -o /dev/null "${HTTP_BASE_URL}/")"
printf '%s' "$redirect_headers" | grep -Eq '^HTTP/[0-9.]+ 301' \
  || fail 'HTTP 80 未返回 301'
printf '%s' "$redirect_headers" | grep -qiE '^location: https://' \
  || fail 'HTTP 80 的 Location 未指向 HTTPS'
if printf '%s' "$redirect_headers" | grep -qiE '^set-cookie:'; then
  fail 'HTTP 80 不应下发会话 Cookie（Secure Cookie 矛盾）'
fi
printf '  HTTP 80 → HTTPS 301，且无 Set-Cookie\n'

headers="$("${CURL[@]}" -f -I "${HTTPS_BASE_URL}/")"
printf '%s' "$headers" | grep -qi '^strict-transport-security:.*max-age=' \
  || fail 'HTTPS 响应缺少 HSTS'
printf '  HSTS 头存在\n'

TLS_HOST="$(node -e 'process.stdout.write(new URL(process.argv[1]).hostname)' "$HTTPS_BASE_URL")"
TLS_PORT="$(node -e 'process.stdout.write(new URL(process.argv[1]).port || "443")' "$HTTPS_BASE_URL")"
S_CLIENT_ARGS=(s_client -connect "$TLS_HOST:$TLS_PORT" -servername "$TLS_HOST" -showcerts)
if [ -n "${HMS_TLS_CA_FILE:-}" ]; then
  S_CLIENT_ARGS+=(-CAfile "$HMS_TLS_CA_FILE")
fi
if [ "${HMS_TLS_INSECURE:-0}" != '1' ]; then
  S_CLIENT_ARGS+=(-verify_return_error)
else
  printf '  [WARN] HMS_TLS_INSECURE=1：跳过证书链验证（仅限本地自签）\n'
fi
if ! openssl "${S_CLIENT_ARGS[@]}" </dev/null > "$TMP_DIR/s_client.txt" 2>&1; then
  cat "$TMP_DIR/s_client.txt" >&2
  fail 'TLS 握手或证书链校验失败'
fi
openssl x509 -in "$TMP_DIR/s_client.txt" -noout -checkend 0 >/dev/null 2>&1 \
  || fail '证书已过期或无法解析'
openssl x509 -in "$TMP_DIR/s_client.txt" -noout -subject -issuer -dates
printf '  证书有效\n'

step 'TC-OPS-005 seed 仅空表执行'
"${COMPOSE[@]}" --profile tools run --rm seed

step 'TC-DEP-005 HTTPS 部署后冒烟'
node scripts/deploy-smoke.mjs

step 'TC-OPS-002 迁移幂等（重启 api）'
"${COMPOSE[@]}" restart api >/dev/null
sleep 3
for _ in $(seq 1 60); do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$("${COMPOSE[@]}" ps -q api)")"
  [ "$status" = 'healthy' ] && break
  sleep 2
done
[ "$status" = 'healthy' ] || fail 'api 重启后未恢复 healthy'
node scripts/deploy-smoke.mjs

step 'TC-OPS-004 mysql 重启后数据与服务恢复'
"${COMPOSE[@]}" restart mysql >/dev/null
for _ in $(seq 1 60); do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$("${COMPOSE[@]}" ps -q mysql)")"
  [ "$status" = 'healthy' ] && break
  sleep 2
done
[ "$status" = 'healthy' ] || fail 'mysql 重启后未恢复 healthy'
sleep 3
node scripts/deploy-smoke.mjs

step 'TC-DEP-007 暴露面与安全响应头'
mysql_port="$("${COMPOSE[@]}" port mysql 3306 2>/dev/null || true)"
case "$mysql_port" in
  '' | ':0') ;;
  *) fail "mysql 端口不应映射到宿主机（$mysql_port）" ;;
esac
printf '  mysql 端口未暴露\n'
headers="$("${CURL[@]}" -f -I "${HTTPS_BASE_URL}/")"
printf '%s' "$headers" | grep -qi 'x-content-type-options: nosniff' \
  || fail '缺少 X-Content-Type-Options: nosniff'
printf '%s' "$headers" | grep -qi 'content-security-policy' \
  || fail '缺少 Content-Security-Policy'
printf '%s' "$headers" | grep -qi '^strict-transport-security:' \
  || fail '缺少 Strict-Transport-Security'
printf '  安全响应头存在\n'

step 'TC-DEP-004 密钥零入库（可选，需要 gitleaks）'
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks detect --no-banner --redact
else
  echo '  [SKIP] 未安装 gitleaks；CI 中必须执行'
fi

printf '\n全部部署验证检查通过（HTTPS/HSTS/Secure Cookie 链路）。\n'
