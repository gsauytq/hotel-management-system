import type { Logger } from 'pino';

export type AuditOutcome = 'SUCCESS' | 'FAILURE';

/**
 * 审计事件（security-design §9）：独立 channel，仅记录操作者/目标/结果/requestId，
 * 绝不含密码、令牌、哈希或证件明文。
 */
export interface AuditEvent {
  action: string;
  outcome: AuditOutcome;
  requestId: string;
  /** 已知操作者 id（如登录成功/登出）；匿名失败尝试不填 */
  actorId?: number;
  /** 目标资源（如被尝试登录的 username） */
  target?: string;
  /** 失败原因（枚举值，不含敏感值） */
  reason?: string;
  ip?: string | undefined;
}

export type AuditLogger = (event: AuditEvent) => void;

export function createAuditLogger(logger: Logger): AuditLogger {
  const channel = logger.child({ channel: 'audit' });
  return (event) => {
    channel.info(event, `audit.${event.action}`);
  };
}
