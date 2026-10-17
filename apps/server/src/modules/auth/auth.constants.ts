/** 认证与授权策略常量（security-design §3，数值为已批准设计） */

/** 连续失败达到该次数后锁定账户 */
export const LOGIN_MAX_FAILED_ATTEMPTS = 5;

/** 账户锁定时长：15 分钟 */
export const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1000;

/** 单用户会话数上限（超出淘汰最旧） */
export const MAX_SESSIONS_PER_USER = 10;

/** 登录接口每 IP 限流：每分钟 10 次 */
export const LOGIN_RATE_LIMIT_MAX = 10;
export const LOGIN_RATE_LIMIT_WINDOW_MS = 60 * 1000;

/** 过期会话清理任务周期：每小时 */
export const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
