import 'dotenv/config';
import { hash } from 'bcryptjs';

import { loadEnv } from '../src/config/env.js';
import { createPrismaClient } from '../src/lib/prisma.js';

async function main(): Promise<void> {
  const config = loadEnv();
  const initialPassword = process.env['ADMIN_INITIAL_PASSWORD'];

  if (initialPassword === undefined || initialPassword.length < 10) {
    throw new Error(
      '缺少或过短的 ADMIN_INITIAL_PASSWORD（≥10 位）；拒绝写入任何默认密码（协议实现规则 8）',
    );
  }

  const prisma = createPrismaClient(config);
  try {
    const userCount = await prisma.user.count();
    if (userCount > 0) {
      console.info('users 表非空，seed 跳过（T-02：seed 仅空表执行）');
      return;
    }

    const passwordHash = await hash(initialPassword, 12);
    await prisma.user.create({
      data: {
        username: 'admin',
        passwordHash,
        displayName: '系统管理员',
        role: 'ADMIN',
      },
    });
    console.info(
      '已创建初始管理员账号 admin（密码来自 ADMIN_INITIAL_PASSWORD，bcrypt cost=12；登录功能尚未实现）',
    );
    console.info('示例房型/房间数据待 T-02 业务表落库后补充，当前 seed 不写入任何业务数据');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
