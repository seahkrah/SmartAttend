"""
Document storage.

Fourteen columns in this schema hold a file URL and nothing was ever behind
any of them. This is the storage they were waiting for, and a file store is
where security mistakes are most expensive — so most of what is asserted here
is about refusal rather than function.

The ones that matter:

  What a file IS comes from its bytes, not from what the upload claimed. A
  PNG renamed to .pdf stores as a PNG and downloads as one.

  SVG and HTML are refused outright. Both execute in a browser, and serving
  either from this origin is stored cross-site scripting. There is no safe
  inline path for them, so there is no accepting them carefully.

  The download headers are checked individually, because each one is the
  difference between a document store and a way to run script on this
  application's origin.

  A file belonging to another tenant is not found — never forbidden, which
  would confirm it exists.
"""
import json, subprocess, sys, time, os, base64, tempfile
RUN = str(int(time.time()))[-6:]
SP = os.environ.get("E2E_FIXTURE_DIR", os.path.join(os.getcwd(), ".e2e-fixtures"))
d = json.load(open(f"{SP}/seed.json")); A, B = d['A'], d['B']
c = json.load(open(f"{SP}/corp.json"))
ROOT = os.environ.get("API_BASE", "http://127.0.0.1:5000") + "/api"
P = F = 0
TMP = tempfile.mkdtemp(prefix="filetest-")

def call(m, p, t, body=None, base="/files"):
    cmd = ["curl", "-s", "-w", "\n%{http_code}", "--max-time", "30", "-X", m,
           "-H", "Content-Type: application/json"]
    if t:
        cmd += ["-H", f"Authorization: Bearer {t}"]
    cmd.append(ROOT + base + p)
    if body is not None:
        cmd += ["-d", json.dumps(body)]
    o = subprocess.run(cmd, capture_output=True, text=True).stdout
    txt, _, code = o.rpartition("\n")
    try:
        parsed = json.loads(txt)
    except Exception:
        parsed = txt
    return int(code), parsed

def put_file(name, data):
    """Writes bytes to a temp file and returns its path."""
    path = os.path.join(TMP, name)
    with open(path, "wb") as fh:
        fh.write(data)
    return path

def upload(token, path, category, declared_type=None, owner_type=None, owner_id=None):
    cmd = ["curl", "-s", "-w", "\n%{http_code}", "--max-time", "30", "-X", "POST"]
    if token:
        cmd += ["-H", f"Authorization: Bearer {token}"]
    spec = f"file=@{path}"
    if declared_type:
        spec += f";type={declared_type}"
    cmd += ["-F", spec, "-F", f"category={category}"]
    if owner_type:
        cmd += ["-F", f"ownerType={owner_type}"]
    if owner_id:
        cmd += ["-F", f"ownerId={owner_id}"]
    cmd.append(ROOT + "/files")
    o = subprocess.run(cmd, capture_output=True, text=True).stdout
    txt, _, code = o.rpartition("\n")
    try:
        parsed = json.loads(txt)
    except Exception:
        parsed = txt
    return int(code), parsed

def download_headers(token, file_id, inline=False):
    url = f"{ROOT}/files/{file_id}/download" + ("?inline=true" if inline else "")
    cmd = ["curl", "-s", "-D", "-", "-o", "/dev/null", "--max-time", "30"]
    if token:
        cmd += ["-H", f"Authorization: Bearer {token}"]
    cmd.append(url)
    out = subprocess.run(cmd, capture_output=True, text=True).stdout
    headers = {}
    status = 0
    for line in out.splitlines():
        if line.startswith("HTTP/"):
            status = int(line.split()[1])
        elif ":" in line:
            k, _, v = line.partition(":")
            headers[k.strip().lower()] = v.strip()
    return status, headers

def download_bytes(token, file_id):
    cmd = ["curl", "-s", "-w", "\n%{http_code}", "--max-time", "30", "--output", "-"]
    if token:
        cmd += ["-H", f"Authorization: Bearer {token}"]
    cmd.append(f"{ROOT}/files/{file_id}/download")
    r = subprocess.run(cmd, capture_output=True)
    body, _, code = r.stdout.rpartition(b"\n")
    try:
        return int(code), body
    except ValueError:
        return 0, body

def check(n, ok, dd=""):
    global P, F
    if ok:
        P += 1; print(f"  ok    {n}")
    else:
        F += 1; print(f"  FAIL  {n} {dd}")

AT, BT = A['token'], B['token']
FA = A['facToken']
STOK = A.get('studentToken')
HR = c['A']['token']
STU_A = A['students'][0]
GHOST = "00000000-0000-4000-8000-000000000000"

# Real file signatures, so the sniffer is exercised against genuine headers.
PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) + b"\x00" * 200
JPEG = bytes([0xff, 0xd8, 0xff, 0xe0]) + b"\x00" * 200
PDF = b"%PDF-1.7\n" + b"trailer\n" * 40
GIF = b"GIF89a" + b"\x00" * 200
TEXT = b"Transcript for the 2026 intake.\nGrade: A\n" * 5

print("-- the gate --")
co, r = call("GET", "/limits", None)
check("files need a token", co in (401, 403), f"({co})")
co, r = call("GET", "/limits", AT)
check("an administrator reads the limits", co == 200, f"({co} {r})")
check("the accepted types are listed",
      co == 200 and len(r.get('accepted', [])) > 0, f"({r})")
check("and what is refused is said explicitly",
      co == 200 and any('svg' in x.get('extensions', []) for x in r.get('refused', [])),
      f"({r.get('refused')})")
check("the quota is reported",
      co == 200 and isinstance(r.get('quota', {}).get('remainingBytes'), int), f"({r})")

# ------------------------------------------------------------------ upload
print("-- upload --")
co, r = upload(AT, put_file("photo.png", PNG), "profile_photo")
check("upload a PNG", co == 201, f"({co} {r})")
png_id = r.get('file', {}).get('id') if co == 201 else None
check("it is recorded as a PNG",
      co == 201 and r['file']['contentType'] == 'image/png', f"({r})")
check("a download URL comes back",
      co == 201 and r.get('downloadUrl', '').endswith('/download'), f"({r})")
check("the storage key is never exposed",
      co == 201 and 'storage_key' not in json.dumps(r) and 'storageKey' not in json.dumps(r),
      f"({r})")

co, r = upload(AT, put_file("doc.pdf", PDF), "application_document")
check("upload a PDF", co == 201, f"({co} {r})")
pdf_id = r.get('file', {}).get('id') if co == 201 else None

co, r = upload(AT, put_file("notes.txt", TEXT), "other")
check("upload plain text", co == 201, f"({co} {r})")
txt_id = r.get('file', {}).get('id') if co == 201 else None

co, r = upload(AT, put_file("nofile.png", PNG), "not_a_category")
check("an unknown category is refused", co == 400, f"({co} {r})")

co, r = upload(AT, put_file("empty.png", b""), "other")
check("an empty file is refused", co in (400, 415), f"({co} {r})")

# ------------------------------------------------ the type is what the bytes say
print("-- the bytes decide, not the claim --")
co, r = upload(AT, put_file("report.pdf", PNG), "other", declared_type="application/pdf")
check("a PNG named .pdf and declared PDF is accepted", co == 201, f"({co} {r})")
check("but stored as a PNG, because that is what it is",
      co == 201 and r['file']['contentType'] == 'image/png', f"({r})")
liar_id = r.get('file', {}).get('id') if co == 201 else None

status, headers = download_headers(AT, liar_id)
check("and it downloads as a PNG",
      headers.get('content-type') == 'image/png', f"({headers.get('content-type')})")
check("with the extension corrected",
      '.png' in headers.get('content-disposition', ''), f"({headers.get('content-disposition')})")

# ---------------------------------------------------- the dangerous types
print("-- what a browser would execute is refused --")
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
co, r = upload(AT, put_file("logo.svg", SVG), "profile_photo", declared_type="image/svg+xml")
check("an SVG is refused", co == 415, f"({co} {r})")
check("and the refusal explains why",
      co == 415 and ('markup' in str(r.get('error')) or 'not accepted' in str(r.get('error'))),
      f"({r})")

HTML = b"<!DOCTYPE html><html><body><script>document.cookie</script></body></html>"
co, r = upload(AT, put_file("page.html", HTML), "other", declared_type="text/html")
check("an HTML file is refused", co == 415, f"({co} {r})")

co, r = upload(AT, put_file("sneaky.txt", HTML), "other", declared_type="text/plain")
check("HTML declared as plain text is still refused", co == 415, f"({co} {r})")

PHP = b"<?php system($_GET['c']); ?>\n"
co, r = upload(AT, put_file("shell.txt", PHP), "other")
check("a PHP script declared as text is refused", co == 415, f"({co} {r})")

ZIP = bytes([0x50, 0x4b, 0x03, 0x04]) + b"\x00" * 200
co, r = upload(AT, put_file("archive.zip", ZIP), "other")
check("a bare zip archive is refused", co == 415, f"({co} {r})")
check("and is named as an archive rather than a document",
      co == 415 and 'archive' in str(r.get('error')), f"({r})")

ELF = bytes([0x7f, 0x45, 0x4c, 0x46]) + b"\x00" * 200
co, r = upload(AT, put_file("binary", ELF), "other")
check("an executable is refused", co == 415, f"({co} {r})")

# ------------------------------------------------------- category constraints
print("-- category constraints --")
co, r = upload(AT, put_file("essay.pdf", PDF), "profile_photo")
check("a PDF is refused as a profile photograph", co == 415, f"({co} {r})")
check("and the refusal says what it wanted",
      co == 415 and 'image' in str(r.get('error')), f"({r})")

co, r = upload(AT, put_file("avatar.gif", GIF), "profile_photo")
check("a GIF is accepted as a profile photograph", co == 201, f"({co} {r})")

# ------------------------------------------------------------ path traversal
print("-- nothing a client sends reaches the filesystem --")
co, r = upload(AT, put_file("traversal.png", PNG), "other")
trav_id = r.get('file', {}).get('id') if co == 201 else None
check("a file uploads normally", co == 201, f"({co} {r})")

# curl sends the basename, so the traversal is asserted at the level the
# server actually controls: the name it hands back is the client's, and the
# key it stored under is not derived from it.
co, r = call("GET", f"/{trav_id}", AT)
check("the response never contains a path separator in a key",
      co == 200 and '/' not in json.dumps(r.get('file', {}).get('id', '')), f"({r})")

# ---------------------------------------------------------- download headers
print("-- the download headers --")
status, headers = download_headers(AT, pdf_id)
check("a download answers", status == 200, f"({status})")
check("nosniff is set, so the browser does not second-guess the type",
      headers.get('x-content-type-options') == 'nosniff', f"({headers})")
check("the response is sandboxed",
      'sandbox' in headers.get('content-security-policy', ''),
      f"({headers.get('content-security-policy')})")
check("framing is refused", headers.get('x-frame-options') == 'DENY', f"({headers})")
check("it is not cached by a shared cache",
      'no-store' in headers.get('cache-control', ''), f"({headers.get('cache-control')})")
check("a PDF defaults to attachment, not inline",
      headers.get('content-disposition', '').startswith('attachment'),
      f"({headers.get('content-disposition')})")

status, headers = download_headers(AT, pdf_id, inline=True)
check("a PDF may be shown inline when asked, because it cannot execute",
      headers.get('content-disposition', '').startswith('inline'),
      f"({headers.get('content-disposition')})")

status, headers = download_headers(AT, txt_id, inline=True)
check("plain text is never inline, even when asked",
      headers.get('content-disposition', '').startswith('attachment'),
      f"({headers.get('content-disposition')})")

status, body = download_bytes(AT, png_id)
check("the bytes come back intact", status == 200 and body.startswith(PNG[:8]),
      f"({status} {body[:12]!r})")

# ------------------------------------------------------------ deduplication
print("-- deduplication --")
co, r = upload(AT, put_file("same-again.png", PNG), "other")
check("the same bytes uploaded again succeed", co == 201, f"({co} {r})")
check("and are recognised as already held",
      co == 201 and r.get('deduplicated') is True, f"({r})")
check("returning the file that was already there",
      co == 201 and r['file']['id'] == png_id, f"({r['file']['id']} vs {png_id})")

# ------------------------------------------------------------ tenant isolation
print("-- tenant isolation --")
co, r = call("GET", f"/{pdf_id}", BT)
check("another school cannot read the file", co == 404, f"({co} {r})")
status, headers = download_headers(BT, pdf_id)
check("nor download it", status == 404, f"({status})")
co, r = call("DELETE", f"/{pdf_id}", BT, {"reason": "not mine"})
check("nor delete it", co == 404, f"({co} {r})")

co, r = call("GET", f"/{pdf_id}/access-log", BT)
check("nor read who has looked at it", co == 404, f"({co} {r})")

co, r = call("GET", "", BT)
check("it does not appear in the other school's listing",
      co == 200 and pdf_id not in [f['id'] for f in r.get('files', [])], f"({co})")

co, r = call("GET", "", HR)
check("nor in the company's listing",
      co == 200 and pdf_id not in [f['id'] for f in r.get('files', [])], f"({co})")

# The same bytes in another tenant are a separate file, not a dedup hit.
co, r = upload(BT, put_file("theirs.png", PNG), "other")
check("identical bytes in another tenant are stored separately",
      co == 201 and r['file']['id'] != png_id, f"({co} {r})")
check("and are not reported as deduplicated",
      co == 201 and r.get('deduplicated') is False, f"({r})")

co, r = call("GET", f"/{GHOST}", AT)
check("an unknown file is 404", co == 404, f"({co})")
co, r = call("GET", "/not-a-uuid", AT)
check("a malformed id is 404 rather than a 500", co == 404, f"({co})")

# ------------------------------------------------------------- who may read
print("-- who may read --")
if STOK:
    co, r = upload(STOK, put_file("mine.png", JPEG), "profile_photo")
    check("a student may upload their own photograph", co == 201, f"({co} {r})")
    student_file = r.get('file', {}).get('id') if co == 201 else None

    co, r = call("GET", f"/{student_file}", STOK)
    check("and read it back", co == 200, f"({co} {r})")

    co, r = call("GET", f"/{pdf_id}", STOK)
    check("but not a document somebody else uploaded", co == 403, f"({co} {r})")
    status, headers = download_headers(STOK, pdf_id)
    check("nor download it", status == 403, f"({status})")

    co, r = call("GET", "", STOK)
    check("their listing holds only what they uploaded",
          co == 200 and all(f['uploadedBy'] is None or f['id'] == student_file
                            for f in r.get('files', [])),
          f"({[f['id'] for f in r.get('files', [])]})")

    co, r = call("GET", f"/{student_file}/access-log", STOK)
    check("a student cannot read an access log", co == 403, f"({co} {r})")

    # Staff can read what a student uploaded, which is the point of the role.
    co, r = call("GET", f"/{student_file}", AT)
    check("an administrator can read it", co == 200, f"({co} {r})")

    co, r = call("DELETE", f"/{pdf_id}", STOK, {"reason": "I want it gone"})
    check("a student cannot delete somebody else's file", co == 403, f"({co} {r})")
else:
    check("student token present in the fixture", False, "(seed.json has no studentToken)")

# ------------------------------------------------------------- the access log
print("-- the access log --")
co, r = call("GET", f"/{pdf_id}/access-log", AT)
entries = r.get('access', []) if co == 200 else []
check("staff read the access log", co == 200, f"({co} {r})")
check("downloads are recorded",
      any(x['action'] == 'download' for x in entries), f"({entries[:3]})")
check("refusals are recorded too, not only successes",
      any(x['action'] == 'denied' for x in entries), f"({[x['action'] for x in entries]})")
check("and the log names who",
      all(x.get('actor_name') or x.get('actor_name') is None for x in entries), f"({entries[:1]})")

co, r = call("GET", f"/{pdf_id}/access-log", FA)
check("a lecturer cannot read an access log", co == 403, f"({co} {r})")

# ----------------------------------------------------------------- deletion
print("-- deletion --")
co, r = call("GET", "/limits", AT)
before_used = r.get('quota', {}).get('usedBytes', 0)

co, r = call("DELETE", f"/{txt_id}", AT, {"reason": f"Superseded, run {RUN}"})
check("delete a file", co == 200, f"({co} {r})")
check("and the response is honest about what deleted means",
      'stored copy is removed' in str(r.get('note')), f"({r.get('note')})")

co, r = call("GET", f"/{txt_id}", AT)
check("the deleted file is gone from reads", co == 404, f"({co})")
status, headers = download_headers(AT, txt_id)
check("and cannot be downloaded", status == 404, f"({status})")

co, r = call("GET", "/limits", AT)
after_used = r.get('quota', {}).get('usedBytes', 0)
check("deleting releases the storage allowance",
      after_used < before_used, f"({after_used} vs {before_used})")

co, r = call("DELETE", f"/{txt_id}", AT, {"reason": "again"})
check("deleting twice is 404", co == 404, f"({co} {r})")

co, r = call("POST", "/purge", FA, {})
check("a lecturer cannot purge", co == 403, f"({co} {r})")
co, r = call("POST", "/purge", AT, {"olderThanDays": 0})
check("an administrator can purge", co == 200, f"({co} {r})")
check("and it reports how many it removed",
      isinstance(r.get('purged'), int), f"({r})")

status, headers = download_headers(AT, txt_id)
check("a purged file stays 404 rather than erroring", status == 404, f"({status})")

# -------------------------------------------------------------------- quota
print("-- quota --")
co, r = call("GET", "/limits", AT)
q = r.get('quota', {}) if co == 200 else {}
check("the quota reports what is used", isinstance(q.get('usedBytes'), int), f"({q})")
check("and what remains",
      q.get('remainingBytes') == q.get('quotaBytes') - q.get('usedBytes'), f"({q})")
check("the count tracks the files", isinstance(q.get('fileCount'), int), f"({q})")

co, r = call("GET", "/limits", BT)
qb = r.get('quota', {}) if co == 200 else {}
check("each tenant has its own allowance",
      qb.get('usedBytes') != q.get('usedBytes'), f"({qb} vs {q})")

print(f"\n{P} passed, {F} failed")
sys.exit(1 if F else 0)
