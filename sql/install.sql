-- ---------------------------------------------------------------------------
-- Nexora Phone - database schema
-- Import once into the database your framework uses:
--     mysql -u root -p your_database < sql/install.sql
-- Every statement is idempotent, so re-importing after an update is safe.
-- ---------------------------------------------------------------------------

-- One row per character: the persistent phone number and the phone settings.
CREATE TABLE IF NOT EXISTS `nexora_phones` (
    `identifier`   VARCHAR(64)  NOT NULL,
    `phone_number` VARCHAR(20)  NOT NULL,
    `settings`     LONGTEXT     NULL,
    `battery`      FLOAT        NOT NULL DEFAULT 100,
    `created_at`   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`identifier`),
    UNIQUE KEY `uq_nexora_phones_number` (`phone_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Address book.
CREATE TABLE IF NOT EXISTS `nexora_phone_contacts` (
    `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `identifier`  VARCHAR(64)     NOT NULL,
    `name`       VARCHAR(64)     NOT NULL,
    `number`     VARCHAR(20)     NOT NULL,
    `avatar`     VARCHAR(255)    NULL,
    `favourite`  TINYINT(1)      NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_nexora_contacts_owner_number` (`identifier`, `number`),
    KEY `idx_nexora_contacts_owner` (`identifier`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- SMS. Both sides keep their own "deleted" flag so clearing a conversation on
-- one phone never removes it from the other.
CREATE TABLE IF NOT EXISTS `nexora_phone_messages` (
    `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `sender`              VARCHAR(20)     NOT NULL,
    `receiver`            VARCHAR(20)     NOT NULL,
    `body`                TEXT            NOT NULL,
    `kind`                VARCHAR(16)     NOT NULL DEFAULT 'text',
    `attachment`          VARCHAR(255)    NULL,
    `is_read`             TINYINT(1)      NOT NULL DEFAULT 0,
    `deleted_by_sender`   TINYINT(1)      NOT NULL DEFAULT 0,
    `deleted_by_receiver` TINYINT(1)      NOT NULL DEFAULT 0,
    `created_at`          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_nexora_messages_sender` (`sender`, `receiver`, `id`),
    KEY `idx_nexora_messages_receiver` (`receiver`, `sender`, `id`),
    KEY `idx_nexora_messages_unread` (`receiver`, `is_read`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Call log. status: answered | missed | declined | cancelled | unavailable
CREATE TABLE IF NOT EXISTS `nexora_phone_calls` (
    `id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `caller`             VARCHAR(20)     NOT NULL,
    `receiver`           VARCHAR(20)     NOT NULL,
    `status`             VARCHAR(16)     NOT NULL DEFAULT 'missed',
    `anonymous`          TINYINT(1)      NOT NULL DEFAULT 0,
    `duration`           INT UNSIGNED    NOT NULL DEFAULT 0,
    `hidden_by_caller`   TINYINT(1)      NOT NULL DEFAULT 0,
    `hidden_by_receiver` TINYINT(1)      NOT NULL DEFAULT 0,
    `created_at`         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_nexora_calls_caller` (`caller`, `id`),
    KEY `idx_nexora_calls_receiver` (`receiver`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Photo gallery (stores the hosted url, never the image itself).
CREATE TABLE IF NOT EXISTS `nexora_phone_gallery` (
    `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `identifier`  VARCHAR(64)     NOT NULL,
    `url`        VARCHAR(255)    NOT NULL,
    `created_at` TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_nexora_gallery_owner` (`identifier`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Notes app.
CREATE TABLE IF NOT EXISTS `nexora_phone_notes` (
    `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `identifier`  VARCHAR(64)     NOT NULL,
    `title`      VARCHAR(80)     NOT NULL DEFAULT '',
    `body`       TEXT            NOT NULL,
    `pinned`     TINYINT(1)      NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_nexora_notes_owner` (`identifier`, `updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Notification centre (missed notifications survive a relog).
CREATE TABLE IF NOT EXISTS `nexora_phone_notifications` (
    `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `identifier`  VARCHAR(64)     NOT NULL,
    `app`        VARCHAR(32)     NOT NULL DEFAULT 'system',
    `title`      VARCHAR(80)     NOT NULL,
    `body`       VARCHAR(255)    NOT NULL DEFAULT '',
    `is_read`    TINYINT(1)      NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_nexora_notifications_owner` (`identifier`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bank transfers made through the phone.
CREATE TABLE IF NOT EXISTS `nexora_phone_transactions` (
    `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `sender_id`    VARCHAR(64)     NOT NULL,
    `sender_name`   VARCHAR(100)    NOT NULL DEFAULT '',
    `receiver_id`  VARCHAR(64)     NOT NULL,
    `receiver_name` VARCHAR(100)    NOT NULL DEFAULT '',
    `amount`        BIGINT UNSIGNED NOT NULL,
    `fee`           BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `reason`        VARCHAR(100)    NOT NULL DEFAULT '',
    `created_at`    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_nexora_tx_sender` (`sender_id`, `id`),
    KEY `idx_nexora_tx_receiver` (`receiver_id`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Generic per-app JSON storage (alarms and any app you add later).
CREATE TABLE IF NOT EXISTS `nexora_phone_app_data` (
    `identifier`  VARCHAR(64) NOT NULL,
    `app`        VARCHAR(32) NOT NULL,
    `data`       LONGTEXT    NOT NULL,
    `updated_at` TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`identifier`, `app`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
