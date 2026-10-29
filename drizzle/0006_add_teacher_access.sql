ALTER TABLE `users` ADD `must_change_password` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE `teacher_assignments` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL UNIQUE REFERENCES `users`(`id`) ON DELETE CASCADE,
  `education_stage` text NOT NULL CHECK (`education_stage` IN ('Educação Infantil','Ensino Fundamental')),
  `class_id` integer NOT NULL REFERENCES `classes`(`id`) ON DELETE CASCADE,
  `subject_id` integer REFERENCES `subjects`(`id`) ON DELETE SET NULL,
  `school_year` integer NOT NULL,
  `can_attendance` integer NOT NULL DEFAULT 1,
  `can_agenda` integer NOT NULL DEFAULT 1,
  `status` text NOT NULL DEFAULT 'active' CHECK (`status` IN ('active','inactive')),
  `created_by` integer REFERENCES `users`(`id`) ON DELETE SET NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `teacher_assignments_class_idx` ON `teacher_assignments` (`class_id`,`school_year`);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `attendance_records_new` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `attendance_date` text NOT NULL,
  `class_id` integer NOT NULL REFERENCES `classes`(`id`) ON DELETE CASCADE,
  `student_id` integer NOT NULL REFERENCES `students`(`id`) ON DELETE CASCADE,
  `subject_id` integer REFERENCES `subjects`(`id`) ON DELETE SET NULL,
  `school_year` integer,
  `scope_key` text NOT NULL DEFAULT 'class',
  `status` text NOT NULL CHECK (`status` IN ('present', 'late', 'justified', 'absent')),
  `notes` text,
  `recorded_by` integer REFERENCES `users`(`id`) ON DELETE SET NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `attendance_records_new` (`id`,`attendance_date`,`class_id`,`student_id`,`subject_id`,`school_year`,`scope_key`,`status`,`notes`,`recorded_by`,`created_at`,`updated_at`)
SELECT a.`id`,a.`attendance_date`,a.`class_id`,a.`student_id`,NULL,c.`school_year`,'class',a.`status`,a.`notes`,a.`recorded_by`,a.`created_at`,a.`updated_at` FROM `attendance_records` a LEFT JOIN `classes` c ON c.`id` = a.`class_id`;
--> statement-breakpoint
DROP TABLE `attendance_records`;
--> statement-breakpoint
ALTER TABLE `attendance_records_new` RENAME TO `attendance_records`;
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_scope_unique` ON `attendance_records` (`attendance_date`,`student_id`,`scope_key`);
--> statement-breakpoint
CREATE INDEX `attendance_class_date_idx` ON `attendance_records` (`class_id`,`attendance_date`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
