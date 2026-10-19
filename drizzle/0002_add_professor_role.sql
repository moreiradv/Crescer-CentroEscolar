PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `users_new` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `username` text NOT NULL,
  `username_key` text NOT NULL UNIQUE,
  `name` text NOT NULL,
  `role` text NOT NULL CHECK (`role` IN ('Coordenação', 'Financeiro', 'Administrador', 'Professor')),
  `initials` text NOT NULL,
  `password_hash` text NOT NULL,
  `password_salt` text NOT NULL,
  `status` text NOT NULL DEFAULT 'active' CHECK (`status` IN ('active', 'inactive')),
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `users_new` (`id`, `username`, `username_key`, `name`, `role`, `initials`, `password_hash`, `password_salt`, `status`, `created_at`, `updated_at`)
SELECT `id`, `username`, `username_key`, `name`, `role`, `initials`, `password_hash`, `password_salt`, `status`, `created_at`, `updated_at` FROM `users`;
--> statement-breakpoint
DROP TABLE `users`;
--> statement-breakpoint
ALTER TABLE `users_new` RENAME TO `users`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
