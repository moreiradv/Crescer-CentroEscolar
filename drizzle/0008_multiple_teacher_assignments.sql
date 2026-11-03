PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `teacher_assignments_new` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
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
INSERT INTO `teacher_assignments_new` SELECT * FROM `teacher_assignments`;
--> statement-breakpoint
DROP TABLE `teacher_assignments`;
--> statement-breakpoint
ALTER TABLE `teacher_assignments_new` RENAME TO `teacher_assignments`;
--> statement-breakpoint
CREATE UNIQUE INDEX `teacher_assignment_scope_unique` ON `teacher_assignments` (`user_id`,`class_id`,`subject_id`,`school_year`);
--> statement-breakpoint
CREATE INDEX `teacher_assignments_user_idx` ON `teacher_assignments` (`user_id`,`status`);
--> statement-breakpoint
CREATE INDEX `teacher_assignments_class_idx` ON `teacher_assignments` (`class_id`,`school_year`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
