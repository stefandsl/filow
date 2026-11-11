; Filow Windows installer pages (electron-builder "nsis.include").
; Pages: welcome, information (build/info_*.txt: what Filow is and what's new), licence (build/license_*.txt),
; directory, components (Filow plus the local AI models with sizes and setup types; "recommended" comes
; from a quick hardware scan), install, finish with
; "Run now" and "Create desktop shortcut". Strings are set at run time from $LANGUAGE (one block per
; installer language in customInit); a language without a block falls back to English.
!include nsDialogs.nsh
!include LogicLib.nsh
!include FileFunc.nsh

; NSIS ships Romanian without the five "install for whom" strings, and electron-builder treats the
; "missing, using fallback" warning as an error. Filow supplies them here. The language-file macro is
; redefined so that a string Filow provides (FILOW_<Language>_<NAME>) is used instead of the English
; fallback; any other missing string still warns, as before.
!include LangFile.nsh
!define FILOW_Romanian_MULTIUSER_TEXT_INSTALLMODE_TITLE "Alege utilizatorii"
!define FILOW_Romanian_MULTIUSER_TEXT_INSTALLMODE_SUBTITLE "Alege pentru ce utilizatori vrei să instalezi $(^NameDA)."
!define FILOW_Romanian_MULTIUSER_INNERTEXT_INSTALLMODE_TOP "Alege dacă vrei să instalezi $(^NameDA) doar pentru tine sau pentru toți utilizatorii acestui computer. $(^ClickNext)"
!define FILOW_Romanian_MULTIUSER_INNERTEXT_INSTALLMODE_ALLUSERS "Instalează pentru oricine folosește acest computer"
!define FILOW_Romanian_MULTIUSER_INNERTEXT_INSTALLMODE_CURRENTUSER "Instalează doar pentru mine"
!macroundef LANGFILE_SETSTRING
!macro LANGFILE_SETSTRING NAME VALUE
  !ifndef ${NAME}
    !ifdef LANGFILE_PRIV_INCLUDEISFALLBACK
      !ifdef FILOW_${LANGFILE_IDNAME}_${NAME}
        !define "${NAME}" "${FILOW_${LANGFILE_IDNAME}_${NAME}}"
      !else
        !define "${NAME}" "${VALUE}"
        !warning 'LangString "${NAME}" for language ${LANGFILE_IDNAME} is missing, using fallback from "${LANGFILE_PRIV_INCLUDEISFALLBACK}"'
      !endif
    !else
      !define "${NAME}" "${VALUE}"
    !endif
  !endif
!macroend

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
Var LblS1Mini
Var LblClef
Var LblGemmaSmall
Var LblGemmaBig
Var LblOllama
Var RunText
Var ShortcutText
Var StWhisperBase
Var StWhisperSmall
Var StS1Mini
Var StClef
Var StGemmaSmall
Var StGemmaBig
Var StOllama
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
Var LblApp
Var LblGroupAI
Var TypeRec
Var TypeFull
Var TypeMin
Var InfoTitle
Var InfoSub
Var InfoTop
Var OllamaFound
Var HaveS1Mini
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
  StrCpy $HaveS1Mini 0
  ${If} ${FileExists} "$APPDATA\@filow\desktop\models\s1-mini\s1-mini-q4_k_m.gguf"
    StrCpy $HaveS1Mini 1
  ${EndIf}
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
  ; S1-mini by Superwhisper (cleans up English dictation, 462 MB): ticked on every PC, whatever its
  ; memory, unless the file is already here. The 4 GB kept spare below covers it.
  StrCpy $StS1Mini ${BST_CHECKED}
  ${If} $HaveS1Mini == 1
    StrCpy $StS1Mini ${BST_UNCHECKED}
  ${EndIf}
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
      IntOp $R1 $R1 + 7
    ${EndIf}
    ${If} $StClef == ${BST_CHECKED}
      IntOp $R1 $R1 + 11
    ${EndIf}
    ${If} $StGemmaSmall == ${BST_CHECKED}
      IntOp $R1 $R1 + 5
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
  ${If} $HaveS1Mini == 1
    StrCpy $LblS1Mini "$LblS1Mini$SfxHave"
  ${ElseIf} $StS1Mini == ${BST_CHECKED}
    StrCpy $LblS1Mini "$LblS1Mini$SfxRec"
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

; Setup types: 1 = recommended for this PC (set at run time), 2 = full, 3 = minimal (Filow only).
; The model sections are empty: customInstall turns the selection into install-choices.json.
!ifndef BUILD_UNINSTALLER
InstType "Recommended"
InstType "Full"
InstType "Minimal"
SectionGroup /e "Local AI" SecAI
  Section /o "Whisper base" SecWhisperBase
    AddSize 153600
  SectionEnd
  Section /o "Whisper small" SecWhisperSmall
    AddSize 512000
  SectionEnd
  Section /o "S1-mini by Superwhisper" SecS1Mini
    AddSize 472871
  SectionEnd
  Section /o "Clef Flash" SecClef
    AddSize 11534336
  SectionEnd
  Section /o "Gemma 4 E2B" SecGemmaSmall
    AddSize 4508877
  SectionEnd
  Section /o "Gemma 4 E4B" SecGemmaBig
    AddSize 6396314
  SectionEnd
SectionGroupEnd
Section /o "Ollama" SecOllama
  AddSize 1048576
SectionEnd
!endif

!macro _FilowSection sec st lbl
  SectionSetText ${sec} "${lbl}"
  ${If} ${st} == ${BST_CHECKED}
    SectionSetInstTypes ${sec} 3
    SectionSetFlags ${sec} ${SF_SELECTED}
  ${Else}
    SectionSetInstTypes ${sec} 2
    SectionSetFlags ${sec} 0
  ${EndIf}
!macroend

; Names, setup types and the recommended selection from the hardware scan. electron-builder's own
; "install" section is declared after this file, so it is found by name and shown as Filow (required).
!macro FilowSections
  InstTypeSetText 0 "$TypeRec"
  InstTypeSetText 1 "$TypeFull"
  InstTypeSetText 2 "$TypeMin"
  SectionSetText ${SecAI} "$LblGroupAI"
  !insertmacro _FilowSection ${SecWhisperBase} $StWhisperBase "$LblWhisperBase"
  !insertmacro _FilowSection ${SecWhisperSmall} $StWhisperSmall "$LblWhisperSmall"
  !insertmacro _FilowSection ${SecS1Mini} $StS1Mini "$LblS1Mini"
  !insertmacro _FilowSection ${SecClef} $StClef "$LblClef"
  !insertmacro _FilowSection ${SecGemmaSmall} $StGemmaSmall "$LblGemmaSmall"
  !insertmacro _FilowSection ${SecGemmaBig} $StGemmaBig "$LblGemmaBig"
  !insertmacro _FilowSection ${SecOllama} $StOllama "$LblOllama"
  ${If} $OllamaFound == 1
    SectionSetFlags ${SecOllama} ${SF_RO}
  ${EndIf}
  StrCpy $0 0
  ${DoWhile} $0 < 32
    SectionGetText $0 $1
    ${If} $1 == "install"
      SectionSetText $0 "$LblApp"
      SectionSetInstTypes $0 7
      SectionSetFlags $0 17
      ${ExitDo}
    ${EndIf}
    IntOp $0 $0 + 1
  ${Loop}
  SetCurInstType 0
!macroend

!macro _FilowReadSection sec st
  ${If} ${SectionIsSelected} ${sec}
    StrCpy ${st} ${BST_CHECKED}
  ${Else}
    StrCpy ${st} ${BST_UNCHECKED}
  ${EndIf}
!macroend

!macro FilowReadSections
  !insertmacro _FilowReadSection ${SecWhisperBase} $StWhisperBase
  !insertmacro _FilowReadSection ${SecWhisperSmall} $StWhisperSmall
  !insertmacro _FilowReadSection ${SecS1Mini} $StS1Mini
  !insertmacro _FilowReadSection ${SecClef} $StClef
  !insertmacro _FilowReadSection ${SecGemmaSmall} $StGemmaSmall
  !insertmacro _FilowReadSection ${SecGemmaBig} $StGemmaBig
  !insertmacro _FilowReadSection ${SecOllama} $StOllama
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
    StrCpy $LblS1Mini "S1-mini by Superwhisper: ripulisce la dettatura in inglese su questo PC (462 MB)"
    StrCpy $LblClef "Clef Flash: decisioni in locale (11 GB, 16 GB di RAM)"
    StrCpy $LblGemmaSmall "Gemma 4 E2B: copione dalle slide e traduzione (4,3 GB, 8 GB di RAM)"
    StrCpy $LblGemmaBig "Gemma 4 E4B: copione dalle slide e traduzione, migliore (6,1 GB, 16 GB di RAM)"
    StrCpy $LblOllama "Installa Ollama in background (motore dei modelli locali, 1 GB; serve per Clef e Gemma)"
    StrCpy $RunText "Esegui Filow"
    StrCpy $ShortcutText "Crea collegamento sul desktop"
    StrCpy $SfxRec " – consigliato"
    StrCpy $SfxRam8 " – servono 8 GB di RAM"
    StrCpy $SfxRam16 " – servono 16 GB di RAM"
    StrCpy $SfxDisk " – spazio su disco insufficiente"
    StrCpy $SfxGpu " – serve una GPU"
    StrCpy $SfxHave " – già installato"
    StrCpy $LblOllamaHave "Ollama è già installato su questo PC: per lui non c'è nulla da scaricare"
    StrCpy $LblApp "Filow (richiesto)"
    StrCpy $LblGroupAI "AI in locale (scaricata al primo avvio)"
    StrCpy $TypeRec "Consigliata per questo PC"
    StrCpy $TypeFull "Completa"
    StrCpy $TypeMin "Minima (solo Filow)"
    StrCpy $InfoTitle "Informazioni"
    StrCpy $InfoSub "Prima di procedere leggi le importanti informazioni che seguono."
    StrCpy $InfoTop "Quando sei pronto per proseguire, seleziona 'Avanti'."
  ${ElseIf} $LANGUAGE == 1031
    StrCpy $WelcomeTitle "Willkommen bei Filow"
    StrCpy $WelcomeText "Sprich frei. Bleib auf den Punkt.$\r$\n$\r$\nDieser Assistent installiert Filow auf dem Computer: den Vortragsbegleiter, der zuhört, deine Stichpunkte abhakt, sobald du sie ansprichst, und zeigt, was du ausgelassen hast – mit Spiegel auf dem Telefon, Screen Sense und dem PowerPoint-Add-in.$\r$\n$\r$\nSchließe vor dem Fortfahren andere Anwendungen.$\r$\n$\r$\n© VoidExploit. Klicke auf 'Weiter', um fortzufahren."
    StrCpy $ModelsTitle "Lokale KI auf diesem PC"
    StrCpy $ModelsSub "Kurzer Hardware-Scan und empfohlene Modelle"
    StrCpy $HwLine "Dieser PC: $RamGb GB RAM · $GpuName · $FreeGb GB frei auf $R3"
    StrCpy $ModelsIntro "Wähle, was beim ersten Start geladen wird. '– empfohlen' läuft gut auf diesem PC; die anderen Hinweise sagen, was fehlt. Alles lässt sich später in den Einstellungen ändern."
    StrCpy $LblWhisperBase "Whisper base: Spracherkennung auf dem Gerät (150 MB)"
    StrCpy $LblWhisperSmall "Whisper small: genauere Spracherkennung (500 MB, braucht eine GPU)"
    StrCpy $LblS1Mini "S1-mini by Superwhisper: bereinigt englische Diktate auf diesem PC (462 MB)"
    StrCpy $LblClef "Clef Flash: lokale Entscheidungen (11 GB, 16 GB RAM)"
    StrCpy $LblGemmaSmall "Gemma 4 E2B: Skript aus den Folien und Übersetzung (4,3 GB, 8 GB RAM)"
    StrCpy $LblGemmaBig "Gemma 4 E4B: Skript aus den Folien und Übersetzung, besser (6,1 GB, 16 GB RAM)"
    StrCpy $LblOllama "Ollama im Hintergrund installieren (Laufzeit für lokale Modelle, 1 GB; nötig für Clef und Gemma)"
    StrCpy $RunText "Filow starten"
    StrCpy $ShortcutText "Desktop-Verknüpfung erstellen"
    StrCpy $SfxRec " – empfohlen"
    StrCpy $SfxRam8 " – braucht 8 GB RAM"
    StrCpy $SfxRam16 " – braucht 16 GB RAM"
    StrCpy $SfxDisk " – zu wenig freier Speicherplatz"
    StrCpy $SfxGpu " – braucht eine GPU"
    StrCpy $SfxHave " – bereits installiert"
    StrCpy $LblOllamaHave "Ollama ist auf diesem PC bereits installiert: dafür ist nichts mehr zu laden"
    StrCpy $LblApp "Filow (erforderlich)"
    StrCpy $LblGroupAI "Lokale KI (beim ersten Start geladen)"
    StrCpy $TypeRec "Empfohlen für diesen PC"
    StrCpy $TypeFull "Vollständig"
    StrCpy $TypeMin "Minimal (nur Filow)"
    StrCpy $InfoTitle "Informationen"
    StrCpy $InfoSub "Bitte lies die folgenden wichtigen Informationen, bevor du fortfährst."
    StrCpy $InfoTop "Klicke auf 'Weiter', wenn du bereit bist fortzufahren."
  ${ElseIf} $LANGUAGE == 1036
    StrCpy $WelcomeTitle "Bienvenue dans Filow"
    StrCpy $WelcomeText "Parlez librement. Restez sur le point.$\r$\n$\r$\nCet assistant installe Filow sur l'ordinateur : le compagnon de présentation qui vous écoute, coche vos points à mesure que vous les abordez et montre ce que vous avez sauté, avec miroir sur le téléphone, Screen Sense et le complément PowerPoint.$\r$\n$\r$\nFermez les autres applications avant de continuer.$\r$\n$\r$\n© VoidExploit. Cliquez sur « Suivant » pour continuer."
    StrCpy $ModelsTitle "IA locale sur ce PC"
    StrCpy $ModelsSub "Analyse rapide du matériel et modèles recommandés"
    StrCpy $HwLine "Ce PC : $RamGb Go de RAM · $GpuName · $FreeGb Go libres sur $R3"
    StrCpy $ModelsIntro "Cochez ce qui sera téléchargé au premier lancement. « – recommandé » fonctionne bien sur ce PC ; les autres notes disent ce qui manque. Tout se change ensuite dans les Paramètres."
    StrCpy $LblWhisperBase "Whisper base : transcription sur l'appareil (150 Mo)"
    StrCpy $LblWhisperSmall "Whisper small : transcription plus précise (500 Mo, GPU nécessaire)"
    StrCpy $LblS1Mini "S1-mini by Superwhisper : nettoie la dictée en anglais sur ce PC (462 Mo)"
    StrCpy $LblClef "Clef Flash : décisions en local (11 Go, 16 Go de RAM)"
    StrCpy $LblGemmaSmall "Gemma 4 E2B : script à partir des diapositives et traduction (4,3 Go, 8 Go de RAM)"
    StrCpy $LblGemmaBig "Gemma 4 E4B : script à partir des diapositives et traduction, meilleur (6,1 Go, 16 Go de RAM)"
    StrCpy $LblOllama "Installer Ollama en arrière-plan (moteur des modèles locaux, 1 Go ; requis par Clef et Gemma)"
    StrCpy $RunText "Lancer Filow"
    StrCpy $ShortcutText "Créer un raccourci sur le bureau"
    StrCpy $SfxRec " – recommandé"
    StrCpy $SfxRam8 " – nécessite 8 Go de RAM"
    StrCpy $SfxRam16 " – nécessite 16 Go de RAM"
    StrCpy $SfxDisk " – espace disque insuffisant"
    StrCpy $SfxGpu " – nécessite un GPU"
    StrCpy $SfxHave " – déjà installé"
    StrCpy $LblOllamaHave "Ollama est déjà installé sur ce PC : rien à télécharger pour lui"
    StrCpy $LblApp "Filow (requis)"
    StrCpy $LblGroupAI "IA locale (téléchargée au premier démarrage)"
    StrCpy $TypeRec "Recommandée pour ce PC"
    StrCpy $TypeFull "Complète"
    StrCpy $TypeMin "Minimale (Filow seul)"
    StrCpy $InfoTitle "Informations"
    StrCpy $InfoSub "Veuillez lire les informations importantes suivantes avant de continuer."
    StrCpy $InfoTop "Lorsque vous êtes prêt à continuer, cliquez sur Suivant."
  ${ElseIf} $LANGUAGE == 3082
    StrCpy $WelcomeTitle "Bienvenido a Filow"
    StrCpy $WelcomeText "Habla con libertad. No pierdas el hilo.$\r$\n$\r$\nEste asistente instala Filow en el equipo: el compañero de presentación que te escucha, marca tus puntos a medida que los tratas y muestra lo que te has saltado, con espejo en el teléfono, Screen Sense y el complemento de PowerPoint.$\r$\n$\r$\nCierra las demás aplicaciones antes de continuar.$\r$\n$\r$\n© VoidExploit. Pulsa 'Siguiente' para continuar."
    StrCpy $ModelsTitle "IA local en este PC"
    StrCpy $ModelsSub "Análisis rápido del hardware y modelos recomendados"
    StrCpy $HwLine "Este PC: $RamGb GB de RAM · $GpuName · $FreeGb GB libres en $R3"
    StrCpy $ModelsIntro "Marca lo que se descargará en el primer inicio. '– recomendado' va bien en este PC; las demás notas dicen qué falta. Todo se puede cambiar luego en Ajustes."
    StrCpy $LblWhisperBase "Whisper base: transcripción en el dispositivo (150 MB)"
    StrCpy $LblWhisperSmall "Whisper small: transcripción más precisa (500 MB, necesita GPU)"
    StrCpy $LblS1Mini "S1-mini by Superwhisper: limpia el dictado en inglés en este PC (462 MB)"
    StrCpy $LblClef "Clef Flash: decisiones en local (11 GB, 16 GB de RAM)"
    StrCpy $LblGemmaSmall "Gemma 4 E2B: guion a partir de las diapositivas y traducción (4,3 GB, 8 GB de RAM)"
    StrCpy $LblGemmaBig "Gemma 4 E4B: guion a partir de las diapositivas y traducción, mejor (6,1 GB, 16 GB de RAM)"
    StrCpy $LblOllama "Instalar Ollama en segundo plano (motor de modelos locales, 1 GB; necesario para Clef y Gemma)"
    StrCpy $RunText "Ejecutar Filow"
    StrCpy $ShortcutText "Crear un acceso directo en el escritorio"
    StrCpy $SfxRec " – recomendado"
    StrCpy $SfxRam8 " – necesita 8 GB de RAM"
    StrCpy $SfxRam16 " – necesita 16 GB de RAM"
    StrCpy $SfxDisk " – no hay suficiente espacio en disco"
    StrCpy $SfxGpu " – necesita GPU"
    StrCpy $SfxHave " – ya instalado"
    StrCpy $LblOllamaHave "Ollama ya está instalado en este PC: no hay nada más que descargar para él"
    StrCpy $LblApp "Filow (obligatorio)"
    StrCpy $LblGroupAI "IA local (se descarga al primer inicio)"
    StrCpy $TypeRec "Recomendada para este PC"
    StrCpy $TypeFull "Completa"
    StrCpy $TypeMin "Mínima (solo Filow)"
    StrCpy $InfoTitle "Información"
    StrCpy $InfoSub "Lee la siguiente información importante antes de continuar."
    StrCpy $InfoTop "Cuando estés listo para continuar, haz clic en Siguiente."
  ${ElseIf} $LANGUAGE == 1046
    StrCpy $WelcomeTitle "Bem-vindo ao Filow"
    StrCpy $WelcomeText "Fale livremente. Mantenha o foco.$\r$\n$\r$\nEste assistente instala o Filow no computador: o companheiro de apresentação que escuta você, marca seus pontos conforme você os aborda e mostra o que ficou de fora, com espelho no celular, Screen Sense e o suplemento do PowerPoint.$\r$\n$\r$\nFeche os outros aplicativos antes de continuar.$\r$\n$\r$\n© VoidExploit. Clique em 'Avançar' para continuar."
    StrCpy $ModelsTitle "IA local neste PC"
    StrCpy $ModelsSub "Verificação rápida do hardware e modelos recomendados"
    StrCpy $HwLine "Este PC: $RamGb GB de RAM · $GpuName · $FreeGb GB livres em $R3"
    StrCpy $ModelsIntro "Marque o que baixar na primeira abertura. '– recomendado' roda bem neste PC; as outras notas dizem o que falta. Tudo pode ser alterado depois em Configurações."
    StrCpy $LblWhisperBase "Whisper base: transcrição no dispositivo (150 MB)"
    StrCpy $LblWhisperSmall "Whisper small: transcrição mais precisa (500 MB, precisa de GPU)"
    StrCpy $LblS1Mini "S1-mini by Superwhisper: limpa o ditado em inglês neste PC (462 MB)"
    StrCpy $LblClef "Clef Flash: decisões locais (11 GB, 16 GB de RAM)"
    StrCpy $LblGemmaSmall "Gemma 4 E2B: roteiro a partir dos slides e tradução (4,3 GB, 8 GB de RAM)"
    StrCpy $LblGemmaBig "Gemma 4 E4B: roteiro a partir dos slides e tradução, melhor (6,1 GB, 16 GB de RAM)"
    StrCpy $LblOllama "Instalar o Ollama em segundo plano (motor dos modelos locais, 1 GB; necessário para Clef e Gemma)"
    StrCpy $RunText "Executar o Filow"
    StrCpy $ShortcutText "Criar atalho na área de trabalho"
    StrCpy $SfxRec " – recomendado"
    StrCpy $SfxRam8 " – precisa de 8 GB de RAM"
    StrCpy $SfxRam16 " – precisa de 16 GB de RAM"
    StrCpy $SfxDisk " – espaço em disco insuficiente"
    StrCpy $SfxGpu " – precisa de GPU"
    StrCpy $SfxHave " – já instalado"
    StrCpy $LblOllamaHave "O Ollama já está instalado neste PC: nada mais a baixar para ele"
    StrCpy $LblApp "Filow (obrigatório)"
    StrCpy $LblGroupAI "IA local (baixada na primeira execução)"
    StrCpy $TypeRec "Recomendada para este PC"
    StrCpy $TypeFull "Completa"
    StrCpy $TypeMin "Mínima (somente Filow)"
    StrCpy $InfoTitle "Informações"
    StrCpy $InfoSub "Leia as informações importantes a seguir antes de continuar."
    StrCpy $InfoTop "Quando estiver pronto para continuar, clique em Avançar."
  ${ElseIf} $LANGUAGE == 1043
    StrCpy $WelcomeTitle "Welkom bij Filow"
    StrCpy $WelcomeText "Spreek vrijuit. Blijf bij de kern.$\r$\n$\r$\nDeze wizard installeert Filow op de computer: de presentatiehulp die meeluistert, je punten afvinkt zodra je ze behandelt en laat zien wat je hebt overgeslagen, met spiegel op de telefoon, Screen Sense en de PowerPoint-invoegtoepassing.$\r$\n$\r$\nSluit andere toepassingen voordat je verdergaat.$\r$\n$\r$\n© VoidExploit. Klik op 'Volgende' om door te gaan."
    StrCpy $ModelsTitle "Lokale AI op deze pc"
    StrCpy $ModelsSub "Snelle hardwarescan en aanbevolen modellen"
    StrCpy $HwLine "Deze pc: $RamGb GB RAM · $GpuName · $FreeGb GB vrij op $R3"
    StrCpy $ModelsIntro "Vink aan wat bij de eerste start wordt gedownload. '– aanbevolen' werkt goed op deze pc; de andere opmerkingen zeggen wat ontbreekt. Alles is later aan te passen in Instellingen."
    StrCpy $LblWhisperBase "Whisper base: spraakherkenning op het apparaat (150 MB)"
    StrCpy $LblWhisperSmall "Whisper small: nauwkeurigere spraakherkenning (500 MB, GPU nodig)"
    StrCpy $LblS1Mini "S1-mini by Superwhisper: ruimt Engelse dictaten op deze pc op (462 MB)"
    StrCpy $LblClef "Clef Flash: lokale beslissingen (11 GB, 16 GB RAM)"
    StrCpy $LblGemmaSmall "Gemma 4 E2B: script uit de dia's en vertaling (4,3 GB, 8 GB RAM)"
    StrCpy $LblGemmaBig "Gemma 4 E4B: script uit de dia's en vertaling, beter (6,1 GB, 16 GB RAM)"
    StrCpy $LblOllama "Ollama op de achtergrond installeren (runtime voor lokale modellen, 1 GB; nodig voor Clef en Gemma)"
    StrCpy $RunText "Filow starten"
    StrCpy $ShortcutText "Snelkoppeling op het bureaublad maken"
    StrCpy $SfxRec " – aanbevolen"
    StrCpy $SfxRam8 " – vereist 8 GB RAM"
    StrCpy $SfxRam16 " – vereist 16 GB RAM"
    StrCpy $SfxDisk " – te weinig vrije schijfruimte"
    StrCpy $SfxGpu " – vereist een GPU"
    StrCpy $SfxHave " – al geïnstalleerd"
    StrCpy $LblOllamaHave "Ollama is al op deze pc geïnstalleerd: daarvoor hoeft niets meer te worden gedownload"
    StrCpy $LblApp "Filow (vereist)"
    StrCpy $LblGroupAI "Lokale AI (gedownload bij de eerste start)"
    StrCpy $TypeRec "Aanbevolen voor deze pc"
    StrCpy $TypeFull "Volledig"
    StrCpy $TypeMin "Minimaal (alleen Filow)"
    StrCpy $InfoTitle "Informatie"
    StrCpy $InfoSub "Lees de volgende belangrijke informatie voordat je verdergaat."
    StrCpy $InfoTop "Klik op Volgende als je klaar bent om verder te gaan."
  ${ElseIf} $LANGUAGE == 1045
    StrCpy $WelcomeTitle "Witamy w Filow"
    StrCpy $WelcomeText "Mów swobodnie. Trzymaj się tematu.$\r$\n$\r$\nTen kreator zainstaluje Filow na komputerze: towarzysza prezentacji, który słucha, odhacza Twoje punkty, gdy je omawiasz, i pokazuje, co pominąłeś, z lustrem na telefonie, Screen Sense i dodatkiem do PowerPointa.$\r$\n$\r$\nPrzed kontynuowaniem zamknij inne aplikacje.$\r$\n$\r$\n© VoidExploit. Kliknij „Dalej”, aby kontynuować."
    StrCpy $ModelsTitle "Lokalna AI na tym komputerze"
    StrCpy $ModelsSub "Szybkie skanowanie sprzętu i zalecane modele"
    StrCpy $HwLine "Ten komputer: $RamGb GB RAM · $GpuName · $FreeGb GB wolne na $R3"
    StrCpy $ModelsIntro "Zaznacz, co pobrać przy pierwszym uruchomieniu. „– zalecane” działa dobrze na tym komputerze; pozostałe uwagi mówią, czego brakuje. Wszystko można później zmienić w Ustawieniach."
    StrCpy $LblWhisperBase "Whisper base: rozpoznawanie mowy na urządzeniu (150 MB)"
    StrCpy $LblWhisperSmall "Whisper small: dokładniejsze rozpoznawanie mowy (500 MB, wymaga GPU)"
    StrCpy $LblS1Mini "S1-mini by Superwhisper: porządkuje dyktowanie po angielsku na tym komputerze (462 MB)"
    StrCpy $LblClef "Clef Flash: decyzje lokalnie (11 GB, 16 GB RAM)"
    StrCpy $LblGemmaSmall "Gemma 4 E2B: skrypt ze slajdów i tłumaczenie (4,3 GB, 8 GB RAM)"
    StrCpy $LblGemmaBig "Gemma 4 E4B: skrypt ze slajdów i tłumaczenie, lepszy (6,1 GB, 16 GB RAM)"
    StrCpy $LblOllama "Zainstaluj Ollama w tle (silnik modeli lokalnych, 1 GB; potrzebny dla Clef i Gemma)"
    StrCpy $RunText "Uruchom Filow"
    StrCpy $ShortcutText "Utwórz skrót na pulpicie"
    StrCpy $SfxRec " – zalecane"
    StrCpy $SfxRam8 " – wymaga 8 GB RAM"
    StrCpy $SfxRam16 " – wymaga 16 GB RAM"
    StrCpy $SfxDisk " – za mało wolnego miejsca na dysku"
    StrCpy $SfxGpu " – wymaga GPU"
    StrCpy $SfxHave " – już zainstalowane"
    StrCpy $LblOllamaHave "Ollama jest już zainstalowana na tym komputerze: nie trzeba nic więcej pobierać"
    StrCpy $LblApp "Filow (wymagany)"
    StrCpy $LblGroupAI "Lokalna AI (pobierana przy pierwszym uruchomieniu)"
    StrCpy $TypeRec "Zalecana dla tego komputera"
    StrCpy $TypeFull "Pełna"
    StrCpy $TypeMin "Minimalna (tylko Filow)"
    StrCpy $InfoTitle "Informacje"
    StrCpy $InfoSub "Przed kontynuowaniem przeczytaj poniższe ważne informacje."
    StrCpy $InfoTop "Gdy zechcesz kontynuować, kliknij Dalej."
  ${ElseIf} $LANGUAGE == 1049
    StrCpy $WelcomeTitle "Добро пожаловать в Filow"
    StrCpy $WelcomeText "Говорите свободно. Держитесь сути.$\r$\n$\r$\nЭтот мастер установит Filow на компьютер: помощника для выступлений, который слушает вас, отмечает тезисы по мере их раскрытия и показывает, что вы пропустили, с зеркалом на телефоне, Screen Sense и надстройкой для PowerPoint.$\r$\n$\r$\nПеред продолжением закройте другие приложения.$\r$\n$\r$\n© VoidExploit. Нажмите «Далее», чтобы продолжить."
    StrCpy $ModelsTitle "Локальный ИИ на этом ПК"
    StrCpy $ModelsSub "Быстрая проверка оборудования и рекомендуемые модели"
    StrCpy $HwLine "Этот ПК: $RamGb ГБ ОЗУ · $GpuName · $FreeGb ГБ свободно на $R3"
    StrCpy $ModelsIntro "Отметьте, что скачать при первом запуске. «– рекомендуется» хорошо работает на этом ПК; остальные пометки говорят, чего не хватает. Всё можно изменить позже в Настройках."
    StrCpy $LblWhisperBase "Whisper base: распознавание речи на устройстве (150 МБ)"
    StrCpy $LblWhisperSmall "Whisper small: более точное распознавание (500 МБ, нужна GPU)"
    StrCpy $LblS1Mini "S1-mini by Superwhisper: приводит в порядок диктовку на английском на этом ПК (462 МБ)"
    StrCpy $LblClef "Clef Flash: локальные решения (11 ГБ, 16 ГБ ОЗУ)"
    StrCpy $LblGemmaSmall "Gemma 4 E2B: сценарий из слайдов и перевод (4,3 ГБ, 8 ГБ ОЗУ)"
    StrCpy $LblGemmaBig "Gemma 4 E4B: сценарий из слайдов и перевод, лучше (6,1 ГБ, 16 ГБ ОЗУ)"
    StrCpy $LblOllama "Установить Ollama в фоне (среда для локальных моделей, 1 ГБ; нужна для Clef и Gemma)"
    StrCpy $RunText "Запустить Filow"
    StrCpy $ShortcutText "Создать ярлык на рабочем столе"
    StrCpy $SfxRec " – рекомендуется"
    StrCpy $SfxRam8 " – нужно 8 ГБ ОЗУ"
    StrCpy $SfxRam16 " – нужно 16 ГБ ОЗУ"
    StrCpy $SfxDisk " – мало свободного места на диске"
    StrCpy $SfxGpu " – нужна GPU"
    StrCpy $SfxHave " – уже установлено"
    StrCpy $LblOllamaHave "Ollama уже установлена на этом ПК: для неё ничего скачивать не нужно"
    StrCpy $LblApp "Filow (обязательно)"
    StrCpy $LblGroupAI "Локальный ИИ (скачивается при первом запуске)"
    StrCpy $TypeRec "Рекомендуемая для этого ПК"
    StrCpy $TypeFull "Полная"
    StrCpy $TypeMin "Минимальная (только Filow)"
    StrCpy $InfoTitle "Информация"
    StrCpy $InfoSub "Прочтите следующую важную информацию перед продолжением."
    StrCpy $InfoTop "Когда будете готовы продолжить, нажмите «Далее»."
  ${ElseIf} $LANGUAGE == 1041
    StrCpy $WelcomeTitle "Filow へようこそ"
    StrCpy $WelcomeText "自由に話す。要点を外さない。$\r$\n$\r$\nこのウィザードは Filow をコンピューターにインストールします。発表を聞きながら、話した要点にチェックを付け、抜けた点を示すプレゼンの相棒です。スマートフォンのミラー、Screen Sense、PowerPoint アドインを備えています。$\r$\n$\r$\n続行する前に他のアプリケーションを閉じてください。$\r$\n$\r$\n© VoidExploit。続行するには「次へ」をクリックしてください。"
    StrCpy $ModelsTitle "この PC のローカル AI"
    StrCpy $ModelsSub "ハードウェアの簡易スキャンと推奨モデル"
    StrCpy $HwLine "この PC: RAM $RamGb GB · $GpuName · $R3 の空き $FreeGb GB"
    StrCpy $ModelsIntro "初回起動時にダウンロードするものを選んでください。「– 推奨」はこの PC で快適に動作します。その他の注記は不足しているものを示します。後から設定で変更できます。"
    StrCpy $LblWhisperBase "Whisper base: 端末内の音声認識 (150 MB)"
    StrCpy $LblWhisperSmall "Whisper small: より高精度な音声認識 (500 MB、GPU が必要)"
    StrCpy $LblS1Mini "S1-mini by Superwhisper: 英語の音声入力をこの PC 上で整えます (462 MB)"
    StrCpy $LblClef "Clef Flash: ローカル判定 (11 GB、RAM 16 GB)"
    StrCpy $LblGemmaSmall "Gemma 4 E2B: スライドから原稿を生成、翻訳 (4.3 GB、RAM 8 GB)"
    StrCpy $LblGemmaBig "Gemma 4 E4B: スライドから原稿を生成、翻訳、高品質 (6.1 GB、RAM 16 GB)"
    StrCpy $LblOllama "Ollama をバックグラウンドでインストール (ローカルモデルの実行環境、1 GB。Clef と Gemma に必要)"
    StrCpy $RunText "Filow を起動"
    StrCpy $ShortcutText "デスクトップにショートカットを作成"
    StrCpy $SfxRec " – 推奨"
    StrCpy $SfxRam8 " – RAM 8 GB が必要"
    StrCpy $SfxRam16 " – RAM 16 GB が必要"
    StrCpy $SfxDisk " – ディスクの空き容量が不足"
    StrCpy $SfxGpu " – GPU が必要"
    StrCpy $SfxHave " – インストール済み"
    StrCpy $LblOllamaHave "Ollama はこの PC にインストール済みです。追加のダウンロードは不要です"
    StrCpy $LblApp "Filow (必須)"
    StrCpy $LblGroupAI "ローカル AI (初回起動時にダウンロード)"
    StrCpy $TypeRec "この PC に推奨"
    StrCpy $TypeFull "完全"
    StrCpy $TypeMin "最小 (Filow のみ)"
    StrCpy $InfoTitle "情報"
    StrCpy $InfoSub "続行する前に、以下の重要な情報をお読みください。"
    StrCpy $InfoTop "続行する準備ができたら「次へ」をクリックしてください。"
  ${ElseIf} $LANGUAGE == 2052
    StrCpy $WelcomeTitle "欢迎使用 Filow"
    StrCpy $WelcomeText "畅所欲言，不离要点。$\r$\n$\r$\n此向导将在计算机上安装 Filow：一位演讲伙伴，边听边为你勾掉已讲到的要点，并提示遗漏的内容，支持手机镜像、Screen Sense 和 PowerPoint 加载项。$\r$\n$\r$\n继续之前请关闭其他应用程序。$\r$\n$\r$\n© VoidExploit。点击“下一步”继续。"
    StrCpy $ModelsTitle "本机本地 AI"
    StrCpy $ModelsSub "快速硬件检测与推荐模型"
    StrCpy $HwLine "本机：$RamGb GB 内存 · $GpuName · $R3 剩余 $FreeGb GB"
    StrCpy $ModelsIntro "勾选首次启动时要下载的内容。“– 推荐”表示在本机运行良好；其他备注说明缺少什么。之后都可以在“设置”中更改。"
    StrCpy $LblWhisperBase "Whisper base：本机语音识别 (150 MB)"
    StrCpy $LblWhisperSmall "Whisper small：更精确的语音识别 (500 MB，需要 GPU)"
    StrCpy $LblS1Mini "S1-mini by Superwhisper：在本机整理英语听写 (462 MB)"
    StrCpy $LblClef "Clef Flash：本地判断 (11 GB，需 16 GB 内存)"
    StrCpy $LblGemmaSmall "Gemma 4 E2B：从幻灯片生成讲稿、翻译 (4.3 GB，需 8 GB 内存)"
    StrCpy $LblGemmaBig "Gemma 4 E4B：从幻灯片生成讲稿、翻译，效果更好 (6.1 GB，需 16 GB 内存)"
    StrCpy $LblOllama "在后台安装 Ollama（本地模型运行环境，1 GB；Clef 和 Gemma 需要）"
    StrCpy $RunText "运行 Filow"
    StrCpy $ShortcutText "创建桌面快捷方式"
    StrCpy $SfxRec " – 推荐"
    StrCpy $SfxRam8 " – 需要 8 GB 内存"
    StrCpy $SfxRam16 " – 需要 16 GB 内存"
    StrCpy $SfxDisk " – 磁盘可用空间不足"
    StrCpy $SfxGpu " – 需要 GPU"
    StrCpy $SfxHave " – 已安装"
    StrCpy $LblOllamaHave "本机已安装 Ollama：无需再为其下载任何内容"
    StrCpy $LblApp "Filow（必需）"
    StrCpy $LblGroupAI "本地 AI（首次启动时下载）"
    StrCpy $TypeRec "本机推荐"
    StrCpy $TypeFull "完全"
    StrCpy $TypeMin "最小（仅 Filow）"
    StrCpy $InfoTitle "信息"
    StrCpy $InfoSub "继续之前，请阅读以下重要信息。"
    StrCpy $InfoTop "准备好继续时，请点击“下一步”。"
  ${ElseIf} $LANGUAGE == 1048
    StrCpy $WelcomeTitle "Bun venit în Filow"
    StrCpy $WelcomeText "Vorbește liber. Rămâi la obiect.$\r$\n$\r$\nAcest asistent instalează Filow pe computerul tău: partenerul de prezentare care te ascultă în timp ce vorbești, îți bifează punctele pe măsură ce le spui și îți arată ce ai omis, cu oglindă pe telefon, Screen Sense și programul de completare pentru PowerPoint.$\r$\n$\r$\nÎnchide celelalte aplicații înainte de a continua.$\r$\n$\r$\n© VoidExploit. Apasă pe Înainte pentru a continua."
    StrCpy $ModelsTitle "AI local pe acest PC"
    StrCpy $ModelsSub "Scanare rapidă a hardware-ului și modele recomandate"
    StrCpy $HwLine "Acest PC: $RamGb GB RAM · $GpuName · $FreeGb GB liberi pe $R3"
    StrCpy $ModelsIntro "Bifează ce să se descarce la prima pornire. '– recomandat' rulează bine pe acest PC; celelalte note spun ce lipsește. Poți schimba totul mai târziu din Setări."
    StrCpy $LblWhisperBase "Whisper base: recunoaștere vocală pe dispozitiv (150 MB)"
    StrCpy $LblWhisperSmall "Whisper small: recunoaștere vocală mai precisă (500 MB, necesită GPU)"
    StrCpy $LblS1Mini "S1-mini by Superwhisper: curăță dictarea în engleză pe acest PC (462 MB)"
    StrCpy $LblClef "Clef Flash: decizii locale (11 GB, 16 GB RAM)"
    StrCpy $LblGemmaSmall "Gemma 4 E2B: scenariu din slide-uri și traducere (4,3 GB, 8 GB RAM)"
    StrCpy $LblGemmaBig "Gemma 4 E4B: scenariu din slide-uri și traducere, mai bun (6,1 GB, 16 GB RAM)"
    StrCpy $LblOllama "Instalează Ollama în fundal (motorul modelelor locale, 1 GB; necesar pentru Clef și Gemma)"
    StrCpy $RunText "Pornește Filow"
    StrCpy $ShortcutText "Creează o comandă rapidă pe desktop"
    StrCpy $SfxRec " – recomandat"
    StrCpy $SfxRam8 " – necesită 8 GB RAM"
    StrCpy $SfxRam16 " – necesită 16 GB RAM"
    StrCpy $SfxDisk " – spațiu pe disc insuficient"
    StrCpy $SfxGpu " – necesită GPU"
    StrCpy $SfxHave " – deja instalat"
    StrCpy $LblOllamaHave "Ollama este deja instalat pe acest PC: nu mai e nimic de descărcat pentru el"
    StrCpy $LblApp "Filow (obligatoriu)"
    StrCpy $LblGroupAI "AI local (descărcat la prima pornire)"
    StrCpy $TypeRec "Recomandată pentru acest PC"
    StrCpy $TypeFull "Completă"
    StrCpy $TypeMin "Minimă (doar Filow)"
    StrCpy $InfoTitle "Informații"
    StrCpy $InfoSub "Citește informațiile importante de mai jos înainte de a continua."
    StrCpy $InfoTop "Când ești gata să continui, apasă pe Înainte."
  ${Else}
    StrCpy $WelcomeTitle "Welcome to Filow"
    StrCpy $WelcomeText "Speak freely. Stay on point.$\r$\n$\r$\nThis wizard installs Filow on your computer: the live speaking companion that listens as you present, checks off your talking points as you cover them and shows what you missed, with a phone mirror, Screen Sense and the PowerPoint add-in.$\r$\n$\r$\nClose other applications before continuing.$\r$\n$\r$\n© VoidExploit. Click Next to continue."
    StrCpy $ModelsTitle "Local AI on this PC"
    StrCpy $ModelsSub "Quick hardware scan and recommended models"
    StrCpy $HwLine "This PC: $RamGb GB RAM · $GpuName · $FreeGb GB free on $R3"
    StrCpy $ModelsIntro "Tick what to download on first start. '– recommended' runs well on this PC; the other notes say what is missing. Everything can be changed later in Settings."
    StrCpy $LblWhisperBase "Whisper base: on-device speech-to-text (150 MB)"
    StrCpy $LblWhisperSmall "Whisper small: more accurate speech-to-text (500 MB, needs a GPU)"
    StrCpy $LblS1Mini "S1-mini by Superwhisper: cleans up English dictation on this PC (462 MB)"
    StrCpy $LblClef "Clef Flash: local decisions (11 GB, 16 GB RAM)"
    StrCpy $LblGemmaSmall "Gemma 4 E2B: script from slides and translation (4.3 GB, 8 GB RAM)"
    StrCpy $LblGemmaBig "Gemma 4 E4B: script from slides and translation, better (6.1 GB, 16 GB RAM)"
    StrCpy $LblOllama "Install Ollama in the background (local model runner, 1 GB; needed by Clef and Gemma)"
    StrCpy $RunText "Run Filow"
    StrCpy $ShortcutText "Create a desktop shortcut"
    StrCpy $SfxRec " – recommended"
    StrCpy $SfxRam8 " – needs 8 GB RAM"
    StrCpy $SfxRam16 " – needs 16 GB RAM"
    StrCpy $SfxDisk " – not enough free disk"
    StrCpy $SfxGpu " – needs a GPU"
    StrCpy $SfxHave " – already installed"
    StrCpy $LblOllamaHave "Ollama is already installed on this PC: nothing more to download for it"
    StrCpy $LblApp "Filow (required)"
    StrCpy $LblGroupAI "Local AI (downloaded on first start)"
    StrCpy $TypeRec "Recommended for this PC"
    StrCpy $TypeFull "Full"
    StrCpy $TypeMin "Minimal (Filow only)"
    StrCpy $InfoTitle "Information"
    StrCpy $InfoSub "Please read the following important information before continuing."
    StrCpy $InfoTop "When you are ready to continue, click Next."
  ${EndIf}
  !insertmacro FilowAnnotate
  !insertmacro FilowSections
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "$WelcomeTitle"
  !define MUI_WELCOMEPAGE_TITLE_3LINES
  !define MUI_WELCOMEPAGE_TEXT "$WelcomeText"
  !insertmacro MUI_PAGE_WELCOME
  ; Information page (like Greenshot's): what Filow is and what's new, from build/info_*.txt.
  LicenseLangString FilowInfo 1040 "${BUILD_RESOURCES_DIR}\info_it.txt"
  LicenseLangString FilowInfo 1033 "${BUILD_RESOURCES_DIR}\info_en.txt"
  LicenseLangString FilowInfo 1031 "${BUILD_RESOURCES_DIR}\info_en.txt"
  LicenseLangString FilowInfo 1036 "${BUILD_RESOURCES_DIR}\info_en.txt"
  LicenseLangString FilowInfo 3082 "${BUILD_RESOURCES_DIR}\info_en.txt"
  LicenseLangString FilowInfo 1046 "${BUILD_RESOURCES_DIR}\info_en.txt"
  LicenseLangString FilowInfo 1043 "${BUILD_RESOURCES_DIR}\info_en.txt"
  LicenseLangString FilowInfo 1045 "${BUILD_RESOURCES_DIR}\info_en.txt"
  LicenseLangString FilowInfo 1049 "${BUILD_RESOURCES_DIR}\info_ru.txt"
  LicenseLangString FilowInfo 1041 "${BUILD_RESOURCES_DIR}\info_ja.txt"
  LicenseLangString FilowInfo 1048 "${BUILD_RESOURCES_DIR}\info_ro.txt"
  LicenseLangString FilowInfo 2052 "${BUILD_RESOURCES_DIR}\info_en.txt"
  !define MUI_PAGE_HEADER_TEXT "$InfoTitle"
  !define MUI_PAGE_HEADER_SUBTEXT "$InfoSub"
  !define MUI_LICENSEPAGE_TEXT_TOP "$InfoTop"
  !define MUI_LICENSEPAGE_TEXT_BOTTOM " "
  !define MUI_LICENSEPAGE_BUTTON "$(^NextBtn)"
  !insertmacro MUI_PAGE_LICENSE "$(FilowInfo)"
!macroend

; Components page (like Greenshot's): Filow itself (read-only) plus the local AI models and Ollama,
; with sizes and setup types. Skipped on updates, like the directory page.
!macro customPageAfterChangeDir
  ; The template has already defined the install page's PRE callback (instFilesPre): park it, give this
  ; page its own (skip on updates), then restore it for the install page.
  !ifdef MUI_PAGE_CUSTOMFUNCTION_PRE
    !undef MUI_PAGE_CUSTOMFUNCTION_PRE
    !define FILOW_RESTORE_INSTFILES_PRE
  !endif
  Function FilowComponentsPre
    ${If} ${isUpdated}
      Abort
    ${EndIf}
  FunctionEnd
  !define MUI_PAGE_CUSTOMFUNCTION_PRE FilowComponentsPre
  !define MUI_PAGE_HEADER_TEXT "$ModelsTitle"
  !define MUI_PAGE_HEADER_SUBTEXT "$ModelsSub"
  !define MUI_COMPONENTSPAGE_TEXT_TOP "$HwLine$\r$\n$ModelsIntro"
  !define MUI_COMPONENTSPAGE_NODESC
  !insertmacro MUI_PAGE_COMPONENTS
  !ifdef FILOW_RESTORE_INSTFILES_PRE
    !define MUI_PAGE_CUSTOMFUNCTION_PRE instFilesPre
  !endif
!macroend

; The app reads this file once at first start, installs Ollama if asked, downloads the chosen models and deletes it.
!macro customInstall
  !insertmacro FilowReadSections
  CreateDirectory "$APPDATA\@filow\desktop"
  StrCpy $1 ""
  ${If} $StWhisperBase == ${BST_CHECKED}
    StrCpy $1 '$1"whisper-base",'
  ${EndIf}
  ${If} $StWhisperSmall == ${BST_CHECKED}
    StrCpy $1 '$1"whisper-small",'
  ${EndIf}
  ; Not on updates: the components page is skipped then, and a model the user unticked must not come back.
  ${If} $StS1Mini == ${BST_CHECKED}
  ${AndIfNot} ${isUpdated}
    StrCpy $1 '$1"s1-mini",'
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
  ${ElseIf} $LANGUAGE == 1049
    StrCpy $2 "ru"
  ${ElseIf} $LANGUAGE == 1048
    StrCpy $2 "ro"
  ${ElseIf} $LANGUAGE == 1041
    StrCpy $2 "ja"
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
  ; The executable's icon changed in 0.9.15 and Explorer kept showing a stale (blank) icon on the
  ; desktop shortcut after updates: tell the shell its associations changed so it rebuilds the icon
  ; cache for our shortcuts (SHCNE_ASSOCCHANGED = 0x08000000).
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
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
