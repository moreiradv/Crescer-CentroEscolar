CREATE TABLE `library_books` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `accession_code` text NOT NULL UNIQUE,
  `title` text NOT NULL,
  `title_key` text NOT NULL,
  `author` text,
  `author_key` text NOT NULL DEFAULT '',
  `synopsis` text,
  `cover_key` text,
  `cover_mime` text,
  `publisher` text,
  `publication_year` integer,
  `age_range` text,
  `quantity` integer,
  `notes` text,
  `created_by` integer REFERENCES `users`(`id`) ON DELETE SET NULL,
  `updated_by` integer REFERENCES `users`(`id`) ON DELETE SET NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `library_books_title_idx` ON `library_books` (`title_key`);
--> statement-breakpoint
CREATE INDEX `library_books_author_idx` ON `library_books` (`author_key`);
