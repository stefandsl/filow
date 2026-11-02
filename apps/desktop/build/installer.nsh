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
  ; disk: keep 3 GB free after the downloads; drop the biggest Ollama models first
  ${If} $FreeGb < 15
  ${AndIf} $StGemmaBig == ${BST_CHECKED}
    StrCpy $StGemmaBig ${BST_UNCHECKED}
    StrCpy $StGemmaSmall ${BST_CHECKED}
  ${EndIf}
  ${If} $FreeGb < 12
    StrCpy $StClef ${BST_UNCHECKED}
  ${EndIf}
  ${If} $FreeGb < 9
    StrCpy $StGemmaSmall ${BST_UNCHECKED}
  ${EndIf}
  StrCpy $StOllama ${BST_UNCHECKED}
  ${If} $StClef == ${BST_CHECKED}
  ${OrIf} $StGemmaSmall == ${BST_CHECKED}
  ${OrIf} $StGemmaBig == ${BST_CHECKED}
    StrCpy $StOllama ${BST_CHECKED}
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
    StrCpy $ModelsIntro "Filow può lavorare interamente qui, senza cloud. In base all'hardware sono preselezionati i modelli che girano bene; i download partono al primo avvio e puoi cambiare tutto in Impostazioni."
    StrCpy $LblWhisperBase "Whisper base: trascrizione sul dispositivo (150 MB)"
    StrCpy $LblWhisperSmall "Whisper small: trascrizione più accurata (500 MB, serve una GPU)"
    StrCpy $LblClef "Clef Flash: decisioni in locale (6 GB, 16 GB di RAM)"
    StrCpy $LblGemmaSmall "Gemma 4 E2B: copione dalle slide (6 GB, 8 GB di RAM)"
    StrCpy $LblGemmaBig "Gemma 4 E4B: copione dalle slide, migliore (9 GB, 16 GB di RAM)"
    StrCpy $LblOllama "Installa Ollama in background (motore dei modelli locali, 1 GB; serve per Clef e Gemma)"
    StrCpy $ApiNote "Senza modelli locali Filow usa il cloud: serve una chiave OpenRouter (pochi centesimi per intervento), che incolli nel file .env aperto al primo avvio."
    StrCpy $RunText "Esegui Filow"
    StrCpy $ShortcutText "Crea collegamento sul desktop"
  ${Else}
    StrCpy $WelcomeTitle "Welcome to Filow"
    StrCpy $WelcomeText "Speak freely. Stay on point.$\r$\n$\r$\nThis wizard installs Filow on your computer: the live speaking companion that listens as you present, checks off your talking points as you cover them and shows what you missed, with a phone mirror, Screen Sense and the PowerPoint add-in.$\r$\n$\r$\nClose other applications before continuing.$\r$\n$\r$\n© VoidExploit. Click Next to continue."
    StrCpy $ModelsTitle "Local AI on this PC"
    StrCpy $ModelsSub "Quick hardware scan and recommended models"
    StrCpy $HwLine "This PC: $RamGb GB RAM · $GpuName · $FreeGb GB free on $R3"
    StrCpy $ModelsIntro "Filow can run entirely here, with no cloud. The models that run well on this hardware are preselected; downloads start on first launch and everything can be changed in Settings."
    StrCpy $LblWhisperBase "Whisper base: on-device speech-to-text (150 MB)"
    StrCpy $LblWhisperSmall "Whisper small: more accurate speech-to-text (500 MB, needs a GPU)"
    StrCpy $LblClef "Clef Flash: local decisions (6 GB, 16 GB RAM)"
    StrCpy $LblGemmaSmall "Gemma 4 E2B: script from slides (6 GB, 8 GB RAM)"
    StrCpy $LblGemmaBig "Gemma 4 E4B: script from slides, better (9 GB, 16 GB RAM)"
    StrCpy $LblOllama "Install Ollama in the background (local model runner, 1 GB; needed by Clef and Gemma)"
    StrCpy $ApiNote "Without local models Filow uses the cloud: an OpenRouter API key (a few cents per talk), pasted into the .env file the app opens on first start."
    StrCpy $RunText "Run Filow"
    StrCpy $ShortcutText "Create a desktop shortcut"
  ${EndIf}
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
  ${NSD_CreateLabel} 0 11u 100% 20u "$ModelsIntro"
  Pop $0
  ${NSD_CreateCheckbox} 0 33u 100% 10u "$LblWhisperBase"
  Pop $CbWhisperBase
  ${NSD_SetState} $CbWhisperBase $StWhisperBase
  ${NSD_CreateCheckbox} 0 44u 100% 10u "$LblWhisperSmall"
  Pop $CbWhisperSmall
  ${NSD_SetState} $CbWhisperSmall $StWhisperSmall
  ${NSD_CreateCheckbox} 0 55u 100% 10u "$LblClef"
  Pop $CbClef
  ${NSD_SetState} $CbClef $StClef
  ${NSD_CreateCheckbox} 0 66u 100% 10u "$LblGemmaSmall"
  Pop $CbGemmaSmall
  ${NSD_SetState} $CbGemmaSmall $StGemmaSmall
  ${NSD_CreateCheckbox} 0 77u 100% 10u "$LblGemmaBig"
  Pop $CbGemmaBig
  ${NSD_SetState} $CbGemmaBig $StGemmaBig
  ${NSD_CreateCheckbox} 0 91u 100% 10u "$LblOllama"
  Pop $CbOllama
  ${NSD_SetState} $CbOllama $StOllama
  ${NSD_CreateLabel} 0 106u 100% 30u "$ApiNote"
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
