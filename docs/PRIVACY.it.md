# Informativa sulla privacy di Filow

Aggiunta del ramo sperimentale: la parola di attivazione Filow, facoltativa,
elabora l'audio solo in memoria su questo computer. Il microfono non si apre senza
un indicatore di ascolto visibile e un comando per disattivarlo con un clic.
Il profilo salva le cinque registrazioni accettate, fino a due esempi negativi
facoltativi accettati e il modello personale. Dopo il nuovo addestramento, Filow
elimina le registrazioni della frase precedente. Nelle Impostazioni puoi eliminare
tutti i dati della parola di attivazione. Per scaricare
i modelli serve accettare l'avviso con fonte, dimensioni e licenza; l'ascolto non
effettua richieste di rete. Dopo il riconoscimento, la domanda ordinaria conserva
le regole del fornitore e del consenso all'invio già previste.
Vedi [prove della parola di attivazione](okfilow/WAKE-WORD.md).

Ultimo aggiornamento: 22 novembre 2026. Questo testo descrive quello che l'app Filow fa davvero,
verificato sul suo codice (l'elenco tecnico completo è docs/okfilow/OUTBOUND.md nel codice sorgente di
Filow). È disponibile anche in inglese: imposta la lingua di Filow sull'inglese.

## In breve

- Filow funziona sul tuo computer. Non c'è nessun account e nessuna registrazione.
- **Nessuna telemetria.** Filow non ci manda come lo usi, cosa dici o cosa c'è sul tuo schermo.
- Il tuo copione, la tua voce e il tuo schermo restano sul tuo computer, a meno che tu non attivi una
  funzione cloud. Prima che qualcosa di tuo vada per la prima volta a un servizio cloud, Filow ti dice cosa
  va dove e aspetta la tua risposta. Mentre invia, mostra "Esce dal PC".
- L'abbinamento del telefono avviene sulla rete locale. Per un telefono su un'altra rete puoi attivare un link pubblico tramite Cloudflare.
- Puoi cancellare tutto quello che Filow conserva (vedi "Come cancellare i tuoi dati").

## Chi è responsabile

L'editore di Filow è il titolare del trattamento per le poche cose che arrivano all'editore (vedi
"Cosa arriva a noi").

- Editore: VoidExploit, Italia (codice postale 30034)
- Contatto per la privacy: [stefandsl@outlook.com](mailto:stefandsl@outlook.com)

Per i servizi cloud che scegli di usare (elencati sotto), è l'azienda che gestisce il servizio a
decidere cosa fa dei dati che riceve. Vale la sua informativa sulla privacy.

## Cosa arriva a noi

Quasi niente:

- **Controllo degli aggiornamenti.** Quando scegli «Controlla aggiornamenti» mentre sei online, Filow
  chiede a GitHub (github.com, gestito da GitHub, Inc.) se esiste una versione più recente, e la
  scarica se c'è. GitHub vede il tuo indirizzo IP e la versione dell'app, come per ogni download. Noi
  vediamo solo il numero di download.
- **Una segnalazione che scegli di pubblicare.** "Segnala un problema" crea la segnalazione sul tuo
  computer e te ne mostra prima ogni riga. Nei registri, link pubblici, chiavi, indirizzi e-mail,
  indirizzi della rete locale e il tuo nome utente nei percorsi delle cartelle sono mascherati;
  quello che scrivi tu resta come l'hai scritto. Filow non la invia mai da solo. Puoi salvarla in un
  file, oppure premere "Apri una segnalazione su GitHub": il browser apre allora una nuova
  segnalazione sulla pagina GitHub di Filow
  ([github.com/stefandsl/filow/issues](https://github.com/stefandsl/filow/issues), gestita da GitHub,
  Inc.) con già inserito quello che hai scritto, la versione di Filow, il tuo sistema e la fine di due
  registri (l'ultima sessione e l'avvio); una segnalazione lunga viene accorciata. Quel testo arriva
  a GitHub appena la pagina si apre. Una volta pubblicata, la segnalazione è **pubblica**: chiunque può leggerla, accanto al nome
  del tuo account GitHub. La usiamo solo per risolvere il problema. Puoi modificarla su GitHub in
  qualsiasi momento e chiederci lì di cancellarla. I file di crash non ne fanno mai parte.

La pagina delle segnalazioni su GitHub è anche il posto dove chiedere aiuto su Filow.

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
| Lista giornaliera | `daily.json` | Testo, scadenze locali, identificativi delle revisioni, resoconti confermati e una modifica annullabile per attività. Parla elabora l’audio in memoria con un modello locale installato. All’apertura o consultazione della lista, le attività scadono 30 giorni dopo l’ultima modifica. Per cancellare la lista, chiudi Filow ed elimina questo file e l’eventuale `daily.json.tmp` nella cartella di configurazione. |
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
| OK Filow, risposte cloud | domanda, testo selezionato e scambi precedenti della conversazione, più le immagini con la condivisione dello schermo attiva. L’app omette il proprio indirizzo LAN dall’intestazione di provenienza | OpenRouter, poi il produttore del modello che hai scelto (per esempio Google) |
| Lavagna, lezioni online | la tua domanda e, per una domanda successiva, la lezione fatta finora; mai un'immagine del tuo schermo | OpenRouter, poi il produttore del modello scelto per la lavagna: Anthropic per impostazione predefinita (Claude Sonnet 5.5), oppure Google se scegli Gemini 2.5 Flash. Per ogni produttore ti viene chiesto il permesso la prima volta |
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
| Segnala un problema, "Apri una segnalazione su GitHub" (l'avviso è accanto al pulsante, ogni volta; niente parte prima del tuo clic) | quello che hai scritto, la versione di Filow, il tuo sistema e la fine del registro dell'ultima sessione e di quello di avvio, mascherati come descritto sopra | GitHub, nel tuo browser; una volta pubblicata la segnalazione, chiunque (le segnalazioni sono pubbliche) |
| Download (modelli vocali, Ollama, lo strumento per il link, aggiornamenti) | nessun tuo contenuto, solo la richiesta | github.com, ollama.com e gli host dei modelli indicati nella finestra di download |
| Controllo ortografico nelle caselle di testo, solo su Linux | nessun tuo contenuto: il correttore integrato della finestra può scaricare il suo dizionario | Google, che ospita i dizionari di Chromium (non ancora verificato su un desktop Linux) |
| FreeLLMAPI, quando lo hai scelto (risposte di OK Filow, tracciamento della ripresa, scrittura e traduzione dei copioni) | gli stessi contenuti della funzione cloud che sostituisce: la domanda e le immagini dei tuoi schermi, le parole pronunciate (mascherate come sopra), il copione o le slide | il tuo router FreeLLMAPI, poi un fornitore di AI gratuito che il router sceglie per ogni richiesta |
| "Verifica la connessione" in Impostazioni > FreeLLMAPI (senza avviso: non contiene nulla di tuo) | una richiesta dell'elenco dei modelli del router | solo il tuo router FreeLLMAPI |

Il modello di confronto richiede i file mancanti a Hugging Face solo con il tuo consenso.

OpenRouter passa la tua richiesta a un'azienda che fa girare il modello. Per i modelli di Google è
Google; per altri modelli può essere un'altra azienda scelta da OpenRouter.

**FreeLLMAPI** è un'app gratuita separata (github.com/tashfeenahmed/freellmapi) che installi e avvii
tu, su questo computer o su un altro della tua rete; Filow non la installa. È pensata per un computer
poco potente, quando la privacy non è la tua prima preoccupazione. Il router è tuo, ma passa ogni
richiesta a uno dei tanti fornitori di AI gratuiti, con le tue chiavi, e Filow non può sapere prima
quale. I piani gratuiti spesso conservano ciò che ricevono e possono usarlo per addestrare i loro
modelli. Filow lo tratta come ogni altro cloud: chiede prima del primo invio, mostra "Esce dal PC -
Invio a FreeLLMAPI (un fornitore gratuito scelto dal router)" ogni volta, non passa mai a FreeLLMAPI da
solo e non ripiega mai da FreeLLMAPI su un altro cloud. La sua chiave è salvata cifrata su questo
computer. La descrizione stessa di FreeLLMAPI dice che è per sperimentazione personale: una scuola o
un'azienda dovrebbe controllare le condizioni dei fornitori che ci stanno dietro prima di usarlo.

**La modalità offline** (menu Filow) blocca ogni richiesta che uscirebbe dal tuo computer, compresi
il controllo degli aggiornamenti e il link pubblico.

**Nomi nelle domande alla lavagna.** Alcuni account online nascondono i nomi in ciò che invii
prima che il modello lo veda, così una lezione sul "ciclo di Krebs" parlerebbe d'altro. Quando
Filow se ne accorge, invia di nuovo la stessa domanda della lavagna con il nome scritto lettera per
lettera, allo stesso servizio, e te lo dice sotto la lezione. Viene modificato solo il testo di
quella domanda: mai il tuo script, il tuo schermo, le tue domande a OK Filow o una risposta.
(Deciso dal titolare l'11 novembre 2026.)
**Parla o scrivi** apre la casella della domanda. La richiesta parte quando la invii. L’evidenziazione locale e Salva prova funzionano senza un modello o una richiesta di rete.

Se OpenRouter non può rispondere alla domanda di prova, la richiesta termina. Per la prossima domanda puoi scegliere un modello installato oppure completare la prova con l’evidenziazione locale.

## Il link pubblico

**Il link pubblico è disattivato all'avvio**, anche dopo un aggiornamento. Per condividere con un
telefono su un'altra rete, scegli il link pubblico nel pannello di abbinamento o nel menu Filow e conferma l'avviso su Cloudflare. La pagina mirror e
il relay usano quindi Cloudflare (trycloudflare.com). Copione, trascrizione e stato delle slide
possono passare dai suoi server. Chi ha il link e il codice corrente può chiedere l'accesso.
Approva il telefono remoto sul PC per mostrargli la sessione. La pagina della sessione mostra l'etichetta "link pubblico".

Per interrompere la condivisione, annulla durante la connessione o disattiva il link nel pannello di abbinamento o nel menu
Filow. Entrambe le connessioni si chiudono e la sessione LAN resta aperta. Un telefono sulla stessa rete Wi-Fi può abbinarsi con il codice locale.

## Il mirror sul telefono nella tua rete

Perché un telefono sulla stessa rete Wi-Fi possa aprire la pagina mirror, il server locale di Filow
risponde sulla tua rete locale. Per l'abbinamento serve il codice monouso mostrato sul tuo schermo.
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

Questa sezione non è ancora stata verificata da un consulente legale per tutti i Paesi in cui Filow è offerto.

## Come cancellare i tuoi dati

1. Nel menu Filow, scegli "Apri la cartella di configurazione".
2. Chiudi Filow.
3. Cancella quella cartella. Così togli copione, impostazioni, chiavi, registri, file di crash e modelli.

Disinstallare Filow lascia questa cartella al suo posto, così le impostazioni sopravvivono a una
reinstallazione; cancellala a mano per togliere tutto. Per togliere il componente PowerPoint e il suo
certificato, usa "Rimuovi Filow da PowerPoint su questo PC" nel menu prima di cancellare la cartella.
I dati già inviati a un servizio cloud sono conservati da quell'azienda: chiedile di cancellarli.

## I tuoi diritti

Puoi chiederci cosa conserviamo su di te (di solito niente, oppure una segnalazione che hai
pubblicato su GitHub), chiederci di correggerlo o cancellarlo e opporti al suo uso.
Scrivi a [stefandsl@outlook.com](mailto:stefandsl@outlook.com).
Puoi anche presentare reclamo al [Garante per la protezione dei dati personali](https://www.garanteprivacy.it) in Italia.
Se ti trovi in un altro Paese dell'UE, puoi presentare reclamo alla tua autorità locale per la protezione dei dati.

## Modifiche

Quando cambia cosa Filow invia o conserva, questa informativa cambia con la stessa versione dell'app
e cambia la data in alto. L'informativa inclusa nell'app corrisponde sempre a quella versione
dell'app.
