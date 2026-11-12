; Filow Windows installer pages (electron-builder "nsis.include").
; Pages: welcome, information (build/info_*.txt: what Filow is and what's new), licence (build/license_*.txt),
; directory, install, finish with "Run now" and "Create desktop shortcut". There is no page about what
; to download: the app's own first-run setup decides for this PC, with the one rule the app uses
; (packages/core/src/profile.ts). Strings are set at run time from $LANGUAGE (one block per installer
; language in customInit); a language without a block falls back to English.
!include LogicLib.nsh

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
Var RunText
Var ShortcutText
Var InfoTitle
Var InfoSub
Var InfoTop
!endif

!macro customInit
  ${If} $LANGUAGE == 1040
    StrCpy $WelcomeTitle "Benvenuto in Filow"
    StrCpy $WelcomeText "Parla liberamente. Resta sul punto.$\r$\n$\r$\nQuesta procedura installerà Filow nel computer: il compagno di presentazione che ti ascolta, spunta i tuoi punti mentre li dici e ti mostra cosa hai saltato, con mirror sul telefono, Screen Sense e il componente per PowerPoint.$\r$\n$\r$\nSi consiglia di chiudere le altre applicazioni prima di continuare.$\r$\n$\r$\n© VoidExploit. Per proseguire, seleziona 'Avanti'."
    StrCpy $RunText "Esegui Filow"
    StrCpy $ShortcutText "Crea collegamento sul desktop"
    StrCpy $InfoTitle "Informazioni"
    StrCpy $InfoSub "Prima di procedere leggi le importanti informazioni che seguono."
    StrCpy $InfoTop "Quando sei pronto per proseguire, seleziona 'Avanti'."
  ${ElseIf} $LANGUAGE == 1031
    StrCpy $WelcomeTitle "Willkommen bei Filow"
    StrCpy $WelcomeText "Sprich frei. Bleib auf den Punkt.$\r$\n$\r$\nDieser Assistent installiert Filow auf dem Computer: den Vortragsbegleiter, der zuhört, deine Stichpunkte abhakt, sobald du sie ansprichst, und zeigt, was du ausgelassen hast – mit Spiegel auf dem Telefon, Screen Sense und dem PowerPoint-Add-in.$\r$\n$\r$\nSchließe vor dem Fortfahren andere Anwendungen.$\r$\n$\r$\n© VoidExploit. Klicke auf 'Weiter', um fortzufahren."
    StrCpy $RunText "Filow starten"
    StrCpy $ShortcutText "Desktop-Verknüpfung erstellen"
    StrCpy $InfoTitle "Informationen"
    StrCpy $InfoSub "Bitte lies die folgenden wichtigen Informationen, bevor du fortfährst."
    StrCpy $InfoTop "Klicke auf 'Weiter', wenn du bereit bist fortzufahren."
  ${ElseIf} $LANGUAGE == 1036
    StrCpy $WelcomeTitle "Bienvenue dans Filow"
    StrCpy $WelcomeText "Parlez librement. Restez sur le point.$\r$\n$\r$\nCet assistant installe Filow sur l'ordinateur : le compagnon de présentation qui vous écoute, coche vos points à mesure que vous les abordez et montre ce que vous avez sauté, avec miroir sur le téléphone, Screen Sense et le complément PowerPoint.$\r$\n$\r$\nFermez les autres applications avant de continuer.$\r$\n$\r$\n© VoidExploit. Cliquez sur « Suivant » pour continuer."
    StrCpy $RunText "Lancer Filow"
    StrCpy $ShortcutText "Créer un raccourci sur le bureau"
    StrCpy $InfoTitle "Informations"
    StrCpy $InfoSub "Veuillez lire les informations importantes suivantes avant de continuer."
    StrCpy $InfoTop "Lorsque vous êtes prêt à continuer, cliquez sur Suivant."
  ${ElseIf} $LANGUAGE == 3082
    StrCpy $WelcomeTitle "Bienvenido a Filow"
    StrCpy $WelcomeText "Habla con libertad. No pierdas el hilo.$\r$\n$\r$\nEste asistente instala Filow en el equipo: el compañero de presentación que te escucha, marca tus puntos a medida que los tratas y muestra lo que te has saltado, con espejo en el teléfono, Screen Sense y el complemento de PowerPoint.$\r$\n$\r$\nCierra las demás aplicaciones antes de continuar.$\r$\n$\r$\n© VoidExploit. Pulsa 'Siguiente' para continuar."
    StrCpy $RunText "Ejecutar Filow"
    StrCpy $ShortcutText "Crear un acceso directo en el escritorio"
    StrCpy $InfoTitle "Información"
    StrCpy $InfoSub "Lee la siguiente información importante antes de continuar."
    StrCpy $InfoTop "Cuando estés listo para continuar, haz clic en Siguiente."
  ${ElseIf} $LANGUAGE == 1046
    StrCpy $WelcomeTitle "Bem-vindo ao Filow"
    StrCpy $WelcomeText "Fale livremente. Mantenha o foco.$\r$\n$\r$\nEste assistente instala o Filow no computador: o companheiro de apresentação que escuta você, marca seus pontos conforme você os aborda e mostra o que ficou de fora, com espelho no celular, Screen Sense e o suplemento do PowerPoint.$\r$\n$\r$\nFeche os outros aplicativos antes de continuar.$\r$\n$\r$\n© VoidExploit. Clique em 'Avançar' para continuar."
    StrCpy $RunText "Executar o Filow"
    StrCpy $ShortcutText "Criar atalho na área de trabalho"
    StrCpy $InfoTitle "Informações"
    StrCpy $InfoSub "Leia as informações importantes a seguir antes de continuar."
    StrCpy $InfoTop "Quando estiver pronto para continuar, clique em Avançar."
  ${ElseIf} $LANGUAGE == 1043
    StrCpy $WelcomeTitle "Welkom bij Filow"
    StrCpy $WelcomeText "Spreek vrijuit. Blijf bij de kern.$\r$\n$\r$\nDeze wizard installeert Filow op de computer: de presentatiehulp die meeluistert, je punten afvinkt zodra je ze behandelt en laat zien wat je hebt overgeslagen, met spiegel op de telefoon, Screen Sense en de PowerPoint-invoegtoepassing.$\r$\n$\r$\nSluit andere toepassingen voordat je verdergaat.$\r$\n$\r$\n© VoidExploit. Klik op 'Volgende' om door te gaan."
    StrCpy $RunText "Filow starten"
    StrCpy $ShortcutText "Snelkoppeling op het bureaublad maken"
    StrCpy $InfoTitle "Informatie"
    StrCpy $InfoSub "Lees de volgende belangrijke informatie voordat je verdergaat."
    StrCpy $InfoTop "Klik op Volgende als je klaar bent om verder te gaan."
  ${ElseIf} $LANGUAGE == 1045
    StrCpy $WelcomeTitle "Witamy w Filow"
    StrCpy $WelcomeText "Mów swobodnie. Trzymaj się tematu.$\r$\n$\r$\nTen kreator zainstaluje Filow na komputerze: towarzysza prezentacji, który słucha, odhacza Twoje punkty, gdy je omawiasz, i pokazuje, co pominąłeś, z lustrem na telefonie, Screen Sense i dodatkiem do PowerPointa.$\r$\n$\r$\nPrzed kontynuowaniem zamknij inne aplikacje.$\r$\n$\r$\n© VoidExploit. Kliknij „Dalej”, aby kontynuować."
    StrCpy $RunText "Uruchom Filow"
    StrCpy $ShortcutText "Utwórz skrót na pulpicie"
    StrCpy $InfoTitle "Informacje"
    StrCpy $InfoSub "Przed kontynuowaniem przeczytaj poniższe ważne informacje."
    StrCpy $InfoTop "Gdy zechcesz kontynuować, kliknij Dalej."
  ${ElseIf} $LANGUAGE == 1049
    StrCpy $WelcomeTitle "Добро пожаловать в Filow"
    StrCpy $WelcomeText "Говорите свободно. Держитесь сути.$\r$\n$\r$\nЭтот мастер установит Filow на компьютер: помощника для выступлений, который слушает вас, отмечает тезисы по мере их раскрытия и показывает, что вы пропустили, с зеркалом на телефоне, Screen Sense и надстройкой для PowerPoint.$\r$\n$\r$\nПеред продолжением закройте другие приложения.$\r$\n$\r$\n© VoidExploit. Нажмите «Далее», чтобы продолжить."
    StrCpy $RunText "Запустить Filow"
    StrCpy $ShortcutText "Создать ярлык на рабочем столе"
    StrCpy $InfoTitle "Информация"
    StrCpy $InfoSub "Прочтите следующую важную информацию перед продолжением."
    StrCpy $InfoTop "Когда будете готовы продолжить, нажмите «Далее»."
  ${ElseIf} $LANGUAGE == 1041
    StrCpy $WelcomeTitle "Filow へようこそ"
    StrCpy $WelcomeText "自由に話す。要点を外さない。$\r$\n$\r$\nこのウィザードは Filow をコンピューターにインストールします。発表を聞きながら、話した要点にチェックを付け、抜けた点を示すプレゼンの相棒です。スマートフォンのミラー、Screen Sense、PowerPoint アドインを備えています。$\r$\n$\r$\n続行する前に他のアプリケーションを閉じてください。$\r$\n$\r$\n© VoidExploit。続行するには「次へ」をクリックしてください。"
    StrCpy $RunText "Filow を起動"
    StrCpy $ShortcutText "デスクトップにショートカットを作成"
    StrCpy $InfoTitle "情報"
    StrCpy $InfoSub "続行する前に、以下の重要な情報をお読みください。"
    StrCpy $InfoTop "続行する準備ができたら「次へ」をクリックしてください。"
  ${ElseIf} $LANGUAGE == 2052
    StrCpy $WelcomeTitle "欢迎使用 Filow"
    StrCpy $WelcomeText "畅所欲言，不离要点。$\r$\n$\r$\n此向导将在计算机上安装 Filow：一位演讲伙伴，边听边为你勾掉已讲到的要点，并提示遗漏的内容，支持手机镜像、Screen Sense 和 PowerPoint 加载项。$\r$\n$\r$\n继续之前请关闭其他应用程序。$\r$\n$\r$\n© VoidExploit。点击“下一步”继续。"
    StrCpy $RunText "运行 Filow"
    StrCpy $ShortcutText "创建桌面快捷方式"
    StrCpy $InfoTitle "信息"
    StrCpy $InfoSub "继续之前，请阅读以下重要信息。"
    StrCpy $InfoTop "准备好继续时，请点击“下一步”。"
  ${ElseIf} $LANGUAGE == 1048
    StrCpy $WelcomeTitle "Bun venit în Filow"
    StrCpy $WelcomeText "Vorbește liber. Rămâi la obiect.$\r$\n$\r$\nAcest asistent instalează Filow pe computerul tău: partenerul de prezentare care te ascultă în timp ce vorbești, îți bifează punctele pe măsură ce le spui și îți arată ce ai omis, cu oglindă pe telefon, Screen Sense și programul de completare pentru PowerPoint.$\r$\n$\r$\nÎnchide celelalte aplicații înainte de a continua.$\r$\n$\r$\n© VoidExploit. Apasă pe Înainte pentru a continua."
    StrCpy $RunText "Pornește Filow"
    StrCpy $ShortcutText "Creează o comandă rapidă pe desktop"
    StrCpy $InfoTitle "Informații"
    StrCpy $InfoSub "Citește informațiile importante de mai jos înainte de a continua."
    StrCpy $InfoTop "Când ești gata să continui, apasă pe Înainte."
  ${Else}
    StrCpy $WelcomeTitle "Welcome to Filow"
    StrCpy $WelcomeText "Speak freely. Stay on point.$\r$\n$\r$\nThis wizard installs Filow on your computer: the live speaking companion that listens as you present, checks off your talking points as you cover them and shows what you missed, with a phone mirror, Screen Sense and the PowerPoint add-in.$\r$\n$\r$\nClose other applications before continuing.$\r$\n$\r$\n© VoidExploit. Click Next to continue."
    StrCpy $RunText "Run Filow"
    StrCpy $ShortcutText "Create a desktop shortcut"
    StrCpy $InfoTitle "Information"
    StrCpy $InfoSub "Please read the following important information before continuing."
    StrCpy $InfoTop "When you are ready to continue, click Next."
  ${EndIf}
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

; Nothing is written into the user's profile: what to download is decided by the app at its first start.
!macro customInstall
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
