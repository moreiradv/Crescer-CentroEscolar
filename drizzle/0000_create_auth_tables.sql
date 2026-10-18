CREATE TABLE `users` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `username` text NOT NULL,
  `username_key` text NOT NULL UNIQUE,
  `name` text NOT NULL,
  `role` text NOT NULL CHECK (`role` IN ('Coordenação', 'Financeiro', 'Administrador')),
  `initials` text NOT NULL,
  `password_hash` text NOT NULL,
  `password_salt` text NOT NULL,
  `status` text NOT NULL DEFAULT 'active' CHECK (`status` IN ('active', 'inactive')),
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `token_hash` text NOT NULL UNIQUE,
  `expires_at` integer NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);
--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `actor_user_id` integer,
  `action` text NOT NULL,
  `target_user_id` integer,
  `details` text,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_logs_created_at_idx` ON `audit_logs` (`created_at`);
