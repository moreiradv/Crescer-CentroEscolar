CREATE TABLE `grades` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL UNIQUE,
  `enrollment_fee_cents` integer NOT NULL DEFAULT 0,
  `monthly_fee_cents` integer NOT NULL DEFAULT 0,
  `status` text NOT NULL DEFAULT 'active' CHECK (`status` IN ('active', 'inactive')),
  `created_by` integer REFERENCES `users`(`id`) ON DELETE SET NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `books` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `grade_id` integer NOT NULL REFERENCES `grades`(`id`) ON DELETE RESTRICT,
  `price_cents` integer NOT NULL DEFAULT 0,
  `stock_enabled` integer NOT NULL DEFAULT 0,
  `stock_quantity` integer NOT NULL DEFAULT 0,
  `status` text NOT NULL DEFAULT 'active' CHECK (`status` IN ('active', 'inactive')),
  `created_by` integer REFERENCES `users`(`id`) ON DELETE SET NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `books_name_grade_unique` ON `books` (`name`, `grade_id`);
--> statement-breakpoint
CREATE INDEX `books_grade_idx` ON `books` (`grade_id`);
--> statement-breakpoint
CREATE TABLE `uniform_items` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `size` text NOT NULL,
  `price_cents` integer NOT NULL DEFAULT 0,
  `stock_enabled` integer NOT NULL DEFAULT 0,
  `stock_quantity` integer NOT NULL DEFAULT 0,
  `status` text NOT NULL DEFAULT 'active' CHECK (`status` IN ('active', 'inactive')),
  `created_by` integer REFERENCES `users`(`id`) ON DELETE SET NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniform_name_size_unique` ON `uniform_items` (`name`, `size`);
--> statement-breakpoint
CREATE TABLE `enrollments` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `code` text NOT NULL UNIQUE,
  `registration` text NOT NULL UNIQUE,
  `student_id` integer REFERENCES `students`(`id`) ON DELETE SET NULL,
  `student_name` text NOT NULL,
  `birth_date` text NOT NULL,
  `grade_id` integer NOT NULL REFERENCES `grades`(`id`) ON DELETE RESTRICT,
  `grade_name_snapshot` text NOT NULL,
  `class_id` integer REFERENCES `classes`(`id`) ON DELETE SET NULL,
  `class_name_snapshot` text,
  `guardian_name` text NOT NULL,
  `guardian_phone` text NOT NULL,
  `enrollment_date` text NOT NULL,
  `notes` text,
  `status` text NOT NULL DEFAULT 'draft' CHECK (`status` IN ('draft', 'completed', 'cancelled')),
  `enrollment_fee_cents` integer NOT NULL,
  `monthly_fee_cents` integer NOT NULL,
  `books_total_cents` integer NOT NULL DEFAULT 0,
  `uniforms_total_cents` integer NOT NULL DEFAULT 0,
  `include_first_monthly` integer NOT NULL DEFAULT 0,
  `initial_total_cents` integer NOT NULL,
  `created_by` integer REFERENCES `users`(`id`) ON DELETE SET NULL,
  `updated_by` integer REFERENCES `users`(`id`) ON DELETE SET NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `enrollments_student_name_idx` ON `enrollments` (`student_name`);
--> statement-breakpoint
CREATE INDEX `enrollments_grade_date_idx` ON `enrollments` (`grade_id`, `enrollment_date`);
--> statement-breakpoint
CREATE TABLE `enrollment_items` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `enrollment_id` integer NOT NULL REFERENCES `enrollments`(`id`) ON DELETE CASCADE,
  `item_type` text NOT NULL CHECK (`item_type` IN ('book', 'uniform')),
  `source_id` integer,
  `description` text NOT NULL,
  `size` text,
  `unit_price_cents` integer NOT NULL,
  `quantity` integer NOT NULL,
  `subtotal_cents` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `enrollment_items_enrollment_idx` ON `enrollment_items` (`enrollment_id`);
--> statement-breakpoint
CREATE TABLE `enrollment_history` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `enrollment_id` integer NOT NULL REFERENCES `enrollments`(`id`) ON DELETE CASCADE,
  `user_id` integer REFERENCES `users`(`id`) ON DELETE SET NULL,
  `action` text NOT NULL,
  `details` text,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `enrollment_history_enrollment_idx` ON `enrollment_history` (`enrollment_id`, `created_at`);
