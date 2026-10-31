// Morning digest, plan § 1. The shapes the run log reader (#2) produces and every part of § 2
// (page, JSON, board link, route tests) reads. Types only: the reader is `readNight` in
// `src/digest/read.ts`, exported as `export const readNight: ReadNight`.

/** A run's outcome, as the log writes it. */
export type RunStatus = 'ok' | 'retry' | 'fail';

/** One line of `runs/<night>.jsonl`, once parsed. */
export type RunLine = {
  /** ISO 8601 time as the log writes it, offset kept (e.g. `2026-10-29T01:30:00+01:00`). */
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

/**
 * One job's night. "First" and "last" mean order in the file (the log is appended as runs
 * happen). Times are the log's `at` strings, offset kept, never converted to UTC.
 */
export type DigestRow = {
  job: string;
  /** Owner on the job's last line; `null` when that line has none (shown as `—`). */
  owner: string | null;
  /** Every parsed line for this job, whatever its status. */
  runs: number;
  /** Lines for this job with status `retry`. */
  retries: number;
  /** Status of the job's last line. */
  lastStatus: RunStatus;
  /**
   * `error` of the job's latest line that carried one, even if a later line was `ok`;
   * `null` when none of the job's lines carried an error.
   */
  lastError: string | null;
  /** `at` of the job's first line. */
  firstAt: string;
  /** `at` of the job's last line. */
  lastAt: string;
};

/** Parsed lines per status over the whole night; `ok + retry + fail` is the sum of `runs`. */
export type StatusCounts = Record<RunStatus, number>;

/** What the reader makes of one night's file. */
export type NightDigest = {
  /** The night asked for, `YYYY-MM-DD`. */
  night: string;
  /**
   * One row per job, sorted by `job` in plain string order (`<`, not `localeCompare`), so the
   * page and the JSON keep one order. Empty when nothing ran: an empty file, or no line parsed.
   */
  rows: DigestRow[];
  /**
   * Non-blank lines that weren't JSON of the `RunLine` shape: counted, never thrown.
   * Blank lines are skipped, not counted.
   */
  badLines: number;
  counts: StatusCounts;
};

/**
 * Reads `<runsDir>/<night>.jsonl`. `null` when there is no file for that night (the routes
 * answer 404); an empty file is a `NightDigest` with no rows ("nothing ran"). A `night` that
 * isn't `YYYY-MM-DD` is treated as no file, so it never reaches the file system.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
