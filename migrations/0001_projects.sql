CREATE TABLE IF NOT EXISTS projects (
  project_number TEXT PRIMARY KEY COLLATE NOCASE,
  data TEXT NOT NULL CHECK(json_valid(data)),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_number TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  previous_data TEXT,
  next_data TEXT
);
