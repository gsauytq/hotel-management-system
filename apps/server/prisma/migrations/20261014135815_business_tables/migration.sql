-- CreateTable
CREATE TABLE `room_types` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `base_price` DECIMAL(10, 2) NOT NULL,
    `capacity` TINYINT UNSIGNED NOT NULL,
    `description` VARCHAR(500) NULL,
    `status` ENUM('ACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_room_types_code`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- CreateTable
CREATE TABLE `rooms` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `room_number` VARCHAR(20) NOT NULL,
    `room_type_id` BIGINT UNSIGNED NOT NULL,
    `status` ENUM('VACANT_CLEAN', 'VACANT_DIRTY', 'OCCUPIED', 'MAINTENANCE', 'DISABLED') NOT NULL DEFAULT 'VACANT_DIRTY',
    `note` VARCHAR(200) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_rooms_room_number`(`room_number`),
    INDEX `idx_rooms_type`(`room_type_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- CreateTable
CREATE TABLE `guests` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `phone` VARCHAR(20) NOT NULL,
    `id_type` ENUM('ID_CARD', 'PASSPORT', 'OTHER') NOT NULL,
    `id_number_hash` CHAR(64) NOT NULL,
    `id_number_cipher` VARBINARY(255) NOT NULL,
    `remark` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_guests_name`(`name`),
    INDEX `idx_guests_phone`(`phone`),
    UNIQUE INDEX `uq_guests_id_number`(`id_type`, `id_number_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- CreateTable
CREATE TABLE `bookings` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `guest_id` BIGINT UNSIGNED NOT NULL,
    `room_type_id` BIGINT UNSIGNED NOT NULL,
    `check_in_date` DATE NOT NULL,
    `check_out_date` DATE NOT NULL,
    `room_count` TINYINT UNSIGNED NOT NULL DEFAULT 1,
    `price_per_night` DECIMAL(10, 2) NOT NULL,
    `total_price` DECIMAL(10, 2) NOT NULL,
    `status` ENUM('CONFIRMED', 'CHECKED_IN', 'CANCELLED', 'NO_SHOW') NOT NULL DEFAULT 'CONFIRMED',
    `note` VARCHAR(500) NULL,
    `created_by` BIGINT UNSIGNED NOT NULL,
    `cancelled_at` DATETIME(3) NULL,
    `cancel_reason` VARCHAR(200) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `idx_bookings_capacity`(`room_type_id`, `status`, `check_in_date`, `check_out_date`),
    INDEX `idx_bookings_guest`(`guest_id`),
    INDEX `idx_bookings_checkin`(`check_in_date`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- CreateTable
CREATE TABLE `stays` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `booking_id` BIGINT UNSIGNED NULL,
    `guest_id` BIGINT UNSIGNED NOT NULL,
    `room_id` BIGINT UNSIGNED NOT NULL,
    `room_type_id` BIGINT UNSIGNED NOT NULL,
    `price_per_night` DECIMAL(10, 2) NOT NULL,
    `check_in_at` DATETIME(3) NOT NULL,
    `expected_check_out_date` DATE NOT NULL,
    `actual_check_out_at` DATETIME(3) NULL,
    `deposit_amount` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `status` ENUM('CHECKED_IN', 'CHECKED_OUT') NOT NULL DEFAULT 'CHECKED_IN',
    `note` VARCHAR(500) NULL,
    `created_by` BIGINT UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_bookings_booking_stay`(`booking_id`),
    INDEX `idx_stays_room`(`room_id`, `status`),
    INDEX `idx_stays_guest`(`guest_id`),
    INDEX `idx_stays_status_checkout`(`status`, `expected_check_out_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- CreateTable
CREATE TABLE `room_occupancy` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `stay_id` BIGINT UNSIGNED NOT NULL,
    `room_id` BIGINT UNSIGNED NOT NULL,
    `date` DATE NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_occupancy_stay`(`stay_id`),
    UNIQUE INDEX `uq_occupancy_room_date`(`room_id`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- CreateTable
CREATE TABLE `orders` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `stay_id` BIGINT UNSIGNED NOT NULL,
    `total_amount` DECIMAL(10, 2) NOT NULL,
    `deposit_amount` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `deposit_applied` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `paid_amount` DECIMAL(10, 2) NOT NULL,
    `payment_method` ENUM('CASH', 'WECHAT', 'ALIPAY', 'BANK_CARD', 'MIXED') NOT NULL,
    `status` ENUM('UNPAID', 'PAID') NOT NULL DEFAULT 'PAID',
    `note` VARCHAR(500) NULL,
    `created_by` BIGINT UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_orders_stay`(`stay_id`),
    INDEX `idx_orders_created`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- CreateTable
CREATE TABLE `order_items` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_id` BIGINT UNSIGNED NOT NULL,
    `type` ENUM('ROOM_FEE', 'MISC', 'DEPOSIT_APPLIED') NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_items_order`(`order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- AddForeignKey
ALTER TABLE `rooms` ADD CONSTRAINT `rooms_room_type_id_fkey` FOREIGN KEY (`room_type_id`) REFERENCES `room_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_guest_id_fkey` FOREIGN KEY (`guest_id`) REFERENCES `guests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_room_type_id_fkey` FOREIGN KEY (`room_type_id`) REFERENCES `room_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bookings` ADD CONSTRAINT `bookings_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stays` ADD CONSTRAINT `stays_booking_id_fkey` FOREIGN KEY (`booking_id`) REFERENCES `bookings`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stays` ADD CONSTRAINT `stays_guest_id_fkey` FOREIGN KEY (`guest_id`) REFERENCES `guests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stays` ADD CONSTRAINT `stays_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stays` ADD CONSTRAINT `stays_room_type_id_fkey` FOREIGN KEY (`room_type_id`) REFERENCES `room_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stays` ADD CONSTRAINT `stays_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `room_occupancy` ADD CONSTRAINT `room_occupancy_stay_id_fkey` FOREIGN KEY (`stay_id`) REFERENCES `stays`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `room_occupancy` ADD CONSTRAINT `room_occupancy_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_stay_id_fkey` FOREIGN KEY (`stay_id`) REFERENCES `stays`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- 手工补充：CHECK 约束（Prisma schema 不支持；database-design.md §2/§7.2）
-- 注：bookings.check_in_date >= CURDATE() - INTERVAL 1 DAY 未实现：
--     MySQL 8.4 禁止 CHECK 中使用非确定性函数（ERROR 3814 已实测），
--     该日期下限改由 T-09 预订服务层校验（database-design §6.1 步骤 2）。
ALTER TABLE `room_types` ADD CONSTRAINT `chk_room_types_base_price` CHECK (`base_price` >= 0);
ALTER TABLE `room_types` ADD CONSTRAINT `chk_room_types_capacity` CHECK (`capacity` BETWEEN 1 AND 20);
ALTER TABLE `bookings` ADD CONSTRAINT `chk_bookings_date_order` CHECK (`check_out_date` > `check_in_date`);
ALTER TABLE `stays` ADD CONSTRAINT `chk_stays_check_out_after_check_in` CHECK (`expected_check_out_date` > DATE(`check_in_at`));
ALTER TABLE `order_items` ADD CONSTRAINT `chk_order_items_amount_positive` CHECK (`amount` > 0);