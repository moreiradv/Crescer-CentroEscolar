CREATE TABLE `agenda_subjects` (
  `agenda_id` integer NOT NULL REFERENCES `agenda_entries`(`id`) ON DELETE CASCADE,
  `subject_id` integer NOT NULL REFERENCES `subjects`(`id`) ON DELETE CASCADE,
  `created_at` integer NOT NULL,
  PRIMARY KEY (`agenda_id`,`subject_id`)
);
--> statement-breakpoint
CREATE INDEX `agenda_subjects_subject_idx` ON `agenda_subjects` (`subject_id`,`agenda_id`);
