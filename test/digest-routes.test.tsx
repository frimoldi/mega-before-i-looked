import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { NightDigest } from '../src/digest/types.js';

// Own nights in a temp runs dir; runs/ is real data and stays untouched.
const NIGHT_BAD = '2026-10-29'; // one bad line, a job with 3 retries, a fail, an owner null
const NIGHT_EMPTY = '2026-10-30'; // an empty file: "nothing ran"
const NIGHT_MISSING = '2026-10-20'; // no file: 404

const line = (o: Record<string, unknown>) => JSON.stringify(o);

// File order is not job order: rig/rotate-logs comes first in the file, last in the digest.
const nightBad = [
  line({ at: '2026-10-29T01:00:00+01:00', job: 'rig/rotate-logs', status: 'ok', owner: null }),
  line({ at: '2026-10-29T01:30:00+01:00', job: 'fixtures/refresh', status: 'retry', owner: 'rook', error: 'upstream 503' }),
  '{"at":"2026-10-29T01:31:00+01:00","job":',
  line({ at: '2026-10-29T01:31:00+01:00', job: 'fixtures/refresh', status: 'retry', owner: 'rook', error: 'upstream 503' }),
  line({ at: '2026-10-29T01:32:00+01:00', job: 'fixtures/refresh', status: 'retry', owner: 'rook', error: 'upstream 503' }),
  line({ at: '2026-10-29T01:33:00+01:00', job: 'lane/sync', status: 'fail', owner: 'rook', error: 'push rejected' }),
].join('\n') + '\n';

const expectedDigest: NightDigest = {
  night: NIGHT_BAD,
  rows: [
    {
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 3,
      retries: 3,
      lastStatus: 'retry',
      lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:32:00+01:00',
    },
    {
      job: 'lane/sync',
      owner: 'rook',
      runs: 1,
      retries: 0,
      lastStatus: 'fail',
      lastError: 'push rejected',
      firstAt: '2026-10-29T01:33:00+01:00',
      lastAt: '2026-10-29T01:33:00+01:00',
    },
    {
      job: 'rig/rotate-logs',
      owner: null,
      runs: 1,
      retries: 0,
      lastStatus: 'ok',
      lastError: null,
      firstAt: '2026-10-29T01:00:00+01:00',
      lastAt: '2026-10-29T01:00:00+01:00',
    },
  ],
  badLines: 1,
  counts: { ok: 1, retry: 3, fail: 1 },
};

// The page's table, row by row: the cell texts in column order.
const decode = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');

function bodyRows(html: string): string[] {
  return html
    .split('<tr')
    .slice(1)
    .map((s) => '<tr' + s.split('</tr>')[0] + '</tr>')
    .filter((r) => r.includes('<td'));
}

function cellsOf(tr: string): string[] {
  return [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
    decode(m[1].replace(/<[^>]*>/g, '').trim()),
  );
}

describe('digest routes', () => {
  let dir: string;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    process.env.LANE_MARKER = 'TEST-MARKER';
    dir = mkdtempSync(join(tmpdir(), 'rig-'));
    writeFileSync(join(dir, `${NIGHT_BAD}.jsonl`), nightBad);
    writeFileSync(join(dir, `${NIGHT_EMPTY}.jsonl`), '');
    app = createApp({
      adapter: 'shim',
      installed: '2026-10-29T14:06:00+01:00',
      beatEverySeconds: 60,
      runsDir: dir,
    });
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('GET /digest/:night', () => {
    it('renders a night with the lane banner, one row per job, and the bad line', async () => {
      const res = await app.request(`/digest/${NIGHT_BAD}`);
      const html = decode(await res.text());
      expect(res.status).toBe(200);
      expect(html).toContain(`digest ${NIGHT_BAD}`);
      expect(html).toContain('TEST-MARKER');
      expect(html).toContain('<table');
      expect(html).toContain('<p class="mute">1 line didn\'t parse</p>');
      expect(bodyRows(html)).toHaveLength(3);
    });

    it('shows the cells in column order, with null owner and null error as —', async () => {
      const html = await (await app.request(`/digest/${NIGHT_BAD}`)).text();
      const rows = bodyRows(html).map(cellsOf);
      expect(rows).toEqual([
        ['fixtures/refresh', 'rook', '3', '3', 'retry', 'upstream 503', '2026-10-29T01:30:00+01:00', '2026-10-29T01:32:00+01:00'],
        ['lane/sync', 'rook', '1', '0', 'fail', 'push rejected', '2026-10-29T01:33:00+01:00', '2026-10-29T01:33:00+01:00'],
        ['rig/rotate-logs', '—', '1', '0', 'ok', '—', '2026-10-29T01:00:00+01:00', '2026-10-29T01:00:00+01:00'],
      ]);
    });

    it('marks a job with 3 or more retries and any fail with class="warn", and no other row', async () => {
      const html = await (await app.request(`/digest/${NIGHT_BAD}`)).text();
      const rows = bodyRows(html);
      const byJob = (job: string) => rows.find((r) => cellsOf(r)[0] === job) ?? '';
      expect(byJob('fixtures/refresh').startsWith('<tr class="warn">')).toBe(true);
      expect(byJob('lane/sync').startsWith('<tr class="warn">')).toBe(true);
      expect(byJob('rig/rotate-logs')).not.toContain('class="warn"');
    });

    it('answers 404 with the layout for a night with no file, and for a malformed night', async () => {
      for (const night of [NIGHT_MISSING, 'not-a-night']) {
        const res = await app.request(`/digest/${night}`);
        const html = decode(await res.text());
        expect(res.status).toBe(404);
        expect(html).toContain(`no run log for ${night}`);
        expect(html).toContain('TEST-MARKER');
      }
    });

    it('answers 200 with "nothing ran" and no table for an empty night', async () => {
      const res = await app.request(`/digest/${NIGHT_EMPTY}`);
      const html = decode(await res.text());
      expect(res.status).toBe(200);
      expect(html).toContain('nothing ran');
      expect(html).not.toContain('<table');
    });
  });

  describe('GET /api/digest/:night', () => {
    it('answers 200 with the digest as JSON, nulls kept', async () => {
      const res = await app.request(`/api/digest/${NIGHT_BAD}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(expectedDigest);
    });

    it('answers 404 with the error shape for a night with no file, and for a malformed night', async () => {
      for (const night of [NIGHT_MISSING, 'not-a-night']) {
        const res = await app.request(`/api/digest/${night}`);
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ night, error: 'no run log' });
      }
    });

    it('answers 200 with no rows for an empty night', async () => {
      const res = await app.request(`/api/digest/${NIGHT_EMPTY}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        night: NIGHT_EMPTY,
        rows: [],
        badLines: 0,
        counts: { ok: 0, retry: 0, fail: 0 },
      });
    });
  });

  it('lists the same jobs in the same order in the page and in the JSON', async () => {
    const html = await (await app.request(`/digest/${NIGHT_BAD}`)).text();
    const pageJobs = bodyRows(html).map((r) => cellsOf(r)[0]);
    const json = (await (await app.request(`/api/digest/${NIGHT_BAD}`)).json()) as NightDigest;
    const jsonJobs = json.rows.map((r) => r.job);
    expect(pageJobs).toEqual(jsonJobs);
    expect(jsonJobs).toEqual(['fixtures/refresh', 'lane/sync', 'rig/rotate-logs']);
  });
});
