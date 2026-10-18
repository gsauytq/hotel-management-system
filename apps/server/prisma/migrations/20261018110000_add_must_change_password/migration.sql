-- A-20 B：首登强制改密标记。
-- 新列默认 false：不追溯既有账号；新 seed 管理员由 seed 置 true。
ALTER TABLE `users`
    ADD COLUMN `must_change_password` BOOLEAN NOT NULL DEFAULT FALSE;
