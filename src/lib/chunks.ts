/** Pure date-window helpers shared by the server importer and the browser progress loop. */

export interface Chunk {
  start: string;
  end: string;
  label: string;
}

/** Month windows [start, end) covering the requested range. */
export function monthChunks(startDate: string, endDate: string): Chunk[] {
  const out: Chunk[] = [];
  const [sy, sm] = startDate.split("-").map(Number);
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return out;

  let cursor = new Date(Date.UTC(sy, sm - 1, 1));
  while (cursor.getTime() < endMs) {
    const next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    const from = Math.max(cursor.getTime(), startMs);
    const to = Math.min(next.getTime(), endMs);
    if (to > from) {
      out.push({
        start: new Date(from).toISOString().slice(0, 10),
        end: new Date(to).toISOString().slice(0, 10),
        label: `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`,
      });
    }
    cursor = next;
  }
  return out;
}
