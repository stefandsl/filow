import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
const require = createRequire(import.meta.url);
const {normalizeNumbers: normalize} = require('./tts-numbers');
const {languageSpans, crossfade} = require('./tts-spans');
const {finishAudio} = require('./tts-audio');

// Authored expected forms, not generated snapshots. RU, RO, JA: needs a native check.
const cases: Record<string, string[][]> = {
  it: [
    ['0','zero'],['1','uno'],['2','due'],['11','undici'],['21','ventuno'],['28','ventotto'],['100','cento'],['101','centouno'],['1000','mille'],['2000','duemila'],
    ['2026','duemilaventisei'],['1999','millenovecentonovantanove'],['2001','duemilauno'],['2010','duemiladieci'],['2030','duemilatrenta'],
    ['14/11/2026','quattordici novembre duemilaventisei'],['14 novembre 2026','quattordici novembre duemilaventisei'],['2026-11-14','quattordici novembre duemilaventisei'],
    ['14:30','quattordici e trenta'],['9:05','nove e cinque'],['10:00','dieci in punto'],
    ['1º','primo'],['2ª','seconda'],['3°','terzo'],['1,5','uno virgola cinque'],['0,05','zero virgola zero cinque'],['12,75','dodici virgola sette cinque'],
    ['1.000','mille'],['2.026','duemilaventisei'],['12 000','dodicimila'],['25%','venticinque per cento'],['1%','uno per cento'],
    ['€1','un euro'],['2 EUR','due euro'],['€0,50','cinquanta centesimi'],['0.9.39','zero punto nove punto trentanove'],['1.2.3','uno punto due punto tre'],
    ['3-5','tre a cinque'],['10–20','dieci a venti'],['2025-2026','duemilaventicinque a duemilaventisei'],
    ['1 gennaio 2026','primo gennaio duemilaventisei'],
  ],
  en: [
    ['0','zero'],['1','one'],['2','two'],['11','eleven'],['21','twenty-one'],['28','twenty-eight'],['100','one hundred'],['101','one hundred one'],['1000','one thousand'],['2000','two thousand'],
    ['2026','two thousand twenty-six'],['1999','one thousand nine hundred ninety-nine'],['2001','two thousand one'],['2010','two thousand ten'],['2030','two thousand thirty'],
    ['14/11/2026','fourteenth November two thousand twenty-six'],['November 14, 2026','fourteenth November two thousand twenty-six'],['2026-11-14','fourteenth November two thousand twenty-six'],
    ['14:30','fourteen thirty'],['9:05','nine oh five'],['10:00',"ten o'clock"],
    ['1st','first'],['2nd','second'],['3rd','third'],['1.5','one point five'],['0.05','zero point zero five'],['12.75','twelve point seven five'],
    ['1,000','one thousand'],['2,026','two thousand twenty-six'],['12 000','twelve thousand'],['25%','twenty-five percent'],['1%','one percent'],
    ['$1','one dollar'],['2 USD','two dollars'],['$0.50','fifty cents'],['0.9.39','zero dot nine dot thirty-nine'],['1.2.3','one dot two dot three'],
    ['3-5','three to five'],['10–20','ten to twenty'],['2025-2026','two thousand twenty-five to two thousand twenty-six'],
    ['21st','twenty-first'],
  ],
  ru: [
    ['0','ноль'],['1','один'],['2','два'],['11','одиннадцать'],['21','двадцать один'],['28','двадцать восемь'],['100','сто'],['101','сто один'],['1000','одна тысяча'],['2000','две тысячи'],
    ['2026','две тысячи двадцать шесть'],['1999','одна тысяча девятьсот девяносто девять'],['2001','две тысячи один'],['2010','две тысячи десять'],['2030','две тысячи тридцать'],
    ['14/11/2026','четырнадцатого ноября две тысячи двадцать шестого года'],['14 ноября 2026 года','четырнадцатого ноября две тысячи двадцать шестого года'],['2026-11-14','четырнадцатого ноября две тысячи двадцать шестого года'],
    ['14:30','четырнадцать часов тридцать минут'],['9:05','девять часов пять минут'],['21:01','двадцать один час одна минута'],
    ['1-й','первый'],['2-я','вторая'],['3-е','третье'],['1,5','одна целая пять десятых'],['0,05','ноль целых пять сотых'],['12,75','двенадцать целых семьдесят пять сотых'],
    ['1.000','одна тысяча'],['2.026','две тысячи двадцать шесть'],['12 000','двенадцать тысяч'],['25%','двадцать пять процентов'],['10%','десять процентов'],
    ['₽1','один рубль'],['2 RUB','два рубля'],['₽0,50','пятьдесят копеек'],['0.9.39','ноль точка девять точка тридцать девять'],['1.2.3','один точка два точка три'],
    ['3-5','от трёх до пяти'],['в 2026 году','в две тысячи двадцать шестом году'],['2026 года','две тысячи двадцать шестого года'],
    ['21 минута','двадцать одна минута'],['2 страницы','две страницы'],
  ],
  ro: [
    ['0','zero'],['1','unu'],['2','doi'],['11','unsprezece'],['21','douăzeci și unu'],['28','douăzeci și opt'],['100','o sută'],['101','o sută unu'],['1000','o mie'],['2000','două mii'],
    ['2026','două mii douăzeci și șase'],['1999','o mie nouă sute nouăzeci și nouă'],['2001','două mii unu'],['2010','două mii zece'],['2030','două mii treizeci'],
    ['14/11/2026','paisprezece noiembrie două mii douăzeci și șase'],['14 noiembrie 2026','paisprezece noiembrie două mii douăzeci și șase'],['2026-11-14','paisprezece noiembrie două mii douăzeci și șase'],
    ['14:30','paisprezece și treizeci'],['9:05','nouă și cinci'],['10:00','zece fix'],
    ['al 1-lea','primul'],['al 2-lea','al doilea'],['al 3-lea','al treilea'],['1,5','unu virgulă cinci'],['0,05','zero virgulă zero cinci'],['12,75','douăsprezece virgulă șapte cinci'],
    ['1.000','o mie'],['2.026','două mii douăzeci și șase'],['12 000','douăsprezece mii'],['25%','douăzeci și cinci la sută'],['1%','unu la sută'],
    ['1 RON','un leu'],['2 RON','doi lei'],['0,50 RON','cincizeci de bani'],['0.9.39','zero punct nouă punct treizeci și nouă'],['1.2.3','unu punct doi punct trei'],
    ['3-5','trei până la cinci'],['10–20','zece până la douăzeci'],['2025-2026','două mii douăzeci și cinci până la două mii douăzeci și șase'],
    ['31','treizeci și unu'],
  ],
  ja: [
    ['0','零'],['1','一'],['2','二'],['11','十一'],['21','二十一'],['28','二十八'],['100','百'],['101','百一'],['1000','千'],['2000','二千'],
    ['2026','二千二十六'],['1999','千九百九十九'],['2001','二千一'],['2010','二千十'],['2030','二千三十'],
    ['14/11/2026','二千二十六年十一月十四日'],['1/1/2001','二千一年一月一日'],['2026-11-14','二千二十六年十一月十四日'],
    ['14:30','十四時三十分'],['9:05','九時五分'],['10:00','十時'],
    ['第1','第一'],['第2','第二'],['第3','第三'],['1.5','一 点 五'],['0.05','零 点 零 五'],['12.75','十二 点 七 五'],
    ['1,000','千'],['2,026','二千二十六'],['12 000','一万二千'],['25%','二十五 パーセント'],['1%','一 パーセント'],
    ['¥1','一円'],['2 JPY','二円'],['¥50','五十円'],['0.9.39','零 点 九 点 三十九'],['1.2.3','一 点 二 点 三'],
    ['3-5','三 から 五'],['10–20','十 から 二十'],['2025-2026','二千二十五 から 二千二十六'],
    ['300','三百'],
  ],
};
for (const [lang, inputs] of Object.entries(cases)) describe(`${lang} spoken numbers${['ru','ro','ja'].includes(lang) ? ' (needs a native check)' : ''}`, () => {
  it('has at least forty authored cases', () => expect(inputs.length).toBeGreaterThanOrEqual(40));
  it.each(inputs)('%s -> %s', (source, expected) => expect(normalize(source,lang)).toBe(expected));
});

describe('language spans', () => {
  it('keeps currency amounts together for native-language normalization', () => {
    expect(languageSpans('Costă 1 RON.', 'ro')).toEqual([{text:'Costă 1 RON.',lang:'ro'}]);
    expect(normalize('Versione 0.9.39.', 'it')).toBe('Versione zero punto nove punto trentanove.');
  });
  it.each(['it','ru','ro','ja'])('uses English for File and the same surrounding text in %s', lang => {
    const text = {it:'Apri File adesso.',ru:'Откройте File сейчас.',ro:'Deschide File acum.',ja:'Fileを開いてください。'}[lang];
    const parts = languageSpans(text,lang);
    expect(parts.map((p:any)=>p.text).join('')).toBe(text);
    expect(parts.find((p:any)=>p.lang==='en').text.trim()).toBe('File');
  });
  it('joins consecutive English words and spells acronyms in English', () => {
    expect(languageSpans('Apri Microsoft PowerPoint e PDF.', 'it').filter((p:any)=>p.lang==='en').map((p:any)=>p.text.trim())).toEqual(['Microsoft PowerPoint','PDF.']);
  });
  it('uses quoted screen labels without making arbitrary Italian labels English', () => {
    expect(languageSpans('Premi "Save Everything".', 'it', ['Save Everything']).filter((p:any)=>p.lang==='en')[0].text).toContain('Save Everything');
    expect(languageSpans('Premi "Salva tutto".', 'it', ['Salva tutto']).every((p:any)=>p.lang==='it')).toBe(true);
  });
  it('does not infer a language from title case', () => expect(languageSpans('Questo Documento Rimane Disponibile.', 'it')).toEqual([{text:'Questo Documento Rimane Disponibile.',lang:'it'}]));
});
describe('audio tails and joins', () => {
  it('pads a truncated wave and makes the last 20 ms silent', () => {
    const out = finishAudio(new Float32Array(1000).fill(.5),1000);
    expect(out.length).toBe(1080);
    expect(Math.max(...out.slice(-20).map(Math.abs))).toBeLessThan(.0005);
    expect(out[999]).toBe(0);
    expect(out[980]).toBeGreaterThan(out[990]);
  });
  it('preserves a quiet consonant tail below the old threshold', () => {
    const raw = new Float32Array(1500);raw.fill(.5,100,500);raw.fill(.002,500,900);
    const out = finishAudio(raw,1000);
    expect(out.length).toBe(920);
    expect(out[800]).toBeCloseTo(.002);
  });
  it('crossfades opposite samples instead of making a discontinuity', () => {
    const out = crossfade(new Float32Array(20).fill(.5),new Float32Array(20).fill(-.5),1000);
    expect(out.length).toBe(32);
    expect(Math.max(...out.slice(1).map((x:number,i:number)=>Math.abs(x-out[i])))).toBeLessThan(.12);
  });
  it('does not add silence inside a language switch', () => expect(finishAudio(new Float32Array(100).fill(.5),1000,.003,true).length).toBe(100));
});

// Spoken forms a first review found wrong (2026-11-14). Sources: DOOM-style school grammar for Romanian
// (ora două, douăzeci și două), Zanichelli "Che ora è?" (l'una, all'una e mezza), standard Japanese
// time reading (3:00 = 三時), Russian fractional numerals (2,5 процента). RU, RO, JA: needs a native check.
describe('clock times and fractional percentages', () => {
  it.each([
    ['ro', 'Ne vedem la 2:10.', 'Ne vedem la două și zece.'],
    ['ro', 'Filmul începe la 22:15.', 'Filmul începe la douăzeci și două și cincisprezece.'],
    ['ro', 'Ajung la 14:02.', 'Ajung la paisprezece și două.'],
    ['ro', 'Trenul pleacă la 12:30.', 'Trenul pleacă la douăsprezece și treizeci.'],
    ['ro', 'Vin la 1:00.', 'Vin la unu fix.'],
    ['ro', 'Ajung la 21:05.', 'Ajung la douăzeci și unu și cinci.'],
    ['ro', 'Scade cu 2%.', 'Scade cu doi la sută.'],
    ['ro', 'Am 2 și 22.', 'Am doi și douăzeci și doi.'],
    ['ro', 'Între 2-3.', 'Între doi până la trei.'],
    ['it', 'Ci vediamo alle 1:30.', "Ci vediamo all'una e trenta."],
    ['it', 'Arrivo alle 1:00.', "Arrivo all'una in punto."],
    ['it', 'Dalle 1:15 siamo aperti.', "Dall'una e quindici siamo aperti."],
    ['it', 'Sono le 1:05.', "Sono l'una e cinque."],
    // A bare "a" is left alone: "pari a 1:30" and "a 1:45 dal primo" are not times of day.
    ['it', 'Parte a 1:20.', 'Parte a una e venti.'],
    ['it', 'Da 1:30 a 1:45.', 'Da una e trenta a una e quarantacinque.'],
    ['it', 'Mandale 1:30 foto.', 'Mandale una e trenta foto.'],
    ['it', 'Elle 1:30.', 'Elle una e trenta.'],
    ['it', 'Da 1:30 a 2:30.', 'Da una e trenta a due e trenta.'],
    ['it', 'Dalle 13:00 alle 1:00.', "Dalle tredici in punto all'una in punto."],
    ['it', 'Parte alle 13:01.', 'Parte alle tredici e uno.'],
    ['it', 'Sono le 21:00.', 'Sono le ventuno in punto.'],
    ['it', 'Alle 11:30 chiude.', 'Alle undici e trenta chiude.'],
    ['ja', '会議は3:00からです。', '会議は三時からです。'],
    ['ja', '0:00に終わります。', '零時に終わります。'],
    ['ja', '電車は14:05に出ます。', '電車は十四時五分に出ます。'],
    ['ru', 'Рост 2,5%.', 'Рост две целых пять десятых процента.'],
    ['ru', 'Рост 0,5%.', 'Рост ноль целых пять десятых процента.'],
    ['ru', 'Рост 22,1%.', 'Рост двадцать две целых одна десятая процента.'],
    ['ru', 'Рост 21%.', 'Рост двадцать один процент.'],
    ['ru', 'Рост 25%.', 'Рост двадцать пять процентов.'],
    ['ru', 'Рост 2%.', 'Рост два процента.'],
    ['ru', 'Рост 2,1234%.', 'Рост два запятая один два три четыре процента.'],
    ['ru', 'Рост 1.000%.', 'Рост одна тысяча процентов.'],
    ['ru', 'Спад -1%.', 'Спад минус один процент.'],
    ['ru', 'Рост 101%.', 'Рост сто один процент.'],
    ['ru', 'Рост 111%.', 'Рост сто одиннадцать процентов.'],
    ['en', 'It starts at 1:30.', 'It starts at one thirty.'],
  ])('%s: %s -> %s', (lang, source, expected) => expect(normalize(source, lang)).toBe(expected));
});
