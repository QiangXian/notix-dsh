#!/usr/bin/env python3
"""List or extract files from the DeepSeek Harness app.asar archive.

Usage:
  python3 asar-extract.py list [substring]        # list matching paths
  python3 asar-extract.py extract <prefix> <outdir>  # extract files under prefix
  python3 asar-extract.py read <path>             # print one file's content

Prefixes begin with '/dsh/...' (paths inside the asar header).
"""
import sys, json, os, struct

ASAR = "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar"
JSON_OFF = 16
JSON_LEN = 0x48F162
BASE_OFFSET = JSON_OFF + JSON_LEN

def load_index():
    with open(ASAR, 'rb') as f:
        f.seek(JSON_OFF)
        h = json.loads(f.read(JSON_LEN).decode('utf-8'))
    files = {}
    def walk(node, prefix=""):
        for k, v in node.get("files", {}).items():
            path = prefix + "/" + k
            if "files" in v:
                walk(v, path)
            else:
                files[path] = v
    walk(h)
    return files

FILES = None

def data_offset(entry):
    return BASE_OFFSET + int(entry["offset"])

def read_entry(entry):
    with open(ASAR, 'rb') as f:
        f.seek(data_offset(entry))
        return f.read(int(entry["size"]))

def main():
    global FILES
    if len(sys.argv) < 2:
        print(__doc__); return
    cmd = sys.argv[1]
    FILES = load_index()
    if cmd == "list":
        pat = sys.argv[2] if len(sys.argv) > 2 else ""
        hits = [p for p in FILES if pat in p]
        print(f"{len(hits)} match(es)")
        for p in sorted(hits)[:500]:
            print(p)
    elif cmd == "extract":
        prefix, outdir = sys.argv[2], sys.argv[3]
        n = 0
        for p, e in FILES.items():
            if p.startswith(prefix):
                dest = os.path.join(outdir, p.lstrip('/'))
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with open(dest, 'wb') as f:
                    f.write(read_entry(e))
                n += 1
        print(f"extracted {n} file(s) to {outdir}")
    elif cmd == "read":
        p = sys.argv[2]
        if p not in FILES:
            print("not found:", p); sys.exit(1)
        sys.stdout.write(read_entry(FILES[p]).decode('utf-8', errors='replace'))
    else:
        print(__doc__)

if __name__ == "__main__":
    main()
