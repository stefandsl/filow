# Filow privacy policy

Last updated: 10 November 2026. This text describes what the Filow app really does, checked against
its code (the full technical list is docs/okfilow/OUTBOUND.md in Filow's source code). It is also
available in Italian: set Filow's language to Italian.

> Parts in double square brackets, like [[this]], are not filled in yet. Only the publisher can fill them in, before release.

## In short

- Filow works on your computer. There is no account and no sign-up.
- **No telemetry.** Filow does not send us how you use it, what you say or what is on your screen.
- Your script, your voice and your screen stay on your computer unless you turn on a cloud feature.
  Before the first time anything of yours goes to a cloud service, Filow tells you what goes where and waits
  for your answer. While it sends, it shows "Going outside".
- **One exception today:** the public link for your phone is on by default (see "The public link").
- You can delete everything Filow keeps (see "How to delete your data").

## Who is responsible

The publisher of Filow is the data controller for the few things that reach the publisher (see
"What reaches us").

- Name: [[publisher's legal name]]
- Address: [[postal address]]
- Contact for privacy questions: [[e-mail address]]

For the cloud services you choose to use (listed below), the company running that service decides
what it does with the data it receives. Its own privacy policy applies.

## What reaches us

Almost nothing:

- **Update check.** About 8 seconds after start (not in offline mode), Filow asks GitHub (github.com,
  run by GitHub, Inc.) whether a newer version exists, and downloads it if so. GitHub sees your IP
  address and the app version, like any download. We only see download counts.
- **A problem report you choose to post.** "Report a problem" makes the report on your computer and
  shows you every line of it first. In the logs, public links, keys, e-mail addresses, local network
  addresses and your user name in folder paths are masked; what you write yourself stays as you wrote
  it. Filow never sends it by itself. You can save
  it to a file, or press "Open an issue on GitHub": your browser then opens a new issue on Filow's
  GitHub page ([github.com/stefandsl/filow/issues](https://github.com/stefandsl/filow/issues), run by
  GitHub, Inc.) with what you wrote, the Filow version, your system and the end of two logs (the
  last take and the start-up log) already filled in (a long report is shortened). That text reaches GitHub as soon as the page opens. Once you
  post the issue it is **public**: anyone can read it, next to your GitHub account name. We use it
  only to fix the problem. You can edit your issue on GitHub at any time, and ask us there to delete
  it. Crash files are never part of it.

The GitHub issues page is also where to ask for help with Filow.

We do not sell or share any data, show no ads and use no analytics.

## What stays on your computer

Filow keeps its files in one folder, the "config folder". Open it from the Filow menu with "Open
config folder". The usual places are:

| System | Config folder |
|---|---|
| Windows | `%APPDATA%\@filow\desktop` |
| macOS | `~/Library/Application Support/@filow/desktop` |
| Linux | `~/.config/@filow/desktop` |

| What | File or place | Why |
|---|---|---|
| Your talking points | `script.md` | the script you present from |
| Your settings and consent answers | `settings.json` and the app's browser storage | so Filow remembers your choices |
| API keys you added | `.env` (the key lines are blanked) and `secrets.json`, encrypted with your system's key store | so cloud features you chose can work |
| A technical log | `startup.log` | which start-up steps ran and which errors happened; it can contain folder names |
| Crash files | `Crashpad` folder | made when part of the app crashes; never uploaded; they can contain parts of what was in memory or on screen |
| Speech and voice models | `models` folder | speech-to-text and the natural voice run on your computer |
| Helper tools | `bin` folder | the Cloudflare link tool and the Ollama installer, when you use them |
| PowerPoint add-in files | `certs` and `powerpoint` folders | a certificate for "localhost", trusted for your user, so PowerPoint can load the add-in |
| OK Filow's recent questions | the app's browser storage | the last 12 questions and answers, to show them again |
| OK Filow helper jobs | `okfilow-agents` folder | files made by a coding helper you started |
| OK Filow answers | a folder you choose | only if you turn on "Save each answer with its screenshot"; off by default |

Local AI models installed through Ollama live in Ollama's own folder (`~/.ollama`), not in Filow's.

**Your voice is not recorded to a file.** Speech is turned into text in memory and the audio is
dropped. The live transcript of a take lives in memory and is gone when you close Filow.

## When something leaves your computer

Each of these happens only when you use the feature, and (except where noted) only after you said
yes in Filow's notice, which names the company before anything is sent. You can withdraw a yes in
OK Filow's settings. Cloud features use your own account with that company.

| Feature | What is sent | To whom |
|---|---|---|
| OK Filow, cloud answers | your question and pictures of your screens | OpenRouter, then the maker of the model you chose (for example Google) |
| OK Filow, cloud voice | the text of each answer | ElevenLabs |
| OK Filow, pictures on answer cards | the name of the card's subject | Wikipedia |
| OK Filow, coding helper | the task and the last answer | OpenAI (Codex) or Anthropic (Claude Code), through their command-line tools |
| Take, cloud speech-to-text | live microphone audio | ElevenLabs or OpenAI |
| Take, "browser" speech-to-text | live microphone audio | the browser's maker (Google for Chrome and Filow's window, Microsoft for Edge, Apple for Safari); the browser sends it, so Filow can warn you but cannot block it |
| Take, cloud tracking | the words you spoke, with names, numbers and addresses masked first | OpenRouter then the model's maker, or Cloudflare |
| Take, Screen Sense | pictures of the screen you share | OpenRouter, then the model's maker |
| Script translation | your script | OpenRouter, then the model's maker |
| Script from slides (PowerPoint add-in, browser extension) | slide text and pictures | OpenRouter, then the model's maker. These two do not show the notice yet, so their cloud requests are refused and only their local mode works |
| Model check in Settings (no notice: nothing of yours is in it) | a fixed sample request, to see which cloud model answers | OpenRouter, then the model's maker |
| Report a problem, "Open an issue on GitHub" (the notice is next to the button, every time; nothing is sent before your click) | what you wrote, the Filow version, your system and the end of the last take's log and of the start-up log, masked as described above | GitHub, in your own browser; once you post the issue, anyone (issues are public) |
| Downloads (speech models, Ollama, the link tool, updates) | no content of yours, only the request | github.com, ollama.com and the model hosts named in the download window |
| Spelling check in text boxes, on Linux only | no content of yours: the window's built-in spelling checker may download its dictionary | Google, which hosts the dictionaries for Chromium (not yet checked on a Linux desktop) |
| FreeLLMAPI, when you chose it (OK Filow answers, take tracking, script writing and translation) | the same content as the cloud feature it replaces: your question and pictures of your screens, the words you spoke (masked as above), your script or slides | your own FreeLLMAPI router, then a free AI provider the router picks for each request |
| "Check connection" in Settings > FreeLLMAPI (no notice: nothing of yours is in it) | a request for the router's list of models | your FreeLLMAPI router only |

OpenRouter passes your request to a company that runs the model. For Google's models that is Google;
for other models it can be another company that OpenRouter picks.

**FreeLLMAPI** is a separate free app (github.com/tashfeenahmed/freellmapi) that you install and run
yourself, on this computer or another one on your network; Filow does not install it. It is meant for
a computer that is not powerful, when privacy is not your main concern. The router is yours, but it
passes each request on to one of many free AI providers, with your own keys for them, and Filow
cannot know in advance which one. Free tiers often keep what they receive and may use it to train
their models. Filow treats it like any other cloud: it asks before the first send, shows "Going
outside - Sending to FreeLLMAPI (a free provider it chooses)" every time, never switches to it by
itself and never falls back from it to another cloud. Its key is stored encrypted on this computer.
FreeLLMAPI's own description says it is for personal experimentation: a school or a company should
check the terms of the providers behind it before using it.

**Offline mode** (Filow menu) stops every request that would leave your computer, including the
update check and the public link.

## The public link

To let a phone on another network follow your talk, Filow opens a public link through Cloudflare
(trycloudflare.com). **Today this link is on by default and starts when Filow starts, without
asking.** While it is on, your script, the live transcript and the current slide pass through
Cloudflare's servers, and anyone who has the link and the 6-digit pairing code can open your
session. The take page shows a "public link" chip.

To turn it off: in the Filow menu, untick "Share to phone on any network". A phone on the same
Wi-Fi still works without it. Whether this link should be off by default is an open decision for
the publisher (decision D31).

## The phone mirror on your own network

So that a phone on the same Wi-Fi can open the mirror page, Filow's local server answers on your
local network. Pairing needs the 6-digit code shown on your screen. Nothing goes through the
internet for this.

## Children, students and classrooms

Filow has no accounts and does not ask for age. It is a tool a teacher or a student runs on a
computer, so:

- **In a school, the school decides.** When a teacher uses Filow with a class, the school is
  responsible for the students' data under its own rules; Filow keeps that data on the computer
  it runs on.
- **Students under 16:** in the European Union the age at which a young person can consent alone to
  online services is 16, or lower where a country sets it (14 in Italy, never below 13). Below that
  age, cloud features need the agreement of a parent or the school, and the cloud company's own
  terms may set a higher minimum age. Use Filow in local mode with the public link off, which needs
  nobody's data to leave the computer.
- Do not put students' personal details in a script or ask OK Filow about them with cloud answers on.
- In the United States, Filow collects no personal information from children under 13 itself;
  the same advice about cloud features applies.

[[The publisher's legal adviser should confirm this section for the countries where Filow is offered.]]

## How to delete your data

1. In the Filow menu, choose "Open config folder".
2. Quit Filow.
3. Delete that folder. This removes your script, settings, keys, logs, crash files and models.

Uninstalling Filow leaves this folder in place, so your settings survive a reinstall; delete it by
hand to remove everything. To remove the PowerPoint add-in and its certificate, use "Remove Filow
from PowerPoint on this PC" in the menu before you delete the folder. Data already sent to a cloud
service is held by that company: ask it to delete it.

## Your rights

You can ask us what we hold about you (normally nothing, or an issue you posted on GitHub), ask us to correct
or delete it, and object to its use. Write to [[e-mail address]]. You can also complain to your data
protection authority ([[the authority where the publisher is established, for example the Garante
per la protezione dei dati personali in Italy]]).

## Changes

When what Filow sends or keeps changes, this policy changes with the same app version, and the date
at the top changes. The policy shipped inside the app always matches that version of the app.
