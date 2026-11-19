ALTER TABLE `students` ADD `mother_name` text;
--> statement-breakpoint
ALTER TABLE `students` ADD `father_name` text;
--> statement-breakpoint
ALTER TABLE `students` ADD `guardian_email` text;
--> statement-breakpoint
ALTER TABLE `students` ADD `address` text;
--> statement-breakpoint
ALTER TABLE `students` ADD `enrollment_notes` text;
--> statement-breakpoint
ALTER TABLE `students` ADD `updated_by` integer REFERENCES `users`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
CREATE TABLE `student_change_history` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `student_id` integer NOT NULL,
  `membership_id` integer,
  `action` text NOT NULL CHECK (`action` IN ('created','updated','year_linked')),
  `actor_user_id` integer REFERENCES `users`(`id`) ON DELETE SET NULL,
  `before_json` text,
  `after_json` text,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `student_change_history_student_idx` ON `student_change_history` (`student_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `school_years` (
  `year` integer PRIMARY KEY NOT NULL,
  `label` text NOT NULL,
  `status` text NOT NULL DEFAULT 'active' CHECK (`status` IN ('active','archived')),
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
