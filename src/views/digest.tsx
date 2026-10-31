import type { DigestRow, NightDigest } from '../digest/types.js';

const dash = '—';

function Row({ row }: { row: DigestRow }) {
  const warn = row.retries >= 3 || row.lastStatus === 'fail';
  return (
    <tr class={warn ? 'warn' : undefined}>
      <td>{row.job}</td>
      <td>{row.owner ?? dash}</td>
      <td>{row.runs}</td>
      <td>{row.retries}</td>
      <td>{row.lastStatus}</td>
      <td>{row.lastError ?? dash}</td>
      <td>{row.firstAt}</td>
      <td>{row.lastAt}</td>
    </tr>
  );
}

export function DigestPage({ digest }: { digest: NightDigest }) {
  return (
    <>
      <h1>digest {digest.night}</h1>
      {digest.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th>
              <th>owner</th>
              <th>runs</th>
              <th>retries</th>
              <th>last status</th>
              <th>last error</th>
              <th>first</th>
              <th>last</th>
            </tr>
          </thead>
          <tbody>
            {digest.rows.map((row) => (
              <Row row={row} />
            ))}
          </tbody>
        </table>
      )}
      {digest.badLines > 0 && (
        <p class="mute">
          {digest.badLines} {digest.badLines === 1 ? 'line' : 'lines'} didn't parse
        </p>
      )}
    </>
  );
}

export function NoDigest({ night }: { night: string }) {
  return (
    <>
      <h1>digest {night}</h1>
      <p class="mute">no run log for {night}</p>
    </>
  );
}
