CREATE TABLE `classes` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `grade_level` text NOT NULL,
  `shift` text NOT NULL CHECK (`shift` IN ('Matutino', 'Vespertino', 'Integral', 'Noturno')),
  `school_year` integer NOT NULL,
  `teacher_name` text,
  `status` text NOT NULL DEFAULT 'active' CHECK (`status` IN ('active', 'inactive')),
  `created_by` integer REFERENCES `users`(`id`) ON DELETE SET NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `classes_name_year_unique` ON `classes` (`name`, `school_year`);
--> statement-breakpoint
CREATE TABLE `students` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `registration` text NOT NULL UNIQUE,
  `name` text NOT NULL,
  `birth_date` text,
  `guardian_name` text,
  `guardian_phone` text,
  `class_id` integer REFERENCES `classes`(`id`) ON DELETE SET NULL,
  `status` text NOT NULL DEFAULT 'active' CHECK (`status` IN ('active', 'inactive')),
  `created_by` integer REFERENCES `users`(`id`) ON DELETE SET NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `students_class_id_idx` ON `students` (`class_id`);
--> statement-breakpoint
CREATE INDEX `students_name_idx` ON `students` (`name`);
--> statement-breakpoint
CREATE TABLE `agenda_entries` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `agenda_date` text NOT NULL,
  `class_id` integer REFERENCES `classes`(`id`) ON DELETE SET NULL,
  `subject` text NOT NULL,
  `content` text NOT NULL,
  `activity` text,
  `materials` text NOT NULL DEFAULT '[]',
  `status` text NOT NULL,
  `notes` text,
  `created_by` integer REFERENCES `users`(`id`) ON DELETE SET NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agenda_entries_date_idx` ON `agenda_entries` (`agenda_date`);
--> statement-breakpoint
CREATE INDEX `agenda_entries_class_idx` ON `agenda_entries` (`class_id`);
--> statement-breakpoint
CREATE TABLE `attendance_records` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `attendance_date` text NOT NULL,
  `class_id` integer NOT NULL REFERENCES `classes`(`id`) ON DELETE CASCADE,
  `student_id` integer NOT NULL REFERENCES `students`(`id`) ON DELETE CASCADE,
  `status` text NOT NULL CHECK (`status` IN ('present', 'late', 'justified', 'absent')),
  `notes` text,
  `recorded_by` integer REFERENCES `users`(`id`) ON DELETE SET NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_date_student_unique` ON `attendance_records` (`attendance_date`, `student_id`);
--> statement-breakpoint
CREATE INDEX `attendance_class_date_idx` ON `attendance_records` (`class_id`, `attendance_date`);
