"""One-shot, token-protected upload for the /visibility-tool hero photo.

This is local developer tooling, not part of the website. It is imported by
``artifacts/preview-server.py`` only when that server is started with
``--upload``.

To remove it once the photo is in place:
  * restart the preview server without ``--upload``, or
  * delete this file and restart the preview server.

Nothing under ``site/`` references this module or the route.
"""

import io
import json
import os
import secrets

from PIL import Image

ROUTE = "/hero-upload"
MAX_BYTES = 25 * 1024 * 1024


class HeroUpload:
    """Serves the upload page and accepts exactly one successful write."""

    def __init__(self, site_root, marker_path=None):
        self.images_dir = os.path.join(site_root, "images")
        self.jpg_path = os.path.join(self.images_dir, "visibility-hero-wave.jpg")
        self.webp_path = os.path.join(self.images_dir, "visibility-hero-wave.webp")
        self.marker_path = marker_path or os.path.join(
            os.path.dirname(os.path.abspath(__file__)), ".hero-upload-used"
        )
        # Per-process CSRF token, embedded only in the page served from disk.
        self.token = secrets.token_urlsafe(32)

    # ---------- routing ----------

    @staticmethod
    def _route(handler):
        return handler.path.split("?")[0].rstrip("/") or "/"

    def handle_get(self, handler):
        if self._route(handler) != ROUTE:
            return False
        if self.already_used():
            self._send_html(handler, _locked_page(), 410)
        else:
            self._send_html(handler, _page(self.token), 200)
        return True

    def handle_post(self, handler):
        if self._route(handler) != ROUTE:
            return False
        if self.already_used():
            self._send_json(handler, 410, {"ok": False, "error": "This one-shot upload is already closed."})
            return True
        if (handler.headers.get("Sec-Fetch-Site") or "").lower() == "cross-site":
            self._send_json(handler, 403, {"ok": False, "error": "Cross-site uploads are not allowed."})
            return True
        supplied = handler.headers.get("X-Hero-Upload-Token") or ""
        if not secrets.compare_digest(supplied, self.token):
            self._send_json(handler, 403, {"ok": False, "error": "Missing or invalid upload token."})
            return True

        try:
            length = int(handler.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            self._send_json(handler, 400, {"ok": False, "error": "Empty upload."})
            return True
        if length > MAX_BYTES:
            self._send_json(handler, 413, {"ok": False, "error": "File is larger than 25 MB."})
            return True

        data = handler.rfile.read(length)
        if self.already_used():
            self._send_json(handler, 410, {"ok": False, "error": "This one-shot upload is already closed."})
            return True
        try:
            image = Image.open(io.BytesIO(data))
            image.load()
        except Exception:
            self._send_json(handler, 415, {"ok": False, "error": "That file is not a readable JPG, PNG or WebP image."})
            return True

        source_format = image.format
        source_size = image.size
        rgb = image.convert("RGB")
        resized = False
        if rgb.size[0] > 3000:
            height = round(rgb.size[1] * 3000 / rgb.size[0])
            rgb = rgb.resize((3000, height), Image.LANCZOS)
            resized = True

        os.makedirs(self.images_dir, exist_ok=True)
        if source_format == "JPEG" and not resized:
            with open(self.jpg_path, "wb") as fh:  # keep the original bytes
                fh.write(data)
        else:
            rgb.save(self.jpg_path, quality=92, optimize=True, progressive=True)
        rgb.save(self.webp_path, quality=88, method=6)

        try:
            with open(self.marker_path, "x", encoding="utf-8") as fh:
                fh.write("used\n")
        except FileExistsError:
            pass

        self._send_json(
            handler,
            200,
            {
                "ok": True,
                "width": rgb.size[0],
                "height": rgb.size[1],
                "source": list(source_size),
                "bytes": os.path.getsize(self.jpg_path),
            },
        )
        return True

    def already_used(self):
        return os.path.exists(self.marker_path)

    # ---------- responses ----------

    @staticmethod
    def _send_html(handler, body, status):
        payload = body.encode("utf-8")
        handler.send_response(status)
        handler.send_header("Content-Type", "text/html; charset=utf-8")
        handler.send_header("Content-Length", str(len(payload)))
        handler.send_header("Cache-Control", "no-store")
        handler.send_header("X-Content-Type-Options", "nosniff")
        handler.send_header("Referrer-Policy", "no-referrer")
        handler.end_headers()
        handler.wfile.write(payload)

    @staticmethod
    def _send_json(handler, status, payload):
        body = json.dumps(payload).encode("utf-8")
        handler.send_response(status)
        handler.send_header("Content-Type", "application/json")
        handler.send_header("Content-Length", str(len(body)))
        handler.send_header("Cache-Control", "no-store")
        handler.send_header("X-Content-Type-Options", "nosniff")
        handler.end_headers()
        handler.wfile.write(body)


SHELL = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Set the hero photo</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
       background:#050b1f;color:#e8f1ff;font:16px/1.55 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  .card{width:100%;max-width:720px;border:1px solid rgba(84,140,255,.28);border-radius:20px;
        background:rgba(12,24,48,.85);padding:28px;box-shadow:0 30px 80px rgba(0,0,0,.45)}
  h1{font-size:22px;margin:0 0 6px}
  p{margin:0 0 14px;color:#a9bcd8}
  .drop{margin-top:18px;border:2px dashed rgba(84,140,255,.45);border-radius:16px;padding:38px 20px;text-align:center;
        cursor:pointer;transition:border-color .2s,background .2s}
  .drop.hot{border-color:#5ea2ff;background:rgba(84,140,255,.10)}
  .drop strong{display:block;font-size:17px;color:#fff;margin-bottom:4px}
  .drop span{color:#9fb4d4;font-size:14px}
  .row{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
  button{border:0;border-radius:999px;padding:11px 20px;font:600 14px/1 inherit;cursor:pointer;
         background:#3b6ef6;color:#fff}
  button.secondary{background:rgba(84,140,255,.16);color:#cfe0ff}
  .hint{margin-top:16px;font-size:13px;color:#8ea6c8}
  #out{margin-top:18px;font-size:14px;min-height:22px;color:#bcd0ec}
  #out.err{color:#ff9c9c} #out.ok{color:#8ef0c0}
  #preview{display:none;margin-top:18px;border-radius:14px;overflow:hidden;border:1px solid rgba(84,140,255,.3)}
  #preview img{display:block;width:100%;height:auto}
  code{background:rgba(255,255,255,.07);padding:2px 6px;border-radius:6px;font-size:13px}
</style></head>
<body><div class="card">%%INNER%%</div></body></html>"""

PAGE = """
  <h1>Set the /visibility-tool hero photo</h1>
  <p>This is a <strong>one-shot</strong> upload. The first successful file is written to
     <code>site/images/visibility-hero-wave.jpg</code> (plus a WebP copy) and the endpoint then closes itself.</p>
  <div class="drop" id="drop" tabindex="0" role="button" aria-label="Choose or drop the hero photo">
    <strong>Drop your photo here</strong>
    <span>or click to choose a file &middot; or press Ctrl+V / Cmd+V to paste</span>
  </div>
  <div class="row">
    <button id="pick">Choose photo</button>
    <button class="secondary" id="reload">Reload preview page</button>
  </div>
  <p class="hint">JPG, PNG or WebP up to 25 MB. Anything wider than 3000 px is scaled down; nothing is cropped.</p>
  <div id="out"></div>
  <div id="preview"><img id="shot" alt="Uploaded hero photo"></div>
  <input id="file" type="file" accept="image/jpeg,image/png,image/webp" hidden>
<script>
  const TOKEN = __TOKEN__;
  const drop = document.getElementById('drop'), file = document.getElementById('file'),
        out = document.getElementById('out'), shot = document.getElementById('shot'),
        preview = document.getElementById('preview');
  async function upload(f) {
    if (!f) { return; }
    out.className = ''; out.textContent = 'Uploading ' + f.name + ' ...';
    try {
      const r = await fetch(location.pathname, {
        method: 'POST',
        headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-Hero-Upload-Token': TOKEN },
        body: f
      });
      const j = await r.json();
      if (!r.ok || !j.ok) { throw new Error(j.error || ('HTTP ' + r.status)); }
      out.className = 'ok';
      out.textContent = 'Saved ' + j.width + 'x' + j.height + ' px as site/images/visibility-hero-wave.jpg. This upload is now closed.';
      shot.src = '/images/visibility-hero-wave.jpg?t=' + Date.now();
      preview.style.display = 'block';
    } catch (e) {
      out.className = 'err'; out.textContent = 'Upload failed: ' + e.message;
    }
  }
  drop.addEventListener('click', () => file.click());
  drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
  document.getElementById('pick').addEventListener('click', () => file.click());
  document.getElementById('reload').addEventListener('click', () => { location.href = '/visibility-tool'; });
  file.addEventListener('change', () => upload(file.files[0]));
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('hot'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('hot'); }));
  drop.addEventListener('drop', e => { upload(e.dataTransfer.files && e.dataTransfer.files[0]); });
  window.addEventListener('paste', e => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items) { if (it.type && it.type.startsWith('image/')) { upload(it.getAsFile()); return; } }
  });
</script>"""

LOCKED_PAGE = """
  <h1>Hero photo already uploaded</h1>
  <p>This one-shot upload endpoint is closed. The hero image at
     <code>site/images/visibility-hero-wave.jpg</code> is in place and the preview page uses it.</p>
  <p class="hint">To replace it deliberately, delete <code>artifacts/.hero-upload-used</code> and restart the
     preview server with <code>--upload</code>. To remove the endpoint for good, start the server without
     <code>--upload</code> or delete <code>artifacts/hero_upload.py</code>.</p>"""


def _page(token):
    return SHELL.replace("%%INNER%%", PAGE.replace("__TOKEN__", json.dumps(token)))


def _locked_page():
    return SHELL.replace("%%INNER%%", LOCKED_PAGE)
