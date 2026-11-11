# Informativa sulla privacy di Filow

Ultimo aggiornamento: 10 novembre 2026. Questo testo descrive quello che l'app Filow fa davvero,
verificato sul suo codice (l'elenco tecnico completo è docs/okfilow/OUTBOUND.md nel codice sorgente di
Filow). È disponibile anche in inglese: imposta la lingua di Filow sull'inglese.

> Le parti tra doppie parentesi quadre, come [[questa]], non sono ancora compilate. Solo l'editore può compilarle, prima del rilascio.

## In breve

- Filow funziona sul tuo computer. Non c'è nessun account e nessuna registrazione.
- **Nessuna telemetria.** Filow non ci manda come lo usi, cosa dici o cosa c'è sul tuo schermo.
- Il tuo copione, la tua voce e il tuo schermo restano sul tuo computer, a meno che tu non attivi una
  funzione cloud. Prima che qualcosa di tuo vada per la prima volta a un servizio cloud, Filow ti dice cosa
  va dove e aspetta la tua risposta. Mentre invia, mostra "Esce dal PC".
- **Un'eccezione, oggi:** il link pubblico per il telefono è attivo di serie (vedi "Il link pubblico").
- Puoi cancellare tutto quello che Filow conserva (vedi "Come cancellare i tuoi dati").

## Chi è responsabile

L'editore di Filow è il titolare del trattamento per le poche cose che arrivano all'editore (vedi
"Cosa arriva a noi").

- Nome: [[ragione sociale o nome dell'editore]]
- Indirizzo: [[indirizzo postale]]
- Contatto per la privacy: [[indirizzo e-mail]]

Per i servizi cloud che scegli di usare (elencati sotto), è l'azienda che gestisce il servizio a
decidere cosa fa dei dati che riceve. Vale la sua informativa sulla privacy.

## Cosa arriva a noi

Quasi niente:

- **Controllo degli aggiornamenti.** Circa 8 secondi dopo l'avvio (non in modalità offline), Filow
  chiede a GitHub (github.com, gestito da GitHub, Inc.) se esiste una versione più recente, e la
  scarica se c'è. GitHub vede il tuo indirizzo IP e la versione dell'app, come per ogni download. Noi
  vediamo solo il numero di download.
- **Una segnalazione che mandi tu.** "Segnala un problema" crea un file di testo sul tuo computer e
  te ne mostra prima ogni riga. Filow non lo invia mai. Se ci mandi il file, lo usiamo solo per
  risolvere il problema e lo cancelliamo entro [[numero]] mesi. Dove mandarlo: [[indirizzo e-mail o
  modulo di assistenza]].

Non vendiamo né condividiamo dati, non mostriamo pubblicità e non usiamo strumenti di analisi.

## Cosa resta sul tuo computer

Filow tiene i suoi file in una cartella, la "cartella di configurazione". Aprila dal menu Filow con
"Apri la cartella di configurazione". Di solito si trova qui:

| Sistema | Cartella di configurazione |
|---|---|
| Windows | `%APPDATA%\@filow\desktop` |
| macOS | `~/Library/Application Support/@filow/desktop` |
| Linux | `~/.config/@filow/desktop` |

| Cosa | File o posizione | Perché |
|---|---|---|
| I tuoi punti del discorso | `script.md` | il copione da cui presenti |
| Le tue impostazioni e le risposte sul consenso | `settings.json` e la memoria del browser dell'app | perché Filow ricordi le tue scelte |
| Le chiavi API che hai aggiunto | `.env` (le righe delle chiavi sono svuotate) e `secrets.json`, cifrato con l'archivio chiavi del sistema | perché funzionino le funzioni cloud che hai scelto |
| Un registro tecnico | `startup.log` | quali passi dell'avvio sono andati e quali errori ci sono stati; può contenere nomi di cartelle |
| File di crash | cartella `Crashpad` | creati quando una parte dell'app si blocca; mai caricati; possono contenere parti di quello che era in memoria o sullo schermo |
| Modelli vocali e di riconoscimento | cartella `models` | il riconoscimento vocale e la voce naturale girano sul tuo computer |
| Strumenti di supporto | cartella `bin` | lo strumento per il link di Cloudflare e l'installatore di Ollama, quando li usi |
| File del componente PowerPoint | cartelle `certs` e `powerpoint` | un certificato per "localhost", attendibile per il tuo utente, perché PowerPoint possa caricare il componente |
| Le domande recenti a OK Filow | la memoria del browser dell'app | le ultime 12 domande e risposte, per mostrarle di nuovo |
| I lavori degli assistenti di OK Filow | cartella `okfilow-agents` | file creati da un assistente di programmazione che hai avviato |
| Le risposte di OK Filow | una cartella che scegli tu | solo se attivi "Salva ogni risposta con lo screenshot"; spento di serie |

I modelli di IA locale installati con Ollama stanno nella cartella di Ollama (`~/.ollama`), non in
quella di Filow.

**La tua voce non viene registrata in un file.** Il parlato diventa testo in memoria e l'audio viene
scartato. La trascrizione dal vivo di una sessione resta in memoria e sparisce quando chiudi Filow.

## Quando qualcosa esce dal tuo computer

Ognuna di queste cose succede solo quando usi la funzione e (salvo dove indicato) solo dopo che hai
detto sì nell'avviso di Filow, che nomina l'azienda prima di inviare qualsiasi cosa. Puoi ritirare un
sì nelle impostazioni di OK Filow. Le funzioni cloud usano il tuo account presso quell'azienda.

| Funzione | Cosa viene inviato | A chi |
|---|---|---|
| OK Filow, risposte cloud | la tua domanda e le immagini dei tuoi schermi | OpenRouter, poi il produttore del modello che hai scelto (per esempio Google) |
| OK Filow, voce cloud | il testo di ogni risposta | ElevenLabs |
| OK Filow, immagini nelle schede | il nome del soggetto della scheda | Wikipedia |
| OK Filow, assistente di programmazione | il compito e l'ultima risposta | OpenAI (Codex) o Anthropic (Claude Code), tramite i loro strumenti a riga di comando |
| Sessione, riconoscimento vocale cloud | l'audio del microfono dal vivo | ElevenLabs o OpenAI |
| Sessione, riconoscimento vocale "browser" | l'audio del microfono dal vivo | il produttore del browser (Google per Chrome e per la finestra di Filow, Microsoft per Edge, Apple per Safari); lo invia il browser, quindi Filow può avvisarti ma non bloccarlo |
| Sessione, tracciamento cloud | le parole che hai detto, con nomi, numeri e indirizzi prima mascherati | OpenRouter e poi il produttore del modello, oppure Cloudflare |
| Sessione, Screen Sense | le immagini dello schermo che condividi | OpenRouter, poi il produttore del modello |
| Traduzione del copione | il tuo copione | OpenRouter, poi il produttore del modello |
| Copione dalle slide (componente PowerPoint, estensione del browser) | testo e immagini delle slide | OpenRouter, poi il produttore del modello. Questi due non mostrano ancora l'avviso, quindi le loro richieste cloud vengono rifiutate e funziona solo la modalità locale |
| Controllo del modello nelle Impostazioni (senza avviso: non contiene nulla di tuo) | una richiesta di prova fissa, per vedere quale modello cloud risponde | OpenRouter, poi il produttore del modello |
| Download (modelli vocali, Ollama, lo strumento per il link, aggiornamenti) | nessun tuo contenuto, solo la richiesta | github.com, ollama.com e gli host dei modelli indicati nella finestra di download |
| Controllo ortografico nelle caselle di testo, solo su Linux | nessun tuo contenuto: il correttore integrato della finestra può scaricare il suo dizionario | Google, che ospita i dizionari di Chromium (non ancora verificato su un desktop Linux) |
| FreeLLMAPI, quando lo hai scelto (risposte di OK Filow, tracciamento della ripresa, scrittura e traduzione dei copioni) | gli stessi contenuti della funzione cloud che sostituisce: la domanda e le immagini dei tuoi schermi, le parole pronunciate (mascherate come sopra), il copione o le slide | il tuo router FreeLLMAPI, poi un fornitore di AI gratuito che il router sceglie per ogni richiesta |
| "Verifica la connessione" in Impostazioni > FreeLLMAPI (senza avviso: non contiene nulla di tuo) | una richiesta dell'elenco dei modelli del router | solo il tuo router FreeLLMAPI |

OpenRouter passa la tua richiesta a un'azienda che fa girare il modello. Per i modelli di Google è
Google; per altri modelli può essere un'altra azienda scelta da OpenRouter.

**FreeLLMAPI** è un'app gratuita separata (github.com/tashfeenahmed/freellmapi) che installi e avvii
tu, su questo computer o su un altro della tua rete; Filow non la installa. È pensata per un computer
poco potente, quando la privacy non è la tua prima preoccupazione. Il router è tuo, ma passa ogni
richiesta a uno dei tanti fornitori di AI gratuiti, con le tue chiavi, e Filow non può sapere prima
quale. I piani gratuiti spesso conservano ciò che ricevono e possono usarlo per addestrare i loro
modelli. Filow lo tratta come ogni altro cloud: chiede prima del primo invio, mostra "Esce dal PC -
Invio a FreeLLMAPI (un fornitore gratuito scelto da lui)" ogni volta, non passa mai a FreeLLMAPI da
solo e non ripiega mai da FreeLLMAPI su un altro cloud. La sua chiave è salvata cifrata su questo
computer. La descrizione stessa di FreeLLMAPI dice che è per sperimentazione personale: una scuola o
un'azienda dovrebbe controllare le condizioni dei fornitori che ci stanno dietro prima di usarlo.

**La modalità offline** (menu Filow) blocca ogni richiesta che uscirebbe dal tuo computer, compresi
il controllo degli aggiornamenti e il link pubblico.

## Il link pubblico

Per permettere a un telefono su un'altra rete di seguire il tuo intervento, Filow apre un link
pubblico tramite Cloudflare (trycloudflare.com). **Oggi questo link è attivo di serie e parte
all'avvio di Filow, senza chiedere.** Mentre è attivo, il tuo copione, la trascrizione dal vivo e la
slide corrente passano dai server di Cloudflare, e chiunque abbia il link e il codice di
abbinamento a 6 cifre può aprire la tua sessione. La pagina della sessione mostra l'etichetta "link pubblico".

Per spegnerlo: nel menu Filow, togli la spunta a "Condividi col telefono su qualsiasi rete". Un
telefono sulla stessa rete Wi-Fi funziona anche senza. Se questo link debba essere spento di serie è
una decisione ancora aperta per l'editore (decisione D31).

## Il mirror sul telefono nella tua rete

Perché un telefono sulla stessa rete Wi-Fi possa aprire la pagina mirror, il server locale di Filow
risponde sulla tua rete locale. Per l'abbinamento serve il codice a 6 cifre mostrato sul tuo schermo.
Per questo non passa niente da internet.

## Minori, studenti e classi

Filow non ha account e non chiede l'età. È uno strumento che un insegnante o uno studente usa su un
computer, quindi:

- **A scuola decide la scuola.** Quando un insegnante usa Filow con una classe, la scuola è
  responsabile dei dati degli studenti secondo le proprie regole; Filow tiene quei dati sul computer
  su cui gira.
- **Studenti sotto i 16 anni:** nell'Unione europea l'età in cui un ragazzo può acconsentire da solo
  ai servizi online è 16 anni, o meno dove un Paese la abbassa (14 in Italia, mai sotto i 13). Sotto
  quell'età, le funzioni cloud richiedono l'accordo di un genitore o della scuola, e i termini
  dell'azienda cloud possono fissare un'età minima più alta. Usa Filow in modalità locale con il
  link pubblico spento: così nessun dato deve uscire dal computer.
- Non mettere dati personali degli studenti in un copione e non chiedere a OK Filow di loro con le
  risposte cloud attive.
- Negli Stati Uniti, Filow di per sé non raccoglie informazioni personali da minori di 13 anni;
  vale lo stesso consiglio sulle funzioni cloud.

[[Il consulente legale dell'editore deve confermare questa sezione per i Paesi in cui Filow è offerto.]]

## Come cancellare i tuoi dati

1. Nel menu Filow, scegli "Apri la cartella di configurazione".
2. Chiudi Filow.
3. Cancella quella cartella. Così togli copione, impostazioni, chiavi, registri, file di crash e modelli.

Disinstallare Filow lascia questa cartella al suo posto, così le impostazioni sopravvivono a una
reinstallazione; cancellala a mano per togliere tutto. Per togliere il componente PowerPoint e il suo
certificato, usa "Rimuovi Filow da PowerPoint su questo PC" nel menu prima di cancellare la cartella.
I dati già inviati a un servizio cloud sono conservati da quell'azienda: chiedile di cancellarli.

## I tuoi diritti

Puoi chiederci cosa conserviamo su di te (di solito niente, oppure una segnalazione che ci hai
mandato), chiederci di correggerlo o cancellarlo e opporti al suo uso. Scrivi a [[indirizzo e-mail]].
Puoi anche presentare reclamo all'autorità per la protezione dei dati ([[l'autorità del Paese in cui
l'editore ha sede, per esempio il Garante per la protezione dei dati personali in Italia]]).

## Modifiche

Quando cambia cosa Filow invia o conserva, questa informativa cambia con la stessa versione dell'app
e cambia la data in alto. L'informativa inclusa nell'app corrisponde sempre a quella versione
dell'app.
