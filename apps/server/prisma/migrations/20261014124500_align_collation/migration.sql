-- 对齐 database-design.md「通用约定」：utf8mb4 / utf8mb4_0900_ai_ci。
-- 背景：Prisma 7 生成的 DDL 固定使用 utf8mb4_unicode_ci，且 schema 不支持
-- datasource 级 collation；按 database-design.md §7.2「以手写 SQL 补充
-- Prisma 不支持的特性」执行前滚修正（不使用破坏性的 reset 操作）。
ALTER TABLE `users` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
ALTER TABLE `sessions` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
