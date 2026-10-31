# Intelliprompter

A teleprompter for people who don't read scripts. You write talking points, start a take, and each point gets checked off the moment you *start* covering its idea (paraphrases count). Skipped points pile up in a "Missed" tray so you can circle back.

Inspired by the demo in NetworkChuck's decision-model video. This version uses an **OpenRouter** model for the per-point yes/no decisions instead of Jev.

- **Desktop app** for Windows, macOS and Linux (Electron, built by GitHub Actions)
- **Web app** you can run on any machine with Node, or host on a Debian server behind HTTPS

---

## Table of contents

1. [How it works](#how-it-works)
2. [API keys you need](#api-keys-you-need)
3. [Desktop app: install and run](#desktop-app-install-and-run)
4. [Run from source on any machine (Windows, macOS, Linux)](#run-from-source-on-any-machine)
5. [Build the desktop installers yourself](#build-the-desktop-installers-yourself)
6. [Deploy on a Debian server](#deploy-on-a-debian-server)
7. [Develop on a Debian server](#develop-on-a-debian-server)
8. [Local mode (privacy)](#local-mode-privacy)
9. [Screen Sense](#screen-sense)
10. [PowerPoint add-in](#powerpoint-add-in)
11. [Script format](#script-format)
12. [Project layout](#project-layout)
13. [Troubleshooting](#troubleshooting)

---

## How it works

```
mic ──► transcription backend ──► rolling transcript
                                       │ every 500 ms (if it changed)
                                       ▼
                      POST /api/decide { transcript, open points }
                                       │
                                       ▼
                 OpenRouter chat completion, JSON out:
                 { decisions: [{ id, started, confidence }] }
                                       │
                                       ▼
          point flips to STARTED when started && confidence ≥ 0.7
```

Transcription backends (pick in the dropdown, or leave on **Auto**):

| Backend | Needs | Works in |
|---|---|---|
| Browser (Web Speech) | nothing, free | Chrome / Edge **web** mode only. Not available in the desktop app. |
| ElevenLabs Scribe v2 Realtime | `ELEVENLABS_API_KEY` | everywhere. Same as the original demo. |
| OpenAI gpt-live-transcribe | `OPENAI_API_KEY` | everywhere. |

**Auto** tries ElevenLabs, then OpenAI, then the browser, then on-device Whisper. A backend that errors or gives no words within 8 s is skipped. The log at the bottom shows each attempt and the time to first words, so you can see which one is actually fastest for you.

API keys never reach the browser: the server mints short-lived tokens for the streaming backends and calls OpenRouter itself.

### Phone mirror and remote

The engine (the browser or desktop app with the microphone) creates a **session** on the session relay and shows a 6-digit code in the top bar. Click it for a QR. Any phone on the same network opens the mirror page, enters the code (or scans the QR), and gets the live view with big type plus Prev / Next / Reset / Start / Stop buttons. The mirror is a web page, so nothing to install; on Android or iOS use "Add to Home Screen" for a full-screen app.

- Web mode: the relay is `apps/server` on port 4748, started by `npm run dev` together with the web app.
- Desktop app: the relay runs inside the app. The QR carries your laptop's LAN address. The first launch triggers one Windows firewall prompt.
- Hosted server: see the Debian section; set `ACCESS_PASSWORD` so strangers cannot spend your credits.

#### Phone on another network

A phone on mobile data, or on an office Wi-Fi that isolates clients, cannot reach your laptop's address. Three ways, in order of effort:

1. **Share to phone on any network** (desktop app menu). The app downloads Cloudflare's free `cloudflared` once (about 20 MB, asked first), opens two quick tunnels and reloads; the QR now carries random `https://….trycloudflare.com` URLs that work from anywhere, like WhatsApp Web. Pairing still needs the 6-digit code, pairing is rate limited, and the spend endpoints stay behind the engine token. Turn it off from the same menu; the URLs change every time. Not available in Offline mode.
2. **Same VPN on both**: if the laptop and the phone run the same VPN (Tailscale, Twingate…), pick the VPN address in the menu **Mirror address on this network** and scan again. The app prefers a private LAN address by default, so a VPN address is never chosen automatically.
3. **Your own server**: deploy the Debian setup below and point the desktop app at it with `INTELLIPROMPTER_SESSION_URL` in `.env`. Permanent URL, your own domain.

If the QR shows an address the phone cannot open, check the menu **Mirror address on this network**: the laptop may have several (Wi-Fi, Ethernet, VPN, virtual adapters) and the automatic choice can be wrong.

---

## API keys you need

| Key | Required? | Where to get it |
|---|---|---|
| `OPENROUTER_API_KEY` | **Yes** | https://openrouter.ai/keys |
| `ELEVENLABS_API_KEY` | Desktop app: one of these two. Web: optional. | https://elevenlabs.io/app/settings/api-keys |
| `OPENAI_API_KEY` | Desktop app: one of these two. Web: optional. | https://platform.openai.com/api-keys |
| `OPENROUTER_DECISION_MODEL` | No (default `google/gemini-2.5-flash-lite`) | any model id from https://openrouter.ai/models |

Cheaper and faster is better for the decision model: it is called twice a second.

---

## Desktop app: install and run

Download the file for your OS from the **Releases** page of this repo (built automatically by GitHub Actions, see [Build the desktop installers yourself](#build-the-desktop-installers-yourself) if there is no release yet).

| OS | File | Notes |
|---|---|---|
| Windows | `Intelliprompter-x.y.z-win-x64.exe` (the NSIS installer; the portable build has the same name pattern) | Unsigned: SmartScreen shows "unknown publisher". Click **More info → Run anyway**. |
| macOS | `Intelliprompter-x.y.z-mac-arm64.dmg` (Apple Silicon) or `-mac-x64.dmg` (Intel) | Unsigned: first launch is blocked. Run once in Terminal: `xattr -dr com.apple.quarantine /Applications/Intelliprompter.app` |
| Linux | `Intelliprompter-x.y.z-linux-x64.AppImage` or `.deb` | AppImage: `chmod +x` then run. Deb: `sudo apt install ./intelliprompter_x.y.z_amd64.deb` |

### First start

1. Launch the app. It shows a notice that no OpenRouter key is set.
2. Menu **Intelliprompter → Open config folder**. You get a folder with two files:
   - `.env` – paste your keys here (same format as `.env.example`)
   - `script.md` – your talking points (also editable from **Edit points** inside the app)
3. Save `.env`, quit and relaunch the app.
4. Press **Start take**, allow the microphone, talk.

Config folder locations:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\Intelliprompter\` |
| macOS | `~/Library/Application Support/Intelliprompter/` |
| Linux | `~/.config/Intelliprompter/` |

The desktop app has no Web Speech backend (Electron's Chromium ships without it), so set `ELEVENLABS_API_KEY` or `OPENAI_API_KEY`.

---

## Run from source on any machine

Prerequisites: **Node.js 22** (https://nodejs.org) and **git**. Chrome or Edge if you want the free browser transcription.

### Windows (PowerShell)

```powershell
git clone https://github.com/<you>/intelliprompter.git
cd intelliprompter
npm ci
Copy-Item apps/web/.env.example apps/web/.env.local
notepad apps/web/.env.local      # paste your keys, save
npm run dev             # web app (4747) + session relay (4748), hot reload
```

Open http://localhost:4747 in Chrome or Edge and allow the microphone.

### macOS / Linux

```bash
git clone https://github.com/<you>/intelliprompter.git
cd intelliprompter
npm ci
cp apps/web/.env.example apps/web/.env.local
nano apps/web/.env.local         # paste your keys, save with Ctrl+O, Enter, Ctrl+X
npm run dev             # web app (4747) + session relay (4748)
```

Open http://localhost:4747 in Chrome or Edge.

### Production mode (faster, no hot reload)

```bash
npm run build
npm start
```

### Run the desktop app from source (no installer)

```bash
npm run desktop
```

---

## Build the desktop installers yourself

### Option A: let GitHub build all three platforms (recommended)

Pushing a version tag builds Windows, macOS and Linux installers and attaches them to a GitHub Release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Or run it by hand: GitHub → **Actions → Desktop builds → Run workflow**. The installers appear as downloadable artifacts on the run page (and as a Release when triggered by a tag).

Installers are unsigned. To sign them later, add `CSC_LINK` / `CSC_KEY_PASSWORD` (and Apple notarization secrets) to the repo and remove `CSC_IDENTITY_AUTO_DISCOVERY: "false"` from `.github/workflows/desktop.yml`.

### Option B: build locally

You can only build for the OS you are on (macOS builds need a Mac).

```bash
npm ci
npm run desktop:build:win      # on Windows  → release/*.exe
npm run desktop:build:mac      # on macOS    → release/*.dmg
npm run desktop:build:linux    # on Linux    → release/*.AppImage, release/*.deb
```

Output lands in `release/`.

---

## Deploy on a Debian server

Target: Debian 12 (bookworm), fresh server, you have `sudo`. The browser only allows microphone access on **HTTPS** (or `localhost`), so a remote server must be served over HTTPS. The commands below use **Caddy**, which gets a Let's Encrypt certificate automatically. You need a DNS `A` record for your domain pointing to the server first.

Replace `prompter.example.com` with your domain and `<you>` with your GitHub user everywhere.

### 1. System packages and Node.js 22

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install git curl ca-certificates gnupg ufw
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt -y install nodejs
node -v && npm -v
```

### 2. A dedicated user and the code

```bash
sudo useradd -r -m -d /opt/intelliprompter -s /usr/sbin/nologin prompter
sudo -u prompter git clone https://github.com/<you>/intelliprompter.git /opt/intelliprompter/app
```

Private repo? Create a fine-grained **read-only** personal access token on GitHub and clone with it instead:

```bash
sudo -u prompter git clone https://<you>:<TOKEN>@github.com/<you>/intelliprompter.git /opt/intelliprompter/app
```

### 3. Keys and build

```bash
cd /opt/intelliprompter/app
sudo -u prompter cp apps/web/.env.example apps/web/.env.local
sudo -u prompter nano apps/web/.env.local        # paste keys, Ctrl+O, Enter, Ctrl+X
sudo -u prompter npm ci
sudo -u prompter npm run build
```

### 4. systemd service (starts on boot, restarts on crash)

```bash
sudo tee /etc/systemd/system/intelliprompter.service >/dev/null <<'EOF'
[Unit]
Description=Intelliprompter (Next.js)
After=network.target

[Service]
Type=simple
User=prompter
WorkingDirectory=/opt/intelliprompter/app
EnvironmentFile=/opt/intelliprompter/app/apps/web/.env.local
Environment=NODE_ENV=production
Environment=PORT=4747
Environment=HOSTNAME=127.0.0.1
ExecStart=/usr/bin/node apps/web/.next/standalone/apps/web/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
sudo tee /etc/systemd/system/intelliprompter-session.service >/dev/null <<'EOF'
[Unit]
Description=Intelliprompter session relay
After=network.target

[Service]
Type=simple
User=prompter
WorkingDirectory=/opt/intelliprompter/app
EnvironmentFile=/opt/intelliprompter/app/apps/web/.env.local
Environment=NODE_ENV=production
Environment=SESSION_PORT=4748
Environment=SESSION_HOST=127.0.0.1
ExecStart=/usr/bin/node apps/server/dist/bundle.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now intelliprompter intelliprompter-session
sudo systemctl status intelliprompter intelliprompter-session --no-pager
curl -s http://127.0.0.1:4747/api/stt/status
curl -s http://127.0.0.1:4748/health
```

Set `ACCESS_PASSWORD=<something long>` and `NEXT_PUBLIC_SESSION_URL=` (empty, meaning same origin) in `apps/web/.env.local` **before** `npm run build`: on a public server the password is what stops strangers from using your API keys. The web app asks for it once and remembers it in the browser.

The last command should print something like `{"elevenlabs":true,"openai":false}`.

### 5. HTTPS with Caddy

```bash
sudo apt -y install debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt -y install caddy
```

```bash
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
prompter.example.com {
    handle /ws/* {
        reverse_proxy 127.0.0.1:4748
    }
    handle /api/session* {
        reverse_proxy 127.0.0.1:4748
    }
    handle {
        reverse_proxy 127.0.0.1:4747
    }
}
EOF
sudo systemctl reload caddy
```

### 6. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

Open `https://prompter.example.com` in Chrome or Edge, allow the microphone, press **Start take**.

### Optional: password-protect the page

Anyone who can reach the URL can spend your API credits. Add basic auth in Caddy:

```bash
caddy hash-password --plaintext 'choose-a-strong-password'
```

Copy the printed hash, then:

```bash
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
prompter.example.com {
    basicauth {
        stefan <PASTE_HASH_HERE>
    }
    handle /ws/* {
        reverse_proxy 127.0.0.1:4748
    }
    handle /api/session* {
        reverse_proxy 127.0.0.1:4748
    }
    handle {
        reverse_proxy 127.0.0.1:4747
    }
}
EOF
sudo systemctl reload caddy
```

### Update to a new version

```bash
cd /opt/intelliprompter/app
sudo -u prompter git pull
sudo -u prompter npm ci
sudo -u prompter npm run build
sudo systemctl restart intelliprompter intelliprompter-session
```

### Logs

```bash
sudo journalctl -u intelliprompter -f
sudo journalctl -u intelliprompter-session -f
sudo journalctl -u caddy -f
```

---

## Develop on a Debian server

For hacking on the code on a remote Debian box with hot reload, instead of (or next to) the production service.

```bash
sudo apt update && sudo apt -y install git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt -y install nodejs
git clone https://github.com/<you>/intelliprompter.git ~/intelliprompter
cd ~/intelliprompter
npm ci
cp apps/web/.env.example apps/web/.env.local
nano apps/web/.env.local
```

Run the dev server, then reach it through an **SSH tunnel** so the browser sees it as `localhost` (microphone works without HTTPS that way):

```bash
# on the server
npm run dev
```

```bash
# on your laptop, in a second terminal
ssh -L 4747:127.0.0.1:4747 user@your-server
```

Now open http://localhost:4747 on your laptop. Edits on the server reload live.

Useful commands:

```bash
npm run typecheck      # TypeScript check, all workspaces
npm test               # engine, prompt and relay tests (vitest)
npm run build          # production build: web standalone + relay bundle
npm run start:server   # run the standalone web build the way systemd does
npm run start:session  # run the relay
```

Working with VS Code: install the **Remote - SSH** extension, connect to the server, open `~/intelliprompter`. The port is forwarded automatically when you run `npm run dev` in the integrated terminal.

---

## Local mode (privacy)

Open **Settings** in the app (or `/settings/local`). You can run the decision model on your own machine with [Cloudflare Clef](https://ollama.com/library/clef-flash) through Ollama: install Ollama 0.35.1 or newer, press **Pull** next to Clef Flash (about 6 GB, needs 16 GB RAM; Clef 27B needs 32 GB), press **Test**, then choose "Clef on this machine" as the decision provider. Nothing leaves the computer for the decisions. The desktop app also has an **Offline mode** menu toggle that blocks every outbound request and forces local providers. Speech can also stay on the device: pick **Whisper on this device** in the transcription dropdown after downloading a Whisper model in Settings (150 MB for base, cached by the browser; WebGPU when available). Before any cloud call, the **PII guard** replaces emails, phones, IBANs, card numbers and codice fiscale with placeholders, and names, addresses and 22 Italian categories too when the [Rizzo-PII](https://github.com/Rizzo-AI-Academy/rizzo-pii) server runs locally (`docker run -p 127.0.0.1:5005:5005 rizzo-pii`). See ARCHITECTURE.md §6.10.

On a Debian server, run Ollama on the same box and set `OLLAMA_URL=http://127.0.0.1:11434` and `DECISION_PROVIDER=clef-local` in `apps/web/.env.local`.

## Screen Sense

Screen Sense lets the engine see what the audience sees (ARCHITECTURE.md §6). Press **Watch screen…** and pick a screen or a window (PowerPoint, a browser, a PDF). Once a second a 16×16 thumbnail is compared with the last frame sent; only a real change (new slide, new page) sends one full frame to a multimodal model on OpenRouter (`OPENROUTER_VISION_MODEL`, default `google/gemini-2.5-flash`), at most 20 frames a minute. The answer appears in the **ON SCREEN** strip: what the slide shows, up to three points to make, the numbers and names visible, and a mismatch warning when the slide contradicts your script. Facts you have not said yet are highlighted (the decision model sees them as a fourth list and reports what is still unmentioned). With no script loaded, each slide becomes a section with its points, so you can present from the slides alone.

- **Cost dial** (dropdown next to the button, or Settings): Off, On slide change, Balanced (also when you say "as you can see", "in questa slide", "en esta diapositiva"…), Real-time (every few seconds while the content keeps changing, for demos). The footer shows the frames sent and their cost; they count against the same $1 session cap as decisions.
- **Look now** sends the current frame at once. From the phone mirror it does the same.
- **Region… / hotkey** (desktop app only): `Ctrl+Shift+Space` (change it in Settings) dims the screen; drag a rectangle and only that region is sent. Works outside a take too.
- **Forget** drops every screen summary and note for this session.
- **Export notes** appears after Stop take: a Markdown file with one entry per slide, what was on screen and what you were saying at the time.
- **Import document** turns a PDF, PPTX, DOCX, TXT or MD file into talking points: one section per slide or page, PPTX speaker notes become the points and slide titles the section titles. You review the result before it replaces `script.md`. Scanned PDF pages have no text and are reported as warnings; add those points by hand.

Privacy: frames live in memory only, go once over HTTPS to the vision model and are dropped; nothing is written to disk or logged. Only the returned text is kept for the session, and the phone mirror and the PowerPoint pane receive that text, never images. The Intelliprompter window is excluded from the source list. In **Offline mode** Screen Sense is disabled (no local vision model ships yet). Screen content is untrusted: the prompt tells the model to treat text on the slide as data, never as instructions.

In the browser (not the desktop app) the browser's own share picker is used, and there is no region hotkey.

## PowerPoint add-in

A task pane for PowerPoint lives in [apps/powerpoint](apps/powerpoint/README.md). Your speaker notes become the script (one slide per section, `-` lines are points), the pane follows the selected slide while you edit, and it runs the microphone itself on Windows and PowerPoint for the web or mirrors a session by code elsewhere. PowerPoint hides panes during a slide show and offers no API to follow one, so on stage the phone mirror or the desktop app is the live view. Build with `npm run build -w apps/powerpoint`; the pane is then served by the web app under `/powerpoint/`.

PowerPoint only loads add-ins over HTTPS and never shows one by itself: it needs a manifest file. Quickest path from the desktop app: turn on **Share to phone on any network**, then menu → **PowerPoint add-in: save manifest…**; the file points at the public tunnel URL. Sideload it in PowerPoint for the web (Home → Add-ins → More Add-ins → My Add-ins → Upload My Add-in) or, on Windows, through a trusted shared folder (steps in the add-in README). The tunnel URL changes each time sharing restarts, so this is for trying it out; for a permanent install deploy on your server with HTTPS, set `PUBLIC_ORIGIN=https://your-domain` in `.env`, and the same menu item writes a manifest for that domain.

## Script format

`script.md` (also editable from the **Edit points** button in the app):

```md
# Section title
- first talking point
- second talking point

# Next section
- another point
```

Web mode reads `script.md` in the project folder. The desktop app reads it from its config folder. Override with the `INTELLIPROMPTER_SCRIPT` environment variable (absolute path).

---

## Project layout

```
apps/web/                 Next.js app: UI, /mirror PWA, API routes (decide, stt tokens, script)
apps/server/              session relay (ws): pairing codes, roles, fan-out. Bundled to dist/bundle.js
apps/desktop/             Electron shell: runs both servers in-process, LAN or hosted mode
packages/core/            types, script parser, decision prompt, Engine class (+ tests)
packages/stt/             browser transcription backends and Auto selection
packages/client/          session client for views and engines (browser + React Native)
packages/ui/              StageView and friends (web only)
scripts/                  prepare-standalone.js, make-icon.js
docs/reviews/             EGM goldfish review reports
ARCHITECTURE.md           the design: session protocol, Screen Sense, add-ins, mobile, roadmap
```

---

## Troubleshooting

**"OPENROUTER_API_KEY is not set"** – web: fill `.env.local` and restart `npm run dev` / the systemd service. Desktop: edit `.env` in the config folder (menu → Open config folder) and relaunch.

**Microphone never asks for permission on the server deploy** – you are on plain HTTP. Browsers only expose the mic on HTTPS or `localhost`. Use the Caddy steps or an SSH tunnel.

**Auto mode says "skipped: not-allowed"** – the browser blocked the mic. Click the camera/mic icon in the address bar and allow it, then press Start take again.

**Desktop app: "no transcription backend available"** – add an ElevenLabs or OpenAI key in `.env`. Web Speech does not exist inside the desktop app.

**Points never flip to STARTED** – check the footer: `CALLS` should be climbing. If it is 0, the decide route is failing; the error chip at the top shows why. If calls climb but nothing flips, say the idea more directly or lower `START_THRESHOLD` in `components/Teleprompter.tsx`.

**Port 4747 already in use** – web: change `-p 4747` in `package.json` scripts. Desktop: set the environment variable `INTELLIPROMPTER_PORT` before launching.

**Windows SmartScreen / macOS Gatekeeper blocks the app** – the builds are unsigned. See the notes in [Desktop app: install and run](#desktop-app-install-and-run).
