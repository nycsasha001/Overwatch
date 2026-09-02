"""
Copy the chart image from each Notion test page onto the matching journal entry.

Every test in the Notion 🧪 Backtesting database has its chart pasted into the page body. Those
images are the record of what was actually on screen — markup, levels and all — which the app's
redrawn chart cannot reproduce. This downloads each one and attaches it to the trade that came
from that page.

Trades are matched by the Notion page URL stored in their review field, so this only ever touches
entries that came from Notion, and it skips any trade that already has a screenshot.

    python3 scripts/import-notion-screenshots.py --images notion-images.json --dry-run
    python3 scripts/import-notion-screenshots.py --images notion-images.json

The images file is a JSON map of { "<notion page url>": "<image url>" }.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def request(base: str, method: str, path: str, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            raw = res.read().decode()
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path} → {e.code}: {e.read().decode()[:300]}") from None
    except urllib.error.URLError as e:
        raise SystemExit(f"Could not reach Overwatch at {base} ({e.reason}). Is the app running?") from None
    return json.loads(raw) if raw else None


def download(url: str) -> tuple[bytes, str]:
    """
    Fetched with curl rather than urllib.

    A python.org install on macOS ships without a CA bundle wired up, so urllib fails every HTTPS
    request to S3 with "unable to get local issuer certificate". curl uses the system keychain and
    is always present, which sidesteps the problem instead of asking you to install certificates.
    """
    with tempfile.NamedTemporaryFile(delete=False) as tmp:
        path = tmp.name
    try:
        proc = subprocess.run(
            ["curl", "-sSL", "--fail", "--max-time", "120", "-o", path, url],
            capture_output=True, text=True,
        )
        if proc.returncode != 0:
            raise RuntimeError((proc.stderr or f"curl exited {proc.returncode}").strip()[:200])
        blob = open(path, "rb").read()
    finally:
        try:
            os.remove(path)
        except OSError:
            pass
    if not blob:
        raise RuntimeError("empty response")
    # Sniff the type from the leading bytes; the extension in a signed URL is not authoritative.
    mime = ("image/png" if blob[:8] == b"\x89PNG\r\n\x1a\n"
            else "image/jpeg" if blob[:3] == b"\xff\xd8\xff"
            else "image/webp" if blob[8:12] == b"WEBP"
            else "image/gif" if blob[:3] == b"GIF"
            else "image/png")
    return blob, mime


def upload(base: str, trade_id: str, blob: bytes, mime: str, caption: str) -> None:
    """multipart/form-data by hand — the app's screenshot endpoint takes a file upload."""
    ext = mimetypes.guess_extension(mime) or ".png"
    boundary = "----overwatch" + uuid.uuid4().hex
    parts: list[bytes] = []

    def field(name: str, value: str) -> None:
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())

    field("tradeId", trade_id)
    field("phase", "trade")
    field("caption", caption)
    parts.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="notion{ext}"\r\n'
        f"Content-Type: {mime}\r\n\r\n".encode()
    )
    parts.append(blob)
    parts.append(f"\r\n--{boundary}--\r\n".encode())
    body = b"".join(parts)

    req = urllib.request.Request(base + "/api/screenshots", data=body, method="POST")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    try:
        urllib.request.urlopen(req, timeout=120).read()
    except urllib.error.HTTPError as e:
        raise SystemExit(f"upload → {e.code}: {e.read().decode()[:300]}") from None


def main() -> None:
    ap = argparse.ArgumentParser(description="Attach Notion chart images to journal entries.")
    ap.add_argument("--account", default="Backtests")
    ap.add_argument("--images", default=os.path.join(HERE, "notion-images.json"))
    ap.add_argument("--url", default=os.environ.get("OVERWATCH_URL", "http://localhost:3000"))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not os.path.exists(args.images):
        raise SystemExit(f"No image map at {args.images}")
    images: dict[str, str] = json.load(open(args.images))

    accounts = request(args.url, "GET", "/api/accounts")
    match = next((a for a in accounts if a["name"].strip().lower() == args.account.strip().lower()), None)
    if not match:
        raise SystemExit(f'No account named "{args.account}".')

    trades = request(args.url, "GET", f"/api/trades?accountId={urllib.parse.quote(match['id'])}") or []
    trades.sort(key=lambda t: t.get("date") or "")

    done = skipped = failed = 0
    for t in trades:
        review = t.get("review") or ""
        page = next((u for u in images if u and u in review), None)
        if not page:
            continue
        full = request(args.url, "GET", f"/api/trades/{t['id']}")
        if full and full.get("screenshots"):
            skipped += 1
            continue
        print(f"  {t['date']}  ← {page.rsplit('/', 1)[-1][:12]}…", end=" ", flush=True)
        if args.dry_run:
            print("(dry run)")
            done += 1
            continue
        try:
            blob, mime = download(images[page])
            upload(args.url, t["id"], blob, mime, f"From Notion · {t['date']}")
            print(f"{len(blob) // 1024} KB")
            done += 1
        except Exception as exc:  # noqa: BLE001 — one bad image should not stop the rest
            print(f"failed ({exc})")
            failed += 1

    print(f"\n  {done} attached, {skipped} already had one, {failed} failed")
    if args.dry_run:
        print("\nDry run — nothing downloaded or uploaded.")


if __name__ == "__main__":
    main()
