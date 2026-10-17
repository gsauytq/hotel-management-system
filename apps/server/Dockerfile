FROM node:22-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NODE_ENV=production

RUN npm install -g pnpm@12.6.0

WORKDIR /app

# 先复制 workspace 清单以利用构建缓存；.env 等敏感文件由 .dockerignore 排除
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/

RUN pnpm install --frozen-lockfile --filter @hms/server...

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server

RUN pnpm --filter @hms/server exec prisma generate

USER node

EXPOSE 3000

WORKDIR /app/apps/server

# 启动即执行迁移（只应用未执行迁移，幂等）；迁移失败容器不启动（fail fast，database-design §7）
# 直接调用包内二进制，避免运行时触发 pnpm 依赖校验/安装
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && ./node_modules/.bin/tsx src/main.ts"]
