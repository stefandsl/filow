// Original localized Filow introduction videos with narration and captions.
// Run with ffmpeg on PATH from the repository root:
//   node scripts/make-intro.mjs [--audio-dir <dir-with-{lang}-{0,1,2}.mp3>] [--lang <lang>]
// If --audio-dir is omitted, existing audio streams from apps/desktop/media/intro.<lang>.mp4 are reused.
import sharp from 'sharp';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { SCENE_DURATIONS, captions, captionVtt } from './intro-captions.mjs';

const out = path.resolve('apps/desktop/media');
const temp = path.resolve('tmp/intro-frames');
const audioArgIdx = process.argv.indexOf('--audio-dir');
const audioDir = audioArgIdx >= 0 && process.argv[audioArgIdx + 1]
  ? path.resolve(process.argv[audioArgIdx + 1])
  : null;
const langArgIdx = process.argv.indexOf('--lang');
const onlyLang = langArgIdx >= 0 && process.argv[langArgIdx + 1]
  ? process.argv[langArgIdx + 1]
  : null;

mkdirSync(out, { recursive: true });
mkdirSync(temp, { recursive: true });

const TOTAL_SECONDS = SCENE_DURATIONS.reduce((a, b) => a + b, 0);
const LEAD_IN_MS = 200;

const esc = (s) => s
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const COPY = {
  en: {
    s1: {
      title: 'Ask in your own words.',
      text: 'Hold your talk shortcut. Ask a question.',
      quote: '“Where can I save this?”',
      bottom: 'You choose whether Filow can see your screen.',
    },
    s2: {
      title: 'Follow the highlight.',
      text: 'Filow points and draws while it explains.',
      save: 'Save',
      bottom: 'The overlay leaves the app underneath clickable.',
    },
    s3: {
      title: 'You stay in control.',
      text: 'Stop any answer. Choose what leaves your PC.',
      b1: 'Screen sharing is your choice',
      b2: 'Local features work without an account',
      stop: 'Stop',
      bottom: 'Next: try Filow’s real desktop overlay yourself.',
    },
  },
  it: {
    s1: {
      title: 'Chiedi con parole tue.',
      text: 'Tieni premuta la scorciatoia e fai una domanda.',
      quote: '«Dove posso salvarlo?»',
      bottom: 'Decidi tu se Filow può vedere lo schermo.',
    },
    s2: {
      title: 'Segui l’evidenziazione.',
      text: 'Filow indica e disegna mentre spiega.',
      save: 'Salva',
      bottom: 'Puoi continuare a fare clic nell’app sottostante.',
    },
    s3: {
      title: 'Il controllo resta a te.',
      text: 'Interrompi ogni risposta. Scegli cosa esce dal PC.',
      b1: 'La condivisione schermo è una tua scelta',
      b2: 'Le funzioni locali non richiedono un account',
      stop: 'Stop',
      bottom: 'Poi prova dal vivo l’overlay di Filow.',
    },
  },
  ru: {
    s1: {
      title: 'Спросите своими словами.',
      text: 'Удерживайте клавиши и задайте вопрос.',
      quote: '«Где это сохранить?»',
      bottom: 'Экран показывается только с вашего согласия.',
    },
    s2: {
      title: 'Следуйте подсветке.',
      text: 'Filow указывает и рисует во время объяснения.',
      save: 'Сохранить',
      bottom: 'В приложении под подсветкой можно нажимать кнопки.',
    },
    s3: {
      title: 'Всё под вашим контролем.',
      text: 'Остановите любой ответ. Решайте, что уходит с ПК.',
      b1: 'Доступ к экрану выбираете вы',
      b2: 'Локальные функции работают без аккаунта',
      stop: 'Стоп',
      bottom: 'Дальше попробуйте оверлей Filow на практике.',
    },
  },
  ro: {
    s1: {
      title: 'Întreabă cu cuvintele tale.',
      text: 'Ține apăsată combinația și pune o întrebare.',
      quote: '„Unde pot salva asta?”',
      bottom: 'Tu alegi dacă Filow poate vedea ecranul.',
    },
    s2: {
      title: 'Urmărește evidențierea.',
      text: 'Filow indică și desenează în timp ce explică.',
      save: 'Salvează',
      bottom: 'Poți face în continuare clic în aplicația de dedesubt.',
    },
    s3: {
      title: 'Tu păstrezi controlul.',
      text: 'Oprește orice răspuns. Alege ce pleacă de pe PC.',
      b1: 'Partajarea ecranului este alegerea ta',
      b2: 'Funcțiile locale merg fără cont',
      stop: 'Stop',
      bottom: 'Apoi încearcă pe viu overlay-ul Filow.',
    },
  },
  ja: {
    s1: {
      title: '自分の言葉で質問する。',
      text: 'ショートカットを押したまま話しかけます。',
      quote: '「これはどこに保存できますか？」',
      bottom: '画面を共有するかどうかは自分で選べます。',
    },
    s2: {
      title: '強調表示を目印に操作。',
      text: 'Filowが画面を指し示し、描きながら説明します。',
      save: '保存',
      bottom: '下にあるアプリはそのままクリックできます。',
    },
    s3: {
      title: '主導権はいつもあなたに。',
      text: 'いつでも停止でき、送信内容も自分で選べます。',
      b1: '画面共有は自分で管理できます',
      b2: 'ローカル機能はアカウント不要です',
      stop: '停止',
      bottom: '次に、実際のオーバーレイを試してみましょう。',
    },
  },
};

// Demo content sits in y=65..525 so y=550..720 remains an empty dark caption-safe band for fullscreen playback.
function buildScenes(copy) {
  return [
    {
      n: '01',
      title: copy.s1.title,
      text: copy.s1.text,
      bottom: copy.s1.bottom,
      content: `<rect x="140" y="260" width="165" height="86" rx="16" fill="#303030"/><text x="222" y="315" text-anchor="middle" font-size="32">Ctrl</text><text x="340" y="317" font-size="32">+</text><rect x="385" y="260" width="165" height="86" rx="16" fill="#303030"/><text x="467" y="315" text-anchor="middle" font-size="32">Alt</text><text x="140" y="418" font-size="30" fill="#ffb600">${esc(copy.s1.quote)}</text>`,
    },
    {
      n: '02',
      title: copy.s2.title,
      text: copy.s2.text,
      bottom: copy.s2.bottom,
      content: `<rect x="140" y="245" width="1000" height="205" rx="12" fill="#252525"/><rect x="180" y="285" width="300" height="10" rx="5" fill="#5c5c5c"/><rect x="180" y="315" width="460" height="10" rx="5" fill="#444"/><rect x="865" y="345" width="210" height="65" rx="10" fill="#ffb600"/><text x="970" y="388" text-anchor="middle" font-size="28" font-weight="600" fill="#111">${esc(copy.s2.save)}</text><rect x="850" y="330" width="240" height="95" rx="14" stroke="#ffb600" stroke-width="4" fill="none"/><path d="M735 288 Q785 298 835 352" stroke="#ffb600" stroke-width="5" fill="none"/><path d="M815 346 L835 352 L835 332" stroke="#ffb600" stroke-width="5" fill="none"/>`,
    },
    {
      n: '03',
      title: copy.s3.title,
      text: copy.s3.text,
      bottom: copy.s3.bottom,
      content: `<rect x="140" y="245" width="1000" height="205" rx="12" fill="#252525"/><circle cx="198" cy="312" r="13" fill="#ffb600"/><text x="232" y="321" font-size="24">${esc(copy.s3.b1)}</text><circle cx="198" cy="382" r="13" fill="#ffb600"/><text x="232" y="391" font-size="24">${esc(copy.s3.b2)}</text><rect x="915" y="332" width="175" height="65" rx="10" fill="#3a3a3a"/><text x="1002" y="374" text-anchor="middle" font-size="28">${esc(copy.s3.stop)}</text>`,
    },
  ];
}

function runFfmpeg(args) {
  const proc = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  if (proc.status !== 0) throw new Error(`ffmpeg failed (${proc.status})`);
}

try {
  const targetLangs = onlyLang ? [onlyLang] : Object.keys(captions);
  for (const lang of targetLangs) {
    const langTemp = path.join(temp, lang);
    mkdirSync(langTemp, { recursive: true });
    const scenes = buildScenes(COPY[lang]);

    for (const [i, s] of scenes.entries()) {
      const svg = `<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg"><rect width="1280" height="720" fill="#121212"/><g font-family="Segoe UI, Yu Gothic UI, Meiryo, sans-serif" fill="#f5f5f5"><text x="70" y="72" font-size="32" font-weight="700">filo<tspan fill="#ffb600">w</tspan></text><text x="1130" y="72" fill="#aaa" font-size="20">${s.n} / 03</text><text x="140" y="152" font-size="44" font-weight="600">${esc(s.title)}</text><text x="140" y="200" font-size="24" fill="#bbb">${esc(s.text)}</text>${s.content}<text x="140" y="518" font-size="22" fill="#aaa">${esc(s.bottom)}</text></g></svg>`;
      await sharp(Buffer.from(svg)).png().toFile(path.join(langTemp, `${i}.png`));
      if (i === 0) {
        await sharp(Buffer.from(svg))
          .png({ palette: true, compressionLevel: 9 })
          .toFile(path.join(out, `intro-poster.${lang}.png`));
      }
    }

    const concatLines = scenes.map((_, i) => `file '${i}.png'\nduration ${SCENE_DURATIONS[i]}`).join('\n') + `\nfile '${scenes.length - 1}.png'\n`;
    const framesList = path.join(langTemp, 'frames.txt');
    writeFileSync(framesList, concatLines);

    const targetMp4 = path.join(out, `intro.${lang}.mp4`);
    const clipPaths = scenes.map((_, i) => audioDir ? path.join(audioDir, `${lang}-${i}.mp3`) : null);
    const hasSplitAudio = clipPaths.every(p => p && existsSync(p));

    if (hasSplitAudio) {
      let startSec = 0;
      const delays = SCENE_DURATIONS.map(d => {
        const ms = startSec * 1000 + LEAD_IN_MS;
        startSec += d;
        return ms;
      });
      const filterParts = [
        `[1:a]aresample=24000,aformat=channel_layouts=mono,adelay=${delays[0]}:all=1[a0]`,
        `[2:a]aresample=24000,aformat=channel_layouts=mono,adelay=${delays[1]}:all=1[a1]`,
        `[3:a]aresample=24000,aformat=channel_layouts=mono,adelay=${delays[2]}:all=1[a2]`,
        `[a0][a1][a2]amix=inputs=3:duration=longest:normalize=0,apad=whole_dur=${TOTAL_SECONDS},atrim=0:${TOTAL_SECONDS}[aout]`,
      ].join(';');

      runFfmpeg([
        '-y',
        '-f', 'concat', '-safe', '0', '-i', framesList,
        '-i', clipPaths[0],
        '-i', clipPaths[1],
        '-i', clipPaths[2],
        '-filter_complex', filterParts,
        '-map', '0:v:0',
        '-map', '[aout]',
        '-t', String(TOTAL_SECONDS),
        '-r', '24',
        '-c:v', 'libx264', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-crf', '26',
        '-c:a', 'aac', '-ac', '1', '-ar', '24000', '-b:a', '48k',
        '-metadata:s:a:0', `language=${lang === 'en' ? 'eng' : lang === 'it' ? 'ita' : lang === 'ru' ? 'rus' : lang === 'ro' ? 'ron' : 'jpn'}`,
        '-movflags', '+faststart',
        targetMp4,
      ]);
    } else if (existsSync(targetMp4)) {
      const preservedAudio = path.join(langTemp, 'audio.m4a');
      runFfmpeg(['-y', '-i', targetMp4, '-vn', '-c:a', 'copy', preservedAudio]);
      runFfmpeg([
        '-y',
        '-f', 'concat', '-safe', '0', '-i', framesList,
        '-i', preservedAudio,
        '-map', '0:v:0', '-map', '1:a:0',
        '-t', String(TOTAL_SECONDS),
        '-r', '24',
        '-c:v', 'libx264', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-crf', '26',
        '-c:a', 'copy',
        '-movflags', '+faststart',
        targetMp4,
      ]);
    } else {
      throw new Error(`Missing narration clips for ${lang}. Pass --audio-dir <dir> containing ${lang}-{0,1,2}.mp3.`);
    }

    writeFileSync(path.join(out, `intro.${lang}.vtt`), captionVtt(lang));
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
}
