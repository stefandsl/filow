const terms = [['File'], ['Save','Download'], ['Settings','File','Save'], ['Microsoft','PowerPoint'], ['PDF','Download'], ['Chrome','Settings','Save']];
const templates = {
  it: ['Apri {w}.','Seleziona {w} in alto.','Premi {w} per continuare.','Cerca {w} nella finestra.','Puoi usare {w} adesso.','Il comando {w} è disponibile.','Controlla {w} prima di uscire.','Trovi {w} accanto al titolo.','Scegli {w} con il mouse.','Ora fai clic su {w}.'],
  ru: ['Откройте {w}.','Выберите {w} вверху.','Нажмите {w}, чтобы продолжить.','Найдите {w} в окне.','Теперь можно использовать {w}.','Команда {w} доступна.','Проверьте {w} перед выходом.','Пункт {w} находится рядом с заголовком.','Выберите {w} мышью.','Теперь нажмите на {w}.'],
  ro: ['Deschide {w}.','Selectează {w} sus.','Apasă {w} pentru a continua.','Caută {w} în fereastră.','Acum poți folosi {w}.','Comanda {w} este disponibilă.','Verifică {w} înainte de ieșire.','Găsești {w} lângă titlu.','Alege {w} cu mouse-ul.','Acum apasă pe {w}.'],
};
const rows = Object.entries(templates).flatMap(([lang, list]) => list.flatMap((template,i) => terms.map((targets,j) => ({id:`foreign-${lang}-${i*6+j}`,lang,kind:'foreign',targets,text:template.replace('{w}',targets.join(', '))}))));
const listen = {
  it: ['Apri il menu File e scegli Save.','Premi Download per scaricare il documento.','Apri Settings e cerca la voce Audio.','Avvia Microsoft PowerPoint e apri la presentazione.','Seleziona il PDF e premi Upload.','In Chrome scegli Print Preview.', 'La riunione è il 14 novembre 2026 alle 14:30.','Il documento è del 14/11/2026, non del 1999.','La scadenza è 2026-11-14 alle 9:05.', 'Fai clic sul pulsante blu in alto a destra.','Vuoi salvare le modifiche prima di uscire?','La casella si trova sotto il titolo.'],
  ru: ['Откройте File и нажмите Save.','В Settings выберите Download.','Откройте Microsoft PowerPoint.', 'Встреча состоится 14 ноября 2026 года в 14:30.','Документ создан 14/11/2026 в 9:05.','В 1999 году вышла эта версия.'],
  ro: ['Deschide File și apasă Save.','În Settings alege Download.','Deschide Microsoft PowerPoint.', 'Ședința este pe 14 noiembrie 2026 la 14:30.','Documentul este din 14/11/2026, nu din 1999.','Termenul este 2026-11-14 la 9:05.'],
  en: ['This command saves a copy of the document. The original file remains available.','The meeting is on November 14, 2026 at 9:05.','Would you like to save your changes before leaving?','Check three things: the title, the date and the file name.'],
};
for (const [lang,texts] of Object.entries(listen)) texts.forEach((text,i)=>rows.push({id:`listen-${lang}-${i}`,lang,text,kind:'listen',index:i}));
// Authored forms from tts-round2.test.ts. Twelve probes per language, all number/date tokens.
const numberCases = require('./round2-number-cases.json');
for (const [lang,tests] of Object.entries(numberCases)) for (const index of [10,11,15,16,17,18,19,24,27,30,32,35]) {
  const [text,expected] = tests[index];
  rows.push({id:`numbers-${lang}-${index}`,lang,text,expected,kind:'numbers'});
}
module.exports = {rows, listen};
