; Filow Windows installer pages (electron-builder "nsis.include").
; Pages: welcome, licence (build/license_*.txt), directory, "models and keys" (this file),
; install, finish with "Run now" and "Create desktop shortcut". Strings are set at run
; time from $LANGUAGE: Italian and English; other installer languages fall back to English.
!include nsDialogs.nsh
!include LogicLib.nsh

; Installer pass only: the uninstaller never sets them and makensis treats unused variables as errors here.
!ifndef BUILD_UNINSTALLER
Var WelcomeTitle
Var WelcomeText
Var ModelsTitle
Var ModelsSub
Var ModelsIntro
Var LblWhisperBase
Var LblWhisperSmall
Var LblClef
Var ApiNote
Var RunText
Var ShortcutText
Var CbWhisperBase
Var CbWhisperSmall
Var CbClef
Var StWhisperBase
Var StWhisperSmall
Var StClef
Var ModelsDlg
!endif

!macro customInit
  StrCpy $StWhisperBase ${BST_CHECKED}
  StrCpy $StWhisperSmall ${BST_UNCHECKED}
  StrCpy $StClef ${BST_UNCHECKED}
  ${If} $LANGUAGE == 1040
    StrCpy $WelcomeTitle "Benvenuto in Filow"
    StrCpy $WelcomeText "Parla liberamente. Resta sul punto.$\r$\n$\r$\nQuesta procedura installerà Filow nel computer: il compagno di presentazione che ti ascolta, spunta i tuoi punti mentre li dici e ti mostra cosa hai saltato, con mirror sul telefono, Screen Sense e il componente per PowerPoint.$\r$\n$\r$\nSi consiglia di chiudere le altre applicazioni prima di continuare.$\r$\n$\r$\n© VoidExploit. Per proseguire, seleziona 'Avanti'."
    StrCpy $ModelsTitle "Modelli locali e chiavi API"
    StrCpy $ModelsSub "Scegli cosa scaricare al primo avvio"
    StrCpy $ModelsIntro "Filow può lavorare interamente su questo PC. Seleziona i modelli da scaricare al primo avvio (puoi cambiare idea in Impostazioni):"
    StrCpy $LblWhisperBase "Whisper base: trascrizione vocale sul dispositivo (150 MB, consigliato)"
    StrCpy $LblWhisperSmall "Whisper small: trascrizione più accurata (500 MB, serve una GPU)"
    StrCpy $LblClef "Clef Flash via Ollama: decisioni in locale (6 GB, servono 16 GB di RAM e Ollama)"
    StrCpy $ApiNote "Per le decisioni nel cloud serve una chiave API OpenRouter (pochi centesimi per intervento); ElevenLabs o OpenAI sono facoltative per la trascrizione. Al primo avvio l'app apre il file .env in cui incollarle. Con Clef e Whisper in locale nessuna chiave è necessaria."
    StrCpy $RunText "Esegui Filow"
    StrCpy $ShortcutText "Crea collegamento sul desktop"
  ${Else}
    StrCpy $WelcomeTitle "Welcome to Filow"
    StrCpy $WelcomeText "Speak freely. Stay on point.$\r$\n$\r$\nThis wizard installs Filow on your computer: the live speaking companion that listens as you present, checks off your talking points as you cover them and shows what you missed, with a phone mirror, Screen Sense and the PowerPoint add-in.$\r$\n$\r$\nClose other applications before continuing.$\r$\n$\r$\n© VoidExploit. Click Next to continue."
    StrCpy $ModelsTitle "Local models and API keys"
    StrCpy $ModelsSub "Choose what to download on first start"
    StrCpy $ModelsIntro "Filow can run entirely on this PC. Pick the models to download on first start (you can change this later in Settings):"
    StrCpy $LblWhisperBase "Whisper base: on-device speech-to-text (150 MB, recommended)"
    StrCpy $LblWhisperSmall "Whisper small: more accurate speech-to-text (500 MB, needs a GPU)"
    StrCpy $LblClef "Clef Flash via Ollama: local decisions (6 GB, needs 16 GB RAM and Ollama)"
    StrCpy $ApiNote "Cloud decisions need an OpenRouter API key (a few cents per talk); ElevenLabs or OpenAI keys are optional for transcription. On first start the app opens the .env file where you paste them. With Clef and Whisper running locally no key is needed."
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
  ${NSD_CreateLabel} 0 0 100% 24u "$ModelsIntro"
  Pop $0
  ${NSD_CreateCheckbox} 0 30u 100% 12u "$LblWhisperBase"
  Pop $CbWhisperBase
  ${NSD_SetState} $CbWhisperBase $StWhisperBase
  ${NSD_CreateCheckbox} 0 44u 100% 12u "$LblWhisperSmall"
  Pop $CbWhisperSmall
  ${NSD_SetState} $CbWhisperSmall $StWhisperSmall
  ${NSD_CreateCheckbox} 0 58u 100% 12u "$LblClef"
  Pop $CbClef
  ${NSD_SetState} $CbClef $StClef
  ${NSD_CreateLabel} 0 80u 100% 48u "$ApiNote"
  Pop $0
  nsDialogs::Show
FunctionEnd

Function ModelsPageLeave
  ${NSD_GetState} $CbWhisperBase $StWhisperBase
  ${NSD_GetState} $CbWhisperSmall $StWhisperSmall
  ${NSD_GetState} $CbClef $StClef
FunctionEnd
  Page custom ModelsPageCreate ModelsPageLeave
!macroend

; The app reads this file once at first start, downloads the chosen models and deletes it.
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
  ${If} $1 != ""
    StrCpy $1 $1 -1
  ${EndIf}
  ${If} $LANGUAGE == 1040
    StrCpy $2 "it"
  ${Else}
    StrCpy $2 "en"
  ${EndIf}
  FileOpen $0 "$APPDATA\@filow\desktop\install-choices.json" w
  FileWrite $0 '{"models":[$1],"lang":"$2"}'
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
