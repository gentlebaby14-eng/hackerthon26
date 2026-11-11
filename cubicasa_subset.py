"""Download a small, reproducible CubiCasa5K subset without saving the 5.5 GB ZIP.

The script reads the official ZIP central directory with HTTP Range requests,
selects complete F1_scaled.png/model.svg pairs from the official split lists,
and downloads only those ZIP members. CubiCasa5K is CC BY-NC 4.0.
"""

import argparse
import http.client
import io
import random
import re
import ssl
import struct
import sys
import time
import urllib.error
import urllib.request
import zipfile
import zlib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path, PurePosixPath

URL = "https://zenodo.org/records/2613548/files/cubicasa5k.zip?download=1"
SPLITS = ("train", "val", "test")
PAIR = ("F1_scaled.png", "model.svg")
USER_AGENT = "Lumai-CubiCasa5K-Subset/1.0"

try:
    import certifi
    SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CONTEXT = ssl.create_default_context()


def fetch_range(range_spec, attempts=4):
    """Return (payload, absolute_start, total_length) for one byte range."""
    error = None
    for attempt in range(attempts):
        request = urllib.request.Request(
            URL, headers={"Range": f"bytes={range_spec}", "User-Agent": USER_AGENT}
        )
        try:
            with urllib.request.urlopen(request, timeout=90, context=SSL_CONTEXT) as response:
                if response.status != 206:
                    raise RuntimeError(
                        f"Server ignored HTTP Range (status {response.status}); refusing full ZIP download."
                    )
                match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", response.headers.get("Content-Range", ""))
                if not match:
                    raise RuntimeError("Missing or invalid Content-Range header.")
                start, end, total = map(int, match.groups())
                payload = response.read()
                if len(payload) != end - start + 1:
                    raise RuntimeError("Incomplete HTTP range response.")
                return payload, start, total
        except (urllib.error.URLError, http.client.HTTPException, TimeoutError, OSError, RuntimeError) as exc:
            error = exc
            if attempt + 1 < attempts:
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Could not read official ZIP range: {error}")


class ZipIndex(io.RawIOBase):
    """Seekable remote file used by zipfile; only requested ranges are fetched."""

    def __init__(self):
        self.tail, self.tail_start, self.length = fetch_range("-131072")
        self.position = 0

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=0):
        origin = (0, self.position, self.length)[whence]
        self.position = origin + offset
        if self.position < 0:
            raise OSError("Invalid ZIP position.")
        return self.position

    def read(self, length=-1):
        start = self.position
        stop = self.length if length < 0 else min(self.length, start + length)
        if stop <= start:
            return b""
        if start >= self.tail_start:
            data = self.tail[start - self.tail_start:stop - self.tail_start]
        else:
            data, _, _ = fetch_range(f"{start}-{stop - 1}")
        self.position = stop
        return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path("ai/data/cubicasa5k-mini"))
    parser.add_argument("--train", type=int, default=40)
    parser.add_argument("--val", type=int, default=10)
    parser.add_argument("--test", type=int, default=10)
    parser.add_argument("--workers", type=int, default=4)
    options = parser.parse_args()
    if min(options.train, options.val, options.test) < 1 or not 1 <= options.workers <= 8:
        parser.error("Each split must have at least one example; workers must be 1–8.")
    if options.out.exists() and not options.out.is_dir():
        parser.error("Output path must be a directory.")
    print("Reading the official ZIP index only…", flush=True)
    with zipfile.ZipFile(ZipIndex()) as archive:
        ordered = sorted(archive.infolist(), key=lambda item: item.header_offset)
        entries = {
            info.filename: (info, ordered[i + 1].header_offset if i + 1 < len(ordered) else archive.start_dir)
            for i, info in enumerate(ordered)
            if not info.is_dir()
        }
    roots = [name[:-len("train.txt")] for name in entries if name.endswith("/train.txt") or name == "train.txt"]
    roots = [root for root in roots if all(root + split + ".txt" in entries for split in SPLITS)]
    if len(roots) != 1:
        raise RuntimeError("Could not uniquely locate the official train/val/test lists.")
    root = roots[0]

    def member(name):
        info, boundary = entries[name]
        if info.flag_bits & 1 or info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            raise RuntimeError(f"Unsupported ZIP entry: {name}")
        end = min(boundary, info.header_offset + 30 + 2 * 65535 + info.compress_size) - 1
        block, _, _ = fetch_range(f"{info.header_offset}-{end}")
        if block[:4] != b"PK\x03\x04":
            raise RuntimeError(f"Invalid ZIP entry header: {name}")
        filename_length, extra_length = struct.unpack_from("<HH", block, 26)
        offset = 30 + filename_length + extra_length
        packed = block[offset:offset + info.compress_size]
        data = zlib.decompress(packed, -zlib.MAX_WBITS) if info.compress_type == zipfile.ZIP_DEFLATED else packed
        if len(data) != info.file_size or zlib.crc32(data) != info.CRC:
            raise RuntimeError(f"ZIP checksum mismatch: {name}")
        return data

    rng = random.Random(42)
    selected = {}
    used = set()
    for split in SPLITS:
        lines = member(root + split + ".txt").decode("utf-8-sig").splitlines()
        folders = {}
        for line in lines:
            relative = line.strip().replace("\\", "/").strip("/")
            parts = PurePosixPath(relative).parts
            if not parts or ".." in parts:
                continue
            if all(root + relative + "/" + file in entries for file in PAIR):
                folders.setdefault(relative, line.strip())
        eligible = [path for path in folders if path not in used]
        count = getattr(options, split)
        if len(eligible) < count:
            raise RuntimeError(f"Only {len(eligible)} complete pairs found for {split}; requested {count}.")
        chosen = sorted(rng.sample(eligible, count))
        selected[split] = [(path, folders[path]) for path in chosen]
        used.update(chosen)

    def save_pair(path):
        folder = options.out.joinpath(*PurePosixPath(path).parts)
        existing = [folder / file for file in PAIR]
        if all(file.is_file() and file.stat().st_size > 0 for file in existing):
            return sum(file.stat().st_size for file in existing)
        payloads = [(file, member(root + path + "/" + file)) for file in PAIR]
        folder.mkdir(parents=True, exist_ok=True)
        for file, data in payloads:
            (folder / file).write_bytes(data)
        return sum(len(data) for _, data in payloads)

    count = sum(map(len, selected.values()))
    total = 0
    with ThreadPoolExecutor(max_workers=options.workers) as workers:
        pairs = workers.map(save_pair, [path for split in SPLITS for path, _ in selected[split]])
        for i, size in enumerate(pairs, 1):
            total += size
            if i == 1 or i % 5 == 0 or i == count:
                print(f"{i}/{count} pairs saved", flush=True)
    for split, pairs in selected.items():
        (options.out / f"{split}.txt").write_text("\n".join(line for _, line in pairs) + "\n", encoding="utf-8")
    print(f"Saved {count} pairs ({total / 1024**2:.1f} MiB) in {options.out}")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, zipfile.BadZipFile) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
