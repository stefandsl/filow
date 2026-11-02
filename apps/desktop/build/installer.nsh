; Filow Windows installer pages (electron-builder "nsis.include").
; Pages: welcome, licence (build/license_*.txt), directory, "local AI" (this file: a quick hardware
; scan, the models recommended for this PC, Ollama in the background), install, finish with
; "Run now" and "Create desktop shortcut". Strings are set at run time from $LANGUAGE: Italian and
; English; other installer languages fall back to English.
!include nsDialogs.nsh
!include LogicLib.nsh
!include FileFunc.nsh

; Installer pass only: the uninstaller never sets them and makensis treats unused variables as errors here.
!ifndef BUILD_UNINSTALLER
Var WelcomeTitle
Var WelcomeText
Var ModelsTitle
Var ModelsSub
Var ModelsIntro
Var HwLine
Var LblWhisperBase
Var LblWhisperSmall
Var LblClef
Var LblGemmaSmall
Var LblGemmaBig
Var LblOllama
Var ApiNote
Var RunText
Var ShortcutText
Var CbWhisperBase
Var CbWhisperSmall
Var CbClef
Var CbGemmaSmall
Var CbGemmaBig
Var CbOllama
Var StWhisperBase
Var StWhisperSmall
Var StClef
Var StGemmaSmall
Var StGemmaBig
Var StOllama
Var ModelsDlg
Var RamGb
Var FreeGb
Var GpuName
Var GpuOk
Var SfxRec
Var SfxRam8
Var SfxRam16
Var SfxDisk
Var SfxGpu
Var SfxHave
Var LblOllamaHave
Var OllamaFound
Var HaveClef
Var HaveGemmaSmall
Var HaveGemmaBig
!endif

; ${FilowContains} out haystack needle : out = 1 when needle occurs in haystack (case-sensitive), else 0.
!macro _FilowContains out hay needle
  Push "${hay}"
  Push "${needle}"
  Call FilowContains
  Pop ${out}
!macroend
!define FilowContains "!insertmacro _FilowContains"
!ifndef BUILD_UNINSTALLER
Function FilowContains
  Exch $1 ; needle
  Exch
  Exch $0 ; haystack
  Push $2
  Push $3
  Push $4
  Push $5
  StrLen $2 $1
  StrLen $3 $0
  IntOp $3 $3 - $2
  StrCpy $4 0
  StrCpy $5 0
  ${If} $2 > 0
    ${DoWhile} $4 <= $3
      StrCpy $R9 $0 $2 $4
      ${If} $R9 == $1
        StrCpy $5 1
        ${ExitDo}
      ${EndIf}
      IntOp $4 $4 + 1
    ${Loop}
  ${EndIf}
  StrCpy $0 $5
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Exch $0
FunctionEnd
!endif

; ---- Quick hardware scan: RAM (GlobalMemoryStatusEx), free space on the profile drive, first GPU name from the registry.
!macro FilowHardwareScan
  System::Alloc 64
  Pop $1
  System::Call "*$1(i 64)"
  System::Call "Kernel32::GlobalMemoryStatusEx(i r1)"
  System::Call "*$1(i.r2, i.r3, l.r4, l.r5, l.r6, l.r7, l.r8, l.r9)"
  System::Free $1
  System::Int64Op $4 / 1073741824
  Pop $RamGb
  ; round up like the app does (Math.ceil): 31.4 GB reported by Windows is a 32 GB machine
  System::Int64Op $4 % 1073741824
  Pop $R2
  ${If} $R2 > 0
    IntOp $RamGb $RamGb + 1
  ${EndIf}
  ${GetRoot} "$PROFILE" $R3
  ${DriveSpace} "$R3\" "/D=F /S=G" $FreeGb
  StrCpy $GpuName ""
  StrCpy $R4 0
  ${Do}
    IntFmt $R5 "%04d" $R4
    ReadRegStr $R6 HKLM "SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\$R5" "DriverDesc"
    ${If} $R6 == ""
      ${ExitDo}
    ${EndIf}
    ${FilowContains} $R7 $R6 "Remote"
    ${FilowContains} $R8 $R6 "Basic"
    ${If} $R7 == 0
    ${AndIf} $R8 == 0
      StrCpy $GpuName $R6
      ${ExitDo}
    ${EndIf}
    IntOp $R4 $R4 + 1
    ${If} $R4 > 7
      ${ExitDo}
    ${EndIf}
  ${Loop}
  ; "GPU ok" = something that runs WebGPU Whisper small comfortably: NVIDIA, Radeon, Arc or Iris Xe.
  StrCpy $GpuOk 0
  ${FilowContains} $R7 $GpuName "NVIDIA"
  ${If} $R7 == 1
    StrCpy $GpuOk 1
  ${EndIf}
  ${FilowContains} $R7 $GpuName "Radeon"
  ${If} $R7 == 1
    StrCpy $GpuOk 1
  ${EndIf}
  ${FilowContains} $R7 $GpuName "Arc"
  ${If} $R7 == 1
    StrCpy $GpuOk 1
  ${EndIf}
  ${FilowContains} $R7 $GpuName "Iris"
  ${If} $R7 == 1
    StrCpy $GpuOk 1
  ${EndIf}
  ${If} $GpuName == ""
    StrCpy $GpuName "GPU ?"
  ${EndIf}
  ; Already here? Ollama's executable and the manifests of the models it has pulled.
  StrCpy $OllamaFound 0
  ${If} ${FileExists} "$LOCALAPPDATA\Programs\Ollama\ollama.exe"
  ${OrIf} ${FileExists} "$PROGRAMFILES64\Ollama\ollama.exe"
    StrCpy $OllamaFound 1
  ${EndIf}
  StrCpy $HaveClef 0
  StrCpy $HaveGemmaSmall 0
  StrCpy $HaveGemmaBig 0
  ${If} ${FileExists} "$PROFILE\.ollama\models\manifests\registry.ollama.ai\library\clef-flash\latest"
    StrCpy $HaveClef 1
  ${EndIf}
  ${If} ${FileExists} "$PROFILE\.ollama\models\manifests\registry.ollama.ai\library\gemma4\e2b"
    StrCpy $HaveGemmaSmall 1
  ${EndIf}
  ${If} ${FileExists} "$PROFILE\.ollama\models\manifests\registry.ollama.ai\library\gemma4\e4b"
    StrCpy $HaveGemmaBig 1
  ${EndIf}
!macroend

; ---- Recommendation from the scan (mirrors apps/desktop/localai.js recommend()).
!macro FilowRecommend
  StrCpy $StWhisperBase ${BST_CHECKED}
  StrCpy $StWhisperSmall ${BST_UNCHECKED}
  StrCpy $StClef ${BST_UNCHECKED}
  StrCpy $StGemmaSmall ${BST_UNCHECKED}
  StrCpy $StGemmaBig ${BST_UNCHECKED}
  ${If} $RamGb >= 32
    StrCpy $StWhisperBase ${BST_UNCHECKED}
    StrCpy $StWhisperSmall ${BST_CHECKED}
    StrCpy $StClef ${BST_CHECKED}
    StrCpy $StGemmaBig ${BST_CHECKED}
  ${ElseIf} $RamGb >= 16
    ${If} $GpuOk == 1
      StrCpy $StWhisperBase ${BST_UNCHECKED}
      StrCpy $StWhisperSmall ${BST_CHECKED}
    ${EndIf}
    StrCpy $StClef ${BST_CHECKED}
    StrCpy $StGemmaSmall ${BST_CHECKED}
  ${ElseIf} $RamGb >= 8
    StrCpy $StGemmaSmall ${BST_CHECKED}
  ${EndIf}
  ; disk: the chosen downloads plus 3 GB spare must fit the free space; drop the big slide model,
  ; then the small one, then Clef (decisions are the core feature, so they go last).
  ${Do}
    StrCpy $R1 4
    ${If} $StGemmaBig == ${BST_CHECKED}
      IntOp $R1 $R1 + 9
    ${EndIf}
    ${If} $StClef == ${BST_CHECKED}
      IntOp $R1 $R1 + 6
    ${EndIf}
    ${If} $StGemmaSmall == ${BST_CHECKED}
      IntOp $R1 $R1 + 6
    ${EndIf}
    ${If} $R1 <= $FreeGb
      ${ExitDo}
    ${EndIf}
    ${If} $StGemmaBig == ${BST_CHECKED}
      StrCpy $StGemmaBig ${BST_UNCHECKED}
      StrCpy $StGemmaSmall ${BST_CHECKED}
    ${ElseIf} $StGemmaSmall == ${BST_CHECKED}
      StrCpy $StGemmaSmall ${BST_UNCHECKED}
    ${ElseIf} $StClef == ${BST_CHECKED}
      StrCpy $StClef ${BST_UNCHECKED}
    ${Else}
      ${ExitDo}
    ${EndIf}
  ${Loop}
  ${If} $HaveClef == 1
    StrCpy $StClef ${BST_UNCHECKED}
  ${EndIf}
  ${If} $HaveGemmaSmall == 1
    StrCpy $StGemmaSmall ${BST_UNCHECKED}
  ${EndIf}
  ${If} $HaveGemmaBig == 1
    StrCpy $StGemmaBig ${BST_UNCHECKED}
  ${EndIf}
  StrCpy $StOllama ${BST_UNCHECKED}
  ${If} $OllamaFound == 0
  ${AndIf} $StClef == ${BST_CHECKED}
  ${OrIf} $OllamaFound == 0
  ${AndIf} $StGemmaSmall == ${BST_CHECKED}
  ${OrIf} $OllamaFound == 0
  ${AndIf} $StGemmaBig == ${BST_CHECKED}
    StrCpy $StOllama ${BST_CHECKED}
  ${EndIf}
!macroend


; ---- Say on every line why it is (not) ticked: recommended / RAM / free disk / GPU.
!macro FilowAnnotate
  ${If} $StWhisperBase == ${BST_CHECKED}
    StrCpy $LblWhisperBase "$LblWhisperBase$SfxRec"
  ${EndIf}
  ${If} $StWhisperSmall == ${BST_CHECKED}
    StrCpy $LblWhisperSmall "$LblWhisperSmall$SfxRec"
  ${ElseIf} $GpuOk == 0
    StrCpy $LblWhisperSmall "$LblWhisperSmall$SfxGpu"
  ${ElseIf} $RamGb < 16
    StrCpy $LblWhisperSmall "$LblWhisperSmall$SfxRam16"
  ${EndIf}
  ${If} $HaveClef == 1
    StrCpy $LblClef "$LblClef$SfxHave"
  ${ElseIf} $StClef == ${BST_CHECKED}
    StrCpy $LblClef "$LblClef$SfxRec"
  ${ElseIf} $RamGb < 16
    StrCpy $LblClef "$LblClef$SfxRam16"
  ${Else}
    StrCpy $LblClef "$LblClef$SfxDisk"
  ${EndIf}
  ${If} $HaveGemmaSmall == 1
    StrCpy $LblGemmaSmall "$LblGemmaSmall$SfxHave"
  ${ElseIf} $StGemmaSmall == ${BST_CHECKED}
    StrCpy $LblGemmaSmall "$LblGemmaSmall$SfxRec"
  ${ElseIf} $RamGb < 8
    StrCpy $LblGemmaSmall "$LblGemmaSmall$SfxRam8"
  ${Else}
    StrCpy $LblGemmaSmall "$LblGemmaSmall$SfxDisk"
  ${EndIf}
  ${If} $HaveGemmaBig == 1
    StrCpy $LblGemmaBig "$LblGemmaBig$SfxHave"
  ${ElseIf} $StGemmaBig == ${BST_CHECKED}
    StrCpy $LblGemmaBig "$LblGemmaBig$SfxRec"
  ${ElseIf} $RamGb < 16
    StrCpy $LblGemmaBig "$LblGemmaBig$SfxRam16"
  ${Else}
    StrCpy $LblGemmaBig "$LblGemmaBig$SfxDisk"
  ${EndIf}
  ${If} $OllamaFound == 1
    StrCpy $LblOllama "$LblOllamaHave"
  ${EndIf}
!macroend

!macro customInit
  !insertmacro FilowHardwareScan
  !insertmacro FilowRecommend
  ${If} $LANGUAGE == 1040
    StrCpy $WelcomeTitle "Benvenuto in Filow"
    StrCpy $WelcomeText "Parla liberamente. Resta sul punto.$\r$\n$\r$\nQuesta procedura installerà Filow nel computer: il compagno di presentazione che ti ascolta, spunta i tuoi punti mentre li dici e ti mostra cosa hai saltato, con mirror sul telefono, Screen Sense e il componente per PowerPoint.$\r$\n$\r$\nSi consiglia di chiudere le altre applicazioni prima di continuare.$\r$\n$\r$\n© VoidExploit. Per proseguire, seleziona 'Avanti'."
    StrCpy $ModelsTitle "AI in locale su questo PC"
    StrCpy $ModelsSub "Scansione rapida dell'hardware e modelli consigliati"
    StrCpy $HwLine "Questo PC: $RamGb GB di RAM · $GpuName · $FreeGb GB liberi su $R3"
    StrCpy $ModelsIntro "Spunta cosa scaricare al primo avvio. '– consigliato' gira bene su questo PC; le altre note dicono cosa manca. Puoi cambiare tutto in Impostazioni."
    StrCpy $LblWhisperBase "Whisper base: trascrizione sul dispositivo (150 MB)"
    StrCpy $LblWhisperSmall "Whisper small: trascrizione più accurata (500 MB, serve una GPU)"
    StrCpy $LblClef "Clef Flash: decisioni in locale (6 GB, 16 GB di RAM)"
    StrCpy $LblGemmaSmall "Gemma 4 E2B: copione dalle slide (6 GB, 8 GB di RAM)"
    StrCpy $LblGemmaBig "Gemma 4 E4B: copione dalle slide, migliore (9 GB, 16 GB di RAM)"
    StrCpy $LblOllama "Installa Ollama in background (motore dei modelli locali, 1 GB; serve per Clef e Gemma)"
    StrCpy $ApiNote "Senza modelli locali Filow usa il cloud: serve una chiave OpenRouter (pochi centesimi per intervento), che incolli nel file .env aperto al primo avvio."
    StrCpy $RunText "Esegui Filow"
    StrCpy $ShortcutText "Crea collegamento sul desktop"
    StrCpy $SfxRec " – consigliato"
    StrCpy $SfxRam8 " – servono 8 GB di RAM"
    StrCpy $SfxRam16 " – servono 16 GB di RAM"
    StrCpy $SfxDisk " – spazio su disco insufficiente"
    StrCpy $SfxGpu " – serve una GPU"
    StrCpy $SfxHave " – già installato"
    StrCpy $LblOllamaHave "Ollama è già installato su questo PC: per lui non c'è nulla da scaricare"
  ${ElseIf} $LANGUAGE == 1031
    StrCpy $WelcomeTitle "Willkommen bei Filow"
    StrCpy $WelcomeText "Sprich frei. Bleib auf den Punkt.$\r$\n$\r$\nDieser Assistent installiert Filow auf dem Computer: den Vortragsbegleiter, der zuhört, deine Stichpunkte abhakt, sobald du sie ansprichst, und zeigt, was du ausgelassen hast – mit Spiegel auf dem Telefon, Screen Sense und dem PowerPoint-Add-in.$\r$\n$\r$\nSchließe vor dem Fortfahren andere Anwendungen.$\r$\n$\r$\n© VoidExploit. Klicke auf 'Weiter', um fortzufahren."
    StrCpy $ModelsTitle "Lokale KI auf diesem PC"
    StrCpy $ModelsSub "Kurzer Hardware-Scan und empfohlene Modelle"
    StrCpy $HwLine "Dieser PC: $RamGb GB RAM · $GpuName · $FreeGb GB frei auf $R3"
    StrCpy $ModelsIntro "Wähle, was beim ersten Start geladen wird. '– empfohlen' läuft gut auf diesem PC; die anderen Hinweise sagen, was fehlt. Alles lässt sich später in den Einstellungen ändern."
    StrCpy $LblWhisperBase "Whisper base: Spracherkennung auf dem Gerät (150 MB)"
    StrCpy $LblWhisperSmall "Whisper small: genauere Spracherkennung (500 MB, braucht eine GPU)"
    StrCpy $LblClef "Clef Flash: lokale Entscheidungen (6 GB, 16 GB RAM)"
    StrCpy $LblGemmaSmall "Gemma 4 E2B: Skript aus den Folien (6 GB, 8 GB RAM)"
    StrCpy $LblGemmaBig "Gemma 4 E4B: Skript aus den Folien, besser (9 GB, 16 GB RAM)"
    StrCpy $LblOllama "Ollama im Hintergrund installieren (Laufzeit für lokale Modelle, 1 GB; nötig für Clef und Gemma)"
    StrCpy $ApiNote "Ohne lokale Modelle nutzt Filow die Cloud: ein OpenRouter-API-Schlüssel (wenige Cent pro Vortrag), eingefügt in die .env-Datei, die die App beim ersten Start öffnet."
    StrCpy $RunText "Filow starten"
    StrCpy $ShortcutText "Desktop-Verknüpfung erstellen"
    StrCpy $SfxRec " – empfohlen"
    StrCpy $SfxRam8 " – braucht 8 GB RAM"
    StrCpy $SfxRam16 " – braucht 16 GB RAM"
    StrCpy $SfxDisk " – zu wenig freier Speicherplatz"
    StrCpy $SfxGpu " – braucht eine GPU"
    StrCpy $SfxHave " – bereits installiert"
    StrCpy $LblOllamaHave "Ollama ist auf diesem PC bereits installiert: dafür ist nichts mehr zu laden"
  ${ElseIf} $LANGUAGE == 1036
    StrCpy $WelcomeTitle "Bienvenue dans Filow"
    StrCpy $WelcomeText "Parlez librement. Restez sur le point.$\r$\n$\r$\nCet assistant installe Filow sur l'ordinateur : le compagnon de présentation qui vous écoute, coche vos points à mesure que vous les abordez et montre ce que vous avez sauté, avec miroir sur le téléphone, Screen Sense et le complément PowerPoint.$\r$\n$\r$\nFermez les autres applications avant de continuer.$\r$\n$\r$\n© VoidExploit. Cliquez sur « Suivant » pour continuer."
    StrCpy $ModelsTitle "IA locale sur ce PC"
    StrCpy $ModelsSub "Analyse rapide du matériel et modèles recommandés"
    StrCpy $HwLine "Ce PC : $RamGb Go de RAM · $GpuName · $FreeGb Go libres sur $R3"
    StrCpy $ModelsIntro "Cochez ce qui sera téléchargé au premier lancement. « – recommandé » fonctionne bien sur ce PC ; les autres notes disent ce qui manque. Tout se change ensuite dans les Paramètres."
    StrCpy $LblWhisperBase "Whisper base : transcription sur l'appareil (150 Mo)"
    StrCpy $LblWhisperSmall "Whisper small : transcription plus précise (500 Mo, GPU nécessaire)"
    StrCpy $LblClef "Clef Flash : décisions en local (6 Go, 16 Go de RAM)"
    StrCpy $LblGemmaSmall "Gemma 4 E2B : script à partir des diapositives (6 Go, 8 Go de RAM)"
    StrCpy $LblGemmaBig "Gemma 4 E4B : script à partir des diapositives, meilleur (9 Go, 16 Go de RAM)"
    StrCpy $LblOllama "Installer Ollama en arrière-plan (moteur des modèles locaux, 1 Go ; requis par Clef et Gemma)"
    StrCpy $ApiNote "Sans modèles locaux, Filow utilise le cloud : une clé API OpenRouter (quelques centimes par intervention), collée dans le fichier .env que l'application ouvre au premier démarrage."
    StrCpy $RunText "Lancer Filow"
    StrCpy $ShortcutText "Créer un raccourci sur le bureau"
    StrCpy $SfxRec " – recommandé"
    StrCpy $SfxRam8 " – nécessite 8 Go de RAM"
    StrCpy $SfxRam16 " – nécessite 16 Go de RAM"
    StrCpy $SfxDisk " – espace disque insuffisant"
    StrCpy $SfxGpu " – nécessite un GPU"
    StrCpy $SfxHave " – déjà installé"
    StrCpy $LblOllamaHave "Ollama est déjà installé sur ce PC : rien à télécharger pour lui"
  ${ElseIf} $LANGUAGE == 1034
    StrCpy $WelcomeTitle "Bienvenido a Filow"
    StrCpy $WelcomeText "Habla con libertad. No pierdas el hilo.$\r$\n$\r$\nEste asistente instala Filow en el equipo: el compañero de presentación que te escucha, marca tus puntos a medida que los tratas y muestra lo que te has saltado, con espejo en el teléfono, Screen Sense y el complemento de PowerPoint.$\r$\n$\r$\nCierra las demás aplicaciones antes de continuar.$\r$\n$\r$\n© VoidExploit. Pulsa 'Siguiente' para continuar."
    StrCpy $ModelsTitle "IA local en este PC"
    StrCpy $ModelsSub "Análisis rápido del hardware y modelos recomendados"
    StrCpy $HwLine "Este PC: $RamGb GB de RAM · $GpuName · $FreeGb GB libres en $R3"
    StrCpy $ModelsIntro "Marca lo que se descargará en el primer inicio. '– recomendado' va bien en este PC; las demás notas dicen qué falta. Todo se puede cambiar luego en Ajustes."
    StrCpy $LblWhisperBase "Whisper base: transcripción en el dispositivo (150 MB)"
    StrCpy $LblWhisperSmall "Whisper small: transcripción más precisa (500 MB, necesita GPU)"
    StrCpy $LblClef "Clef Flash: decisiones en local (6 GB, 16 GB de RAM)"
    StrCpy $LblGemmaSmall "Gemma 4 E2B: guion a partir de las diapositivas (6 GB, 8 GB de RAM)"
    StrCpy $LblGemmaBig "Gemma 4 E4B: guion a partir de las diapositivas, mejor (9 GB, 16 GB de RAM)"
    StrCpy $LblOllama "Instalar Ollama en segundo plano (motor de modelos locales, 1 GB; necesario para Clef y Gemma)"
    StrCpy $ApiNote "Sin modelos locales Filow usa la nube: una clave API de OpenRouter (unos céntimos por charla), pegada en el archivo .env que la app abre al primer inicio."
    StrCpy $RunText "Ejecutar Filow"
    StrCpy $ShortcutText "Crear un acceso directo en el escritorio"
    StrCpy $SfxRec " – recomendado"
    StrCpy $SfxRam8 " – necesita 8 GB de RAM"
    StrCpy $SfxRam16 " – necesita 16 GB de RAM"
    StrCpy $SfxDisk " – no hay suficiente espacio en disco"
    StrCpy $SfxGpu " – necesita GPU"
    StrCpy $SfxHave " – ya instalado"
    StrCpy $LblOllamaHave "Ollama ya está instalado en este PC: no hay nada más que descargar para él"
  ${ElseIf} $LANGUAGE == 1046
    StrCpy $WelcomeTitle "Bem-vindo ao Filow"
    StrCpy $WelcomeText "Fale livremente. Mantenha o foco.$\r$\n$\r$\nEste assistente instala o Filow no computador: o companheiro de apresentação que escuta você, marca seus pontos conforme você os aborda e mostra o que ficou de fora, com espelho no celular, Screen Sense e o suplemento do PowerPoint.$\r$\n$\r$\nFeche os outros aplicativos antes de continuar.$\r$\n$\r$\n© VoidExploit. Clique em 'Avançar' para continuar."
    StrCpy $ModelsTitle "IA local neste PC"
    StrCpy $ModelsSub "Verificação rápida do hardware e modelos recomendados"
    StrCpy $HwLine "Este PC: $RamGb GB de RAM · $GpuName · $FreeGb GB livres em $R3"
    StrCpy $ModelsIntro "Marque o que baixar na primeira abertura. '– recomendado' roda bem neste PC; as outras notas dizem o que falta. Tudo pode ser alterado depois em Configurações."
    StrCpy $LblWhisperBase "Whisper base: transcrição no dispositivo (150 MB)"
    StrCpy $LblWhisperSmall "Whisper small: transcrição mais precisa (500 MB, precisa de GPU)"
    StrCpy $LblClef "Clef Flash: decisões locais (6 GB, 16 GB de RAM)"
    StrCpy $LblGemmaSmall "Gemma 4 E2B: roteiro a partir dos slides (6 GB, 8 GB de RAM)"
    StrCpy $LblGemmaBig "Gemma 4 E4B: roteiro a partir dos slides, melhor (9 GB, 16 GB de RAM)"
    StrCpy $LblOllama "Instalar o Ollama em segundo plano (motor dos modelos locais, 1 GB; necessário para Clef e Gemma)"
    StrCpy $ApiNote "Sem modelos locais o Filow usa a nuvem: uma chave de API do OpenRouter (alguns centavos por apresentação), colada no arquivo .env que o app abre na primeira execução."
    StrCpy $RunText "Executar o Filow"
    StrCpy $ShortcutText "Criar atalho na área de trabalho"
    StrCpy $SfxRec " – recomendado"
    StrCpy $SfxRam8 " – precisa de 8 GB de RAM"
    StrCpy $SfxRam16 " – precisa de 16 GB de RAM"
    StrCpy $SfxDisk " – espaço em disco insuficiente"
    StrCpy $SfxGpu " – precisa de GPU"
    StrCpy $SfxHave " – já instalado"
    StrCpy $LblOllamaHave "O Ollama já está instalado neste PC: nada mais a baixar para ele"
  ${ElseIf} $LANGUAGE == 1043
    StrCpy $WelcomeTitle "Welkom bij Filow"
    StrCpy $WelcomeText "Spreek vrijuit. Blijf bij de kern.$\r$\n$\r$\nDeze wizard installeert Filow op de computer: de presentatiehulp die meeluistert, je punten afvinkt zodra je ze behandelt en laat zien wat je hebt overgeslagen, met spiegel op de telefoon, Screen Sense en de PowerPoint-invoegtoepassing.$\r$\n$\r$\nSluit andere toepassingen voordat je verdergaat.$\r$\n$\r$\n© VoidExploit. Klik op 'Volgende' om door te gaan."
    StrCpy $ModelsTitle "Lokale AI op deze pc"
    StrCpy $ModelsSub "Snelle hardwarescan en aanbevolen modellen"
    StrCpy $HwLine "Deze pc: $RamGb GB RAM · $GpuName · $FreeGb GB vrij op $R3"
    StrCpy $ModelsIntro "Vink aan wat bij de eerste start wordt gedownload. '– aanbevolen' werkt goed op deze pc; de andere opmerkingen zeggen wat ontbreekt. Alles is later aan te passen in Instellingen."
    StrCpy $LblWhisperBase "Whisper base: spraakherkenning op het apparaat (150 MB)"
    StrCpy $LblWhisperSmall "Whisper small: nauwkeurigere spraakherkenning (500 MB, GPU nodig)"
    StrCpy $LblClef "Clef Flash: lokale beslissingen (6 GB, 16 GB RAM)"
    StrCpy $LblGemmaSmall "Gemma 4 E2B: script uit de dia's (6 GB, 8 GB RAM)"
    StrCpy $LblGemmaBig "Gemma 4 E4B: script uit de dia's, beter (9 GB, 16 GB RAM)"
    StrCpy $LblOllama "Ollama op de achtergrond installeren (runtime voor lokale modellen, 1 GB; nodig voor Clef en Gemma)"
    StrCpy $ApiNote "Zonder lokale modellen gebruikt Filow de cloud: een OpenRouter-API-sleutel (enkele centen per presentatie), geplakt in het .env-bestand dat de app bij de eerste start opent."
    StrCpy $RunText "Filow starten"
    StrCpy $ShortcutText "Snelkoppeling op het bureaublad maken"
    StrCpy $SfxRec " – aanbevolen"
    StrCpy $SfxRam8 " – vereist 8 GB RAM"
    StrCpy $SfxRam16 " – vereist 16 GB RAM"
    StrCpy $SfxDisk " – te weinig vrije schijfruimte"
    StrCpy $SfxGpu " – vereist een GPU"
    StrCpy $SfxHave " – al geïnstalleerd"
    StrCpy $LblOllamaHave "Ollama is al op deze pc geïnstalleerd: daarvoor hoeft niets meer te worden gedownload"
  ${ElseIf} $LANGUAGE == 1045
    StrCpy $WelcomeTitle "Witamy w Filow"
    StrCpy $WelcomeText "Mów swobodnie. Trzymaj się tematu.$\r$\n$\r$\nTen kreator zainstaluje Filow na komputerze: towarzysza prezentacji, który słucha, odhacza Twoje punkty, gdy je omawiasz, i pokazuje, co pominąłeś, z lustrem na telefonie, Screen Sense i dodatkiem do PowerPointa.$\r$\n$\r$\nPrzed kontynuowaniem zamknij inne aplikacje.$\r$\n$\r$\n© VoidExploit. Kliknij „Dalej”, aby kontynuować."
    StrCpy $ModelsTitle "Lokalna AI na tym komputerze"
    StrCpy $ModelsSub "Szybkie skanowanie sprzętu i zalecane modele"
    StrCpy $HwLine "Ten komputer: $RamGb GB RAM · $GpuName · $FreeGb GB wolne na $R3"
    StrCpy $ModelsIntro "Zaznacz, co pobrać przy pierwszym uruchomieniu. „– zalecane” działa dobrze na tym komputerze; pozostałe uwagi mówią, czego brakuje. Wszystko można później zmienić w Ustawieniach."
    StrCpy $LblWhisperBase "Whisper base: rozpoznawanie mowy na urządzeniu (150 MB)"
    StrCpy $LblWhisperSmall "Whisper small: dokładniejsze rozpoznawanie mowy (500 MB, wymaga GPU)"
    StrCpy $LblClef "Clef Flash: decyzje lokalnie (6 GB, 16 GB RAM)"
    StrCpy $LblGemmaSmall "Gemma 4 E2B: skrypt ze slajdów (6 GB, 8 GB RAM)"
    StrCpy $LblGemmaBig "Gemma 4 E4B: skrypt ze slajdów, lepszy (9 GB, 16 GB RAM)"
    StrCpy $LblOllama "Zainstaluj Ollama w tle (silnik modeli lokalnych, 1 GB; potrzebny dla Clef i Gemma)"
    StrCpy $ApiNote "Bez modeli lokalnych Filow korzysta z chmury: klucz API OpenRouter (kilka centów za wystąpienie), wklejony do pliku .env, który aplikacja otwiera przy pierwszym uruchomieniu."
    StrCpy $RunText "Uruchom Filow"
    StrCpy $ShortcutText "Utwórz skrót na pulpicie"
    StrCpy $SfxRec " – zalecane"
    StrCpy $SfxRam8 " – wymaga 8 GB RAM"
    StrCpy $SfxRam16 " – wymaga 16 GB RAM"
    StrCpy $SfxDisk " – za mało wolnego miejsca na dysku"
    StrCpy $SfxGpu " – wymaga GPU"
    StrCpy $SfxHave " – już zainstalowane"
    StrCpy $LblOllamaHave "Ollama jest już zainstalowana na tym komputerze: nie trzeba nic więcej pobierać"
  ${ElseIf} $LANGUAGE == 1049
    StrCpy $WelcomeTitle "Добро пожаловать в Filow"
    StrCpy $WelcomeText "Говорите свободно. Держитесь сути.$\r$\n$\r$\nЭтот мастер установит Filow на компьютер: помощника для выступлений, который слушает вас, отмечает тезисы по мере их раскрытия и показывает, что вы пропустили, с зеркалом на телефоне, Screen Sense и надстройкой для PowerPoint.$\r$\n$\r$\nПеред продолжением закройте другие приложения.$\r$\n$\r$\n© VoidExploit. Нажмите «Далее», чтобы продолжить."
    StrCpy $ModelsTitle "Локальный ИИ на этом ПК"
    StrCpy $ModelsSub "Быстрая проверка оборудования и рекомендуемые модели"
    StrCpy $HwLine "Этот ПК: $RamGb ГБ ОЗУ · $GpuName · $FreeGb ГБ свободно на $R3"
    StrCpy $ModelsIntro "Отметьте, что загрузить при первом запуске. «– рекомендуется» хорошо работает на этом ПК; остальные пометки говорят, чего не хватает. Всё можно изменить позже в Настройках."
    StrCpy $LblWhisperBase "Whisper base: распознавание речи на устройстве (150 МБ)"
    StrCpy $LblWhisperSmall "Whisper small: более точное распознавание (500 МБ, нужна GPU)"
    StrCpy $LblClef "Clef Flash: локальные решения (6 ГБ, 16 ГБ ОЗУ)"
    StrCpy $LblGemmaSmall "Gemma 4 E2B: сценарий из слайдов (6 ГБ, 8 ГБ ОЗУ)"
    StrCpy $LblGemmaBig "Gemma 4 E4B: сценарий из слайдов, лучше (9 ГБ, 16 ГБ ОЗУ)"
    StrCpy $LblOllama "Установить Ollama в фоне (среда для локальных моделей, 1 ГБ; нужна для Clef и Gemma)"
    StrCpy $ApiNote "Без локальных моделей Filow использует облако: ключ API OpenRouter (несколько центов за выступление), вставленный в файл .env, который приложение открывает при первом запуске."
    StrCpy $RunText "Запустить Filow"
    StrCpy $ShortcutText "Создать ярлык на рабочем столе"
    StrCpy $SfxRec " – рекомендуется"
    StrCpy $SfxRam8 " – нужно 8 ГБ ОЗУ"
    StrCpy $SfxRam16 " – нужно 16 ГБ ОЗУ"
    StrCpy $SfxDisk " – мало свободного места на диске"
    StrCpy $SfxGpu " – нужна GPU"
    StrCpy $SfxHave " – уже установлено"
    StrCpy $LblOllamaHave "Ollama уже установлена на этом ПК: для неё ничего загружать не нужно"
  ${ElseIf} $LANGUAGE == 1041
    StrCpy $WelcomeTitle "Filow へようこそ"
    StrCpy $WelcomeText "自由に話す。要点を外さない。$\r$\n$\r$\nこのウィザードは Filow をコンピューターにインストールします。発表を聞きながら、話した要点にチェックを付け、抜けた点を示すプレゼンの相棒です。スマートフォンのミラー、Screen Sense、PowerPoint アドインを備えています。$\r$\n$\r$\n続行する前に他のアプリケーションを閉じてください。$\r$\n$\r$\n© VoidExploit。続行するには「次へ」をクリックしてください。"
    StrCpy $ModelsTitle "この PC のローカル AI"
    StrCpy $ModelsSub "ハードウェアの簡易スキャンと推奨モデル"
    StrCpy $HwLine "この PC: RAM $RamGb GB · $GpuName · $R3 の空き $FreeGb GB"
    StrCpy $ModelsIntro "初回起動時にダウンロードするものを選んでください。「– 推奨」はこの PC で快適に動作します。その他の注記は不足しているものを示します。後から設定で変更できます。"
    StrCpy $LblWhisperBase "Whisper base: 端末内の音声認識 (150 MB)"
    StrCpy $LblWhisperSmall "Whisper small: より高精度な音声認識 (500 MB、GPU が必要)"
    StrCpy $LblClef "Clef Flash: ローカル判定 (6 GB、RAM 16 GB)"
    StrCpy $LblGemmaSmall "Gemma 4 E2B: スライドから原稿を生成 (6 GB、RAM 8 GB)"
    StrCpy $LblGemmaBig "Gemma 4 E4B: スライドから原稿を生成、高品質 (9 GB、RAM 16 GB)"
    StrCpy $LblOllama "Ollama をバックグラウンドでインストール (ローカルモデルの実行環境、1 GB。Clef と Gemma に必要)"
    StrCpy $ApiNote "ローカルモデルがない場合 Filow はクラウドを使います。OpenRouter の API キー (1 回の発表で数セント) を、初回起動時に開く .env ファイルに貼り付けてください。"
    StrCpy $RunText "Filow を起動"
    StrCpy $ShortcutText "デスクトップにショートカットを作成"
    StrCpy $SfxRec " – 推奨"
    StrCpy $SfxRam8 " – RAM 8 GB が必要"
    StrCpy $SfxRam16 " – RAM 16 GB が必要"
    StrCpy $SfxDisk " – ディスクの空き容量が不足"
    StrCpy $SfxGpu " – GPU が必要"
    StrCpy $SfxHave " – インストール済み"
    StrCpy $LblOllamaHave "Ollama はこの PC にインストール済みです。追加のダウンロードは不要です"
  ${ElseIf} $LANGUAGE == 2052
    StrCpy $WelcomeTitle "欢迎使用 Filow"
    StrCpy $WelcomeText "畅所欲言，不离要点。$\r$\n$\r$\n此向导将在计算机上安装 Filow：一位演讲伙伴，边听边为你勾掉已讲到的要点，并提示遗漏的内容，支持手机镜像、Screen Sense 和 PowerPoint 加载项。$\r$\n$\r$\n继续之前请关闭其他应用程序。$\r$\n$\r$\n© VoidExploit。点击“下一步”继续。"
    StrCpy $ModelsTitle "本机本地 AI"
    StrCpy $ModelsSub "快速硬件检测与推荐模型"
    StrCpy $HwLine "本机：$RamGb GB 内存 · $GpuName · $R3 剩余 $FreeGb GB"
    StrCpy $ModelsIntro "勾选首次启动时要下载的内容。“– 推荐”表示在本机运行良好；其他备注说明缺少什么。之后都可以在“设置”中更改。"
    StrCpy $LblWhisperBase "Whisper base：本机语音识别 (150 MB)"
    StrCpy $LblWhisperSmall "Whisper small：更精确的语音识别 (500 MB，需要 GPU)"
    StrCpy $LblClef "Clef Flash：本地判断 (6 GB，需 16 GB 内存)"
    StrCpy $LblGemmaSmall "Gemma 4 E2B：从幻灯片生成讲稿 (6 GB，需 8 GB 内存)"
    StrCpy $LblGemmaBig "Gemma 4 E4B：从幻灯片生成讲稿，效果更好 (9 GB，需 16 GB 内存)"
    StrCpy $LblOllama "在后台安装 Ollama（本地模型运行环境，1 GB；Clef 和 Gemma 需要）"
    StrCpy $ApiNote "没有本地模型时 Filow 使用云端：需要 OpenRouter API 密钥（每次演讲几美分），粘贴到应用首次启动时打开的 .env 文件中。"
    StrCpy $RunText "运行 Filow"
    StrCpy $ShortcutText "创建桌面快捷方式"
    StrCpy $SfxRec " – 推荐"
    StrCpy $SfxRam8 " – 需要 8 GB 内存"
    StrCpy $SfxRam16 " – 需要 16 GB 内存"
    StrCpy $SfxDisk " – 磁盘可用空间不足"
    StrCpy $SfxGpu " – 需要 GPU"
    StrCpy $SfxHave " – 已安装"
    StrCpy $LblOllamaHave "本机已安装 Ollama：无需再为其下载任何内容"
  ${Else}
    StrCpy $WelcomeTitle "Welcome to Filow"
    StrCpy $WelcomeText "Speak freely. Stay on point.$\r$\n$\r$\nThis wizard installs Filow on your computer: the live speaking companion that listens as you present, checks off your talking points as you cover them and shows what you missed, with a phone mirror, Screen Sense and the PowerPoint add-in.$\r$\n$\r$\nClose other applications before continuing.$\r$\n$\r$\n© VoidExploit. Click Next to continue."
    StrCpy $ModelsTitle "Local AI on this PC"
    StrCpy $ModelsSub "Quick hardware scan and recommended models"
    StrCpy $HwLine "This PC: $RamGb GB RAM · $GpuName · $FreeGb GB free on $R3"
    StrCpy $ModelsIntro "Tick what to download on first start. '– recommended' runs well on this PC; the other notes say what is missing. Everything can be changed later in Settings."
    StrCpy $LblWhisperBase "Whisper base: on-device speech-to-text (150 MB)"
    StrCpy $LblWhisperSmall "Whisper small: more accurate speech-to-text (500 MB, needs a GPU)"
    StrCpy $LblClef "Clef Flash: local decisions (6 GB, 16 GB RAM)"
    StrCpy $LblGemmaSmall "Gemma 4 E2B: script from slides (6 GB, 8 GB RAM)"
    StrCpy $LblGemmaBig "Gemma 4 E4B: script from slides, better (9 GB, 16 GB RAM)"
    StrCpy $LblOllama "Install Ollama in the background (local model runner, 1 GB; needed by Clef and Gemma)"
    StrCpy $ApiNote "Without local models Filow uses the cloud: an OpenRouter API key (a few cents per talk), pasted into the .env file the app opens on first start."
    StrCpy $RunText "Run Filow"
    StrCpy $ShortcutText "Create a desktop shortcut"
    StrCpy $SfxRec " – recommended"
    StrCpy $SfxRam8 " – needs 8 GB RAM"
    StrCpy $SfxRam16 " – needs 16 GB RAM"
    StrCpy $SfxDisk " – not enough free disk"
    StrCpy $SfxGpu " – needs a GPU"
    StrCpy $SfxHave " – already installed"
    StrCpy $LblOllamaHave "Ollama is already installed on this PC: nothing more to download for it"
  ${EndIf}
  !insertmacro FilowAnnotate
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "$WelcomeTitle"
  !define MUI_WELCOMEPAGE_TITLE_3LINES
  !define MUI_WELCOMEPAGE_TEXT "$WelcomeText"
  !insertmacro MUI_PAGE_WELCOME
!macroend

; Defined here, after MUI's page macros exist (MUI_HEADER_TEXT is only available from then on).
!macro customPageAfterChangeDir
Function ModelsPageCreate
  !insertmacro MUI_HEADER_TEXT "$ModelsTitle" "$ModelsSub"
  nsDialogs::Create 1018
  Pop $ModelsDlg
  ${If} $ModelsDlg == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 10u "$HwLine"
  Pop $0
  ${NSD_CreateLabel} 0 11u 100% 30u "$ModelsIntro"
  Pop $0
  ${NSD_CreateCheckbox} 0 43u 100% 10u "$LblWhisperBase"
  Pop $CbWhisperBase
  ${NSD_SetState} $CbWhisperBase $StWhisperBase
  ${NSD_CreateCheckbox} 0 54u 100% 10u "$LblWhisperSmall"
  Pop $CbWhisperSmall
  ${NSD_SetState} $CbWhisperSmall $StWhisperSmall
  ${NSD_CreateCheckbox} 0 65u 100% 10u "$LblClef"
  Pop $CbClef
  ${NSD_SetState} $CbClef $StClef
  ${NSD_CreateCheckbox} 0 76u 100% 10u "$LblGemmaSmall"
  Pop $CbGemmaSmall
  ${NSD_SetState} $CbGemmaSmall $StGemmaSmall
  ${NSD_CreateCheckbox} 0 87u 100% 10u "$LblGemmaBig"
  Pop $CbGemmaBig
  ${NSD_SetState} $CbGemmaBig $StGemmaBig
  ${NSD_CreateCheckbox} 0 100u 100% 10u "$LblOllama"
  Pop $CbOllama
  ${NSD_SetState} $CbOllama $StOllama
  ${If} $OllamaFound == 1
    EnableWindow $CbOllama 0
  ${EndIf}
  ${NSD_CreateLabel} 0 114u 100% 26u "$ApiNote"
  Pop $0
  nsDialogs::Show
FunctionEnd

Function ModelsPageLeave
  ${NSD_GetState} $CbWhisperBase $StWhisperBase
  ${NSD_GetState} $CbWhisperSmall $StWhisperSmall
  ${NSD_GetState} $CbClef $StClef
  ${NSD_GetState} $CbGemmaSmall $StGemmaSmall
  ${NSD_GetState} $CbGemmaBig $StGemmaBig
  ${NSD_GetState} $CbOllama $StOllama
FunctionEnd
  Page custom ModelsPageCreate ModelsPageLeave
!macroend

; The app reads this file once at first start, installs Ollama if asked, downloads the chosen models and deletes it.
!macro customInstall
  CreateDirectory "$APPDATA\@filow\desktop"
  StrCpy $1 ""
  ${If} $StWhisperBase == ${BST_CHECKED}
    StrCpy $1 '$1"whisper-base",'
  ${EndIf}
  ${If} $StWhisperSmall == ${BST_CHECKED}
    StrCpy $1 '$1"whisper-small",'
  ${EndIf}
  ${If} $StClef == ${BST_CHECKED}
    StrCpy $1 '$1"clef-flash",'
  ${EndIf}
  ${If} $StGemmaSmall == ${BST_CHECKED}
    StrCpy $1 '$1"gemma4:e2b",'
  ${EndIf}
  ${If} $StGemmaBig == ${BST_CHECKED}
    StrCpy $1 '$1"gemma4:e4b",'
  ${EndIf}
  ${If} $1 != ""
    StrCpy $1 $1 -1
  ${EndIf}
  ${If} $LANGUAGE == 1040
    StrCpy $2 "it"
  ${Else}
    StrCpy $2 "en"
  ${EndIf}
  ${If} $StOllama == ${BST_CHECKED}
    StrCpy $3 "true"
  ${Else}
    StrCpy $3 "false"
  ${EndIf}
  FileOpen $0 "$APPDATA\@filow\desktop\install-choices.json" w
  FileWrite $0 '{"models":[$1],"lang":"$2","ollama":$3,"hardware":{"ramGb":$RamGb,"freeGb":$FreeGb,"gpu":"$GpuName"}}'
  FileClose $0
!macroend

; Only in the installer pass: $launchLink does not exist while the uninstaller is compiled.
!macro customFinishPage
  Function StartAppNow
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" ""
  FunctionEnd

  Function CreateDesktopLink
    CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  FunctionEnd

  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION StartAppNow
  !define MUI_FINISHPAGE_RUN_TEXT "$RunText"
  !define MUI_FINISHPAGE_SHOWREADME ""
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "$ShortcutText"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateDesktopLink
  !insertmacro MUI_PAGE_FINISH
!macroend
