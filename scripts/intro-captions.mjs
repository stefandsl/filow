// Original English captions and translations for the onboarding intro video.
// All five languages share the three scene durations below so visuals, narration and captions stay in sync.
export const SCENE_DURATIONS = [10, 8, 8];

export const captions = {
  en: [
    'Hold the talk shortcut and ask a question. You choose screen sharing.',
    'Follow the highlight. The app underneath stays clickable.',
    'Stop any answer. Local features work without an account.',
  ],
  it: [
    'Tieni premuta la scorciatoia per parlare e fai una domanda. Decidi tu se condividere lo schermo.',
    'Segui l’evidenziazione. Puoi continuare a fare clic nell’app sottostante.',
    'Puoi interrompere qualsiasi risposta. Le funzioni locali non richiedono un account.',
  ],
  ru: [
    'Удерживайте сочетание клавиш для разговора и задайте вопрос. Вы сами решаете, делиться ли экраном.',
    'Следуйте подсветке. В приложении под ней по-прежнему можно нажимать кнопки.',
    'Любой ответ можно остановить. Локальные функции работают без аккаунта.',
  ],
  ro: [
    'Ține apăsată combinația de taste pentru vorbire și pune o întrebare. Tu alegi dacă partajezi ecranul.',
    'Urmărește evidențierea. Poți face în continuare clic în aplicația de dedesubt.',
    'Poți opri orice răspuns. Funcțiile locale merg fără cont.',
  ],
  ja: [
    '会話用のショートカットキーを押したまま質問します。画面を共有するかどうかは自分で選べます。',
    '強調表示を目印に操作します。下にあるアプリはそのままクリックできます。',
    '回答はいつでも停止できます。ローカル機能はアカウントなしで使えます。',
  ],
};

export function captionVtt(lang) {
  const cues = captions[lang] ?? captions.en;
  const time = seconds => `00:${String(seconds).padStart(2, '0')}.000`;
  let cursor = 0;
  return 'WEBVTT\n\n' + cues.map((text, i) => {
    const start = cursor;
    const end = cursor + (SCENE_DURATIONS[i] ?? 8);
    cursor = end;
    return `${time(start)} --> ${time(end)}\n${text}\n`;
  }).join('\n');
}
