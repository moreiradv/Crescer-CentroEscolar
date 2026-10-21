CREATE TABLE `subjects` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `education_stage` text NOT NULL CHECK (`education_stage` IN ('Educação Infantil','Ensino Fundamental')),
  `sort_order` integer NOT NULL DEFAULT 0,
  `status` text NOT NULL DEFAULT 'active' CHECK (`status` IN ('active','inactive')),
  `created_by` integer REFERENCES `users`(`id`) ON DELETE SET NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  UNIQUE(`education_stage`,`name`)
);
--> statement-breakpoint
CREATE INDEX `subjects_stage_idx` ON `subjects` (`education_stage`,`sort_order`);
--> statement-breakpoint
CREATE TABLE `subject_components` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `subject_id` integer NOT NULL REFERENCES `subjects`(`id`) ON DELETE CASCADE,
  `name` text NOT NULL,
  `sort_order` integer NOT NULL DEFAULT 0,
  `status` text NOT NULL DEFAULT 'active' CHECK (`status` IN ('active','inactive')),
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  UNIQUE(`subject_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `student_class_history` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `student_id` integer NOT NULL REFERENCES `students`(`id`) ON DELETE CASCADE,
  `class_id` integer REFERENCES `classes`(`id`) ON DELETE SET NULL,
  `school_year` integer NOT NULL,
  `grade_level_snapshot` text NOT NULL,
  `class_name_snapshot` text NOT NULL,
  `result_status` text NOT NULL DEFAULT 'active',
  `notes` text,
  `joined_at` integer NOT NULL,
  `left_at` integer,
  `promoted_by` integer REFERENCES `users`(`id`) ON DELETE SET NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  UNIQUE(`student_id`,`class_id`)
);
--> statement-breakpoint
CREATE INDEX `student_class_history_student_idx` ON `student_class_history` (`student_id`,`school_year`);
--> statement-breakpoint
ALTER TABLE `agenda_entries` ADD `subject_id` integer REFERENCES `subjects`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `agenda_entries` ADD `education_stage` text;
--> statement-breakpoint
ALTER TABLE `agenda_entries` ADD `school_year` integer;
--> statement-breakpoint
ALTER TABLE `agenda_entries` ADD `grade_level` text;
--> statement-breakpoint
ALTER TABLE `agenda_entries` ADD `teacher_name` text;
--> statement-breakpoint
ALTER TABLE `agenda_entries` ADD `homework` text;
--> statement-breakpoint
ALTER TABLE `agenda_entries` ADD `subject_component` text;
