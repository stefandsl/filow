# Intelliprompter for PowerPoint

A task pane add-in. Your **speaker notes become the script**: one slide = one section, and every note line starting with `-` is a talking point. While you edit, the pane follows the selected slide and the engine follows the pane; with a slide-sourced script, moving to the next section in Intelliprompter selects the next slide.

## What it can and cannot do

| | |
|---|---|
| Load script from notes | yes, PowerPoint for the web and Microsoft 365 builds with `PowerPointApi 1.8` (older builds cannot expose notes to add-ins; the pane says so) |
| Follow the selected slide in Normal view | yes, both directions |
| Run the microphone and the decision loop in the pane (**Engine mode**) | Windows (WebView2 runtime, Microsoft 365 Current Channel) and PowerPoint for the web. On Mac the pane cannot use the microphone, so it runs in View mode |
| Mirror a session from the laptop or phone (**View mode**) | everywhere, pair with the 6-digit code |
| Follow or control a running **Slide Show** | **no**. The PowerPoint JavaScript API has no slide-show events or navigation, and task panes are hidden during a show. On stage, use the phone mirror or the desktop app |

## Development

Prerequisites: Node 22, the repo installed (`npm ci` at the root), and the servers running:

```bash
npm run dev            # web app on 4747 + session relay on 4748
```

One-time: install a trusted localhost certificate (Office refuses plain HTTP panes):

```bash
npm run certs -w apps/powerpoint
```

Then serve the pane:

```bash
npm run dev -w apps/powerpoint      # https://localhost:3000, proxies /api and /ws to the local servers
```

`manifest.xml` already points at `https://localhost:3000`. Sideload it:

- **PowerPoint for the web**: open a deck → Home → Add-ins → More Add-ins → My Add-ins → **Upload My Add-in** → choose `apps/powerpoint/manifest.xml`.
- **Windows desktop**: share a folder (right-click → Properties → Sharing), put `manifest.xml` in it, then in PowerPoint File → Options → Trust Center → Trust Center Settings → Trusted Add-in Catalogs → add the share's path and tick *Show in Menu*. Restart PowerPoint → Insert → My Add-ins → Shared Folder.
- **Mac**: copy `manifest.xml` to `~/Library/Containers/com.microsoft.Powerpoint/Data/Documents/wef/`, restart PowerPoint → Insert → My Add-ins (View mode only on Mac).

Microsoft's full sideload guide: https://learn.microsoft.com/office/dev/add-ins/testing/test-debug-office-add-ins

## Production

The pane is static files served by the Intelliprompter web app under `/powerpoint/`, so it shares the origin with the API and the relay (no CORS, keys never leave the server).

```bash
npm run build -w apps/powerpoint                      # → apps/web/public/powerpoint/
node apps/powerpoint/scripts/manifest.js https://prompter.example.com
```

Deploy the web app as in the root README (the `/powerpoint/` files ship with it), then distribute `apps/powerpoint/dist/manifest.prompter.example.com.xml`:

- for yourself: sideload as above;
- for a company: Microsoft 365 admin center → Settings → Integrated apps → Upload custom apps (centralized deployment).

`ACCESS_PASSWORD` on the server is required for Engine mode on a hosted deployment; the pane asks for it once.

## Writing notes that work

```
Say hello and thank the host             ← ignored (prose)
- introduce the three problems           ← point
- show the demo of the mirror            ← point
* mention the cost per talk              ← point (any of - * •)
```

## Files

- `manifest.xml` – dev manifest; `scripts/manifest.js <origin>` writes a production one
- `src/office.ts` – `readNotesAsScript`, `onSelectionChange`, `selectSlide`, host detection
- `src/notes.ts` – pure notes → script conversion (tested)
- `src/taskpane.tsx` – the pane: Engine mode and View mode, both using `StageView` from `packages/ui`
- `vite.config.ts` – dev server with HTTPS + proxy; production build into `apps/web/public/powerpoint/`
