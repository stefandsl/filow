// n2words 6.3.0, MIT. Context rules below are deliberately bounded, not a grammar parser.
const converters = Object.fromEntries(['en', 'it', 'ru', 'ro', 'ja'].map(l => [l, require(`n2words/${l}`)]));
const MONTHS = {
  en: 'January February March April May June July August September October November December'.split(' '),
  it: 'gennaio febbraio marzo aprile maggio giugno luglio agosto settembre ottobre novembre dicembre'.split(' '),
  ru: 'января февраля марта апреля мая июня июля августа сентября октября ноября декабря'.split(' '),
  ro: 'ianuarie februarie martie aprilie mai iunie iulie august septembrie octombrie noiembrie decembrie'.split(' '),
};
const word = (n, l, options) => converters[l].toCardinal(String(n), options);
function ordinal(n, l, form = '') {
  let s = converters[l].toOrdinal(Number(n));
  // Russian years are said "тысяча девятьсот ...", never "одна тысяча девятьсот ...".
  if (l === 'ru') s = s.replace(/^одна тысяча/, 'тысяча');
  if (l === 'it' && form === 'ª') s = s.replace(/o$/, 'a');
  if (l === 'ru') {
    if (form === 'gen') s = s.replace(/третий$/, 'третьего').replace(/(?:ый|ой|ий)$/, 'ого');
    if (form === 'prep') s = s.replace(/третий$/, 'третьем').replace(/(?:ый|ой|ий)$/, 'ом');
    if (form === 'neuter') s = s.replace(/третий$/, 'третье').replace(/(?:ый|ой|ий)$/, 'ое');
    if (form === 'я') s = s.replace(/третий$/, 'третья').replace(/(?:ый|ой|ий)$/, 'ая');
  }
  return s;
}
function date(d, m, y, l) {
  d = Number(d); m = Number(m); y = Number(y);
  const valid = new Date(Date.UTC(y, m-1, d));
  if (y < 1000 || y > 9999 || valid.getUTCDate() !== d || valid.getUTCMonth() !== m-1) return null;
  if (l === 'ja') return `${word(y,l)}年${word(m,l)}月${word(d,l)}日`;
  if (l === 'ru') return `${ordinal(d,l,'gen')} ${MONTHS.ru[m-1]} ${ordinal(y,l,'gen')} года`;
  const day = l === 'en' ? ordinal(d,l) : l === 'it' && d === 1 ? 'primo' : word(d,l);
  return `${day} ${MONTHS[l][m-1]} ${word(y,l)}`;
}
// Currency names: [one, many, one minor, many minor]; Russian: [one, few, many] for major then minor units.
const CURRENCY = {
  en: {EUR:['euro','euros','cent','cents'],USD:['dollar','dollars','cent','cents'],GBP:['pound','pounds','penny','pence'],JPY:['yen','yen','',''],RUB:['ruble','rubles','kopeck','kopecks'],RON:['leu','lei','ban','bani']},
  it: {EUR:['euro','euro','centesimo','centesimi'],USD:['dollaro','dollari','centesimo','centesimi'],GBP:['sterlina','sterline','penny','pence'],JPY:['yen','yen','',''],RUB:['rublo','rubli','copeco','copechi'],RON:['leu','lei','ban','bani']},
  ro: {EUR:['euro','euro','cent','cenți'],USD:['dolar','dolari','cent','cenți'],GBP:['liră','lire','penny','pence'],JPY:['yen','yeni','',''],RUB:['rublă','ruble','copeică','copeici'],RON:['leu','lei','ban','bani']},
  ru: {EUR:['евро','евро','евро','цент','цента','центов'],USD:['доллар','доллара','долларов','цент','цента','центов'],GBP:['фунт','фунта','фунтов','пенни','пенни','пенни'],JPY:['иена','иены','иен','','',''],RUB:['рубль','рубля','рублей','копейка','копейки','копеек'],RON:['лей','лея','леев','бань','бани','бань']},
  ja: {EUR:'ユーロ',USD:'ドル',GBP:'ポンド',JPY:'円',RUB:'ルーブル',RON:'レイ'},
};
// English years are said in pairs: nineteen ninety-nine, nineteen oh five, twenty twenty-one, two thousand five.
function yearEn(y) {
  y = Number(y);
  const hi = Math.floor(y / 100), lo = y % 100;
  if (y < 1100 || y > 2099 || (hi === 20 && lo < 10)) return word(y,'en');
  return `${word(hi,'en')} ${lo === 0 ? 'hundred' : lo < 10 ? 'oh ' + word(lo,'en') : word(lo,'en')}`;
}
const pluralRu = (n, forms) => forms[n % 100 >= 11 && n % 100 <= 14 ? 2 : n % 10 === 1 ? 0 : n % 10 >= 2 && n % 10 <= 4 ? 1 : 2];
function ruGenitive(n) {
  const forms = {
    ноль:'нуля',один:'одного',одна:'одной',два:'двух',две:'двух',три:'трёх',четыре:'четырёх',
    пять:'пяти',шесть:'шести',семь:'семи',восемь:'восьми',девять:'девяти',десять:'десяти',
    одиннадцать:'одиннадцати',двенадцать:'двенадцати',тринадцать:'тринадцати',четырнадцать:'четырнадцати',
    пятнадцать:'пятнадцати',шестнадцать:'шестнадцати',семнадцать:'семнадцати',восемнадцать:'восемнадцати',девятнадцать:'девятнадцати',
    двадцать:'двадцати',тридцать:'тридцати',сорок:'сорока',пятьдесят:'пятидесяти',шестьдесят:'шестидесяти',
    семьдесят:'семидесяти',восемьдесят:'восьмидесяти',девяносто:'девяноста',сто:'ста',двести:'двухсот',
    триста:'трёхсот',четыреста:'четырёхсот',пятьсот:'пятисот',шестьсот:'шестисот',семьсот:'семисот',восемьсот:'восьмисот',девятьсот:'девятисот',
    тысяча:'тысячи',тысячи:'тысяч',тысяч:'тысяч',миллион:'миллиона',миллиона:'миллионов',миллионов:'миллионов',
  };
  return word(n,'ru').split(' ').map(w=>forms[w]??w).join(' ');
}
function clock(h, m, l) {
  h = Number(h); m = Number(m);
  // A full hour is said without minutes: 3:00 is 三時, not 三時零分.
  if (l === 'ja') return `${word(h,l)}時${m ? word(m,l) + '分' : ''}`;
  if (l === 'ru') return `${word(h,l)} ${pluralRu(h,['час','часа','часов'])} ${word(m,l,{gender:'feminine'})} ${pluralRu(m,['минута','минуты','минут'])}`;
  // One o'clock is feminine in Italian (l'una). The article in front of it is fixed in normalizeNumbers.
  if (l === 'it') return `${h === 1 ? 'una' : word(h,l)}${m ? ' e ' + word(m,l) : ' in punto'}`;
  // Romanian hours and minutes take "două" (ora două, douăzeci și două); "unu" stays (ora unu).
  const ro = n => word(n,l).replace(/doi$/, 'două');
  if (l === 'ro') return `${ro(h)}${m ? ' și ' + ro(m) : ' fix'}`;
  return `${word(h,l)}${m ? (m < 10 ? ' oh ' : ' ') + word(m,l) : " o'clock"}`;
}
function numeric(s, l) {
  s = s.replace(/[\s\u00a0\u202f]/g, '');
  let decimal = ['en','ja'].includes(l) ? '.' : ',';
  // Models also emit dot decimals in European prose; three digits remain grouping.
  if (decimal === ',' && /^-?\d+\.\d{1,2}$/.test(s)) decimal = '.';
  const grouping = decimal === '.' ? ',' : '.';
  s = s.split(grouping).join('');
  const parts = s.split(decimal);
  if (parts.length > 2 || !/^-?\d{1,12}$/.test(parts[0])) return null;
  if (parts.length === 1) return word(parts[0],l);
  if (!/^\d{1,6}$/.test(parts[1])) return null;
  if (l === 'ru' && parts[1].length <= 3) {
    const fraction = Number(parts[1]);
    const denominator = {1:['десятая','десятых','десятых'],2:['сотая','сотых','сотых'],3:['тысячная','тысячных','тысячных']}[parts[1].length];
    return `${word(parts[0],l,{gender:'feminine'})} ${pluralRu(Math.abs(Number(parts[0])),['целая','целых','целых'])} ${word(fraction,l,{gender:'feminine'})} ${pluralRu(fraction,denominator)}`;
  }
  const point = {en:'point',it:'virgola',ru:'запятая',ro:'virgulă',ja:'点'}[l];
  return `${word(parts[0],l)} ${point} ${[...parts[1]].map(n=>word(n,l)).join(' ')}`;
}
function normalizeNumbers(text, lang) {
  const l = converters[lang] ? lang : 'en';
  const kept = [];
  // Protect structured tokens before the broad number pass. Private-use placeholders have no digits.
  const hold = value => { kept.push(value); return String.fromCodePoint(0xF0000 + kept.length - 1); };
  let s = text;
  s = s.replace(/(?<![\p{L}\d.])\d+(?:\.\d+){2,}(?!\d|\.\d)/gu, v => hold(v.split('.').map(n=>word(n,l)).join(` ${{en:'dot',it:'punto',ru:'точка',ro:'punct',ja:'点'}[l]} `)));
  s = s.replace(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g, (v,y,m,d) => hold(date(d,m,y,l) ?? v));
  s = s.replace(/(?<!\d)(\d{1,2})\/(\d{1,2})\/(\d{4})(?!\d)/g, (v,d,m,y) => hold(date(d,m,y,l) ?? v));
  if (MONTHS[l]) {
    const months = MONTHS[l].join('|');
    s = s.replace(new RegExp(`(\\d{1,2}) (${months}) (\\d{4})(?: года)?`, 'gi'), (v,d,m,y) => hold(date(d,MONTHS[l].findIndex(a=>a.toLowerCase()===m.toLowerCase())+1,y,l) ?? v));
    if (l === 'en') s = s.replace(new RegExp(`(${months}) (\\d{1,2}),? (\\d{4})`, 'gi'), (v,m,d,y) => hold(date(d,MONTHS.en.findIndex(a=>a.toLowerCase()===m.toLowerCase())+1,y,l) ?? v));
  }
  if (l === 'it') {
    // "alle 1:30" is "all'una e trenta", "le 1:05" is "l'una e cinque": the article elides before "una".
    s = s.replace(/(?<![\p{L}\d])([Aa]|[Dd]a|[Dd]e|[Ss]u|[Nn]e)lle (0?1):([0-5]\d)(?![\d:])/gu, (_,p,h,m) => hold(`${p}ll'${clock(h,m,l)}`));
    s = s.replace(/(?<![\p{L}\d])([Ll])e (0?1):([0-5]\d)(?![\d:])/gu, (_,p,h,m) => hold(`${p}'${clock(h,m,l)}`));
  }
  s = s.replace(/(?<![\d:.])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])/g, (_,h,m) => hold(clock(h,m,l)));
  // Leave malformed clocks, ratios, IP addresses and identifiers intact.
  s = s.replace(/\d+(?:[.:]\d+)*:\d+(?::\d+)*/g, hold);
  if (l === 'ru') {
    s = s.replace(/(в|во) (\d{4}) году/gi, (_,p,y) => hold(`${p} ${ordinal(y,l,'prep')} году`));
    s = s.replace(/(\d{4}) года/g, (_,y) => hold(`${ordinal(y,l,'gen')} года`));
    s = s.replace(/(\d{4}) год(?![а-я])/g, (_,y) => hold(`${ordinal(y,l)} год`));
    s = s.replace(/(\d+) (минут[аыу]?|страниц[аыу]?|секунд[аыу]?)(?![а-я])/g, (_,n,noun) => hold(`${word(n,l,{gender:'feminine'})} ${noun}`));
  }
  if (l === 'en') {
    // A decade (the 1990s) or a year after a time preposition (in 1999, since 2021) is a year, not a count.
    s = s.replace(/\b(1[1-9]|20)(\d0)s\b/g, (_,a,b) => hold(yearEn(a + b).replace(/y$/, 'ie') + 's'));
    s = s.replace(/\b(in|since|from|to|until|by|before|after) (1[1-9]\d\d|20\d\d)\b(?![.,]\d)/gi, (_,p,y) => `${p} ${hold(yearEn(y))}`);
    s = s.replace(/\b([1-9]\d*)(?:st|nd|rd|th)\b/g, (_,n)=>hold(ordinal(n,l)));
  }
  if (l === 'it') s = s.replace(/\b([1-9]\d*)([°ºª])/g, (_,n,f)=>hold(ordinal(n,l,f)));
  if (l === 'ru') s = s.replace(/\b([1-9]\d*)-([йяе])/g, (_,n,f)=>hold(ordinal(n,l,f === 'е' ? 'neuter' : f)));
  if (l === 'ro') s = s.replace(/\bal ([1-9]\d*)-lea\b/g, (_,n)=>hold(ordinal(n,l)));
  if (l === 'ja') s = s.replace(/第(\d+)/g, (_,n)=>hold(ordinal(n,l)));
  const amount = '(?:\\d{1,3}(?:[., \\u00a0\\u202f]\\d{3})+|\\d+)(?:[.,]\\d{1,2})?';
  const currencies = {'€':'EUR','$':'USD','£':'GBP','₽':'RUB','¥':'JPY',EUR:'EUR',USD:'USD',GBP:'GBP',RUB:'RUB',RON:'RON',JPY:'JPY'};
  const money = (n,c) => {
    const decimal = ['en','ja'].includes(l) ? '.' : ',';
    const raw = n.replace(/[\s\u00a0\u202f]/g,'').split(decimal === '.' ? ',' : '.').join('').replace(decimal,'.');
    const code = currencies[c];
    if (l === 'ja') return `${numeric(n,l) ?? n}${CURRENCY.ja[code]}`;
    const [whole, cents = ''] = raw.split('.');
    const major = Number(whole), minor = Number(cents.padEnd(2,'0').slice(0,2));
    const [one, many, oneMinor, manyMinor] = CURRENCY[l][code];
    const count = (x, sing, plural, gen, feminine) => {
      if (l === 'ru') return `${word(x,l,feminine ? {gender:'feminine'} : undefined)} ${pluralRu(x,[sing,plural,gen])}`;
      const w = x === 1 ? {en:'one',it:'un',ro:'un'}[l] : word(x,l);
      const de = l === 'ro' && x >= 20 && (x % 100 === 0 || x % 100 >= 20) ? 'de ' : '';
      return `${w} ${de}${x === 1 ? sing : plural}`;
    };
    const ru = l === 'ru';
    const majorText = ru ? count(major, ...CURRENCY.ru[code].slice(0,3), code === 'JPY') : count(major, one, many);
    if (!minor) return majorText;
    const minorText = ru ? count(minor, ...CURRENCY.ru[code].slice(3,6), code === 'RUB') : count(minor, oneMinor, manyMinor);
    if (!major) return minorText;
    return `${majorText}${{en:' and ',it:' e ',ro:' \u0219i ',ru:' '}[l]}${minorText}`;
  };
  s = s.replace(new RegExp(`([€$£₽¥])\\s*(${amount})`, 'g'), (_,c,n)=>hold(money(n,c)));
  s = s.replace(new RegExp(`(${amount})\\s*(EUR|USD|GBP|RUB|RON|JPY|[€$£₽¥])`, 'g'), (_,n,c)=>hold(money(n,c)));
  // Japanese words have no spaces: a range before 日 or ページ is still a range.
  s = s.replace(l === 'ja' ? /(?<![A-Za-z\d])(\d+)\s*[-–]\s*(\d+)(?![A-Za-z\d])/gu : /(?<![\p{L}\d])(\d+)\s*[-–]\s*(\d+)(?![\p{L}\d])/gu, (_,a,b)=>hold(l === 'ru' ? `от ${ruGenitive(a)} до ${ruGenitive(b)}` : `${word(a,l)} ${{en:'to',it:'a',ro:'până la',ja:'から'}[l]} ${word(b,l)}`));
  const pattern = l === 'ja'
    ? /(?<![A-Za-z\d])(-?(?:\d{1,3}(?:[.,\u00a0\u202f ]\d{3})+|\d+)(?:[.,]\d+)?)(\s*%)?(?![A-Za-z\d])/gu
    : /(?<![\p{L}\d])(-?(?:\d{1,3}(?:[.,\u00a0\u202f ]\d{3})+|\d+)(?:[.,]\d+)?)(\s*%)?(?![\p{L}\d])/gu;
  s = s.replace(pattern, (v,n,pct) => {
    const value = numeric(n,l);
    // After a fraction the noun is genitive singular: 2,5 процента.
    const percent = l === 'ru' ? (/ цел(?:ая|ых) | запятая /.test(value ?? '') ? 'процента' : pluralRu(Math.abs(Number(n.replace(/[\s\u00a0\u202f.]/g, ''))) || 0,['процент','процента','процентов'])) : {en:'percent',it:'per cento',ro:'la sută',ja:'パーセント'}[l];
    return value === null ? v : value + (pct ? ` ${percent}` : '');
  });
  return s.replace(/[\u{F0000}-\u{FFFFD}]/gu, c => kept[c.codePointAt(0)-0xF0000] ?? c);
}
module.exports = { normalizeNumbers, clock, date };
