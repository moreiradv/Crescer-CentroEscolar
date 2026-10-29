ALTER TABLE `agenda_entries` ADD `no_agenda` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `uniform_items` ADD `category` text NOT NULL DEFAULT 'regular' CHECK (`category` IN ('regular','physical_education'));
--> statement-breakpoint
ALTER TABLE `uniform_items` ADD `product_type` text NOT NULL DEFAULT 'single' CHECK (`product_type` IN ('set','single'));
--> statement-breakpoint
ALTER TABLE `uniform_items` ADD `components` text;
--> statement-breakpoint
ALTER TABLE `enrollment_items` ADD `category` text;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `enrollments_new` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `code` text NOT NULL UNIQUE,
  `registration` text NOT NULL,
  `student_id` integer REFERENCES `students`(`id`) ON DELETE SET NULL,
  `student_name` text NOT NULL,
  `birth_date` text NOT NULL,
  `grade_id` integer NOT NULL REFERENCES `grades`(`id`) ON DELETE RESTRICT,
  `grade_name_snapshot` text NOT NULL,
  `class_id` integer REFERENCES `classes`(`id`) ON DELETE SET NULL,
  `class_name_snapshot` text,
  `school_year` integer,
  `guardian_name` text NOT NULL,
  `guardian_phone` text NOT NULL,
  `enrollment_date` text NOT NULL,
  `notes` text,
  `status` text NOT NULL DEFAULT 'draft' CHECK (`status` IN ('draft', 'completed', 'cancelled')),
  `enrollment_fee_cents` integer NOT NULL,
  `monthly_fee_cents` integer NOT NULL,
  `books_total_cents` integer NOT NULL DEFAULT 0,
  `uniforms_total_cents` integer NOT NULL DEFAULT 0,
  `uniform_regular_total_cents` integer NOT NULL DEFAULT 0,
  `uniform_physical_total_cents` integer NOT NULL DEFAULT 0,
  `include_first_monthly` integer NOT NULL DEFAULT 0,
  `initial_total_cents` integer NOT NULL,
  `created_by` integer REFERENCES `users`(`id`) ON DELETE SET NULL,
  `updated_by` integer REFERENCES `users`(`id`) ON DELETE SET NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `completed_at` integer
);
--> statement-breakpoint
INSERT INTO `enrollments_new` (`id`,`code`,`registration`,`student_id`,`student_name`,`birth_date`,`grade_id`,`grade_name_snapshot`,`class_id`,`class_name_snapshot`,`school_year`,`guardian_name`,`guardian_phone`,`enrollment_date`,`notes`,`status`,`enrollment_fee_cents`,`monthly_fee_cents`,`books_total_cents`,`uniforms_total_cents`,`uniform_regular_total_cents`,`uniform_physical_total_cents`,`include_first_monthly`,`initial_total_cents`,`created_by`,`updated_by`,`created_at`,`updated_at`,`completed_at`)
SELECT e.`id`,e.`code`,e.`registration`,e.`student_id`,e.`student_name`,e.`birth_date`,e.`grade_id`,e.`grade_name_snapshot`,e.`class_id`,e.`class_name_snapshot`,c.`school_year`,e.`guardian_name`,e.`guardian_phone`,e.`enrollment_date`,e.`notes`,e.`status`,e.`enrollment_fee_cents`,e.`monthly_fee_cents`,e.`books_total_cents`,e.`uniforms_total_cents`,e.`uniforms_total_cents`,0,e.`include_first_monthly`,e.`initial_total_cents`,e.`created_by`,e.`updated_by`,e.`created_at`,e.`updated_at`,e.`completed_at` FROM `enrollments` e LEFT JOIN `classes` c ON c.`id`=e.`class_id`;
--> statement-breakpoint
DROP TABLE `enrollments`;
--> statement-breakpoint
ALTER TABLE `enrollments_new` RENAME TO `enrollments`;
--> statement-breakpoint
CREATE INDEX `enrollments_student_name_idx` ON `enrollments` (`student_name`);
--> statement-breakpoint
CREATE INDEX `enrollments_grade_date_idx` ON `enrollments` (`grade_id`,`enrollment_date`);
--> statement-breakpoint
CREATE UNIQUE INDEX `enrollments_student_year_unique` ON `enrollments` (`student_id`,`school_year`) WHERE `student_id` IS NOT NULL AND `school_year` IS NOT NULL AND `status` != 'cancelled';
--> statement-breakpoint
PRAGMA foreign_keys=ON;
