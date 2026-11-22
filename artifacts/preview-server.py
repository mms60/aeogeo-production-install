#!/usr/bin/env python3
"""Static preview server for the site/ directory.

    python3 artifacts/preview-server.py             # plain static preview
    python3 artifacts/preview-server.py --upload    # + one-shot hero photo upload

The upload route is optional and lives in ``artifacts/hero_upload.py``. It is
only loaded with ``--upload`` and can be removed by deleting that file or by
starting this server without the flag. Nothing under ``site/`` depends on it.
"""

import argparse
import atexit
import http.server
import os
import socketserver
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SITE_ROOT = os.path.abspath(os.path.join(HERE, "..", "site"))
PID_FILE = os.path.join(HERE, "preview-server.pid")


class PreviewHandler(http.server.SimpleHTTPRequestHandler):
    upload = None  # set by main() when --upload is passed

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=SITE_ROOT, **kwargs)

    def translate_path(self, path):
        resolved = super().translate_path(path)
        if os.path.isdir(resolved):
            index = os.path.join(resolved, "index.html")
            return index if os.path.isfile(index) else resolved
        if not os.path.exists(resolved):
            for candidate in (resolved + ".html", os.path.join(resolved, "index.html")):
                if os.path.isfile(candidate):
                    return candidate
            fallback = os.path.join(SITE_ROOT, "404.html")
            if os.path.isfile(fallback):
                return fallback
        return resolved

    def do_GET(self):
        if self.upload is not None and self.upload.handle_get(self):
            return
        super().do_GET()

    def do_POST(self):
        if self.upload is not None and self.upload.handle_post(self):
            return
        self.send_error(405, "Method Not Allowed")

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


class ThreadingServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=3000)
    parser.add_argument(
        "--upload",
        action="store_true",
        help="enable the one-shot hero photo upload at /hero-upload",
    )
    args = parser.parse_args()

    if args.upload:
        sys.path.insert(0, HERE)
        try:
            from hero_upload import HeroUpload
        except ImportError:
            print("hero_upload.py not found; starting without the upload endpoint.", flush=True)
        else:
            PreviewHandler.upload = HeroUpload(SITE_ROOT)

    with open(PID_FILE, "w", encoding="utf-8") as fh:
        fh.write(str(os.getpid()) + "\n")
    atexit.register(lambda: os.path.exists(PID_FILE) and os.remove(PID_FILE))

    state = "enabled (one-shot, token-protected)" if PreviewHandler.upload else "disabled"
    with ThreadingServer(("0.0.0.0", args.port), PreviewHandler) as httpd:
        print(f"serving {SITE_ROOT} on 0.0.0.0:{args.port}; upload {state}", flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
