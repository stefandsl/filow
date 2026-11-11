# Whiteboard tutor: the pen in time with the voice, two boards, a video

2026-11-11. What was taken from `haiderfarooq3/khan-explainer`, what was built in Filow, and what
plays where.

## What that project is, and what was reused

`khan-explainer` (MIT, Copyright (c) 2026 Haider Farooq) is a Claude Code skill that renders
"Khan Academy style" explainer videos offline: a scene is a list of beats, a beat is one spoken
clause plus the drawing made while it is said; the renderer speaks the beat first, measures it and
fits the drawing to its length. Chalk on a blackboard or marker on a whiteboard. It renders MP4
with Playwright, ffmpeg and the macOS `say` voice, and its scenes are JavaScript drawing functions
with coordinates written by a strong model.

Its README, its `SKILL.md` and its `LICENSE` were read in a browser. The repository was not cloned
or downloaded, and **no code, font or asset of it is in Filow**. So there is nothing of it in
`THIRD_PARTY_NOTICES.md`. Filow cannot use its scenes as they are: Filow never runs what a model
wrote, a small local model cannot place coordinates, and Filow plays live in a window, not offline.

Three ideas were taken, each rebuilt on Filow's own layout and renderer:

| Idea | In Filow |
|---|---|
| The voice drives the clock | `lib/whiteboard/pace.ts`: a step is one sentence plus what is drawn with it, and the drawing is spread over the time the sentence takes |
| Chalk on a blackboard next to marker on a whiteboard | two palettes in `components/whiteboard/Board.tsx`, a switch on the page |
| A lesson as a video | `lib/whiteboard/video.ts`: recorded inside the app, no ffmpeg |

Their contact sheet (the board at the end of every beat) already had its counterpart here:
`tools/whiteboard/shots.mjs`.

## The pen in time with the voice

That project can speak a beat before it draws it, because it renders offline. A live voice
cannot be measured before it speaks. So:

- `PaceMeter` estimates how long a sentence will take from its letters and pauses, and learns the
  voice in use: every sentence heard to its end moves the rate towards what was measured (the
  first counts in full, later ones for a third). A voice that was cut or never spoke teaches
  nothing. With the voice off the time is the reading time the player already used.
- `stepSchedule` gives each new thing of the step a slot of that time, in the order a teacher
  draws: boxes, the arrows between them, marks, then formulas, plots, cells and notes. A thing's
  share follows how much pen work it is. The drawing takes 88 % of the expected time, and one
  thing never takes longer than a hand would, so a single box is not stretched over a long
  sentence.
- The board hands each slot to the style sheet as two custom properties. The strokes of a thing
  are drawn by length in the first 60 % of its slot (Rough.js paths, or the plain shapes of the
  Lite tier), and what is written in it appears left to right in the rest. A formula fades in
  in its slot.
- When the voice ends, whatever is left is completed at once. So the pen never runs ahead of the
  words by more than the estimate was short, and never trails behind the end of the sentence.
- Pause, back, next, replay, a jump and the end of a step all show the complete board (`wb-rest`):
  nothing is ever left half drawn. Playing a paused step again says and draws it from its start.
- `prefers-reduced-motion`: no animation at all, as before. The Lite tier draws plainly and
  gets no schedule. The first slot starts at 0 ms, so "a step's first stroke within 200 ms of its
  data" holds as before. No GPU is needed: it is CSS on SVG paths.

Tests: `lib/whiteboard/pace.test.ts` (the estimate, learning from a slow and a fast voice with the
durations given by the test, the schedule: in order, none before 0, none after the end, done
before the voice), `components/whiteboard/Board.test.tsx` (slots only on new things, the rest
state), and the packaged app (`tools/whiteboard/e2e.mjs`: a step being said is timed, a paused
board has no open stroke).

## Two boards

The whiteboard (marker on off-white) and the blackboard (chalk on a green-black board, a rougher
and slightly broader line). The board follows the app's theme until the user picks one with the
switch under the board; the choice is kept in this browser profile. Every ink of both palettes is
checked against its board (WCAG 4.5 for what is written, 3 for lines) in `Board.test.tsx`, and the
packaged app runs axe on both.

## A lesson as a video

"Save video" plays the lesson again from its first step and records it: each frame is the live
board at that instant (a copy of the SVG carrying the state each stroke and each label has
reached), drawn on a 1280 x 720 canvas with the sentence of the step written under it, at 12
frames a second, recorded by the browser's `MediaRecorder` as WebM. Nothing leaves the PC.

What plays where, honestly:

| | |
|---|---|
| Time to make | as long as the lesson takes to play; the window has to stay in front, because a hidden window stops drawing |
| Narration | in the video only with the natural voice of this PC (the app plays that sound itself and hands it to the recorder too). The system voice is spoken by Windows and a page cannot record it; with it, or with the voice off, the video is silent and the sentences are its captions. The page says which it was |
| Format | WebM (VP9 or VP8, Opus when there is sound). It plays in browsers, VLC and current Windows players. It is not MP4 |
| A known limit | a file recorded by a browser has no length in its header: it plays from start to end, but some players show no total time and seek poorly |
| Not done | frame-exact rendering faster than real time, MP4, burned-in highlights of the word being said |

The natural-voice path (sound in the video) could not be tried here: the checks run with the
voice off. The silent path was recorded and looked at frame by frame.

## Draw over the screen: a proposal, not built

That project's second mode draws numbered steps, arrows and circles over product screenshots.
OK Filow already draws over the real screen, live, which is the harder half:

| | OK Filow today | What "draw over the screen" would add |
|---|---|---|
| Where | on the live screen, in transparent overlay windows, one per display | the same |
| Marks | `[POINT]` (the cursor flies there), `[CIRCLE]`, `[ARROW]`, `[BOX]`, `[UNDERLINE]`, each with a label; cards | numbered steps: "1", "2", "3" in a small disc beside each mark |
| Order | all marks of an answer appear as the answer streams | one mark per spoken clause, drawn while that clause is said |
| After | the marks fade when the answer is over | a "show me again" that replays the walk through, and a picture of the screen with all marks to keep |
| Who places them | the model, on a 0 to 1000 grid over the screenshot it was sent; only a model that sees the picture (the text-only helper is told not to) | the same; no new risk, the tags stay data that is validated |

Proposal, smallest first:

1. Number the marks in the order they are spoken (a disc with the number at the start of each
   label). Overlay only, a few lines, no prompt change. Worth doing on its own.
2. Pace them with the voice: the answer is already split into sentences for speaking; a mark
   appears when its sentence starts, using the same `PaceMeter` idea. It needs the position of
   each tag inside the text to be kept by `parseBuddyAnswer` (today the tags are stripped and
   their place is lost).
3. "Save this walk through": the screenshot the model saw with the marks drawn on it, as a PNG,
   saved locally. The screenshot is the user's screen, so this is a deliberate save by the user,
   never automatic.

Not proposed: recording the live screen as a video (it would capture whatever else is on screen),
and letting a text-only local model place marks (it cannot see where things are).
