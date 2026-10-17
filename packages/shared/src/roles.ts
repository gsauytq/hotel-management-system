export const ROLES = ['ADMIN', 'RECEPTIONIST'] as const;

export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ['ACTIVE', 'DISABLED'] as const;

export type UserStatus = (typeof USER_STATUSES)[number];
