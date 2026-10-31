import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';
import type { NightDigest } from '../src/digest/types.js';

// The real nights, read in place. `runs/` is read-only: every other case uses a temp dir.
const RUNS = fileURLToPath(new URL('../runs', import.meta.url));

const line = (o: Record<string, unknown>) => JSON.stringify(o);

describe('readNight on runs/ (read in place)', () => {
  it('reads 2026-10-28: 5 jobs sorted by job, 1 bad line, offsets kept', () => {
    const expected: NightDigest = {
      night: '2026-10-28',
      rows: [
        {
          job: 'digest/render',
          owner: null,
          runs: 1,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-10-29T05:41:09+01:00',
          lastAt: '2026-10-29T05:41:09+01:00',
        },
        {
          job: 'fixtures/refresh',
          owner: 'rook',
          runs: 4,
          retries: 3,
          lastStatus: 'ok',
          lastError: 'upstream 503',
          firstAt: '2026-10-29T01:30:00+01:00',
          lastAt: '2026-10-29T01:37:00+01:00',
        },
        {
          job: 'lane/sync',
          owner: 'rook',
          runs: 8,
          retries: 1,
          lastStatus: 'ok',
          lastError: 'lock held',
          firstAt: '2026-10-28T23:00:06+01:00',
          lastAt: '2026-10-29T05:00:04+01:00',
        },
        {
          job: 'notes/backup',
          owner: 'lane-07',
          runs: 1,
          retries: 0,
          lastStatus: 'fail',
          lastError: 'quota exceeded',
          firstAt: '2026-10-29T04:00:01+01:00',
          lastAt: '2026-10-29T04:00:01+01:00',
        },
        {
          job: 'rig/rotate-logs',
          owner: 'lane-07',
          runs: 1,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-10-28T23:00:02+01:00',
          lastAt: '2026-10-28T23:00:02+01:00',
        },
      ],
      badLines: 1,
      counts: { ok: 10, retry: 4, fail: 1 },
    };
    expect(readNight(RUNS, '2026-10-28')).toStrictEqual(expected);
  });

  it('counts add up to the runs over all rows', () => {
    const d = readNight(RUNS, '2026-10-28');
    expect(d).not.toBeNull();
    const runs = d!.rows.reduce((n, r) => n + r.runs, 0);
    expect(d!.counts.ok + d!.counts.retry + d!.counts.fail).toBe(runs);
  });

  it('reads 2026-10-27: 4 jobs, all ok, no bad lines', () => {
    const expected: NightDigest = {
      night: '2026-10-27',
      rows: [
        {
          job: 'fixtures/refresh',
          owner: 'rook',
          runs: 1,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-10-28T01:30:00+01:00',
          lastAt: '2026-10-28T01:30:00+01:00',
        },
        {
          job: 'lane/sync',
          owner: 'rook',
          runs: 4,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-10-27T23:00:05+01:00',
          lastAt: '2026-10-28T05:00:04+01:00',
        },
        {
          job: 'notes/backup',
          owner: 'lane-07',
          runs: 1,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-10-28T04:00:01+01:00',
          lastAt: '2026-10-28T04:00:01+01:00',
        },
        {
          job: 'rig/rotate-logs',
          owner: 'lane-07',
          runs: 1,
          retries: 0,
          lastStatus: 'ok',
          lastError: null,
          firstAt: '2026-10-27T23:00:03+01:00',
          lastAt: '2026-10-27T23:00:03+01:00',
        },
      ],
      badLines: 0,
      counts: { ok: 7, retry: 0, fail: 0 },
    };
    expect(readNight(RUNS, '2026-10-27')).toStrictEqual(expected);
  });

  it('is null for a night with no file', () => {
    expect(readNight(RUNS, '2026-10-26')).toBeNull();
  });
});

describe('readNight on a temp runs dir', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (night: string, text: string) => writeFileSync(join(dir, `${night}.jsonl`), text);
  const ok = (job: string, at: string, owner: string | null = 'rook') => line({ at, job, status: 'ok', owner });

  it('is null when the runs dir itself is missing', () => {
    expect(readNight(join(dir, 'nope'), '2026-10-28')).toBeNull();
  });

  it('is null for a night that is not YYYY-MM-DD, even when such a file exists', () => {
    write('evil', ok('a', '2026-10-29T01:00:00+01:00'));
    write('2026-10-28', ok('a', '2026-10-29T01:00:00+01:00'));
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    expect(readNight(dir, 'evil')).toBeNull();
    expect(readNight(sub, '../2026-10-28')).toBeNull();
    expect(readNight(dir, '2026-10-28.jsonl')).toBeNull();
    expect(readNight(dir, '2026-1-28')).toBeNull();
    expect(readNight(dir, '')).toBeNull();
    expect(readNight(dir, '2026-10-28')).not.toBeNull();
  });

  it('reads an empty file as nothing ran', () => {
    write('2026-10-30', '');
    expect(readNight(dir, '2026-10-30')).toStrictEqual({
      night: '2026-10-30',
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('skips blank lines without counting them, with LF or CRLF', () => {
    write('2026-10-30', `\n  \r\n${ok('a', '2026-10-30T01:00:00+01:00')}\r\n\t\r\n\n`);
    const d = readNight(dir, '2026-10-30');
    expect(d?.badLines).toBe(0);
    expect(d?.rows.map((r) => r.job)).toEqual(['a']);
  });

  it('counts valid JSON of the wrong shape as bad lines, never throws', () => {
    const at = '2026-10-30T01:00:00+01:00';
    const bad = [
      line({ at, job: 'a', status: 'done', owner: 'rook' }), // status outside ok | retry | fail
      line({ job: 'a', status: 'ok', owner: 'rook' }), // no at
      line({ at, status: 'ok', owner: 'rook' }), // no job
      line({ at: 1761782400, job: 'a', status: 'ok', owner: 'rook' }), // at not a string
      line({ at, job: 'a', status: 'ok', owner: 7 }), // owner not string | null
      line({ at, job: 'a', status: 'fail', owner: 'rook', error: { code: 503 } }), // error not a string
      '[1,2,3]',
      '42',
      'null',
      '"ok"',
      '{"at":', // not JSON at all
    ];
    write('2026-10-30', [ok('a', at), ...bad, ok('a', '2026-10-30T02:00:00+01:00')].join('\n'));
    const d = readNight(dir, '2026-10-30');
    expect(d?.badLines).toBe(bad.length);
    expect(d?.counts).toEqual({ ok: 2, retry: 0, fail: 0 });
    expect(d?.rows).toStrictEqual([
      {
        job: 'a',
        owner: 'rook',
        runs: 2,
        retries: 0,
        lastStatus: 'ok',
        lastError: null,
        firstAt: at,
        lastAt: '2026-10-30T02:00:00+01:00',
      },
    ]);
  });

  it('has no rows when no line parsed', () => {
    write('2026-10-30', 'not json\n{"job":"a"}\n');
    expect(readNight(dir, '2026-10-30')).toStrictEqual({
      night: '2026-10-30',
      rows: [],
      badLines: 2,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('takes owner and status from the last line, and the latest error carried', () => {
    write(
      '2026-10-30',
      [
        line({ at: '2026-10-30T01:00:00+01:00', job: 'j', status: 'retry', owner: 'rook', error: 'first' }),
        line({ at: '2026-10-30T01:05:00+01:00', job: 'j', status: 'fail', owner: 'lane-07', error: 'second' }),
        line({ at: '2026-10-30T01:10:00+01:00', job: 'j', status: 'ok', owner: null }),
      ].join('\n'),
    );
    expect(readNight(dir, '2026-10-30')?.rows).toStrictEqual([
      {
        job: 'j',
        owner: null,
        runs: 3,
        retries: 1,
        lastStatus: 'ok',
        lastError: 'second',
        firstAt: '2026-10-30T01:00:00+01:00',
        lastAt: '2026-10-30T01:10:00+01:00',
      },
    ]);
  });

  it('reads an owner or error left out, or an error set to null, as none', () => {
    write(
      '2026-10-30',
      [
        line({ at: '2026-10-30T01:00:00+01:00', job: 'j', status: 'ok' }),
        line({ at: '2026-10-30T01:01:00+01:00', job: 'k', status: 'ok', owner: 'rook', error: null }),
      ].join('\n'),
    );
    const d = readNight(dir, '2026-10-30');
    expect(d?.badLines).toBe(0);
    expect(d?.rows.map((r) => [r.job, r.owner, r.lastError])).toEqual([
      ['j', null, null],
      ['k', 'rook', null],
    ]);
  });

  it('keeps first and last in file order and the offsets as written', () => {
    write(
      '2026-10-30',
      [
        line({ at: '2026-10-30T23:00:00-03:00', job: 'j', status: 'ok', owner: 'rook' }),
        line({ at: '2026-10-30T01:00:00Z', job: 'j', status: 'ok', owner: 'rook' }),
      ].join('\n'),
    );
    const [row] = readNight(dir, '2026-10-30')?.rows ?? [];
    expect(row?.firstAt).toBe('2026-10-30T23:00:00-03:00');
    expect(row?.lastAt).toBe('2026-10-30T01:00:00Z');
  });

  it('sorts rows by job in plain string order, not locale order', () => {
    const at = '2026-10-30T01:00:00+01:00';
    write('2026-10-30', ['b', 'a', '_x', 'B'].map((j) => ok(j, at)).join('\n'));
    expect(readNight(dir, '2026-10-30')?.rows.map((r) => r.job)).toEqual(['B', '_x', 'a', 'b']);
  });
});
