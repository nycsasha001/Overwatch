import zlib from "node:zlib";

/**
 * A .zip file, built in memory.
 *
 * An export is several files that belong together (a report, a spreadsheet and the screenshots),
 * and a zip is the one container every computer opens with a double-click. The format is simple
 * enough to write by hand: each file gets a small header followed by its bytes, and a directory
 * at the end lists where each one starts. No dependency is needed. Node already has the
 * compression and the checksum.
 *
 * Deliberately limited: no encryption, no ZIP64 (so under 4 GB and 65,535 files), no folders as
 * separate entries. A path like `screenshots/a.png` is enough for every unzipper to create the
 * folder itself.
 */

export interface ZipEntry {
  /** Path inside the archive, with forward slashes: `report.md`, `screenshots/a.png`. */
  path: string;
  data: Buffer | string;
}

/** Dates in a zip use the old MS-DOS layout: two 16-bit numbers, seconds counted in twos. */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function buildZip(entries: ZipEntry[], when = new Date()): Buffer {
  const { time, date } = dosDateTime(when);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const raw = typeof entry.data === "string" ? Buffer.from(entry.data, "utf8") : entry.data;
    const crc = zlib.crc32(raw);
    // Compress, but keep the original when that does not help. A PNG is already compressed, and
    // squeezing it again only makes it slightly bigger.
    const deflated = zlib.deflateRawSync(raw);
    const stored = deflated.length >= raw.length;
    const body = stored ? raw : deflated;
    const method = stored ? 0 : 8;
    // Bit 11 says the file name is UTF-8, so an accent or a dash in a name survives the trip.
    const flags = 0x0800;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed to extract: 2.0
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // no extra field
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // made by
    central.writeUInt16LE(20, 6); // needed to extract
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    // Extra field, comment, disk number, internal and external attributes are all zero.
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, directory, end]);
}
