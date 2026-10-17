/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API 基础路径，默认 /api/v1（见架构 §2.4 / ADR-010） */
  readonly VITE_API_BASE_URL?: string;
  /** 请求超时（毫秒），默认 15000 */
  readonly VITE_REQUEST_TIMEOUT_MS?: string;
  /** 开发服务器代理目标，仅 vite.config.ts 使用 */
  readonly VITE_DEV_PROXY_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
