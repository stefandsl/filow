# OK Filow: the answer bubble

The bubble is the dark box next to the pointer that shows what OK Filow answers (and, while it
listens, the waveform or a dictation's words). Mouse and keyboard only: no spoken or typed command
closes it.

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
  pointer is on it or within 96 px of it, and follows again once the pointer goes further away
  (`motion.ts` `bubbleSticks`). It stays by the pointer while the dot flies off to the things the
  answer points at. While listening it follows the pointer as before.
- Placement (`motion.ts` `bubblePlacement`, `bubbleOnScreen`): lower right of the pointer; to its
  left at the right edge, above it at the bottom edge; always wholly on screen, 8 px from every
  edge; never over the pill (a bubble that would lie over it goes below it).
- While the pointer is on the bubble that overlay takes the mouse, the same way it does for the
  pill's controls (`okfilow-stop.js` `overlayMouse`, `overlayLive`), and gives it back after.

## When it goes away

The rule is one pure function, `okfilow-stop.js` `bubbleHold`, driven by `createBubble` in the main
process. Whatever keeps the overlays on screen (cards, "always show the pointer") never
keeps the bubble.

| State | The bubble stays |
| --- | --- |
| Listening, thinking, speaking, paused | as long as that lasts |
| The pointer is on it | as long as it is, then 2.5 s more |
| Answer finished | 4 s after the end, and never less than its reading time counted from when the whole text was shown. Reading time: 60 ms a letter (120 ms for Japanese, Chinese and Korean letters), between 5 s and 90 s. A spoken answer has usually been on screen that long, so it goes 4 s after the voice; with the voice off, missing or failed it stays for the reading time. |
| Error | the same rule on the error's text (5 s for a short one) |
| Stopped (the "Stopped" mark, and Resume on the pill) | 8 s; Resume stays on the panel after that |
| A dictation's note | the time the panel gives it, between 1 s and 6 s |

Ways out at any time: Esc, the close button, a new question (spoken or typed) or a dictation, which
replace the old words at once.

- Esc while an answer runs stops it. Esc with no answer running closes the bubble and wipes the
  marks (`escapePlan`). So a second Esc after a stop closes what the first one left.
- The close button (top right corner of the bubble, named "Close the answer" in the five languages)
  closes the bubble on every screen, and the answer's marks with it.
- An answer's marks (boxes, circles, arrows, underlines and their labels) belong to the answer and
  never outlive it (`okfilow-stop.js` `createMarks`, `marksHold`): they go when the bubble goes,
  however it went (by itself, Esc, the close button), and when there is no bubble (an answer without
  words) 4 s after the answer ended. They stay while the answer runs or is paused. A new question,
  the talk keys, Esc and the panel's Clear wipe them at once. Resume after Stop draws them again.
  They used to stay until Esc: boxes were left on the desktop long after the answer.
- Cards (a photo, a drawing) are the answer itself and stay until Esc, Clear or the next question.
- When the bubble has gone the overlays go a second later, unless cards are kept or the
  pointer is always shown. The pointer's visits to the things an answer points at keep the overlays
  only for as long as they take (`pointsShowMs`), not until Esc.

## Keyboard

The overlay window is never focusable: it must not take the keyboard from the app in use. So the
close button cannot be reached with Tab. The keyboard's way is Esc, which reaches OK Filow through
the keyboard hook from any app, and the panel, which shows the whole answer in an ordinary window.
If Windows refuses the hook (the panel says so), Esc works only while the panel has the keyboard:
the bubble then still goes by itself, and the close button works with the mouse.

## Where it lives

- `apps/web/components/okfilow/bubble.tsx` (the bubble), `app/okfilow/overlay/page.tsx` (placing,
  holding, hover, following the voice), `app/okfilow/okfilow.css`.
- `apps/web/lib/buddy/motion.ts` (placement, hold, scroll), `turn.ts` `sentenceParts`, `voice.ts`
  `onSentence`.
- `apps/desktop/okfilow-stop.js` (`bubbleHold`, `createBubble`, `escapePlan`, `bubbleText`,
  `pointsShowMs`), wired in `okfilow.js`.
- Test builds log `okfilow qa bubble closes in N ms` / `stays`, and `okfilow qa overlays shown` /
  `hidden`; every build logs `okfilow: bubble closed (timer | escape | button)`.
