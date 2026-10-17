/**
 * Prisma 已知错误识别（用于仓库/服务层将约束冲突翻译为业务错误码，
 * api-contract §1.5；未翻译的数据库错误由 errorHandler 兜底 500）。
 */
export function prismaErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return null;
  }
  const code = (error as { code: unknown }).code;
  return typeof code === 'string' && /^P\d{4}$/.test(code) ? code : null;
}

export function isRecordNotFoundError(error: unknown): boolean {
  return prismaErrorCode(error) === 'P2025';
}

export function isUniqueConstraintError(error: unknown): boolean {
  return prismaErrorCode(error) === 'P2002';
}
