# Project Documentation

This document explains how the code in this repository works, the key files, required settings, outputs, and how to run the scripts.

## Overview

- Purpose: Fetch, process, and combine POS export CSVs from a remote endpoint for multiple branches and POS devices. The combined/processed output is written to `record2025.csv`.
- Main components:
  - `fetcher.py` — fetch/download remote CSVs and manage the fetch workflow.
  - `combiner.py` — parse the downloaded CSV files (per POS type), join reference files, and create the master/combined records.
  - `manual_fetch.py` — simple runner that uses `last_record.log` to fetch a date range and run the combiner.
  - `missing_generate.py` — helper to compute missing dates per branch/pos and call missing fetch.
  - `pandasbiggs.py` — local helper module used across the project (not detailed here).

Files live in the repository root; downloaded files are placed in `latest/` and temporary files in `temp/`.

## Requirements

- Python 3.x
- pip packages: `requests`, `pandas`, `tqdm`, `bokeh` (used by `missing_generate.py`), and any dependencies used by `pandasbiggs.py`.
- Local settings files under `settings/`:
  - `branches.txt` — list of branch IDs (one per line) used by `fetcher.Receive`.
  - `newBranches.txt` — list of branches that require different parsing logic in `combiner.Combiner`.

Install dependencies (example):

```bash
pip install requests pandas tqdm bokeh
```

## Important output files

- `record2025.csv` — main combined output (created/appended by `Combiner`).
- `masterData_errorMonitoring.csv` — created/updated by `Combiner.update_monitor_csv()` to track any branch/pos/date combos with errors.
- `last_record.log` — keeps track of the latest processed date used by `manual_fetch.py`.

## How to run

- Manual run (fetch a date range and process):

  1. Update `settings/branches.txt` and `settings/newBranches.txt` as needed.
  2. Edit or ensure `last_record.log` contains a start date (YYYY-MM-DD).
  3. Run:

     ```bash
     python manual_fetch.py
     ```

- Use `missing_generate.py` to calculate missing dates between two entered dates and auto-fetch those missing records. It will call `Receive.missing_fetch()` to download only the missing files and then run the combiner.

## Module details

### `fetcher.py`

Key class: `Receive`

- `__init__(self, start_time, end_time, datearr=pandas.DataFrame())`:
  - Prepares a date range (`self.dlist`) either from `start_time`/`end_time` strings (YYYY-MM-DD) or from a passed `pandas` date index.
  - Loads branch list from `settings/branches.txt` into `self.branches`.

- `send(self, branch, pos, date)`:
  - POSTs to `https://biggsph.com/biggsinc_loyalty/controller/fetch_list2.php` with `branch`, `pos`, `date` to retrieve a comma-separated list of filenames available for that branch/pos/date.
  - Returns a list of filenames or `['']` if the response is HTML (indicating an error or redirect).

- `download_file(self, url, destination)`:
  - Downloads a file from the remote controller endpoint and saves to local `destination` folder (e.g., `latest/`).
  - Returns the saved local file path.

- `process(self, filearray, pos)`:
  - Given a list of filenames (from `send`), downloads each into `latest/`.
  - Historically this method used logic to determine the largest file per filetype; currently it downloads all available files into `latest/` for later combining.

- `clean(self, directory)`:
  - Removes files and subdirectories inside `directory` (used to clear `latest/` and `temp/`).

- `fetch(self)`:
  - Drives a full fetch over the date range in `self.dlist` and all branches in `self.branches`.
  - For each (date, branch), calls `send` for POS 1 and 2, calls `process` to download, then creates a `Combiner()` and runs `compress.generate()` to combine downloaded files.
  - Clears `latest/` between processing dates and updates `last_record.log` to the next date.

- `missing_fetch(self, branches_missing)`:
  - Accepts a dictionary organized as {branch: {pos: [date_strs]}} and fetches only those missing dates/pos.
  - After processing each branch it calls `Combiner.generate()` and clears `latest/`.

Notes:
- `Receive.process` downloads to `latest/` and relies on the combiner to read those files.

### `combiner.py`

Key class: `Combiner`

Top-level behavior:

- `__init__(self)`:
  - Sets `self.parentDir` and file paths; reads `settings/newBranches.txt` into `self.new_branches`.

- `clean(self, directory)`:
  - Removes files/subfolders in given directory (similar to `Receive.clean`).

- `generate(self)`:
  - Scans `latest/` for files and organizes them into a nested dict keyed as `posFilenames[branch][pos][date][filetype]`.
  - File names are expected with the format like `a_BRANCH_POS_filetype_YYYY-MM-DD_...csv` (split by `_`).
  - After building `posFilenames`, the generator iterates branches/pos/dates and will call processing routines (the provided snippet shows the structure; main logic runs in `GenAppend`/`stringifyAppend`).

- `GenAppend(self, filename, fTypes)`:
  - Core conversion routine. It reads the main transaction file (`rd5000`), plus reference files such as `rd5500` (items), `discount`, `rd1800` (departments), `rd5800` (transactions), `rd5900` (payments), and `blpr` (billing/profile) when available.
  - Builds dictionaries from these reference files (e.g., `item_dict`, `dept_dict`, `disc_dict`, `tnsc_dict`, `paym_dict`, `blpr_dict`) to map keys to human-friendly fields.
  - Iterates transaction lines and uses `stringifyAppend` to create a cleaned, combined CSV row for each transaction and appends into `record2025.csv` via `csvGenAppend`.
  - Uses `tqdm` to show progress when iterating lines.

- `preProc(self, filename)`:
  - Safely opens a file located in `latest/` by base name and returns its content as a string.
  - Returns an empty string if file not found.

- `stringifyAppend(self, filename, line, item, disc, dept, type, time, tnsc, paym, blpr)`:
  - Given a transaction `line` and reference dictionaries, it extracts specific columns, performs lookups (item name, department, discount, payment method, billing cust), and creates a normalized CSV row (string).
  - This is where field mapping is centralized: column indices are selected and transformed, time-of-day mapping is applied, and lookups for `tnsc` and `blpr` produce additional fields.

- `update_monitor_csv(self, filename="masterData_errorMonitoring.csv")`:
  - Ensures a monitoring CSV exists and appends a unique `(pos, branch, date)` row whenever called; avoids duplicates.

- `prepare_csv(self)`:
  - Ensures `record2025.csv` file exists and creates it (with headers from `aaa_headers.csv`) if it is missing or empty.

- `csvGenAppend(self, filename, part, line)`:
  - Appends a given `line` string to the `record_file` (open in append mode with UTF-8).

- `clean_csv_edges(self, file_path)`:
  - Utility to remove any leading/trailing empty lines from a CSV file.

Notes:
- `Combiner` expects to find all downloaded files in `latest/` and reference branch behavior in `settings/newBranches.txt` to handle branch-specific parsing.
- File-type keys used: `rd1800`, `blpr`, `discount`, `rd5000`, `rd5500`, `rd5800`, `rd5900`.

### `manual_fetch.py`

- Convenience runner that reads `last_record.log` for a start date and sets an end date (by default previous day). It constructs a `Receive` object and calls `rep.fetch()`.
- After running, it updates `last_record.log` to the current date.

### `missing_generate.py`

- Interactive helper to compute missing branch/pos/date combos by:
  1. Reading `record2025.csv` via a `CSVProcessor` (from `pandasbiggs.py`).
  2. Taking a user-entered date range, pivoting by `DATE`, `BRANCH`, `POS` and `QUANTITY` to detect where entries are zero/missing.
  3. Building a `branches_missing` dictionary of the form `{branch: {pos: [dates]}}`.
  4. Instantiating `Receive` with a date range and calling `rep.missing_fetch(branches_missing)` to fetch only the missing records.

This script writes `Missing_dates.csv` and `Missing_dates_new.csv` as outputs of the detection steps.

## Expected directory layout

- `latest/` — remote downloads saved here temporarily.
- `temp/` — used for transient files.
- `settings/branches.txt` — branch list used by fetcher.
- `settings/newBranches.txt` — branches that require alternate parsing in the combiner.
- `record2025.csv` — main aggregated CSV output.

## Troubleshooting & notes

- If `Combiner` fails to find a file, `preProc` returns an empty string; `GenAppend` contains logic to handle missing reference files (skips lookups or uses defaults).
- Network failures during `send` or `download_file` are retried up to 3 times in the current implementation, but you may wish to add more detailed retry/backoff.
- The project uses a local `pandasbiggs.py` helper which exposes `CSVProcessor`; ensure that file is present and importable.
- If running on Windows, ensure paths and permissions allow read/write on `latest/`, `temp/`, and the repo root.

## Next steps (suggested)

- (Optional) Add a CLI wrapper to accept start/end dates and a `--missing-only` flag.
- Improve logging (use `logging` module instead of prints) and surface errors to `masterData_errorMonitoring.csv` when parsing fails.

---

Documentation created by assistant summarizing code behavior. For questions or deeper inline comments, tell me which file or function you want annotated.
