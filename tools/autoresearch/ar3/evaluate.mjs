// AR-3 FIXED evaluator: spoken forms of numbers, dates, times, years, versions, percentages and currency.
// The experimenting agent must never edit this file. The one editable file is apps/desktop/tts-numbers.js.
// See ../program.md.
//
//   node tools/autoresearch/ar3/evaluate.mjs [--split dev|heldout] > run.log 2>&1
//
// No model calls, no network. Loads the normaliser in this process and compares its output with the
// frozen expected spoken forms below. Score = percent exact matches per language (case-insensitive,
// whitespace collapsed; for Japanese all whitespace removed), averaged over the five languages.
// Split: in each language, item i is held out when i % 3 === 2 (20 items), the rest are dev (40 items).
// Misses are written to G:/FILOW/tmp/autoresearch/ar3/runs for the dev split only.
//
// The expected forms were written once on 2026-11-14 before the first experiment. Russian, Romanian and
// Japanese expected forms were written by an agent, not a native speaker: NEEDS A NATIVE CHECK.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const WORK = "G:/FILOW/tmp/autoresearch/ar3";
const LANGS = ["en", "it", "ru", "ro", "ja"];

export const NEEDS_NATIVE_CHECK = ["ru", "ro", "ja"];

// [input, expected spoken form]
export const ITEMS = {
  en: [
    ["I have 3 cats.", "I have three cats."],
    ["It costs $5.", "It costs five dollars."],
    ["It costs $5.50.", "It costs five dollars and fifty cents."],
    ["Pay €20 today.", "Pay twenty euros today."],
    ["About 1,234 people came.", "About one thousand two hundred thirty-four people came."],
    ["The total is 1,000,000.", "The total is one million."],
    ["It was -5 degrees.", "It was minus five degrees."],
    ["Pi is 3.14.", "Pi is three point one four."],
    ["Growth was 12%.", "Growth was twelve percent."],
    ["Only 0.5% failed.", "Only zero point five percent failed."],
    ["Meet at 9:30.", "Meet at nine thirty."],
    ["Meet at 14:05.", "Meet at fourteen oh five."],
    ["Call at 7:00.", "Call at seven o'clock."],
    ["Born on 2024-03-15.", "Born on March fifteenth twenty twenty-four."],
    ["Due 15/03/2024.", "Due March fifteenth twenty twenty-four."],
    ["On March 5, 2024 we met.", "On March fifth twenty twenty-four we met."],
    ["On 5 March 2024 we met.", "On March fifth twenty twenty-four we met."],
    ["In 1999 it began.", "In nineteen ninety-nine it began."],
    ["Since 2021 we grew.", "Since twenty twenty-one we grew."],
    ["In 2005 it ended.", "In two thousand five it ended."],
    ["Version 2.4.1 is out.", "Version two point four point one is out."],
    ["Update to v3.2 now.", "Update to version three point two now."],
    ["The 3rd item.", "The third item."],
    ["The 21st century.", "The twenty-first century."],
    ["Read pages 10-20.", "Read pages ten to twenty."],
    ["Rated 4.5 out of 5.", "Rated four point five out of five."],
    ["Price: £1,250.", "Price: one thousand two hundred fifty pounds."],
    ["Budget of 300 USD.", "Budget of three hundred dollars."],
    ["Save 25 %.", "Save twenty-five percent."],
    ["The year 2000 was big.", "The year two thousand was big."],
    ["Back in the 1990s.", "Back in the nineteen nineties."],
    ["At 12:00 sharp.", "At twelve o'clock sharp."],
    ["Train at 08:15.", "Train at eight fifteen."],
    ["We sold 15 units.", "We sold fifteen units."],
    ["Score: 100%.", "Score: one hundred percent."],
    ["Temperature 36.6.", "Temperature thirty-six point six."],
    ["Only $0.99.", "Only ninety-nine cents."],
    ["Costs $1.", "Costs one dollar."],
    ["A loan of $2,500,000.", "A loan of two million five hundred thousand dollars."],
    ["Wait 2-3 days.", "Wait two to three days."],
    ["The 100th visitor.", "The one hundredth visitor."],
    ["Release 10.0.1 is stable.", "Release ten point zero point one is stable."],
    ["Node 18 is required.", "Node eighteen is required."],
    ["From 2010 to 2020.", "From twenty ten to twenty twenty."],
    ["Back in 1066.", "Back in ten sixty-six."],
    ["On 2023-12-31 at 23:59.", "On December thirty-first twenty twenty-three at twenty-three fifty-nine."],
    ["It rose 3.5%.", "It rose three point five percent."],
    ["Pay 49.99 EUR.", "Pay forty-nine euros and ninety-nine cents."],
    ["Use Python 3.12 here.", "Use Python three point twelve here."],
    ["We have 7 days.", "We have seven days."],
    ["About 42 people.", "About forty-two people."],
    ["Exactly 1,001 nights.", "Exactly one thousand one nights."],
    ["In 1905 he wrote it.", "In nineteen oh five he wrote it."],
    ["The 2nd floor.", "The second floor."],
    ["The 12th rule.", "The twelfth rule."],
    ["Open at 6:45.", "Open at six forty-five."],
    ["Lost ¥500.", "Lost five hundred yen."],
    ["Up 0.25%.", "Up zero point two five percent."],
    ["Room for 250 guests.", "Room for two hundred fifty guests."],
    ["The 1800s were long.", "The eighteen hundreds were long."],
  ],
  it: [
    ["Ho 3 gatti.", "Ho tre gatti."],
    ["Costa 5 €.", "Costa cinque euro."],
    ["Costa €5,50.", "Costa cinque euro e cinquanta centesimi."],
    ["Paga 20 euro oggi.", "Paga venti euro oggi."],
    ["Sono venute 1.234 persone.", "Sono venute milleduecentotrentaquattro persone."],
    ["Il totale è 1.000.000.", "Il totale è un milione."],
    ["C'erano -5 gradi.", "C'erano meno cinque gradi."],
    ["Pi greco vale 3,14.", "Pi greco vale tre virgola quattordici."],
    ["La crescita è stata del 12%.", "La crescita è stata del dodici per cento."],
    ["Solo lo 0,5% ha fallito.", "Solo lo zero virgola cinque per cento ha fallito."],
    ["Ci vediamo alle 9:30.", "Ci vediamo alle nove e trenta."],
    ["Ci vediamo alle 14:05.", "Ci vediamo alle quattordici e cinque."],
    ["Chiama alle 7:00.", "Chiama alle sette in punto."],
    ["Nato il 2024-03-15.", "Nato il quindici marzo duemilaventiquattro."],
    ["Scade il 15/03/2024.", "Scade il quindici marzo duemilaventiquattro."],
    ["Il 5 marzo 2024 ci siamo visti.", "Il cinque marzo duemilaventiquattro ci siamo visti."],
    ["Il 1 marzo 2024 è sabato.", "Il primo marzo duemilaventiquattro è sabato."],
    ["Nel 1999 è iniziato.", "Nel millenovecentonovantanove è iniziato."],
    ["Dal 2021 cresciamo.", "Dal duemilaventuno cresciamo."],
    ["Nel 2005 è finito.", "Nel duemilacinque è finito."],
    ["È uscita la versione 2.4.1.", "È uscita la versione due punto quattro punto uno."],
    ["Aggiorna alla v3.2 ora.", "Aggiorna alla versione tre punto due ora."],
    ["Il 3° elemento.", "Il terzo elemento."],
    ["La 2ª volta.", "La seconda volta."],
    ["Leggi le pagine 10-20.", "Leggi le pagine da dieci a venti."],
    ["Voto 4,5 su 5.", "Voto quattro virgola cinque su cinque."],
    ["Prezzo: 1.250 €.", "Prezzo: milleduecentocinquanta euro."],
    ["Budget di 300 USD.", "Budget di trecento dollari."],
    ["Risparmia il 25 %.", "Risparmia il venticinque per cento."],
    ["L'anno 2000 è stato importante.", "L'anno duemila è stato importante."],
    ["Negli anni '90.", "Negli anni novanta."],
    ["Alle 12:00 in punto.", "Alle dodici in punto."],
    ["Il treno delle 08:15.", "Il treno delle otto e quindici."],
    ["Abbiamo venduto 15 pezzi.", "Abbiamo venduto quindici pezzi."],
    ["Punteggio: 100%.", "Punteggio: cento per cento."],
    ["Temperatura 36,6.", "Temperatura trentasei virgola sei."],
    ["Solo 0,99 €.", "Solo novantanove centesimi."],
    ["Costa 1 €.", "Costa un euro."],
    ["Un prestito di 2.500.000 €.", "Un prestito di due milioni cinquecentomila euro."],
    ["Aspetta 2-3 giorni.", "Aspetta da due a tre giorni."],
    ["Il 100° visitatore.", "Il centesimo visitatore."],
    ["La release 10.0.1 è stabile.", "La release dieci punto zero punto uno è stabile."],
    ["Serve Node 18.", "Serve Node diciotto."],
    ["Dal 2010 al 2020.", "Dal duemiladieci al duemilaventi."],
    ["Nel 1066.", "Nel millesessantasei."],
    ["Il 2023-12-31 alle 23:59.", "Il trentuno dicembre duemilaventitré alle ventitré e cinquantanove."],
    ["È salito del 3,5%.", "È salito del tre virgola cinque per cento."],
    ["Paga 49,99 EUR.", "Paga quarantanove euro e novantanove centesimi."],
    ["Usa Python 3.12 qui.", "Usa Python tre punto dodici qui."],
    ["Abbiamo 7 giorni.", "Abbiamo sette giorni."],
    ["Circa 42 persone.", "Circa quarantadue persone."],
    ["Esattamente 1.001 notti.", "Esattamente milleuno notti."],
    ["Nel 1905 lo scrisse.", "Nel millenovecentocinque lo scrisse."],
    ["Il 2° piano.", "Il secondo piano."],
    ["La 12ª regola.", "La dodicesima regola."],
    ["Apre alle 6:45.", "Apre alle sei e quarantacinque."],
    ["Ha perso 500 ¥.", "Ha perso cinquecento yen."],
    ["Su dello 0,25%.", "Su dello zero virgola venticinque per cento."],
    ["Posto per 250 ospiti.", "Posto per duecentocinquanta ospiti."],
    ["Alle 1:20 parto.", "All'una e venti parto."],
  ],
  // NEEDS A NATIVE CHECK (expected forms written by an agent).
  ru: [
    ["У меня 3 кошки.", "У меня три кошки."],
    ["Стоит 5 €.", "Стоит пять евро."],
    ["Стоит 5,50 €.", "Стоит пять евро пятьдесят центов."],
    ["Заплати 20 рублей сегодня.", "Заплати двадцать рублей сегодня."],
    ["Пришли 1 234 человека.", "Пришли тысяча двести тридцать четыре человека."],
    ["Итого 1 000 000.", "Итого один миллион."],
    ["Было -5 градусов.", "Было минус пять градусов."],
    ["Число пи равно 3,14.", "Число пи равно три целых четырнадцать сотых."],
    ["Рост составил 12%.", "Рост составил двенадцать процентов."],
    ["Только 0,5% не прошли.", "Только ноль целых пять десятых процента не прошли."],
    ["Встречаемся в 9:30.", "Встречаемся в девять часов тридцать минут."],
    ["Встречаемся в 14:05.", "Встречаемся в четырнадцать часов пять минут."],
    ["Позвони в 7:00.", "Позвони в семь часов."],
    ["Родился 2024-03-15.", "Родился пятнадцатого марта две тысячи двадцать четвёртого года."],
    ["Сдать до 15.03.2024.", "Сдать до пятнадцатого марта две тысячи двадцать четвёртого года."],
    ["Мы виделись 5 марта 2024 года.", "Мы виделись пятого марта две тысячи двадцать четвёртого года."],
    ["В 1999 году всё началось.", "В тысяча девятьсот девяносто девятом году всё началось."],
    ["С 2021 года мы растём.", "С две тысячи двадцать первого года мы растём."],
    ["В 2005 году всё закончилось.", "В две тысячи пятом году всё закончилось."],
    ["Вышла версия 2.4.1.", "Вышла версия два точка четыре точка один."],
    ["Обнови до v3.2 сейчас.", "Обнови до версии три точка два сейчас."],
    ["3-й элемент.", "Третий элемент."],
    ["2-я попытка.", "Вторая попытка."],
    ["Читай страницы 10-20.", "Читай страницы от десяти до двадцати."],
    ["Оценка 4,5 из 5.", "Оценка четыре целых пять десятых из пяти."],
    ["Цена: 1 250 ₽.", "Цена: тысяча двести пятьдесят рублей."],
    ["Бюджет 300 USD.", "Бюджет триста долларов."],
    ["Сэкономь 25 %.", "Сэкономь двадцать пять процентов."],
    ["2000 год был важным.", "Двухтысячный год был важным."],
    ["В 1990-х годах.", "В тысяча девятьсот девяностых годах."],
    ["Ровно в 12:00.", "Ровно в двенадцать часов."],
    ["Поезд в 08:15.", "Поезд в восемь часов пятнадцать минут."],
    ["Мы продали 15 штук.", "Мы продали пятнадцать штук."],
    ["Результат: 100%.", "Результат: сто процентов."],
    ["Температура 36,6.", "Температура тридцать шесть целых шесть десятых."],
    ["Всего 0,99 €.", "Всего девяносто девять центов."],
    ["Стоит 1 ₽.", "Стоит один рубль."],
    ["Кредит 2 500 000 ₽.", "Кредит два миллиона пятьсот тысяч рублей."],
    ["Подожди 2-3 дня.", "Подожди от двух до трёх дней."],
    ["100-й посетитель.", "Сотый посетитель."],
    ["Релиз 10.0.1 стабилен.", "Релиз десять точка ноль точка один стабилен."],
    ["Нужен Node 18.", "Нужен Node восемнадцать."],
    ["С 2010 по 2020 год.", "С две тысячи десятого по две тысячи двадцатый год."],
    ["В 1066 году.", "В тысяча шестьдесят шестом году."],
    ["2023-12-31 в 23:59.", "Тридцать первого декабря две тысячи двадцать третьего года в двадцать три часа пятьдесят девять минут."],
    ["Вырос на 3,5%.", "Вырос на три целых пять десятых процента."],
    ["Заплати 49,99 EUR.", "Заплати сорок девять евро девяносто девять центов."],
    ["Используй Python 3.12 здесь.", "Используй Python три точка двенадцать здесь."],
    ["У нас 7 дней.", "У нас семь дней."],
    ["Около 42 человек.", "Около сорока двух человек."],
    ["Ровно 1 001 ночь.", "Ровно тысяча одна ночь."],
    ["Прошло 5 минут.", "Прошло пять минут."],
    ["Это 21 страница.", "Это двадцать одна страница."],
    ["Открыто в 6:45.", "Открыто в шесть часов сорок пять минут."],
    ["Потерял 500 ¥.", "Потерял пятьсот иен."],
    ["Плюс 0,25%.", "Плюс ноль целых двадцать пять сотых процента."],
    ["Места для 250 гостей.", "Места для двухсот пятидесяти гостей."],
    ["В 1:20 я ухожу.", "В час двадцать минут я ухожу."],
    ["Это заняло 2 секунды.", "Это заняло две секунды."],
    ["Ему 21 год.", "Ему двадцать один год."],
  ],
  // NEEDS A NATIVE CHECK (expected forms written by an agent).
  ro: [
    ["Am 3 pisici.", "Am trei pisici."],
    ["Costă 5 €.", "Costă cinci euro."],
    ["Costă 5,50 €.", "Costă cinci euro și cincizeci de cenți."],
    ["Plătește 20 de lei azi.", "Plătește douăzeci de lei azi."],
    ["Au venit 1.234 de oameni.", "Au venit o mie două sute treizeci și patru de oameni."],
    ["Totalul este 1.000.000.", "Totalul este un milion."],
    ["Au fost -5 grade.", "Au fost minus cinci grade."],
    ["Pi este 3,14.", "Pi este trei virgulă paisprezece."],
    ["Creșterea a fost de 12%.", "Creșterea a fost de doisprezece la sută."],
    ["Doar 0,5% au eșuat.", "Doar zero virgulă cinci la sută au eșuat."],
    ["Ne vedem la 9:30.", "Ne vedem la nouă și treizeci."],
    ["Ne vedem la 14:05.", "Ne vedem la paisprezece și cinci."],
    ["Sună la 7:00.", "Sună la șapte fix."],
    ["Născut pe 2024-03-15.", "Născut pe cincisprezece martie două mii douăzeci și patru."],
    ["Termen 15/03/2024.", "Termen cincisprezece martie două mii douăzeci și patru."],
    ["Pe 5 martie 2024 ne-am văzut.", "Pe cinci martie două mii douăzeci și patru ne-am văzut."],
    ["În 1999 a început.", "În o mie nouă sute nouăzeci și nouă a început."],
    ["Din 2021 creștem.", "Din două mii douăzeci și unu creștem."],
    ["În 2005 s-a terminat.", "În două mii cinci s-a terminat."],
    ["A apărut versiunea 2.4.1.", "A apărut versiunea doi punct patru punct unu."],
    ["Actualizează la v3.2 acum.", "Actualizează la versiunea trei punct doi acum."],
    ["Al 3-lea element.", "Al treilea element."],
    ["Citește paginile 10-20.", "Citește paginile zece până la douăzeci."],
    ["Nota 4,5 din 5.", "Nota patru virgulă cinci din cinci."],
    ["Preț: 1.250 RON.", "Preț: o mie două sute cincizeci de lei."],
    ["Buget de 300 USD.", "Buget de trei sute de dolari."],
    ["Economisește 25 %.", "Economisește douăzeci și cinci la sută."],
    ["Anul 2000 a fost important.", "Anul două mii a fost important."],
    ["În anii '90.", "În anii nouăzeci."],
    ["La 12:00 fix.", "La douăsprezece fix."],
    ["Trenul de la 08:15.", "Trenul de la opt și cincisprezece."],
    ["Am vândut 15 bucăți.", "Am vândut cincisprezece bucăți."],
    ["Scor: 100%.", "Scor: o sută la sută."],
    ["Temperatura 36,6.", "Temperatura treizeci și șase virgulă șase."],
    ["Doar 0,99 €.", "Doar nouăzeci și nouă de cenți."],
    ["Costă 1 €.", "Costă un euro."],
    ["Un credit de 2.500.000 €.", "Un credit de două milioane cinci sute de mii de euro."],
    ["Așteaptă 2-3 zile.", "Așteaptă două până la trei zile."],
    ["Al 100-lea vizitator.", "Al o sutălea vizitator."],
    ["Versiunea 10.0.1 este stabilă.", "Versiunea zece punct zero punct unu este stabilă."],
    ["Trebuie Node 18.", "Trebuie Node optsprezece."],
    ["Din 2010 până în 2020.", "Din două mii zece până în două mii douăzeci."],
    ["În 1066.", "În o mie șaizeci și șase."],
    ["Pe 2023-12-31 la 23:59.", "Pe treizeci și unu decembrie două mii douăzeci și trei la douăzeci și trei și cincizeci și nouă."],
    ["A crescut cu 3,5%.", "A crescut cu trei virgulă cinci la sută."],
    ["Plătește 49,99 EUR.", "Plătește patruzeci și nouă de euro și nouăzeci și nouă de cenți."],
    ["Folosește Python 3.12 aici.", "Folosește Python trei punct doisprezece aici."],
    ["Avem 7 zile.", "Avem șapte zile."],
    ["Cam 42 de oameni.", "Cam patruzeci și doi de oameni."],
    ["Exact 1.500 de pași.", "Exact o mie cinci sute de pași."],
    ["În 1905 a scris-o.", "În o mie nouă sute cinci a scris-o."],
    ["La 2:00 plecăm.", "La două fix plecăm."],
    ["La 1:20 plec.", "La unu și douăzeci plec."],
    ["Deschide la 6:45.", "Deschide la șase și patruzeci și cinci."],
    ["A pierdut 500 ¥.", "A pierdut cinci sute de yeni."],
    ["Plus 0,25%.", "Plus zero virgulă douăzeci și cinci la sută."],
    ["Loc pentru 250 de invitați.", "Loc pentru două sute cincizeci de invitați."],
    ["Am 2 copii.", "Am doi copii."],
    ["Avem 12 mere.", "Avem douăsprezece mere."],
    ["Sunt 22 de elevi.", "Sunt douăzeci și doi de elevi."],
  ],
  // NEEDS A NATIVE CHECK (expected forms written by an agent).
  ja: [
    ["猫が3匹います。", "猫が三匹います。"],
    ["5ドルです。", "五ドルです。"],
    ["5.50ドルです。", "五点五零ドルです。"],
    ["今日20ユーロ払います。", "今日二十ユーロ払います。"],
    ["1,234人が来ました。", "千二百三十四人が来ました。"],
    ["合計は1,000,000です。", "合計は百万です。"],
    ["-5度でした。", "マイナス五度でした。"],
    ["円周率は3.14です。", "円周率は三点一四です。"],
    ["成長率は12%でした。", "成長率は十二パーセントでした。"],
    ["0.5%だけ失敗しました。", "零点五パーセントだけ失敗しました。"],
    ["9:30に会いましょう。", "九時三十分に会いましょう。"],
    ["14:05に会いましょう。", "十四時五分に会いましょう。"],
    ["7:00に電話して。", "七時に電話して。"],
    ["2024-03-15生まれ。", "二千二十四年三月十五日生まれ。"],
    ["締め切りは2024年3月15日。", "締め切りは二千二十四年三月十五日。"],
    ["1999年に始まった。", "千九百九十九年に始まった。"],
    ["2021年から成長しています。", "二千二十一年から成長しています。"],
    ["バージョン2.4.1が出ました。", "バージョン二点四点一が出ました。"],
    ["v3.2に更新して。", "バージョン三点二に更新して。"],
    ["第3章です。", "第三章です。"],
    ["10-20ページを読んで。", "十から二十ページを読んで。"],
    ["5点中4.5点。", "五点中四点五点。"],
    ["価格は¥1,250です。", "価格は千二百五十円です。"],
    ["予算は300 USDです。", "予算は三百ドルです。"],
    ["25 %節約。", "二十五パーセント節約。"],
    ["2000年は大事な年でした。", "二千年は大事な年でした。"],
    ["12:00ちょうどに。", "十二時ちょうどに。"],
    ["08:15の電車。", "八時十五分の電車。"],
    ["15個売れました。", "十五個売れました。"],
    ["スコアは100%。", "スコアは百パーセント。"],
    ["体温は36.6度。", "体温は三十六点六度。"],
    ["たった0.99ドル。", "たった零点九九ドル。"],
    ["¥1です。", "一円です。"],
    ["¥2,500,000の融資。", "二百五十万円の融資。"],
    ["2-3日待って。", "二から三日待って。"],
    ["第100回の大会。", "第百回の大会。"],
    ["リリース10.0.1は安定版です。", "リリース十点零点一は安定版です。"],
    ["Node 18が必要です。", "Node十八が必要です。"],
    ["2010年から2020年まで。", "二千十年から二千二十年まで。"],
    ["1066年のこと。", "千六十六年のこと。"],
    ["2023-12-31の23:59。", "二千二十三年十二月三十一日の二十三時五十九分。"],
    ["3.5%上がった。", "三点五パーセント上がった。"],
    ["49.99 EURを払って。", "四十九点九九ユーロを払って。"],
    ["ここでPython 3.12を使って。", "ここでPython三点十二を使って。"],
    ["7日あります。", "七日あります。"],
    ["約42人です。", "約四十二人です。"],
    ["ちょうど1,001夜。", "ちょうど千一夜。"],
    ["1905年に書いた。", "千九百五年に書いた。"],
    ["2階です。", "二階です。"],
    ["第12条。", "第十二条。"],
    ["6:45に開きます。", "六時四十五分に開きます。"],
    ["¥500をなくした。", "五百円をなくした。"],
    ["0.25%上昇。", "零点二五パーセント上昇。"],
    ["250人の席。", "二百五十人の席。"],
    ["1:20に出ます。", "一時二十分に出ます。"],
    ["3時に会おう。", "三時に会おう。"],
    ["2024/03/15に提出。", "二千二十四年三月十五日に提出。"],
    ["100円です。", "百円です。"],
    ["10%オフ。", "十パーセントオフ。"],
    ["1万人が来た。", "一万人が来た。"],
  ],
};

export const splitOf = i => (i % 3 === 2 ? "heldout" : "dev");
export const normalise = (s, lang) => {
  const t = String(s ?? "").toLowerCase().normalize("NFC");
  return lang === "ja" ? t.replace(/\s+/gu, "") : t.replace(/\s+/gu, " ").trim();
};

export function score(normalizeNumbers, split) {
  const per = {};
  const misses = [];
  for (const lang of LANGS) {
    const items = ITEMS[lang].map((it, i) => [...it, i]).filter(([, , i]) => splitOf(i) === split);
    let ok = 0;
    for (const [input, expected, i] of items) {
      let got;
      try { got = normalizeNumbers(input, lang); } catch (e) { got = `THROW ${e.message}`; }
      if (normalise(got, lang) === normalise(expected, lang)) ok++;
      else misses.push({ lang, i, input, expected, got });
    }
    per[lang] = { n: items.length, ok, score: (100 * ok) / items.length };
  }
  return { per, misses, score: LANGS.reduce((s, l) => s + per[l].score, 0) / LANGS.length };
}

function main() {
  const started = Date.now();
  const args = process.argv.slice(2);
  const split = args.includes("--split") ? args[args.indexOf("--split") + 1] : "dev";
  if (split !== "dev" && split !== "heldout") throw Error("--split must be dev or heldout");
  for (const l of LANGS) if (ITEMS[l].length !== 60) throw Error(`${l} has ${ITEMS[l].length} items, not 60`);
  const commit = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();
  let s; let crashed = null;
  try {
    const { normalizeNumbers } = createRequire(import.meta.url)(path.join(REPO, "apps/desktop/tts-numbers.js"));
    s = score(normalizeNumbers, split);
  } catch (e) { crashed = e.message; }
  let missFile = "not written (held-out split)";
  if (s && split === "dev") {
    fs.mkdirSync(`${WORK}/runs`, { recursive: true });
    missFile = `${WORK}/runs/${new Date().toISOString().replace(/[:.]/g, "-")}-${commit}-dev-misses.json`;
    fs.writeFileSync(missFile, JSON.stringify(s.misses, null, 1));
  }
  console.log("---");
  console.log(`status:   ${crashed ? "crash" : "ok"}${crashed ? `\nreason:   ${crashed}` : ""}`);
  console.log(`score:    ${crashed ? "0.00" : s.score.toFixed(2)}`);
  if (s) for (const l of LANGS) console.log(`${l}: ${s.per[l].score.toFixed(1)} (${s.per[l].ok}/${s.per[l].n})${NEEDS_NATIVE_CHECK.includes(l) ? " needs a native check" : ""}`);
  console.log(`split:    ${split}`);
  console.log(`seconds:  ${((Date.now() - started) / 1000).toFixed(2)}`);
  console.log(`commit:   ${commit}`);
  console.log(`misses:   ${missFile}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
