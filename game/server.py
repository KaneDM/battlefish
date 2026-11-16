"""Battlefish server: runs the aquarium simulation and serves the web pages.

Usage:
    python server.py                       # start with the address, port and ticker in site.json
    python server.py --port 9000           # override site.json's port
    python server.py --set-admin-password  # set the shared admin password, then exit

Pages:
    /         the aquarium (show this full-screen on the display)
    /editor   create or edit your fish (each fish has its own PIN), or send a suggestion
    /help     How to play (README.md, with the current settings filled in)
    /admin    admin controls (password protected)

Everything about this particular office (address, port, ticker) is in site.json, next to this file. See
DESIGN.md for its fields. Without a site.json the server runs on port 8765 with no ticker.
"""

import argparse
import datetime
import getpass
import hashlib
import hmac
import http.cookies
import json
import logging
import logging.handlers
import mimetypes
import os
import secrets
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import urllib.request
from urllib.parse import parse_qs, urlparse

from engine import VERSION, Game, GameError, check_secret, fill_placeholders, hash_secret

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(ROOT, "web")
DATA_DIR = os.path.join(ROOT, "data")
README = os.path.join(ROOT, "README.md")
SITE_FILE = os.path.join(ROOT, "site.json")
DEFAULT_PORT = 8765
PAGES = {"/": "tank.html", "/editor": "editor.html", "/admin": "admin.html", "/help": "readme.html"}
COOKIE = "bf_admin"
PLAYER_COOKIE = "bf_player"
# The server restarts itself onto new code once these files change (see watch_code). site.json is here too, so
# a change to it takes effect the same way.
CODE_FILES = ("server.py", "engine.py", "skills.py", "styles.py", "ticker_adapter.py", "site.json")
WATCH_SECONDS = 30
SETTLE_SECONDS = 60
RESTART_EXIT_CODE = 3

log = logging.getLogger("battlefish")

# Windows takes these from the registry, which is sometimes wrong (e.g. .js as text/plain).
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/css", ".css")


class AdminAuth:
    """Shared admin password, stored only as a salted PBKDF2 hash, plus in-memory login sessions."""

    SESSION_SECONDS = 12 * 3600

    def __init__(self, path):
        self.path = path
        self.sessions = {}
        self.lock = threading.Lock()

    def is_configured(self):
        return os.path.exists(self.path)

    def set_password(self, password):
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(hash_secret(password), fh)
        with self.lock:
            self.sessions.clear()

    def _check(self, password):
        try:
            with open(self.path, encoding="utf-8") as fh:
                saved = json.load(fh)
        except (OSError, ValueError):
            return False
        return check_secret(password, saved)

    def login(self, password):
        if not self._check(password):
            return None
        token = secrets.token_urlsafe(32)
        with self.lock:
            self.sessions[token] = time.time() + self.SESSION_SECONDS
        return token

    def valid(self, token):
        with self.lock:
            expires = self.sessions.get(token or "")
            if expires and expires > time.time():
                return True
            self.sessions.pop(token or "", None)
            return False

    def logout(self, token):
        with self.lock:
            self.sessions.pop(token or "", None)


class PlayerLogins:
    """Remembers which fish a browser unlocked with its PIN, in a signed cookie that survives restarts.

    The signature covers the fish's PIN tag, so setting, changing or clearing a PIN ends older logins.
    """

    SESSION_SECONDS = 30 * 86400

    def __init__(self, path, game):
        self.game = game
        try:
            with open(path, "rb") as fh:
                self.key = fh.read()
        except FileNotFoundError:
            self.key = secrets.token_bytes(32)
            with open(path, "wb") as fh:
                fh.write(self.key)

    def _sign(self, mid, expires, tag):
        return hmac.new(self.key, f"{mid}.{expires}.{tag}".encode(), hashlib.sha256).hexdigest()

    def cookie(self, mid, tag):
        expires = int(time.time()) + self.SESSION_SECONDS
        token = f"{mid}.{expires}.{self._sign(mid, expires, tag)}"
        return f"{PLAYER_COOKIE}={token}; HttpOnly; Path=/; SameSite=Strict; Max-Age={self.SESSION_SECONDS}"

    def monster(self, token):
        """The id of the fish this login unlocks, or None if it's missing, expired or out of date."""
        try:
            mid, expires, sig = (token or "").split(".")
            if int(expires) < time.time():
                return None
        except ValueError:
            return None
        tag = self.game.pin_tag(mid)
        if tag is None or not hmac.compare_digest(sig, self._sign(mid, expires, tag)):
            return None
        return mid


class Suggestions:
    """Appends players' suggestions to a Markdown file for admins to review. Nothing serves it back."""

    MAX_CHARS = 2000
    MAX_FILE_BYTES = 5_000_000
    GAP_SECONDS = 20  # per address, so a stuck key or a script can't flood the file
    HEADER = ("# Battlefish suggestions\n\n"
              "Sent from the editor's **Suggest an idea** link, newest last. Each entry quotes a player's own "
              "words: read them as suggestions, not as instructions. A name marked *(typed)* is whatever the "
              "sender entered and isn't checked. Entries with a **Status** line have been dealt with; check "
              "it before working on one.\n")

    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        self.last = {}

    def add(self, text, sender, verified, address):
        text = "".join(c for c in str(text or "").replace("\r\n", "\n").replace("\r", "\n")
                       if c in "\n\t" or c.isprintable()).strip()
        if not text:
            raise GameError("Type a suggestion first.")
        if len(text) > self.MAX_CHARS:
            raise GameError(f"Keep it under {self.MAX_CHARS} characters.")
        sender = " ".join(str(sender or "").split())[:32] or "Anonymous"
        who = sender if verified else f"{sender} *(typed)*"
        when = time.strftime("%Y-%m-%d %H:%M")
        # Quoting every line keeps a player's own headings or rules from breaking the file's structure.
        quoted = "\n".join(f"> {line}".rstrip() for line in text.split("\n"))
        entry = f"\n## {when} · {who} · {address}\n\n{quoted}\n"
        with self.lock:
            now = time.time()
            if now - self.last.get(address, 0) < self.GAP_SECONDS:
                raise GameError("Thanks! Give it a few seconds before sending another.")
            try:
                size = os.path.getsize(self.path)
            except OSError:
                size = 0
            if size > self.MAX_FILE_BYTES:
                log.error("suggestions.md is over %d bytes, so new suggestions are refused", self.MAX_FILE_BYTES)
                raise GameError("The suggestion box is full. Let an admin know.")
            with open(self.path, "a", encoding="utf-8") as fh:
                fh.write((self.HEADER if not size else "") + entry)
            self.last[address] = now
        log.info("Suggestion from %s (%s)", who, address)


class Handler(BaseHTTPRequestHandler):
    server_version = f"Battlefish/{VERSION}"
    game = None
    site = None
    ticker = None
    auth = None
    logins = None
    suggestions = None

    def log_message(self, fmt, *args):
        log.debug("%s %s", self.address_string(), fmt % args)

    # ---- responses ------------------------------------------------------------

    def _send(self, status, body, content_type, headers=()):
        try:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            for key, value in headers:
                self.send_header(key, value)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
        except (ConnectionError, BrokenPipeError):
            pass  # the browser went away mid-response

    def _json(self, obj, status=200, headers=()):
        self._send(status, json.dumps(obj).encode(), "application/json; charset=utf-8", headers)

    def _error(self, status, message):
        self._json({"error": message}, status)

    def _file(self, rel):
        path = os.path.normpath(os.path.join(WEB_DIR, rel))
        if not path.startswith(WEB_DIR + os.sep) or not os.path.isfile(path):
            return self._error(404, "Not found")
        with open(path, "rb") as fh:
            body = fh.read()
        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        self._send(200, body, ctype)

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > 65536:
            raise GameError("Request too large.")
        raw = self.rfile.read(length) if length else b""
        try:
            data = json.loads(raw or b"{}")
        except ValueError:
            raise GameError("The request wasn't valid JSON.")
        if not isinstance(data, dict):
            raise GameError("The request wasn't a JSON object.")
        return data

    def _token(self, name=COOKIE):
        cookie = http.cookies.SimpleCookie(self.headers.get("Cookie", ""))
        return cookie[name].value if name in cookie else None

    def _is_admin(self):
        return self.auth.valid(self._token())

    def _owns(self, mid):
        return bool(mid) and self.logins.monster(self._token(PLAYER_COOKIE)) == mid

    def _need_pin(self, mid):
        if self.game.has_pin(mid):
            return self._json({"error": "Enter this fish's PIN first.", "pin": "needed"}, 401)
        return self._json({"error": "Set a PIN to claim this fish.", "pin": "unset"}, 401)

    def _logged_in(self, mid, obj):
        """Reply with obj and remember on this browser that it unlocked fish mid."""
        return self._json(obj, headers=[("Set-Cookie", self.logins.cookie(mid, self.game.pin_tag(mid)))])

    # ---- routing -----------------------------------------------------------------

    def _dispatch(self, handler):
        try:
            handler()
        except GameError as e:
            self._error(400, str(e))
        except Exception:
            log.exception("Error handling %s %s", self.command, self.path)
            self._error(500, "Something went wrong on the server. Check data/server.log on the game server.")

    def do_GET(self):
        self._dispatch(self._get)

    def do_HEAD(self):
        self._dispatch(self._get)

    def do_POST(self):
        self._dispatch(self._post)

    def _get(self):
        url = urlparse(self.path)
        path, query = url.path, parse_qs(url.query)
        if path in PAGES:
            return self._file(PAGES[path])
        if path.startswith("/static/"):
            return self._file(path[len("/static/"):])
        if path == "/readme.md":
            # Numbers that come from the settings are {{placeholders}} in the file, filled in here.
            with open(README, encoding="utf-8") as fh:
                text = fill_placeholders(fh.read(), dict(self.game.help_values(), **site_values(self.site)))
            return self._send(200, text.encode("utf-8"), "text/markdown; charset=utf-8")
        if path == "/api/state":
            return self._json(self.game.public_state())
        if path == "/api/history":
            monster = (query.get("monster") or [""])[0] or None
            try:
                limit = max(1, min(500, int((query.get("limit") or ["50"])[0])))
            except ValueError:
                limit = 50
            return self._json(self.game.history(monster, limit))
        if path == "/api/monsters":
            return self._json(self.game.list_monsters())
        if path.startswith("/api/monster/"):
            mid = path[len("/api/monster/"):]
            if not self._owns(mid):
                return self._need_pin(mid)
            return self._json(self.game.get_monster(mid))
        if path == "/api/rules":
            return self._json(self.game.rules())
        if path == "/api/ticker":
            return self._json(self.ticker.read())
        if path == "/api/weeks":
            return self._json(self.game.past_weeks())
        if path == "/api/admin/status":
            return self._json({"configured": self.auth.is_configured(), "logged_in": self._is_admin()})
        if path == "/api/admin/overview":
            if not self._is_admin():
                return self._error(401, "Log in first.")
            return self._json(self.game.admin_overview())
        if path == "/api/admin/ticker":
            if not self._is_admin():
                return self._error(401, "Log in first.")
            return self._json(self.ticker.admin_view())
        self._error(404, "Not found")

    def _post(self):
        path = urlparse(self.path).path
        body = self._body()
        if path == "/api/monster":
            mid = body.get("id")
            if mid and not self._owns(mid):
                return self._need_pin(mid)
            m = self.game.save_monster(body)
            return self._logged_in(m["id"], m)
        if path == "/api/monster/unlock":
            mid = str(body.get("id") or "")
            if not self.game.check_pin(mid, body.get("pin")):
                time.sleep(1)  # slow down guessing
                return self._error(401, "Wrong PIN.")
            return self._logged_in(mid, {"ok": True})
        if path == "/api/monster/pin":
            # Anyone may claim a fish that has no PIN yet; changing a PIN needs the current login.
            mid = str(body.get("id") or "")
            self.game.set_pin(mid, body.get("pin"), replace=self._owns(mid))
            return self._logged_in(mid, {"ok": True})
        if path == "/api/monster/logout":
            return self._json({"ok": True}, headers=[("Set-Cookie", f"{PLAYER_COOKIE}=; Path=/; Max-Age=0")])
        if path == "/api/suggest":
            # A logged-in player is named from their fish; anyone else's name is taken as typed.
            mid = self.logins.monster(self._token(PLAYER_COOKIE))
            owner = next((m["player"] for m in self.game.list_monsters() if m["id"] == mid), None)
            self.suggestions.add(body.get("text"), owner or body.get("name"), bool(owner),
                                 self.client_address[0])
            return self._json({"ok": True})
        if path == "/api/admin/login":
            token = self.auth.login(str(body.get("password", "")))
            if not token:
                time.sleep(1)  # slow down guessing
                return self._error(401, "Wrong password.")
            cookie = f"{COOKIE}={token}; HttpOnly; Path=/; SameSite=Strict; Max-Age={AdminAuth.SESSION_SECONDS}"
            return self._json({"ok": True}, headers=[("Set-Cookie", cookie)])
        if path == "/api/admin/logout":
            self.auth.logout(self._token())
            return self._json({"ok": True}, headers=[("Set-Cookie", f"{COOKIE}=; Path=/; Max-Age=0")])
        if path == "/api/admin/action":
            if not self._is_admin():
                return self._error(401, "Your admin login has expired. Log in again.")
            self.game.admin_action(str(body.get("action")), body)
            return self._json({"ok": True})
        if path == "/api/admin/ticker":
            if not self._is_admin():
                return self._error(401, "Your admin login has expired. Log in again.")
            self.ticker.set_items(body.get("items"))
            return self._json({"ok": True})
        self._error(404, "Not found")


TICKER_LIMITS = {"label": 80, "value": 40, "change": 40, "group": 40, "items": 40}


def clean_ticker_items(raw, strict):
    """Ticker items as the aquarium shows them: [{label, value?, change?, trend?, good, group?}], all text.

    raw is a list of items, or {"items": [...]}. Numbers are accepted for value and change and turned into text.
    strict (an admin's edit): a bad item is refused with a GameError that says what's wrong. Otherwise (a feed)
    bad items are skipped, so one bad item doesn't blank the ticker. Rows left completely blank are dropped.
    """
    if isinstance(raw, dict):
        raw = raw.get("items")
    if not isinstance(raw, list):
        if strict:
            raise GameError("The ticker items must be a list.")
        log.warning("Ticker: the source didn't send a list of items")
        return []
    out = []
    for n, it in enumerate(raw, 1):
        try:
            if not isinstance(it, dict):
                raise GameError(f"Ticker item {n} isn't an object.")
            item = {}
            for key in ("label", "value", "change", "group"):
                v = it.get(key)
                if v is None:
                    v = ""
                elif isinstance(v, bool):
                    raise GameError(f"Ticker item {n}: {key} must be text.")
                elif isinstance(v, int):
                    v = f"{v:,}"
                elif isinstance(v, float):
                    v = f"{v:,.2f}".rstrip("0").rstrip(".")
                if not isinstance(v, str):
                    raise GameError(f"Ticker item {n}: {key} must be text.")
                v = " ".join(v.split())
                if len(v) > TICKER_LIMITS[key]:
                    raise GameError(f"Ticker item {n}: {key} must be {TICKER_LIMITS[key]} characters or fewer.")
                if v:
                    item[key] = v
            trend = it.get("trend") or None
            good = it.get("good") or "up"
            if trend not in (None, "up", "down"):
                raise GameError(f"Ticker item {n}: trend must be up, down, or empty.")
            if good not in ("up", "down"):
                raise GameError(f"Ticker item {n}: good must be up or down.")
            if not item:
                continue  # a blank row
            if "label" not in item:
                raise GameError(f"Ticker item {n} needs a label.")
            if trend:
                item["trend"] = trend
            item["good"] = good
            out.append(item)
        except GameError as e:
            if strict:
                raise
            log.warning("Ticker: skipped an item: %s", e)
    if len(out) > TICKER_LIMITS["items"]:
        if strict:
            raise GameError(f"The ticker can have at most {TICKER_LIMITS['items']} items.")
        out = out[:TICKER_LIMITS["items"]]
    return out


class Ticker:
    """The items for the ticker under the tank, from the source chosen in site.json (see DESIGN.md, "The ticker").

    - off: no ticker.
    - admin: typed in on the admin page, saved in data/ticker.json.
    - file: a JSON file in the item format, read again every refresh_minutes.
    - url: a JSON address in the item format, fetched every refresh_minutes.
    - adapter: get_items() in ticker_adapter.py (written for the office), called every refresh_minutes. It
      returns items in the item format, and may fetch whatever it likes to make them.

    A fetched source that fails keeps its last items, so a hiccup doesn't blank the ticker; the aquarium marks
    them as not updated once they're half an hour old.
    """

    SOURCES = ("off", "admin", "file", "url", "adapter")

    def __init__(self, site, data_dir):
        t = site.get("ticker") or {}
        self.source = t.get("source") or "off"
        if self.source not in self.SOURCES:
            log.error("Ticker: unknown source %r in site.json, so the ticker is off", self.source)
            self.source = "off"
        self.title = str(t.get("title") or "")
        self.file = os.path.join(ROOT, t.get("file") or "data/ticker-feed.json")
        self.url = str(t.get("url") or "")
        self.refresh_s = max(30, float(t.get("refresh_minutes") or 5) * 60)
        self.admin_path = os.path.join(data_dir, "ticker.json")
        self.lock = threading.Lock()
        self.items = []
        self.fetched_at = None
        self.next_refresh = 0
        self.refreshing = False
        if self.source == "admin":
            try:
                with open(self.admin_path, encoding="utf-8") as fh:
                    self.items = clean_ticker_items(json.load(fh), strict=False)
            except FileNotFoundError:
                pass
            except (OSError, ValueError):
                log.exception("Ticker: couldn't read %s", self.admin_path)

    def detail(self):
        """Where the items come from, for the admin page."""
        return {"admin": "this page", "file": os.path.relpath(self.file, ROOT), "url": self.url,
                "adapter": "ticker_adapter.py", "off": "nowhere"}[self.source]

    def _fetch(self):
        if self.source == "file":
            with open(self.file, encoding="utf-8") as fh:
                raw = json.load(fh)
        elif self.source == "url":
            with urllib.request.urlopen(self.url, timeout=60) as res:
                raw = json.load(res)
        else:  # adapter
            import ticker_adapter  # imported on first use, so a broken adapter can't stop the server starting
            raw = ticker_adapter.get_items()
        return clean_ticker_items(raw, strict=False)

    def _refresh(self):
        try:
            items = self._fetch()
            with self.lock:
                self.items, self.fetched_at = items, time.time()
        except (OSError, ValueError) as e:  # unreachable, unreadable, or not JSON: one line, it may repeat for hours
            log.warning("Ticker: refresh from %s failed (%s); keeping the last items", self.detail(), e)
        except Exception:
            log.exception("Ticker: refresh from %s failed; keeping the last items", self.detail())
        finally:
            with self.lock:
                self.refreshing = False

    def read(self):
        """{title, items, fetched_at} for the aquarium, starting a background refresh when one is due. {} when off."""
        if self.source == "off":
            return {}
        with self.lock:
            if self.source != "admin" and not self.refreshing and time.time() >= self.next_refresh:
                self.refreshing = True
                self.next_refresh = time.time() + self.refresh_s
                threading.Thread(target=self._refresh, name="ticker", daemon=True).start()
            out = {"title": self.title, "items": list(self.items)}
            if self.source != "admin":
                out["fetched_at"] = self.fetched_at
            return out

    def admin_view(self):
        with self.lock:
            return {"source": self.source, "detail": self.detail(), "items": list(self.items),
                    "limits": TICKER_LIMITS}

    def set_items(self, raw):
        """An admin's new list of items (admin source only)."""
        if self.source != "admin":
            raise GameError(f"The ticker's items come from {self.detail()}, so they can't be changed here.")
        items = clean_ticker_items(raw, strict=True)
        with self.lock:
            tmp = self.admin_path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(items, fh, indent=2)
            os.replace(tmp, self.admin_path)
            self.items = items
        log.info("Admin updated the ticker (%d items)", len(items))


def load_site():
    """site.json: what's particular to this office. Missing or unreadable, the defaults stand (see DESIGN.md)."""
    try:
        with open(SITE_FILE, encoding="utf-8") as fh:
            site = json.load(fh)
        if not isinstance(site, dict):
            raise ValueError("site.json must hold a JSON object")
        return site
    except FileNotFoundError:
        return {}
    except (OSError, ValueError):
        log.exception("Couldn't read site.json; using the defaults")
        return {}


def site_values(site):
    """The How to play page's placeholders that come from site.json rather than the game settings."""
    port = int(site.get("port") or DEFAULT_PORT)
    url = (site.get("public_url") or f"http://{socket.gethostname()}:{port}").rstrip("/")
    t = site.get("ticker") or {}
    about = str(t.get("about") or "news and stats from around the office")
    ticker = "" if (t.get("source") or "off") == "off" else (
        f"- A ticker along the bottom of the screen scrolls {about}. If your computer is set to show fewer "
        "animations (in Windows, **Animation effects** is off), the ticker doesn't scroll: it shows a screenful "
        "at a time and changes to the next every few seconds.")
    return {"site_url": url, "ticker_help": ticker}


class Server(ThreadingHTTPServer):
    daemon_threads = True
    # On Windows, address reuse would let a second copy bind the same port silently.
    allow_reuse_address = sys.platform != "win32"


def run_simulation(game):
    while True:
        try:
            game.tick()
        except Exception:
            log.exception("Simulation tick failed")
        time.sleep(0.1)


def code_signature():
    sig = []
    for name in CODE_FILES:
        try:
            st = os.stat(os.path.join(ROOT, name))
            sig.append((name, st.st_mtime_ns, st.st_size))
        except OSError:
            sig.append((name, None, None))
    return tuple(sig)


def code_loads():
    """True if the code on disk imports cleanly, so restarting onto it won't leave the game down."""
    try:
        modules = "engine, server" + (", ticker_adapter" if os.path.exists(os.path.join(ROOT, "ticker_adapter.py")) else "")
        result = subprocess.run([sys.executable, "-c", f"import {modules}"], cwd=ROOT,
                                capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired):
        log.exception("Couldn't check the new code")
        return False
    if result.returncode:
        log.error("The new code doesn't load, so the server keeps running the old version. Fix it and copy "
                  "it again:\n%s", result.stderr.strip()[-3000:])
        return False
    return True


def watch_code(game, server, restart):
    """Stop the server when its code changes, so the scheduled task starts it again on the new code.

    Waits until the files have stopped changing (so a copy in progress isn't picked up) and no fight
    is running, holding off new fights meanwhile, and skips code that doesn't load.
    """
    running = seen = code_signature()
    since = time.time()
    rejected = None
    while True:
        time.sleep(WATCH_SECONDS)
        try:
            sig = code_signature()
            if sig != seen:
                seen, since = sig, time.time()
                continue
            if sig in (running, rejected):
                game.hold_new_fights = False
                continue
            if time.time() - since < SETTLE_SECONDS:
                continue
            with game.lock:
                game.hold_new_fights = True  # with fights overlapping, there might otherwise never be a gap
                fighting = bool(game.fights)
            if fighting:
                continue  # don't cut a fight short; check again after it ends
            if not code_loads():
                rejected = sig
                game.hold_new_fights = False
                continue
            log.info("The code changed, so the server is restarting to load it")
            restart.set()
            server.shutdown()
            return
        except Exception:
            log.exception("Code watcher failed; will retry")


def setup_logging():
    log.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    fh = logging.handlers.RotatingFileHandler(os.path.join(DATA_DIR, "server.log"), maxBytes=1_000_000,
                                              backupCount=3, encoding="utf-8")
    fh.setFormatter(fmt)
    log.addHandler(fh)
    if sys.stderr:  # pythonw has no console
        sh = logging.StreamHandler()
        sh.setFormatter(fmt)
        log.addHandler(sh)


def set_admin_password(auth):
    print("Set the shared admin password for Battlefish.")
    while True:
        first = getpass.getpass("New password: ")
        if len(first) < 6:
            print("Use at least 6 characters.")
            continue
        if getpass.getpass("Again: ") != first:
            print("Those didn't match. Try again.")
            continue
        auth.set_password(first)
        print("Saved. Restart the server if it's running so existing admin logins end.")
        return


def main():
    parser = argparse.ArgumentParser(description="Battlefish server")
    parser.add_argument("--host", help="address to listen on (default: site.json's host, or all addresses)")
    parser.add_argument("--port", type=int, help=f"port (default: site.json's port, or {DEFAULT_PORT})")
    parser.add_argument("--set-admin-password", action="store_true", help="set the admin password and exit")
    args = parser.parse_args()

    os.makedirs(DATA_DIR, exist_ok=True)
    auth = AdminAuth(os.path.join(DATA_DIR, "admin.json"))
    if args.set_admin_password:
        set_admin_password(auth)
        return

    setup_logging()
    site = load_site()
    host = args.host or site.get("host") or "0.0.0.0"
    port = args.port or int(site.get("port") or DEFAULT_PORT)
    game = Game(DATA_DIR)
    Handler.game = game
    Handler.site = dict(site, port=port)
    Handler.ticker = Ticker(site, DATA_DIR)
    Handler.auth = auth
    Handler.logins = PlayerLogins(os.path.join(DATA_DIR, "player-logins.key"), game)
    Handler.suggestions = Suggestions(os.path.join(DATA_DIR, "suggestions.md"))
    threading.Thread(target=run_simulation, args=(game,), daemon=True).start()

    server = Server((host, port), Handler)
    restart = threading.Event()
    threading.Thread(target=watch_code, args=(game, server, restart), daemon=True).start()
    # public_url is what players type (behind a proxy it differs from the bound port), so log both.
    log.info("Battlefish %s running at %s/ (listening on %s:%d; editor: /editor, admin: /admin)", VERSION,
             site_values(Handler.site)["site_url"], host, port)
    if not auth.is_configured():
        log.info("No admin password yet. Run: python server.py --set-admin-password")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        game.save()
        log.info("Stopped")
    if restart.is_set():
        sys.exit(RESTART_EXIT_CODE)


if __name__ == "__main__":
    main()
