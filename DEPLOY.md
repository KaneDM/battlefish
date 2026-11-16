# Deploying Battlefish

How to install the game on the office's server, run it as a service, set up the TV, and keep it backed up. Do the setup interview in `START-HERE.md` first; the answers fill in the paths, names and ports below.

The examples use these placeholders:

| Placeholder | Meaning |
|---|---|
| `GAME_DIR` | The game folder on the server's own disk, such as `D:\Battlefish` or `/opt/battlefish` |
| `PORT` | The port from `site.json` (default 8765) |
| `PUBLIC_URL` | `site.json`'s `public_url`, such as `http://battlefish.corp.example:8765` |

## What the service has to do

Whatever the platform, the server process needs:

1. **Start at boot** and run all the time, in `GAME_DIR` as its working directory: `python server.py` (`python3` on Linux and macOS).
2. **Restart whenever it exits.** The server exits on purpose, with code 3, to reload itself after a code change (`DESIGN.md` section 18). A supervisor that restarts it on *any* exit is required, or a code update stops the game.
3. **Restart nightly** (recommended, 3 AM by default) as a backup for the code watcher.
4. **Run as an account that can write `GAME_DIR/data/`,** with nobody else able to read it.
5. **Be reachable on `PORT`** from players' computers and the TV.

It needs no database, no web server and no packages: just Python 3.9 or newer.

## 1. Copy the files

Copy the contents of the package's `game/` folder into `GAME_DIR`, so that `GAME_DIR/server.py` exists. Put the `site.json` you wrote there, and `ticker_adapter.py` if you wrote one. Don't copy the example files' names over the real ones: `site.example.json` and `ticker_adapter.example.py` can stay as templates.

```
GAME_DIR/
  server.py  engine.py  skills.py  styles.py  README.md
  site.json                 (yours)
  ticker_adapter.py         (only with the adapter ticker)
  web/  setup/  tools/
  data/                     (created on first start)
```

## 2. Set the admin password

On the server, in `GAME_DIR`, **as the account that will run the service** (so it can write `data/`):

```
python server.py --set-admin-password
```

The person types the password into this prompt themselves (at least 6 characters). It's stored only as a salted hash in `data/admin.json`. Run it again any time to change the password; restart the service afterwards to end existing admin logins.

## 3a. Windows

1. **Install Python 3.9 or newer.** The service runs as SYSTEM, and the scheduled task stores the full path to `pythonw.exe`, so Python must be somewhere SYSTEM can read that won't move. python.org now offers two kinds of Windows download. Use them in this order:
   - **Recommended: the standalone installer, for all users.** On python.org's Downloads page, the main Windows button is the Python Install Manager. Instead, follow the link under it, **"Or get the standalone installer for Python 3.x"** (or take **Windows installer (64-bit)** from a release page). Tick **Add python.exe to PATH**, choose **Customize installation**, and on **Advanced Options** tick **Install Python 3.x for all users**. Python then lives under `C:\Program Files\`. This installer is deprecated: python.org won't produce it for Python 3.16 or later. The 3.15 installer still gets security releases for years, which is plenty for a game that needs only 3.9.
   - **Acceptable: the Python Install Manager** (the main Windows button, also sold as "Python" in the Microsoft Store). It installs runtimes **per user only**, under `%LOCALAPPDATA%\Python\pythoncore-3.x-64\`, and never offers the all-users or PATH options. It puts `python` and `py` on PATH through `%LOCALAPPDATA%\Microsoft\WindowsApps` and `%LOCALAPPDATA%\Python\bin`. The game still runs this way, because SYSTEM can read that folder through the profile's normal permissions. The installer warns about it. The risk is the stored path: if that runtime is uninstalled (`py uninstall`), replaced by an Install Manager update, or moved, or that user's profile is deleted, the game stops and doesn't come back. If you go this way, install as a long-lived admin account, not a person who may leave. After any change to that Python, check that the path the installer printed still exists, and run the installer again if it doesn't.
   - **Not an install: the Microsoft Store stub.** On a fresh Windows, `python.exe` and `python3.exe` in `%LOCALAPPDATA%\Microsoft\WindowsApps` are shortcuts that open the Microsoft Store. If `python --version` prints nothing or opens the Store, Python isn't installed. The installer asks Python for its real location, so it ignores the stub, and it refuses a Microsoft Store copy of Python, which can't run as a SYSTEM service.
2. **Set the admin password** (step 2), from an Administrator terminal so the files are written where SYSTEM can read them.
3. **Install the service**, in an Administrator PowerShell, from the server's local copy of the folder (not a `\\server\share` path):

   ```powershell
   cd "GAME_DIR"
   powershell -ExecutionPolicy Bypass -File .\setup\install-windows.ps1
   ```

   The installer:
   - finds Python 3.9+ and uses `pythonw.exe`, so there's no console window (it warns if that Python is a per-user install)
   - opens `PORT` (read from `site.json`) in Windows Firewall for the Domain and Private profiles, replacing any earlier Battlefish rule. If `site.json`'s `host` is `127.0.0.1` or `localhost` (only this computer, or a reverse proxy on it), it opens no port and says so.
   - registers a scheduled task named **Battlefish** that runs as SYSTEM, starts at boot, and checks every minute that it's running (so it comes back within a minute of the code-reload exit or a crash), never starting a second copy
   - registers **Battlefish nightly restart** at 3:00 AM
   - starts the game, checks that it answers, and prints the addresses: `site.json`'s `public_url` if it has one, otherwise `http://localhost:PORT` for a this-computer-only install or `http://<computer name>:PORT`

   Options: `-RestartAt 5:00AM` changes the nightly time, and `-Uninstall` removes the tasks and any Battlefish firewall rule (game data is kept). If `site.json`'s port or host changes later, run the installer again so the firewall rule follows.

4. **Restrict the data folder** to SYSTEM and administrators (start the game once first so `data/` exists):

   ```powershell
   icacls "GAME_DIR\data" /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F"
   ```

5. **Manual restart** if ever needed (there's no `Restart-ScheduledTask`):

   ```powershell
   Stop-ScheduledTask "Battlefish"; Start-ScheduledTask "Battlefish"
   ```

## 3b. Linux (systemd)

1. **Python:** most distributions ship Python 3.9+ (`python3 --version`). Install it from the distribution if needed.
2. **A dedicated account and folder:**

   ```bash
   sudo useradd --system --home-dir /opt/battlefish --shell /usr/sbin/nologin battlefish
   sudo mkdir -p /opt/battlefish && sudo cp -r game/. /opt/battlefish/
   sudo chown -R battlefish:battlefish /opt/battlefish
   sudo -u battlefish python3 /opt/battlefish/server.py --set-admin-password
   sudo chmod 700 /opt/battlefish/data
   ```

   Run the password command from inside `/opt/battlefish` if your `sudo` doesn't keep the working directory; the game always uses the `data/` folder next to `server.py`.

3. **The service**, `/etc/systemd/system/battlefish.service`:

   ```ini
   [Unit]
   Description=Battlefish office aquarium
   After=network-online.target
   Wants=network-online.target

   [Service]
   User=battlefish
   Group=battlefish
   WorkingDirectory=/opt/battlefish
   ExecStart=/usr/bin/python3 /opt/battlefish/server.py
   # The server exits with code 3 to reload new code: always start it again.
   Restart=always
   RestartSec=5
   # The weekly reset and daily form follow local time; set this if the system clock's zone isn't the office's.
   # Environment=TZ=America/Chicago

   [Install]
   WantedBy=multi-user.target
   ```

4. **The nightly restart**, `/etc/systemd/system/battlefish-restart.service` and `.timer`:

   ```ini
   # battlefish-restart.service
   [Unit]
   Description=Restart Battlefish nightly

   [Service]
   Type=oneshot
   ExecStart=/bin/systemctl restart battlefish.service
   ```

   ```ini
   # battlefish-restart.timer
   [Unit]
   Description=Restart Battlefish nightly at 3 AM

   [Timer]
   OnCalendar=*-*-* 03:00:00
   Persistent=false

   [Install]
   WantedBy=timers.target
   ```

5. **Enable and start:**

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now battlefish.service battlefish-restart.timer
   systemctl status battlefish
   ```

6. **Firewall:** open `PORT` to the office network only, for example `sudo ufw allow from 10.0.0.0/8 to any port 8765 proto tcp`, or with firewalld, a rich rule for the office subnet. Use a port above 1024 so the service doesn't need root.

7. **Updating the code** is copying files into `/opt/battlefish` as the `battlefish` user (or `chown` them afterwards); the server reloads itself. Read the log with `tail -f /opt/battlefish/data/server.log`.

## 3c. macOS

Use a launchd daemon with `KeepAlive` set to true (restart on any exit) and `WorkingDirectory` set to `GAME_DIR`, running `/usr/bin/python3 GAME_DIR/server.py` as a dedicated user. Add a second daemon with `StartCalendarInterval` (Hour 3) that runs `launchctl kickstart -k system/<label>` for the nightly restart. Allow incoming connections for Python in the macOS firewall if it's on.

## 3d. Containers (Docker or Podman)

Bind-mount the whole game folder rather than copying the code into the image. Then the self-reload works and updates are still just file copies, and `data/` lives on the host:

```dockerfile
# GAME_DIR/Dockerfile
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
EXPOSE 8765
CMD ["python", "server.py"]
```

```bash
docker build -t battlefish GAME_DIR
docker run -d --name battlefish --restart unless-stopped \
  -p 8765:8765 \
  -v GAME_DIR:/app \
  -e TZ=America/Chicago -v /etc/localtime:/etc/localtime:ro \
  battlefish
docker exec -it battlefish python server.py --set-admin-password
```

- `--restart unless-stopped` brings the container back after the code-reload exit. For the nightly restart, schedule `docker restart battlefish` with cron or a systemd timer on the host.
- Set `TZ` to the office's zone: the weekly reset and the daily form follow the container's local time, which is UTC unless you set it.
- `site.json` must have `"host": "0.0.0.0"` (the default) inside a container.

## 4. Reverse proxy and HTTPS (optional)

Only if the office wants HTTPS or a URL without a port. Bind the game to `127.0.0.1` in `site.json`, put a proxy in front, and set `public_url` to the proxy's address. The game needs nothing special from the proxy: plain request forwarding, no websockets. Every page polls with ordinary requests.

```nginx
server {
    listen 443 ssl;
    server_name battlefish.corp.example;
    ssl_certificate     /etc/ssl/certs/battlefish.pem;
    ssl_certificate_key /etc/ssl/private/battlefish.key;
    location / {
        proxy_pass http://127.0.0.1:8765;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
    }
}
```

On Windows, IIS with URL Rewrite and Application Request Routing does the same. Note that behind a proxy, suggestions record the proxy's address rather than the player's, because the game reads the direct connection's address.

## 5. The TV

The aquarium is a web page; whatever drives the TV just needs to show `PUBLIC_URL/` full-screen and keep showing it.

- **Best:** a small PC (or the TV's own PC input) running Chrome or Edge in kiosk mode, started automatically at log-in. On Windows, put a shortcut in the startup folder (`shell:startup`) with a target like:

  ```
  "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --noerrdialogs --disable-session-crashed-bubble --disable-infobars PUBLIC_URL/
  ```

  or for Edge: `msedge.exe --kiosk PUBLIC_URL/ --edge-kiosk-type=fullscreen --no-first-run`.
- **Keep it awake:** set the display and sleep timeouts to Never and turn off the screen saver. Follow the IT team's policy on auto-log-in for a display account.
- **No mouse needed.** Without a mouse the fish just wander. The side panel resets itself to everyone and this week after 3 minutes without use, so it never sticks on one person's fight history.
- **Recovery:** the page retries on its own if the server restarts or the network drops, and the version next to the title updates by itself. After a change to files in `web/`, though, the TV keeps running the old page until it's reloaded: press F5 on it, or restart its browser. After a power cut the kiosk shortcut brings it back.
- **Performance:** the aquarium redraws at the display's frame rate on a 2D canvas. Any recent PC or mini PC is fine. A very slow device may stutter with many fish; `DESIGN.md` section 19 has notes.
- **Reduced motion:** if the TV PC has Windows' **Animation effects** turned off (or the OS's reduce-motion setting on), the ticker shows a page at a time instead of scrolling. That's intended.

## 6. Verify

Go through this with the person after installing:

1. `PUBLIC_URL/` opens on the server and on another computer, shows "Battlefish" with `v1.0.0`, and says the tank is empty.
2. `PUBLIC_URL/help` shows How to play with real numbers. No `{{…}}` should be left, and the addresses on the page should be `PUBLIC_URL`.
3. `PUBLIC_URL/admin` asks for the password, logs in, and shows the Settings tabs. If the ticker is on, the **Ticker** section appears.
4. Create two test fish in `PUBLIC_URL/editor` (two different player names) and watch them fight within about a minute (or use **Start a fight now**). Then delete them on the admin page, or use **Reset everything** before launch.
5. If the ticker is on, items appear along the bottom of the aquarium within a minute (for `admin`, add one on the admin page first).
6. `data/server.log` shows the startup line with the version, and the fights.
7. Restart the service (or reboot) and check the game comes back by itself.
8. The TV shows the aquarium full-screen and comes back by itself after its PC restarts.

Before launch, check **Reset hour** under **Week** on the admin page and set it if the office chose something other than 7 AM. Then use **Reset everything** to clear the test fish.

## 7. Updating, rolling back, and backups

- **Updating:** follow `WORKFLOWS.md`. In short: test in a copy, snapshot the live files, copy the changed files in together, and watch `data/server.log` for the restart with the new version. Python files and `site.json` reload within about 3 minutes, once running fights end. `web/` and `README.md` changes show on the next page load.
- **Rolling back:** copy the snapshot's files back the same way.
- **Backups:** back up `GAME_DIR/data/` regularly (it's a few megabytes at most), and keep the code under version control or in snapshots. To restore `state.json` or `weeks.json`, stop the service first: the server rewrites `state.json` every 10 seconds.
- **Moving servers:** stop the service, copy the whole folder including `data/`, install the service on the new machine, and update `public_url` and DNS. Players stay logged in, because the login key travels with `data/`.
