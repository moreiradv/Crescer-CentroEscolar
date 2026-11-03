CREATE TABLE `progression_rules` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `from_grade` text NOT NULL UNIQUE,
  `to_grade` text NOT NULL,
  `status` text NOT NULL DEFAULT 'active' CHECK (`status` IN ('active','inactive')),
  `created_by` integer REFERENCES `users`(`id`) ON DELETE SET NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `progression_rules` (`from_grade`,`to_grade`,`status`,`created_at`,`updated_at`) VALUES
('Infantil 3','Infantil 4','active',0,0),
('Infantil 4','Infantil 5','active',0,0),
('Infantil 5','1º Ano','active',0,0),
('1º Ano','2º Ano','active',0,0),
('2º Ano','3º Ano','active',0,0),
('3º Ano','4º Ano','active',0,0),
('4º Ano','5º Ano','active',0,0),
('5º Ano','6º Ano','active',0,0),
('6º Ano','7º Ano','active',0,0),
('7º Ano','8º Ano','active',0,0),
('8º Ano','9º Ano','active',0,0);
