ALTER TABLE `agenda_entries` ADD `updated_by` integer REFERENCES `users`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
CREATE TABLE `agenda_change_history` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `agenda_id` integer NOT NULL,
  `action` text NOT NULL CHECK (`action` IN ('create','update','delete')),
  `actor_user_id` integer REFERENCES `users`(`id`) ON DELETE SET NULL,
  `before_json` text,
  `after_json` text,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agenda_change_history_agenda_idx` ON `agenda_change_history` (`agenda_id`,`created_at`);
