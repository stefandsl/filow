// Original Filo introduction. Run with ffmpeg on PATH. No downloaded media or fonts.
import sharp from 'sharp';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const out = path.resolve('apps/desktop/media');
const temp = path.resolve('tmp/intro-frames');
mkdirSync(out,{recursive:true}); mkdirSync(temp,{recursive:true});
const scenes = [
 { n:'01', title:'Ask in your own words.', text:'Hold your talk shortcut. Ask a question.', bottom:'You choose whether Filo can see your screen.', content:`<rect x="160" y="330" width="170" height="90" rx="16" fill="#303030"/><text x="245" y="388" text-anchor="middle" font-size="32">Ctrl</text><text x="365" y="390" font-size="32">+</text><rect x="410" y="330" width="170" height="90" rx="16" fill="#303030"/><text x="495" y="388" text-anchor="middle" font-size="32">Alt</text><text x="160" y="495" font-size="28" fill="#ffb600">“Where can I save this?”</text>` },
 { n:'02', title:'Follow the highlight.', text:'Filo points and draws while it explains.', bottom:'The overlay leaves the app underneath clickable.', content:`<rect x="160" y="310" width="960" height="210" rx="12" fill="#252525"/><rect x="200" y="348" width="300" height="10" rx="5" fill="#5c5c5c"/><rect x="200" y="376" width="460" height="10" rx="5" fill="#444"/><rect x="880" y="410" width="180" height="65" rx="10" fill="#ffb600"/><text x="970" y="453" text-anchor="middle" font-size="28" fill="#111">Save</text><rect x="865" y="395" width="210" height="95" rx="14" stroke="#ffb600" stroke-width="4" fill="none"/><path d="M750 350 Q800 360 850 415" stroke="#ffb600" stroke-width="5" fill="none"/><path d="M830 409 L850 415 L850 395" stroke="#ffb600" stroke-width="5" fill="none"/>` },
 { n:'03', title:'You stay in control.', text:'Stop any answer. Choose what leaves your PC.', bottom:'Next: try Filo’s real desktop overlay yourself.', content:`<rect x="160" y="310" width="960" height="210" rx="12" fill="#252525"/><circle cx="220" cy="372" r="14" fill="#ffb600"/><text x="255" y="382" font-size="26">Screen sharing is your choice</text><circle cx="220" cy="440" r="14" fill="#ffb600"/><text x="255" y="450" font-size="26">Local features work without an account</text><rect x="890" y="395" width="170" height="65" rx="10" fill="#3a3a3a"/><text x="975" y="438" text-anchor="middle" font-size="28">Stop</text>` },
];
for(const [i,s] of scenes.entries()) {
 const svg=`<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg"><rect width="1280" height="720" fill="#121212"/><g font-family="Segoe UI, sans-serif" fill="#f5f5f5"><text x="70" y="85" font-size="32" font-weight="700">filo<tspan fill="#ffb600">w</tspan></text><text x="1130" y="85" fill="#aaa" font-size="20">${s.n} / 03</text><text x="160" y="200" font-size="48" font-weight="600">${s.title}</text><text x="160" y="250" font-size="25" fill="#bbb">${s.text}</text>${s.content}<text x="160" y="625" font-size="23" fill="#aaa">${s.bottom}</text></g></svg>`;
 await sharp(Buffer.from(svg)).png().toFile(path.join(temp,`${i}.png`));
 if(i===0) await sharp(Buffer.from(svg)).png().toFile(path.join(out,'intro-poster.png'));
}
writeFileSync(path.join(temp,'frames.txt'),scenes.map((_,i)=>`file '${i}.png'\nduration 6`).join('\n')+"\nfile '2.png'\n");
const proc=spawnSync('ffmpeg',['-y','-f','concat','-safe','0','-i',path.join(temp,'frames.txt'),'-t','18','-r','24','-c:v','libx264','-pix_fmt','yuv420p','-crf','25','-movflags','+faststart',path.join(out,'intro.mp4')],{stdio:'inherit'});
if(proc.status!==0) throw new Error('ffmpeg failed');
writeFileSync(path.join(out,'intro.en.vtt'),`WEBVTT\n\n00:00.000 --> 00:06.000\nHold the talk shortcut and ask a question. You choose screen sharing.\n\n00:06.000 --> 00:12.000\nFollow the highlight. The app underneath stays clickable.\n\n00:12.000 --> 00:18.000\nStop any answer. Local features work without an account.\n`);
rmSync(temp,{recursive:true,force:true});
