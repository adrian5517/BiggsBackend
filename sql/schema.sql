-- PostgreSQL schema for FetchLog and FileRecord
CREATE TABLE IF NOT EXISTS fetch_logs (
  id SERIAL PRIMARY KEY,
  job_id TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  mode TEXT,
  start_date DATE,
  end_date DATE,
  branches TEXT[],
  positions INT[],
  rows_inserted INT DEFAULT 0,
  files_total INT DEFAULT 0,
  files_completed INT DEFAULT 0,
  errors TEXT[],
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS file_records (
  id SERIAL PRIMARY KEY,
  filename TEXT NOT NULL,
  branch TEXT,
  pos TEXT,
  work_date DATE,
  source_file TEXT,
  file_type TEXT,
  storage_type TEXT,
  storage_path TEXT,
  fetched_at TIMESTAMP DEFAULT now(),
  size BIGINT,
  checksum TEXT,
  status TEXT,
  error TEXT,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- Unique constraint to mirror the original Mongoose unique index
CREATE UNIQUE INDEX IF NOT EXISTS unique_branch_pos_date_source ON file_records(branch, pos, work_date, source_file);

-- Users table for Postgres-backed auth
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  profile_picture TEXT,
  refresh_tokens TEXT[] DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Export jobs table (replaces Mongo ExportJob when running Postgres-only)
CREATE TABLE IF NOT EXISTS export_jobs (
  id SERIAL PRIMARY KEY,
  job_id TEXT UNIQUE NOT NULL,
  user_id INT,
  status TEXT NOT NULL DEFAULT 'pending',
  params JSONB,
  file_name TEXT,
  error TEXT,
  progress INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_export_jobs_status ON export_jobs(status);
