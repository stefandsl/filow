# Local date in OK Filow prompts

The date is computed from the clock of the process running Filow, using local
calendar fields, not UTC. A shared pure `withLocalDate(system, date)` function in
`apps/desktop/prompt-date.js` appends `Today's local date: YYYY-MM-DD (weekday).`
The caller supplies the Date. The helper reads no clock, locale, files or network.
Its English metadata does not override the existing answer-language instructions.
Nothing else about the person or PC is added.

Prompt inventory and insertion points:

- `lib/buddy/prompt.ts` builds words-only and screenshot answer instructions,
  including the optional phone quotation rule. `api/buddy/ask` also uses this
  builder for the narrow grounding question.
- `lib/buddy/providers.ts` sends these instructions through Ollama, FreeLLMAPI
  and OpenRouter. Append the date at each system-message boundary, including
  caller-supplied `AskShape.system`, so grounding and all whiteboard calls agree.
- `lib/whiteboard/generate.ts` builds template, narration, outline, rewrite,
  plan, repair, selection, whole-lesson, review, definition, arrow, link and legend
  instructions. `api/whiteboard/lesson` sends all of them through `askBuddy`, so
  they use that same insertion point, for local and online models alike.
- `api/whiteboard/look` and `edit` build separate inspection/edit instructions.
  They use `lib/whiteboard/local.ts`; append the date to its system message.
- `apps/desktop/okfilow-agents.js` builds the CLI job instructions. Insert the
  same helper's line after the static instructions, before screen context/task.
  Package the helper with the desktop app; the web build imports the same file.

Cache and warm-up: keep the complete existing system prefix byte-for-byte and
append the date after it, before any following conversation messages. A new day
invalidates only the suffix. There is no explicit provider cache breakpoint.
`warmLocalModel` currently sends an empty `/api/generate` request: it loads weights
without pre-filling any tokens. Its prompt prefix is empty, shared by real requests;
leave that weight-only operation unchanged. Any future prompt-prefilling warm-up
must use the real builder and same helper with the same language/screen options,
never a separate dated prefix. Tests pin this weight-only contract with mocked fetch.

Verification uses fixed local dates, the local midnight boundary, five UI
languages and mocked provider requests only. No model or paid API is needed.
