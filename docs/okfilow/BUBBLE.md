# OK Filow: the answer bubble

The bubble is the dark box next to the pointer that shows what OK Filow answers (and, while it
listens, the waveform or a dictation's words). Use X, Esc, a horizontal mouse shake or a short spoken close command with the talk keys.

## The whole answer, always

- The text is never cut. There is no line clamp and no ellipsis, and the desktop shell passes the
  text on whole (`okfilow-stop.js` `bubbleText`, up to 20,000 letters; it used to cut at 2,000).
- The bubble is at most 380 px wide. Its text grows to half the screen's height; beyond that it
  scrolls inside the bubble: with the mouse wheel while the pointer is on it, and by itself while
  the voice reads, so the sentence being spoken stays in view (it is marked). The panel tells the
  overlays which sentence the voice is on (`voice.ts` `onSentence`, exact for this PC's voice, worked
  out from what was played for the natural and the cloud voice). While the pointer is on the bubble
  the text does not move by itself: the user is scrolling it.
- An answer's bubble holds still when the pointer comes to it: it stays where it is while the
  pointer is within 120 CSS pixels. The bubble and buddy hold their displayed positions for the rest of that bubble.
- Placement (`motion.ts` `bubblePlacement`, `bubbleOnScreen`): lower right of the pointer; to its
  left at the right edge, above it at the bottom edge; always wholly on screen, 8 px from every
  edge; never over the pill (a bubble that would lie over it goes below it).
- While the pointer is on the bubble that overlay takes the mouse, the same way it does for the
  pill's controls (`okfilow-stop.js` `overlayMouse`, `overlayLive`), and gives it back after.

## When it goes away

The rule is one pure function, `okfilow-stop.js` `bubbleHold`, driven by `createBubble` in the main
process. Cards, media and Resume keep their answer available. The always-visible pointer has its own lifetime.

| State | The bubble stays |
| --- | --- |
| Listening, thinking, speaking, paused | as long as that lasts |
| Hovered | the reading timer resumes with its remaining time once the pointer leaves (replaces the old 2.5 s after hover) |
| Finished or stopped answer with text | 60 ms per unit, bounded to 5-90 s, less time already shown with a minimum 4 s linger |
| Stopped before text arrived | 8 s |
| Answer with cards, media or Resume | until dismissed or replaced |
| Dictation note | the panel requests 2.5, 4.5, 5 or 6 seconds, bounded to 1-6 s |
| Information or error | 6 seconds plus 60 ms per unit, up to 20 seconds |

Whitespace counts as zero units. Japanese, Chinese and Korean wide characters count as two. Other characters count as one.

Ways out at any time: Esc, the close button, a new question (spoken or typed) or a dictation, which
replace the old words at once.

- Esc dismisses the bubble and stops an active answer while the foreground app receives the same key.
- The close button (top right corner of the bubble, named "Close the answer" in the five languages)
  closes the bubble on every screen, and the answer's marks with it.
- An answer's marks (boxes, circles, arrows, underlines and their labels) last as long as they are
  being told, and never outlive the answer (`okfilow-stop.js` `createMarks`, `marksHold`). They stay
  while the answer is spoken or paused. Then they go after a short hold: 4 s after the voice, 8 s
  when nothing was spoken. They go sooner: at once on Stop (Resume draws them again) and on an
  error; when the bubble is closed (Esc, the close button, its own time); at the first click
  anywhere but on the bubble or the pill once the answer has ended (the screen may have changed
  under them; this needs the keyboard and mouse hook). A new question, the talk keys, Esc and the
  panel's Clear wipe them at once. They used to stay until Esc: boxes were left on the desktop long
  after the answer. A change of the window in front is not watched: Filow has no hook for it.
- Cards (a photo, a drawing) are the answer itself and stay until Esc, Clear or the next question.
- When the bubble has gone the overlays go a second later, unless cards are kept or the
  pointer is always shown. The pointer's visits to the things an answer points at keep the overlays
  only for as long as they take (`pointsShowMs`), not until Esc.

## Keyboard

Clicking the bubble or its X keeps keyboard focus in the current app. Filow observes Escape passively while answering, listening, dictating, or showing a model, pinned items or a bubble. An active answer stops first. Otherwise Escape closes the model, pinned items or bubble in that order. A second press within 700 ms clears all three. Filow removes the listener when idle with nothing shown.

## Where it lives

- `apps/web/components/okfilow/bubble.tsx` (the bubble), `app/okfilow/overlay/page.tsx` (placing,
  holding, hover, following the voice), `app/okfilow/okfilow.css`.
- `apps/web/lib/buddy/motion.ts` (placement, hold, scroll), `turn.ts` `sentenceParts`, `voice.ts`
  `onSentence`.
- `apps/desktop/okfilow-stop.js` (`bubbleHold`, `createBubble`, `escapePlan`, `bubbleText`,
  `pointsShowMs`), wired in `okfilow.js`.
- Test builds log `okfilow qa bubble closes in N ms` / `stays`, and `okfilow qa overlays shown` /
  `hidden`; every build logs `okfilow: bubble closed (timer | escape | button)`.
