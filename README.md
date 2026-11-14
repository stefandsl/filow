<p align="right"><strong>English</strong> · <a href="README.it.md">Italiano</a></p>
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="brand/png/filow-primary-light.png" />
    <img src="brand/png/filow-primary-dark.png" width="520" alt="Filow" />
  </picture>
</p>

<p align="center"><strong>Speak freely. Stay on point.</strong><br/>
Filow is a live speaking companion: it listens as you present, checks off your talking points as you cover them, and shows what you missed. Not a scrolling teleprompter.</p>

<p align="center">
  <a href="https://github.com/stefandsl/filow/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/stefandsl/filow?display_name=tag&label=download&color=FFB600" /></a>
  <a href=".github/workflows/desktop.yml"><img alt="Desktop builds" src="https://img.shields.io/github/actions/workflow/status/stefandsl/filow/desktop.yml?label=build" /></a>
  <img alt="Platforms" src="https://img.shields.io/badge/Windows%20%7C%20macOS%20%7C%20Linux-desktop-08090B" />
  <img alt="Phone mirror" src="https://img.shields.io/badge/Android%20%7C%20iOS-phone%20mirror-08090B" />
  <img alt="PowerPoint" src="https://img.shields.io/badge/PowerPoint-add--in-b7472a" />
  <img alt="Languages" src="https://img.shields.io/badge/UI-English%20%7C%20Italiano-4ad67a" />
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-GPL--3.0-4ad67a" /></a>
</p>

<p align="center"><sub>Free software, © 2026 Stefan Butnaru (VoidExploit), released under the <a href="LICENSE">GNU General Public License v3.0 or later</a>. Installers before v0.9.18 still show the earlier proprietary (or, up to v0.6.0, MIT) text in their licence page; from v0.9.18 the installer carries the GPL notice.</sub></p>

<p align="center">
  <a href="https://github.com/stefandsl/filow/releases/latest">Download</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#screen-sense">Screen Sense</a> ·
  <a href="#phone-mirror-and-remote">Phone mirror</a> ·
  <a href="#powerpoint-add-in">PowerPoint</a> ·
  <a href="#local-mode-privacy">Privacy</a> ·
  <a href="ARCHITECTURE.md">Architecture</a>
</p>

---

> **Renamed from Intelliprompter in 0.8.0.** Existing installations keep working: the app moves its profile (keys, script, certificates, add-in files) to the new folder on first start, accepts the old `INTELLIPROMPTER_*` environment names, upgrades over the old install, and re-registers the PowerPoint add-in. The old GitHub URLs redirect to the new ones. On a Debian server rename the systemd units at your convenience (see the deploy section); the old unit names keep running.

## The problem: scripts make you sound like you are reading

A classic teleprompter scrolls text at a fixed speed and you chase it. The moment you improvise, tell a story or answer a question, the prompter and you drift apart, and the rest of the talk is spent finding your place. The alternative, bullet points on a card, keeps you natural but gives you no feedback: you only discover the point you skipped when the talk is over.

Filow keeps the bullet points and adds the feedback. It listens, and twice a second a small model answers one question per open point: *has the speaker started talking about this?* Paraphrases, examples and translations count; "I'll get to that later" does not. Points flip to **started** as you cover them, and the ones you skip pile up in a **Missed** tray so you can circle back before the end.

## What it does

The flat prompter uses one left sidebar layout in both dark and light themes, with the same controls. The single theme button cycles light, dark, then system; its icon and accessible label show the current choice. System follows the OS colours without moving controls. Pair device opens the mirror controls even when the relay is unavailable. Mode controls show short labels with full descriptions in tooltips. Points show Waiting, In progress, or Said with an icon, label, and progress bar; completed points are struck through and show a green tick. Import and Reload are in the sidebar, Edit points under the title, and Start/Stop in the bottom action bar. More contains Reset, Log and report a problem. Expand This computer for resources and model diagnostics. Transcript expands below the points, with its toggle in the action bar. The phone mirror keeps its layout.

The Next section card below the points has a resize handle along its bottom edge. Drag it, or focus it and use ArrowUp/ArrowDown in 16 px steps; double click resets to 240 px. Its height stays between 120 px and 70 percent of the content area (120 px takes priority in very short areas). Long content scrolls inside the card. Each viewer saves their height in `prefs:nextHeight`; resizing the window re-clamps that preference and restores it when space becomes available.

In the prompter and a controllable mirror, Tab focuses points and missed items. Press Enter or Space to toggle a point or reopen a missed item. Double-clicking a point still works.

A point is ticked only on what the speech-to-text has committed (a finished sentence), never on the words still being recognised: those can change ("we will raise prices" becoming "we will not raise prices"), so while they match an open point it only shows In progress. Before a point is ticked, its numbers, units, direction words and negation are compared with what you said: "costs rose 30%" never ticks "costs fell 30%", nor does "we did not cut costs", 21% for 12%, or days for hours. A done point has a **Why?** link (hover it, or click to open it under the point): the sentence it rests on, when it was heard, the model and how sure it was, and how many of the point's words were heard, or that you marked it by hand.

At high zoom or in a short window, the page scrolls to keep points and controls reachable. Start, screen-source and script-editor dialogs keep keyboard focus inside; Escape closes them and returns focus to the opener. Closing the log returns focus to More. Cancel also cancels pending automatic startup checks. Import failures appear immediately as an announced error above the points.

| | |
|---|---|
| ✅ **Live check-off** | Points are checked off as you cover them, judged by idea, not wording. Confidence shown per point. |
| ⚠️ **Missed tray** | Everything you jumped over, one click to re-open. |
| 👁 **Screen Sense** | Watches your slides or any window and tells you what is on screen, which facts you have not said yet, and when a slide contradicts your script. |
| 📱 **Phone mirror** | Scan a QR and your phone shows the live view with Prev / Next / Stop. Works from any network by default; you approve each phone. |
| 🖥 **PowerPoint add-in** | One click adds Filow to PowerPoint on this PC or Mac. Your speaker notes become the script, or the script is generated from the slides. |
| 🧩 **Browser extension** | reveal.js, Slidev, Marp, Canva, Pitch: generate the script from the deck and follow the live slide. |
| 📄 **Import** | PDF, PPTX, DOCX, TXT or Markdown become talking points, one section per slide or page. |
| 🔒 **Privacy modes** | On-device Whisper, a local decision model via Ollama, a PII guard before any cloud call, and a full offline mode. |
| 🌍 **English and Italian UI** | Automatic / English / Italiano; desktop windows and menus share one preference, browsers keep their own. |
| 🌗 **Light and dark theme** | ☀ / ◐ / ☾ toggle; "system" follows Windows or macOS. |
| 🔄 **Self-updating** | The desktop app checks GitHub and installs new versions itself. |

## First-run welcome

The desktop app opens **Welcome** before loading the main app or offering local AI setup.
Choose Automatic (OS language, Italian or English fallback), English, or Italiano; system theme
is on and system accent following is off by default. Turning system theme off keeps the current
appearance and reveals Light/Dark choices. Accent following uses your OS color with contrasting
text; off restores Filow yellow. Changes apply immediately to all desktop windows, independently
of the spoken-language setting. Browser and phone preferences remain separate.

**Get started** or the title-bar X saves completion once per profile. Reopen all four options from
**Filow > Welcome…** without interrupting a take. The startup switch is available in installed
Windows/macOS builds, never enables itself, and reflects OS startup settings; macOS may require
Login Items approval. Startup is hidden in development/Windows portable builds and on Linux;
Linux also hides system accent following. macOS login/accent behavior still needs real-device QA.

For isolated source testing, set `FILOW_USER_DATA_DIR` to an absolute path, for example
`G:\FILOW\tmp\welcome-qa`; both Electron userData and sessionData use it, with no legacy profile
import. Set TEMP/TMP and tool caches inside that QA folder too. Build with
`npm run build` and `npm run build:welcome -w apps/desktop`, then run `npx electron .` in
`apps/desktop`. `npm run start -w apps/desktop` rebuilds Welcome automatically. The flag is
`welcomeCompleted` in the profile's `settings.json`; an absent/false flag shows Welcome.

## Quick start

Choose **Microphone** in Settings beside the spoken language, or in the take action bar.
Grant microphone permission once to see device names. System default is the first option;
an unavailable saved device falls back to it and is noted in the take log. Changes during a
take apply at the next start. Web Speech always uses the system default.
Four seconds of digital silence or an ended input track shows an inline warning with a
microphone chooser, without stopping the take. Audio recovery clears the warning. Slow audio
context opening (over five seconds) is also reported with its measured time.
Streaming model downloads abort after 30 seconds without data, discard partial archives and
retry three times after 5, 15 and 45 seconds. A final failure is shown in Settings and startup.log.

1. **Download** the installer for your OS from the [latest release](https://github.com/stefandsl/filow/releases/latest) (`-win-x64.exe`, `-mac-arm64.dmg` / `-mac-x64.dmg`, `-linux-x86_64.AppImage` / `.deb`). Windows shows a SmartScreen warning because the build is not code-signed yet; see [Code signing](#code-signing-and-the-smartscreen-warning).
2. **Add your key**: menu → *Edit API keys (.env)* → paste an [OpenRouter](https://openrouter.ai/keys) key (a few cents per talk) → restart.
3. **Write points**: *Edit points*, or *Import document*, or just *Watch screen…* and let Screen Sense build a section per slide.
4. **Start take**, talk, watch the points check themselves off. Click the pairing code to put the same view on your phone.

## Why this is different

- **It judges ideas, not keywords.** The decision model gets the open points, the points already covered, the next section and what is on screen, and must prefer a false "not started" over a wrong check-off. Two confident calls in a row, or one very confident one, flip a point.
- **One engine, many views.** The laptop runs the microphone and the decisions; the phone, the PowerPoint pane and any browser are views of the same session through a small relay. Nothing is installed on the phone.
- **Your data stays yours by default.** Frames from Screen Sense live in memory and go once to the vision model; personal data is replaced by placeholders before any cloud call; speech and decisions can run entirely on your machine; offline mode blocks every outbound request.
- **No account, no server required.** Everything runs inside the desktop app, including the relay and, for pairing from other networks, a free Cloudflare quick tunnel. A Debian deployment is there when you want a permanent address.

---

## Table of contents

1. [How it works](#how-it-works)
2. [API keys you need](#api-keys-you-need)
3. [Desktop app: install and run](#desktop-app-install-and-run)
4. [Run from source on any machine (Windows, macOS, Linux)](#run-from-source-on-any-machine)
5. [Build the desktop installers yourself](#build-the-desktop-installers-yourself)
6. [Automatic updates](#automatic-updates)
7. [Code signing and the SmartScreen warning](#code-signing-and-the-smartscreen-warning)
8. [Deploy on a Debian server](#deploy-on-a-debian-server)
9. [Develop on a Debian server](#develop-on-a-debian-server)
10. [Local mode (privacy)](#local-mode-privacy)
11. [Screen Sense](#screen-sense)
12. [PowerPoint add-in](#powerpoint-add-in)
13. [Script format](#script-format)
14. [Project layout](#project-layout)
15. [Troubleshooting](#troubleshooting)

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

With **Auto** the start mode (auto, local, cloud or ask, in Settings) decides, and the prompter picks one backend when the take starts: a local take uses the speech model on this PC (sherpa), else on-device Whisper; a cloud take uses ElevenLabs, else OpenAI, else the browser. The prompter does not switch to another backend during a take; the log at the bottom names the one in use. Only the PowerPoint pane tries the backends in turn, skipping one that errors or gives no words within 8 s (30 s for Whisper).

API keys never reach the browser: the server mints short-lived tokens for the streaming backends and calls OpenRouter itself.

### Presenting with PowerPoint (desktop app)

PowerPoint hides task panes during a slide show and its add-in API cannot see the show, so the desktop app does two things on its own:

- **It follows the show.** On Windows the app asks PowerPoint over COM (the channel Presenter View uses) which slide is on screen, every 0.4 s; on macOS the same through AppleScript. When the show starts, the current section jumps to the slide and keeps following; a "📽 slide n/m" chip shows in the top bar. The script must come from the slides (speaker notes or **Generate script from slides** in the pane) so slide and section numbers line up.
- **It shows a presenter overlay.** A small always-on-top window with the slide's title and its points, checked off as you say them, plus the next slide's title. It opens by itself when a show starts and closes when it ends (menu: *Presenter overlay*, *Open the overlay automatically*). Drag it anywhere, usually on the laptop screen next to Presenter View; *Hide the overlay from screen recordings and shares* keeps it out of Teams or OBS. The overlay is a compact view of the app's own session, so what you see on it is exactly what the phone sees.

Linux has no PowerPoint; there the phone mirror is the live view.

### Phone mirror and remote

The engine (the browser or desktop app with the microphone) creates a **session** on the session relay and shows a 6-digit code in the top bar. Click it for a QR. A phone opens the mirror page, enters the code (or scans the QR), and gets the live view with big type plus Prev / Next / Reset / Start / Stop buttons. The mirror is a web page, so nothing to install; on Android or iOS use "Add to Home Screen" for a full-screen app.

How pairing is protected: a code works **once** and for **5 minutes** (the dialog shows the countdown and a New code button; a second phone needs a new code). A phone that pairs through the public link is **pending** until you accept it: the app shows the device ("iPhone · Safari") with Allow / View only / Reject, and the phone sees nothing until then. Phones on the same Wi-Fi as the desktop app are let in without the prompt. Pairing attempts are limited per address and globally, and the phone page never connects to a server other than its own without asking you.

- Web mode: the relay is `apps/server` on port 4748, started by `npm run dev` together with the web app.
- Desktop app: the relay runs inside the app. The QR carries your laptop's LAN address. The first launch triggers one Windows firewall prompt.
- Hosted server: see the Debian section; set `ACCESS_PASSWORD` so strangers cannot spend your credits.

#### Phone on another network

A phone on mobile data, or on an office Wi-Fi that isolates clients, cannot reach your laptop's address. Three ways, in order of effort:

1. **Public link, on by default** in the desktop app. On first start the app downloads Cloudflare's free `cloudflared` once (about 20 MB, shown as "Setting up the public link…" in the pairing dialog), opens two quick tunnels and refreshes the QR; it then carries random `https://….trycloudflare.com` URLs that work from anywhere, like WhatsApp Web. The pairing dialog says "Works from any network" when it is ready, or why it is not (no internet, download blocked), in which case the QR keeps working on the same Wi-Fi. Turn it off in the dialog ("Back to Wi-Fi only"), with the ✕ on the "public link" chip in the top bar, or in the menu; the tunnel also stops when the app quits. Quick tunnels (`*.trycloudflare.com`) are meant for short tests: no uptime promise, a new URL every start. For talks that matter, run your own server (below) or a [named Cloudflare tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) with Cloudflare Access in front of the mirror page. Pairing still needs the 6-digit code, pairing is rate limited, and the spend endpoints stay behind the engine token. Turn it off from the same menu; the URLs change every time. Not available in Offline mode.
2. **Same VPN on both**: if the laptop and the phone run the same VPN (Tailscale, Twingate…), pick the VPN address in the menu **Mirror address on this network** and scan again. The app prefers a private LAN address by default, so a VPN address is never chosen automatically.
3. **Your own server**: deploy the Debian setup below and point the desktop app at it with `FILOW_SESSION_URL` in `.env`. Permanent URL, your own domain.

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
| Windows | `Filow-x.y.z-win-x64.exe` (the NSIS installer; the portable build has the same name pattern) | Unsigned: SmartScreen shows "unknown publisher". Click **More info → Run anyway**. |
| macOS | `Filow-x.y.z-mac-arm64.dmg` (Apple Silicon) or `-mac-x64.dmg` (Intel) | Unsigned: first launch is blocked. Run once in Terminal: `xattr -dr com.apple.quarantine /Applications/Filow.app` |
| Linux | `Filow-x.y.z-linux-x64.AppImage` or `.deb` | AppImage: `chmod +x` then run. Deb: `sudo apt install ./filow_x.y.z_amd64.deb` |

### The Windows installer

A step-by-step wizard in the language of your Windows (English, Italian, German, French, Spanish, Portuguese, Dutch, Polish, Russian, Japanese, Chinese; the custom pages are in English and Italian): welcome, licence (proprietary, © VoidExploit), install folder, a **Local AI on this PC** page (see below), then the finish page with **Run Filow** and **Create a desktop shortcut**. The app opens with a splash screen (logo, progress bar, "Local models · data stays on this PC · GDPR" when it runs locally, "PII guard on · GDPR" otherwise) while the servers and the public link start, then goes to Settings to fetch the models you ticked.

#### Local AI chosen from your hardware

The installer runs a quick scan (RAM, GPU name, free disk on your profile drive) and preselects the models that run well on that machine; the page shows the scan result and lets you tick or untick anything, so nothing is forced:

| This PC | Preselected |
|---|---|
| 32 GB RAM or more | Whisper small, Clef Flash (local decisions), Gemma 4 E4B (script from slides) |
| 16 GB | Whisper small on a real GPU (NVIDIA, Radeon, Arc, Iris Xe) else Whisper base, Clef Flash, Gemma 4 E2B |
| 8 GB | Whisper base, Gemma 4 E2B |
| less | Whisper base |

The biggest Ollama models are dropped when the disk would end up with less than 3 GB free. **Install Ollama in the background** is ticked whenever a Clef or Gemma model is: on first start the app downloads the official Ollama installer (about 1 GB), runs it silently, starts it, then pulls the chosen models while you use the app. The Settings page shows every step (downloading Ollama 42 % → installing → starting → ready → model pulls) and has the same **Install Ollama automatically** button for later. On macOS and Linux, or with the portable build, the app asks the same question in a dialog on first start (macOS: Ollama.app is unzipped into `~/Applications`; Linux: the official one-line install script is shown, since it needs sudo).

### First start

1. Launch the app. It shows a notice that no OpenRouter key is set.
2. Menu **Filow → Open config folder**. You get a folder with two files:
   - `.env` – paste your keys here (same format as `.env.example`)
   - `script.md` – your talking points (also editable from **Edit points** inside the app)
3. Save `.env`, quit and relaunch the app.
4. Press **Start take**, allow the microphone, talk.

Config folder locations:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\Filow\` |
| macOS | `~/Library/Application Support/Filow/` |
| Linux | `~/.config/Filow/` |

The desktop app has no Web Speech backend (Electron's Chromium ships without it), so set `ELEVENLABS_API_KEY` or `OPENAI_API_KEY`.

---

## Run from source on any machine

Prerequisites: **Node.js 22** (https://nodejs.org) and **git**. Chrome or Edge if you want the free browser transcription.

### Windows (PowerShell)

```powershell
git clone https://github.com/<you>/filow.git
cd filow
npm ci
Copy-Item apps/web/.env.example apps/web/.env.local
notepad apps/web/.env.local      # paste your keys, save
npm run dev             # web app (4747) + session relay (4748), hot reload
```

Open http://localhost:4747 in Chrome or Edge and allow the microphone.

### macOS / Linux

```bash
git clone https://github.com/<you>/filow.git
cd filow
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

Installers are unsigned unless you add a certificate; see [Code signing](#code-signing-and-the-smartscreen-warning).

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

## Automatic updates

Test builds packaged with `-c.extraMetadata.updates=false` do not check, download or install updates. The menu says updates are off; the owner supplies replacement installers.

The installed desktop app checks for a new version a few seconds after start-up and from the menu (*Check for updates…*). The update downloads in the background; you get "Restart now / Later", and an update you postpone installs itself the next time you quit. Windows and Linux (AppImage) update in place; macOS needs a signed and notarized build for in-place updates, so on a Mac the app only tells you a new version exists until that is set up.

The feed is a separate **public** GitHub repository that holds only the installers. It was set up while this source repository was private (an installed app cannot read private releases without shipping a secret); the source has been public since 2026-11-03, and the feed stays where installed apps look for updates. One-time setup, from a machine where `gh` is logged in:

```bash
gh repo create stefandsl/filow-releases --public --description "Filow installers (auto-update feed)"
```

CI uploads installers only to the source release. The owner uses `tools/release/release.ps1` to verify the build, create a feed draft, require a clean Windows install/start smoke test, and set Latest last. No `RELEASES_TOKEN` is used by CI. Follow [the release checklist](docs/RELEASE-CHECKLIST.md) for preflight, publication and recall. The updater explicitly refuses automatic downgrades; a recall does not undo an already installed or downloaded update.

## Code signing and the SmartScreen warning

Windows shows "Microsoft Defender SmartScreen couldn't verify this file" for any installer that is not code-signed and not yet downloaded by many people. The warning cannot be removed by changing the installer; it goes away when the build is signed with a certificate that Windows trusts:

| Option | Cost | SmartScreen reputation | Notes |
|---|---|---|---|
| **Azure Trusted Signing** | about 10 €/month | immediate | Needs an Azure account and identity validation (individuals accepted). Recommended. |
| **EV code-signing certificate** | 300–500 €/year | immediate | Hardware token or cloud HSM; the CI needs a signing service. |
| **OV code-signing certificate** | 100–250 €/year | builds over weeks of downloads | Simplest to wire: a `.pfx` file. |

For a `.pfx` certificate, the workflow is already prepared: store the file and its password as repository secrets and every tagged build is signed.

```bash
base64 -w0 your-certificate.pfx | gh secret set WIN_CSC_LINK --repo stefandsl/filow
```

```bash
gh secret set WIN_CSC_KEY_PASSWORD --repo stefandsl/filow
```

For Azure Trusted Signing, add to `apps/desktop/package.json` under `build.win` an `azureSignOptions` block with your `publisherName`, `endpoint`, `certificateProfileName` and `codeSigningAccountName`, and the secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` as workflow env; electron-builder signs with them. Set `build.win.publisherName` to the exact name on the certificate so the updater can verify downloaded installers.

On macOS the equivalent is an Apple Developer ID certificate plus notarization (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`) and removing `CSC_IDENTITY_AUTO_DISCOVERY: "false"` from the workflow.

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
sudo useradd -r -m -d /opt/filow -s /usr/sbin/nologin prompter
sudo -u prompter git clone https://github.com/<you>/filow.git /opt/filow/app
```

Private repo? Create a fine-grained **read-only** personal access token on GitHub and clone with it instead:

```bash
sudo -u prompter git clone https://<you>:<TOKEN>@github.com/<you>/filow.git /opt/filow/app
```

### 3. Keys and build

```bash
cd /opt/filow/app
sudo -u prompter cp apps/web/.env.example apps/web/.env.local
sudo -u prompter nano apps/web/.env.local        # paste keys, Ctrl+O, Enter, Ctrl+X
sudo -u prompter npm ci
sudo -u prompter npm run build
```

### 4. systemd service (starts on boot, restarts on crash)

```bash
sudo tee /etc/systemd/system/filow.service >/dev/null <<'EOF'
[Unit]
Description=Filow (Next.js)
After=network.target

[Service]
Type=simple
User=prompter
WorkingDirectory=/opt/filow/app
EnvironmentFile=/opt/filow/app/apps/web/.env.local
Environment=NODE_ENV=production
Environment=PORT=4747
Environment=HOSTNAME=127.0.0.1
ExecStart=/usr/bin/node apps/web/.next/standalone/apps/web/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
sudo tee /etc/systemd/system/filow-session.service >/dev/null <<'EOF'
[Unit]
Description=Filow session relay
After=network.target

[Service]
Type=simple
User=prompter
WorkingDirectory=/opt/filow/app
EnvironmentFile=/opt/filow/app/apps/web/.env.local
Environment=NODE_ENV=production
Environment=SESSION_PORT=4748
Environment=SESSION_HOST=127.0.0.1
Environment=TRUST_PROXY=1
ExecStart=/usr/bin/node apps/server/dist/bundle.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now filow filow-session
sudo systemctl status filow filow-session --no-pager
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

### Upgrading a server that was deployed as Intelliprompter

The old unit names, folder and `.env.local` keep working (the app reads both `INTELLIPROMPTER_*` and `FILOW_*` names). To align the names with the new ones:

```bash
sudo systemctl disable --now intelliprompter intelliprompter-session
```

```bash
sudo mv /opt/intelliprompter /opt/filow && sudo mv /etc/systemd/system/intelliprompter.service /etc/systemd/system/filow.service && sudo mv /etc/systemd/system/intelliprompter-session.service /etc/systemd/system/filow-session.service
```

```bash
sudo sed -i 's#/opt/intelliprompter#/opt/filow#g; s/INTELLIPROMPTER_/FILOW_/g' /etc/systemd/system/filow.service /etc/systemd/system/filow-session.service /opt/filow/app/apps/web/.env.local
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now filow filow-session
```

Then pull from the renamed repository (`git remote set-url origin https://github.com/stefandsl/filow.git`; the old URL redirects anyway) and rebuild.

### Update to a new version

```bash
cd /opt/filow/app
sudo -u prompter git pull
sudo -u prompter npm ci
sudo -u prompter npm run build
sudo systemctl restart filow filow-session
```

### Logs

```bash
sudo journalctl -u filow -f
sudo journalctl -u filow-session -f
sudo journalctl -u caddy -f
```

---

## Develop on a Debian server

For hacking on the code on a remote Debian box with hot reload, instead of (or next to) the production service.

```bash
sudo apt update && sudo apt -y install git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt -y install nodejs
git clone https://github.com/<you>/filow.git ~/filow
cd ~/filow
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

Working with VS Code: install the **Remote - SSH** extension, connect to the server, open `~/filow`. The port is forwarded automatically when you run `npm run dev` in the integrated terminal.

---

## Local mode (privacy)

Open **Settings** in the app (or `/settings/local`). You can run the decision model on your own machine with [Cloudflare Clef](https://ollama.com/library/clef-flash) through Ollama: install Ollama 0.35.1 or newer, press **Pull** next to Clef Flash (about 11 GB on disk, about 12 GB of VRAM or RAM while running, so a 12 GB card or a 16 GB PC; Clef 27B needs 32 GB), press **Test**, then choose "Clef on this machine" as the decision provider. Nothing leaves the computer for the decisions. The desktop app also has an **Offline mode** menu toggle that blocks every outbound request and forces local providers. Speech can also stay on the device: pick **Whisper on this device** in the transcription dropdown after downloading a Whisper model in Settings (150 MB for base, cached by the browser; WebGPU when available). Before any cloud call, the **PII guard** replaces emails, phones, IBANs, card numbers and codice fiscale with placeholders, and names, addresses and 22 Italian categories too when the [Rizzo-PII](https://github.com/Rizzo-AI-Academy/rizzo-pii) server runs locally (`docker run -p 127.0.0.1:5005:5005 rizzo-pii`). See ARCHITECTURE.md §6.10.

On a Debian server, run Ollama on the same box and set `OLLAMA_URL=http://127.0.0.1:11434` and `DECISION_PROVIDER=clef-local` in `apps/web/.env.local`.

With `FILOW_OFFLINE=1`, script translation and cloud speech tokens are unavailable, and the PII server health probe is skipped. Generation uses the configured Ollama without a cloud fallback; document import parses files locally. The desktop keeps offline settings from the profile `.env`, stops active public tunnels when offline is enabled, and refuses speech-model downloads and Ollama installation with an explanatory message. **Report a problem** offers to copy the report to the clipboard for later review instead of opening a browser. Install models before going offline. The local-model **Pull** endpoint still delegates to Ollama on this machine; Ollama manages its own model downloads.

## Screen Sense

Screen Sense lets the engine see what the audience sees (ARCHITECTURE.md §6). Press **Watch screen…** and pick a screen or a window (PowerPoint, a browser, a PDF). Once a second a 16×16 thumbnail is compared with the last frame sent; only a real change (new slide, new page) sends one full frame to a multimodal model on OpenRouter (`OPENROUTER_VISION_MODEL`, default `google/gemini-2.5-flash`), at most 20 frames a minute. The answer appears in the **ON SCREEN** strip: what the slide shows, up to three points to make, the numbers and names visible, and a mismatch warning when the slide contradicts your script. Facts you have not said yet are highlighted (the decision model sees them as a fourth list and reports what is still unmentioned). With no script loaded, each slide becomes a section with its points, so you can present from the slides alone.

- **Cost dial** (dropdown next to the button, or Settings): Off, On slide change, Balanced (also when you say "as you can see", "in questa slide", "en esta diapositiva"…), Real-time (every few seconds while the content keeps changing, for demos). The footer shows the frames sent and their cost; they count against the same $1 session cap as decisions.
- **Look now** sends the current frame at once. From the phone mirror it does the same.
- **Region… / hotkey** (desktop app only): `Ctrl+Shift+Space` (change it in Settings) dims the screen; drag a rectangle and only that region is sent. Works outside a take too.
- **Forget** drops every screen summary and note for this session.
- **Export notes** appears after Stop take: a Markdown file with one entry per slide, what was on screen and what you were saying at the time.
- **Import document** turns a PDF, PPTX, DOCX, TXT or MD file into talking points: one section per slide or page, PPTX speaker notes become the points and slide titles the section titles. You review the result before it replaces `script.md`. Scanned PDF pages have no text and are reported as warnings; add those points by hand.

Privacy: frames live in memory only, go once over HTTPS to the vision model and are dropped; nothing is written to disk or logged. Only the returned text is kept for the session, and the phone mirror and the PowerPoint pane receive that text, never images. The Filow window is excluded from the source list. In **Offline mode** Screen Sense is disabled (no local vision model ships yet). Screen content is untrusted: the prompt tells the model to treat text on the slide as data, never as instructions.

In the browser (not the desktop app) the browser's own share picker is used, and there is no region hotkey.

### Automatic setup (model router)

Start mode **Auto** asks the router at every Start: it looks at the models installed, what the
machine can hold (GPU memory, RAM) and the keys configured, runs one real decision call on each
candidate (local Clef, OpenRouter) and picks the lowest-latency setup per task: speech
(Nemotron streaming on the PC, ElevenLabs, OpenAI, Whisper, browser), decisions (Clef on the PC or
cloud; local wins when measured within 20 % of the cloud), script generation (the biggest local
vision model that fits, else cloud) and Screen Sense. Settings shows the current plan with the
reason for each choice, the measured latency and the expected "said to ticked" time; **Measure now**
re-runs the probes. A chip in the top bar shows what the take is using.

### Streaming speech-to-text on this PC (desktop app)

Settings lists **Nemotron 3.5 streaming speech-to-text** (NVIDIA, 450 MB download): the desktop app
runs it with sherpa-onnx in a worker thread, so words appear as you say them and a sentence is
committed about 1.2 s after you pause, instead of Whisper's 4-second windows. It covers English,
Italian, Romanian and Russian (and more) and detects the language by itself, or follows the
**Spoken language** setting. Measured on a Core Ultra 7 laptop, CPU only: 105 ms of work per 560 ms
of speech on 4 threads (RTF 0.19), 2 s to load. Local mode picks it automatically when it is
downloaded; Whisper stays the fallback and the only option in the browser and the PowerPoint pane.

### Translate the points

In **Edit points**, pick a language (English, Italiano, Română, Русский, Deutsch, Français, Español)
and press **Translate**: the whole script comes back in that language with the same sections and
points, in the editor, and nothing is saved until you press Save. The status line names the model
and warns if the point count changed. It uses the OpenRouter key (same model as slide generation).

### Pre-filter before the model (embedding gate)

Settings has **Pre-filter before the model** under **More options**. It is on by default for new
installs; an install that used Filow before the setup profiles keeps the choice it had (off unless
you turned it on). On, a small multilingual sentence
model (paraphrase-multilingual-MiniLM, 120 MB, downloaded once into the browser cache) scores every
open point against the last few seconds of speech, on this PC, in a few milliseconds. The decision
model is then asked only about the plausible points (at most four) and not at all when nothing
matches. A lexical stage runs alongside it: names, numbers (said or written) and rare words of a point
heard in the speech make it a candidate even when the sentence model misses it. With the local model
(Clef) the pre-filter only decides whether to call the model, and then asks about every open point:
asking Clef about fewer points changed its answers and cost recall in the P1 gauntlet. Point vectors are prepared when a script loads and cached per script. Measured on the demo
corpus with a cloud model, two runs each: 3 of 17 model calls skipped, recall equal or better, no
false starts either way; the latency gain was within the provider's own variance, so expect the
benefit mainly in local mode, where each model call is the expensive part. Details and how to
rerun the comparison: `docs/gauntlet/BASELINE.md`.

## OK Filow, the screen helper

OK Filow is a helper in the desktop app that sees the screen under your mouse and answers out loud,
with a dot that can point at what it talks about. Gestures (any other key while a chord is down
cancels it):

- **Hold Ctrl+Alt** and speak to ask about what is on screen (the chord can be changed in its settings).
- **Hold Ctrl+Win** to dictate into the field that has focus, in any app; **tap Ctrl+Win twice** for hands-free.
- **Tap Ctrl twice** to open a text box and type the question instead.

Answers come from the model on this PC by default. Nothing leaves the PC without your yes: the first
time a screenshot, your voice or your words would go to a service, a notice says what goes where, and
every send shows "Going outside" while it lasts ([docs/okfilow/OUTBOUND.md](docs/okfilow/OUTBOUND.md)).
It speaks with a natural voice that runs on this PC, with the system voice as the fallback
([docs/okfilow/VOICE.md](docs/okfilow/VOICE.md)). Speech works in English, Italian, Russian, Romanian
and Japanese ([docs/stt/LANGUAGES.md](docs/stt/LANGUAGES.md)).

Screen marks follow the spoken sentences and keep their earlier positions as an answer grows. The pointer and its label travel together through clear space; a blocked route hides the pointer instead of covering detected text. The answer bubble grows smoothly (without size animation when reduced motion is enabled). The 3D view uses surface anchors and spaced leader lanes, with readable labels in both themes; empty model margins let clicks through.

When a target rectangle is available, the pointer lands on its corner and underlines it, with a visible ring in either theme. Model leaders use wider lanes and prefer anchors inside each visible part. The light model stage has a blue-grey background, stronger shell edges and a compact shadow.

## PowerPoint add-in

A task pane for PowerPoint lives in [apps/powerpoint](apps/powerpoint/README.md). Your speaker notes become the script (one slide per section, `-` lines are points), the pane follows the selected slide while you edit, and it runs the microphone itself on Windows and PowerPoint for the web or mirrors a session by code elsewhere. PowerPoint hides panes during a slide show and offers no API to follow one, so on stage the phone mirror or the desktop app is the live view. Build with `npm run build -w apps/powerpoint`; the pane is then served by the web app under `/powerpoint/`.

**Windows and macOS, one click.** On first start the desktop app asks "Add Filow to PowerPoint?". Yes creates a certificate for localhost and trusts it for your user (Windows: one confirmation dialog; macOS: the login-keychain password once), starts an HTTPS proxy on port 4749 in front of the app, and registers the add-in for PowerPoint: through Office's developer sideload key on Windows (HKCU, no admin) or the `wef` folder of the PowerPoint container on macOS. Restart PowerPoint and Filow is on the Home tab (Mac: Insert → My Add-ins). The pane talks to the app on this computer, so keep Filow running while you present; on a Mac the pane is a view (Office for Mac gives add-ins no microphone), so start the take in the app or from the phone. The menu has "Remove Filow from PowerPoint on this PC" to undo it, and the install item if you said "Not now".

**Other computers.** PowerPoint only loads add-ins over HTTPS and never shows one by itself: it needs a manifest file. From the desktop app: turn on **Share to phone on any network**, then menu → **PowerPoint add-in: save manifest for another computer…**; the file points at the public tunnel URL. Sideload it in PowerPoint for the web (Home → Add-ins → More Add-ins → My Add-ins → Upload My Add-in) or, on Windows, through a trusted shared folder (steps in the add-in README). The tunnel URL changes each time sharing restarts, so this is for trying it out; for a permanent install deploy on your server with HTTPS, set `PUBLIC_ORIGIN=https://your-domain` in `.env`, and the same menu item writes a manifest for that domain.

### Script from slides without notes

In the pane, **Generate script from slides** reads every slide (titles, text, tables, alt text, notes where the host exposes them) and asks the server for 3–5 spoken points per slide; slides with notes keep the notes. Slides with little text or a picture also send a small slide image so charts and numbers are read. You review the result in an editor before it replaces the script. Online it uses Gemini through OpenRouter (text through the PII guard); with Offline mode or `GENERATE_PROVIDER=ollama` it uses Gemma 4 E2B through Ollama (pull it in Settings > Local models; E4B on 16 GB, Qwen3-VL 2B as the light option). On this PC the pane joins the desktop app's session by itself; on another computer enter the pairing code.

## Browser extension (HTML slide decks)

For reveal.js, Slidev, Marp, impress.js, Canva and Pitch decks in the browser: the extension's side panel pairs with your Filow session, **generates the script from the deck** (it steps through the slides for you) and **follows** the live slide so the prompter, the phone and the check-off stay in sync. Install: download `Filow-extension-<version>.zip` from the release, unzip it, open `chrome://extensions` (or `edge://extensions`), turn on Developer mode, **Load unpacked** → the unzipped folder. Firefox: `about:debugging` → This Firefox → Load Temporary Add-on → `manifest.json`. Click the toolbar icon, enter the pairing code shown by the app (defaults point at the desktop app on this PC), then "Use this tab as the deck". No API keys live in the extension.

## Script format

`script.md` (also editable from the **Edit points** button in the app):

```md
# Section title
- first talking point
- second talking point

# Next section
- another point
```

Web mode reads `script.md` in the project folder. The desktop app reads it from its config folder. Override with the `FILOW_SCRIPT` environment variable (absolute path).

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
brand/                    brand kit (icon, wordmark, palette); `npm run icon` copies it into the apps
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

**Points never flip to STARTED** – check the footer: **Calls** should be climbing. If it is 0, the decide route is failing; the error chip at the top shows why. If calls climb but nothing flips, say the idea more directly or pass a lower `threshold` (default 0.7) / `sureThreshold` (default 0.85) where the Engine is created: `new Engine({ decide })` in `apps/web/components/useEngine.ts` (line 70), and in `apps/powerpoint/src/taskpane.tsx` for the PowerPoint pane.

**Port 4747 already in use** – web: change `-p 4747` in `package.json` scripts. Desktop: set the environment variable `FILOW_PORT` before launching.

**Windows SmartScreen / macOS Gatekeeper blocks the app** – the builds are unsigned. See the notes in [Desktop app: install and run](#desktop-app-install-and-run).

Pointer flights take at most 900 ms. Landing labels reserve 8 px around detected text and dividers; an underline is omitted beside a nearby divider. Light-theme arrival accents have dark outlines. Model part numbers and columns stay fixed during rotation and dragging. Rows may move when a fixed row would require a backward hook; rows and leader shapes ease over 160 ms. Routing runs in a worker so it cannot block the animation. Pointer flights approach monotonically with a gentle start, and light-theme leaders and the full-size landing ring have dark casings.

OK Filow answers, whiteboard lessons and agent jobs receive today's local date and weekday. This adds no other information about you or your PC.

At landing, the pointer tip stays on the target corner. The ring leaves the text-facing quadrant empty, the underline stops before it, and the arrow shadow disappears. Acceleration and braking keep pointer travel continuous.

### OK Filow response timing

OK Filow prepares its local answer model ahead of a question when memory allows.
On a small graphics card, it may wait until the question to avoid displacing the
model used for your presentation. The microphone closes when you release the
keys; Filow then finishes recognising your words before answering. The pointer
shows microphone opening separately from listening and thinking.
Local answers use a smaller screen image to reduce processing time. Online
answers keep the same image size. Named screen controls retain their original
positions for pointing.
