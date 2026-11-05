export function Transcript({text, open}: {text: string; open: boolean}) {
  return <section className="prompter-transcript" hidden={!open || !text}>
    <p id="prompter-transcript-text" hidden={!open || !text}>{text}</p>
  </section>;
}
