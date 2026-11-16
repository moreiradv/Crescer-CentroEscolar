ALTER TABLE `users` ADD `email` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `email_key` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `email_verified_at` integer;
--> statement-breakpoint
ALTER TABLE `users` ADD `pending_email` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `pending_email_key` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_key_unique` ON `users` (`email_key`) WHERE `email_key` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `users_pending_email_key_unique` ON `users` (`pending_email_key`) WHERE `pending_email_key` IS NOT NULL;
--> statement-breakpoint
CREATE TABLE `auth_tokens` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `type` text NOT NULL CHECK (`type` IN ('email_verification', 'password_reset')),
  `token_hash` text NOT NULL UNIQUE,
  `expires_at` integer NOT NULL,
  `consumed_at` integer,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_tokens_user_type_idx` ON `auth_tokens` (`user_id`,`type`,`created_at`);
--> statement-breakpoint
CREATE INDEX `auth_tokens_expiry_idx` ON `auth_tokens` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `recovery_requests` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer REFERENCES `users`(`id`) ON DELETE SET NULL,
  `identifier_hash` text NOT NULL,
  `ip_hash` text NOT NULL,
  `kind` text NOT NULL CHECK (`kind` IN ('password_reset', 'email_verification', 'administrative_reset')),
  `status` text NOT NULL CHECK (`status` IN ('requested', 'sent', 'completed', 'failed', 'rejected')),
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `recovery_requests_identifier_idx` ON `recovery_requests` (`identifier_hash`,`created_at`);
--> statement-breakpoint
CREATE INDEX `recovery_requests_ip_idx` ON `recovery_requests` (`ip_hash`,`created_at`);
