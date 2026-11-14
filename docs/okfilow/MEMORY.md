# OK Filow: "Remember things about me"

Owner decision 14/11/2026 (G2). Opt-in, off by default.

## What it does

- **Learn.** After an answer, the user's own question (never the screen, the answer, selected text,
  a web page or the earlier conversation) is read by the model of the route the answer took, with
  `LEARN_SYSTEM` (`apps/web/lib/buddy/memory.ts`, route `/api/buddy/memory`). It proposes at most 3
  lines, `ANSWER:` (how to answer) or `ME:` (about the user).
- **Keep.** The desktop app decides what is kept (`apps/desktop/okfilow-memory.js`, the only writer):
  at most 3 new facts per answer, each at most 140 characters, no duplicate, and none that names a
  password or code, holds 4 digits or more or a letters-and-digits code, an e-mail, link or site,
  another person (family, work, friends, in the five languages), or words that are mostly not in the
  question. A question that names a password teaches nothing. The question kept next to each fact has
  numbers, codes and addresses masked.
- **Recall.** For each question: the "how to answer" facts first (newest first), then the facts
  that share the most words with the question (Japanese by pairs of characters), at most 5, in one
  short block at the end of the answer's system prompt (`memoryBlock`).
- **Where.** One file, `okfilow-memory.json`, in the app profile (`userData`). Never synced, never
  sent anywhere by the desktop app. The log says how many facts were kept, never which.
- **Settings.** The switch, then the list: each fact, when and from which question it was learned,
  Delete for one, Delete all (after one question). Deleting the last fact removes the file. With the
  switch off nothing is recalled or learned; facts already kept stay listed until deleted.

## Leaving this PC

On "Answers from: Local" (this PC) nothing leaves. When the question goes out (cloud, FreeLLMAPI or
the user's own server), the saved preferences and the learning call need their own yes, kind
`memory` (`OUTBOUND.md` row 22): the notice says "your saved preferences", the key travels in
`x-filow-consent-memory` besides the question's `ask` key, and the server refuses (online) or drops
them (own server) without it. A no is remembered silently: questions go without them and nothing is
learned online. A phone's question and a continuation after Stop never use memory.

## Tests

`apps/desktop/okfilow-memory.test.ts` (off by default, nothing stored when off, forbidden fixtures,
Delete on disk, recall on a fixed set), `apps/web/app/api/buddy/memory.test.ts` (the gates and the
prompt), `apps/web/lib/buddy/memory.test.ts` (learning under `sending`, the notice, the OUTBOUND row),
`apps/web/components/memorySettings.test.tsx` (the list). Every rule was broken on its own once and
its test went red (mutation run of 14/11/2026: 34 of 34 caught, voice speed included).
