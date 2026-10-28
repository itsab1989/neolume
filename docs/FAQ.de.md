# Neolume – Häufige Fragen

[English](FAQ.md) · [Installation](INSTALL.de.md) · [Übersicht](../README.de.md)

### Ist Neolume eine offizielle Plex-App?
Nein. Neolume ist ein unabhängiges Hobbyprojekt und steht in keiner Verbindung zu Plex Inc. Bei Problemen mit Neolume hilft der Plex-Support nicht; bitte im Projekt ein Issue anlegen.

### Warum gibt es Neolume?
Die offizielle Plex-App für Samsung-Fernseher von 2014 wird nicht mehr gepflegt und kann sich nicht mehr bei plex.tv anmelden, weil der Fernseher nur alte Verschlüsselung (TLS bis 1.1) beherrscht. Neolume umgeht das: Die Anmeldung erledigt einmalig ein Programm auf deinem Computer, danach spricht der Fernseher nur noch mit deinem Plex Media Server im Heimnetz.

### Welche Fernseher werden unterstützt?
Neolume läuft auf Samsungs **Orsay-Plattform** (Smart Hub 2011–2015). Das Baujahr steht an der **fünften Stelle** der Modellnummer:
**E** = 2012, **F** = 2013, **H/HU** = 2014, **J/JU/JS** = 2015.
- **2014, H-Serie:** ✅ unterstützt, entwickelt und getestet auf dem UE48H8000. Andere H-Modelle sollten laufen.
- **2014, HU-Serie (4K):** 🟡 sollte laufen (gleiche Plattform), ungetestet.
- **2013 (F) / 2012 (E):** ungetestet; älterer Browser, anderes Entwicklermenü.
- **2015:** nur die Modelle, die noch Orsay haben (einige J4xxx/J5xxx); die meisten 2015er (ab J5500, JU/JS) haben **Tizen** → ❌.
- **Ab 2016 (Tizen):** ❌ nicht unterstützt – dort gibt es die offizielle Plex-App im Samsung-Store.

Orsay oder Tizen? Bei Orsay (hier 2014) zeigt `SMART HUB` unten eine Leiste mit den Gruppen **Recent** und **Featured**; in
Featured gibt es das türkise Feld **SAMSUNG APPS** mit den Abschnitten **EMPFOHLEN** und **EIGENE APPS**, und unter `MENU` →
**Smart Hub** gibt es **Samsung-Konto**. Tizen-Geräte haben kein SAMSUNG APPS und keine `develop`-Anmeldung – dort fehlen
**IP Setting** und **Start User App Sync**.

### Ich habe einen neueren Fernseher – gibt es Neolume dafür?
Nicht fertig. Neolume läuft nur auf der oben beschriebenen Orsay-Plattform. Die meisten neueren Fernseher (Samsung Tizen,
LG webOS, Android TV / Google TV, Fire TV, Apple TV) haben die **offizielle Plex-App** im App-Store – probiere zuerst die.
Möchtest du Aussehen und Funktionen von Neolume trotzdem dort haben, kann ein **KI-Coding-Agent** die App dafür bauen:
Neolume bringt dafür eine Produktspezifikation, einen Ablaufplan für den Agenten und einen Abnahme-Testplan mit (auf
Englisch). Den Startbefehl und die Erklärung findest du im [README](../README.de.md#für-deinen-fernseher-bauen--mit-einem-ki-agenten);
Apps, die andere schon gebaut haben, stehen bei den [Community-Portierungen](../PORTS.md).

### Welche Auflösung nutzt Neolume?
Die Oberfläche ist für **1280 × 720** gebaut (so groß ist eine App auf der Orsay-Plattform); der Fernseher skaliert sie auf sein
Panel – 720p, 1080p und 4K (HU) sehen gleich aus. **Videos** zeigt der Fernseher in voller Auflösung: bis **1080p** direkt (H.264, 8 Bit),
alles darüber (z. B. 4K) wandelt dein Server in 1080p um.

### Brauche ich einen Plex Pass?
Nein. Einige Funktionen nutzen Daten, die der Server nur mit Plex Pass erzeugt (z. B. Intro-/Abspann-Marken, Vorschaubilder beim Spulen). Ohne sie fehlen nur diese Funktionen.

### Brauche ich den Computer dauerhaft?
Nein. Nur für die Einrichtung und für Updates. Danach kann der Computer aus sein.
Ausnahme: Für die **Merkliste**, die plex.tv-Reihen in **Entdecken** und die Infos zu Titeln, die nicht auf deinem Server
sind, muss der optionale Helfer irgendwo im Heimnetz laufen
(ein Computer oder ein NAS) – er lässt sich so installieren, dass er mit dem Computer von selbst startet, siehe
[INSTALL, Abschnitt 13](INSTALL.de.md#13-optionaler-helfer-merkliste--trends).

### Was ist der Helfer, und brauche ich ihn?
Nur, wenn du deine **Plex-Merkliste**, die Entdecken-Reihen **„Gerade beliebt“**, **„Neu erschienen“** und **„Bald
verfügbar“** und die **Infos zu Titeln, die nicht auf deinem Server sind** (Inhalt, Genres, Laufzeit, Besetzung), möchtest.
Die liegen bei plex.tv, und das erreicht der Fernseher (2014) nicht selbst (seine Verschlüsselung ist zu
alt). Der Helfer ist ein kleines Programm auf einem Computer oder NAS in deinem Heimnetz, das genau diese Listen und Infos
für den Fernseher holt – keine Videos, sonst nichts. Alles andere geht auch ohne ihn. Du kreuzt ihn im Einrichtungsprogramm an und
kannst ihn so installieren, dass er mit dem Computer startet, mit einem Symbol in der Menüleiste bzw. neben der Uhr; mit einem
Klick ist er wieder vollständig entfernt. Schritt für Schritt:
[INSTALL, Abschnitt 13](INSTALL.de.md#13-optionaler-helfer-merkliste--trends).

### Braucht Neolume Internet?
Im Alltag nicht – nur dein Plex Media Server im Heimnetz. Die einmalige Einrichtung braucht Internet (plex.tv). Ausnahme: die Merkliste, die Trend-Reihen in „Entdecken“ und die Infos zu Titeln, die nicht auf deinem Server sind, brauchen plex.tv und dafür den optionalen Helfer im Heimnetz (siehe [INSTALL, Abschnitt 13](INSTALL.de.md#13-optionaler-helfer-merkliste--trends)).

### Funktioniert Neolume außerhalb des Heimnetzes (Fernzugriff)?
Nein, bewusst nicht. Deinen eigenen Server erreicht Neolume nur über seine Adresse im Heimnetz.

### Kann ich mehrere Server nutzen?
Ein eigener Server wird bei der Einrichtung gewählt. Zusätzlich kannst du **Server, die jemand für dich freigegeben hat** (z. B. ein Freund), einbinden:
im Einrichtungsprogramm, Schritt **Übersicht**, auf **„Freigegebene Server suchen“** klicken und die gewünschten Server ankreuzen. Ihre Bibliotheken stehen dann in der Seitenleiste („von <Server>“);
Suche und Startseite bleiben bei deinem Server. Zwei Grenzen kommen vom Fernseher (2014), der nicht verschlüsseln kann: Der fremde Server muss unverschlüsselte Verbindungen
erlauben (Plex: **Einstellungen → Netzwerk → Sichere Verbindungen: Bevorzugt**), und die Verbindung läuft **unverschlüsselt über das Internet**.
Siehe [INSTALL, Abschnitt 14 „Weitere Server“](INSTALL.de.md#14-weitere-server-optional).

### Kann ich Profile wechseln?
Ja, alle bei der Einrichtung gewählten Plex-Home-Profile. Jedes Profil sieht nur seine eigenen Bibliotheken und hat seinen eigenen Gesehen-Status.

### Warum wird meine Plex-PIN nicht abgefragt?
Ohne plex.tv kann der Fernseher die Plex-PIN nicht prüfen. Stattdessen kann jedes Profil in Neolume eine eigene **App-PIN** bekommen. Gespeichert wird nur ein gesalzener Hash.

### Kann ich die Farben ändern?
Ja. Unter **Einstellungen → Oberfläche → Akzentfarbe** stehen sieben Farben für Fokus, Knöpfe und Fortschrittsbalken zur Wahl: Türkis (Standard), Bernstein, Koralle, Rosé, Lavendel, Himmelblau und Mintgrün. Die Wahl gilt je Profil und wirkt sofort. Alle Farben sind auf guten Kontrast geprüft (mindestens 4,5:1 für Schrift auf der Farbe und für die Farbe auf dem dunklen Hintergrund).

### Wie spule ich, und wie stelle ich die Sprungweite ein?
Im Video springen **Links/Rechts** und die Knöpfe **-10/+10** um die *Sprungweite Pfeiltasten & Knöpfe*, die **Vor-/Rückspultasten** um die *Sprungweite Vor-/Rückspulen* (beides unter **Einstellungen → Wiedergabe**). Die Knöpfe zeigen immer den echten Wert, z. B. **-10 / +30**, wenn du die Stufe wählst, die zurück kürzer springt als vor. Mehrmals drücken addiert, Halten einer Pfeiltaste beschleunigt, und gesprungen wird **einmal**, wenn du aufhörst zu drücken – so muss der Fernseher nur einmal nachladen. Mit der Smart Control zeigst du auf den Fortschrittsbalken und siehst vor dem Klick die Zeit (und ein Vorschaubild, wenn dein Server welche erstellt); nach dem Klick kannst du noch per Wischen auf dem Touchpad nach links/rechts nachjustieren, bevor gesprungen wird. **⏮ / ⏭** (und CH hoch/runter) wechseln zur vorigen/nächsten Folge, bei Filmen mit Kapiteln zum vorigen/nächsten Kapitel, nach *Alle abspielen* zum vorigen/nächsten Video; sie erscheinen nur, wenn es etwas zu wechseln gibt. Bei Musik nutzen die Knöpfe dieselbe Sprungweite wie die Pfeiltasten, bei Hörbüchern die größere *Vor-/Rückspulen*-Weite (Standard 30 Sekunden).

### Was ist die „Feinauswahl am Fortschrittsbalken“?
Eine optionale Hilfe für lange Filme, Folgen und Hörbücher, wenn ein Klick auf den Fortschrittsbalken zu weit danebenliegt
(bei einem zweistündigen Film ist ein Zeigerschritt schon mehrere Sekunden, und der Zeiger wackelt immer ein wenig). Schalte
sie unter **Einstellungen → Wiedergabe → Feinauswahl am Fortschrittsbalken** ein (sie braucht die *Zeiger-Steuerung*). Dann
zeigst du auf den Fortschrittsbalken und hältst den Zeiger knapp eine Sekunde ruhig, den Finger auf dem Touchpad: Die
Feinauswahl öffnet sich für die Minuten rund um diese Stelle, und der Zeiger bewegt die Zeit jetzt um ein Vielfaches feiner –
die Zielzeit steht an der kleinen Markierung, Kapitelanfänge rasten ein. Klicke, um dorthin zu springen (Wischen zum
Nachjustieren geht weiterhin), oder bewege den Zeiger nach oben weg (bzw. drücke RETURN), um sie zu verlassen. Solange sie
offen ist, reagieren die Knöpfe unter dem Balken überhaupt nicht: Rutscht dein Daumen auf sie, setzt ein Klick dort trotzdem
nur die feine Zielzeit – du kannst also nicht aus Versehen pausieren oder ein Menü öffnen. Bei kurzen Titeln wie Musikstücken oder kurzen Folgen erscheint sie nicht, weil der normale Balken dort schon genau
genug ist. Sie ist anfangs ausgeschaltet.

Wie die Feinauswahl aussieht, stellst du unter **Einstellungen → Wiedergabe → Darstellung der Feinauswahl** ein. Alle drei
Formen werden gleich bedient und treffen gleich genau:
- **Panel über dem Balken** (Standard): ein Feld mit einer gedehnten Leiste wächst aus der Oberkante der Bedienleiste heraus (Hinweis oben, Zeiten unter der
  Leiste). Solange es offen ist, rücken Untertitel nach oben, und was es verdecken würde (z. B. die Karte „Nächste Folge“),
  macht kurz Platz.
- **Balken dehnt sich**: kein zusätzliches Feld – der Balken selbst wird um die Stelle breit, der Rest rückt zusammen;
  Striche über dem Balken zeigen den gedehnten Teil.
- **Filmstreifen**: wie das Panel, aber mit sieben Vorschaubildern über die ganze Breite; das Bild unter dem Zeiger ist
  umrandet und zeigt die Zielstelle. Das braucht Vorschaubilder, die dein Server für das Video erstellt hat, und die
  Einstellung *Vorschaubilder beim Spulen*; ohne sie erscheint automatisch das Panel.

In *Jetzt läuft* (Musik, Hörbücher) dehnt sich immer der Balken, weil dort über dem Balken Titel und Kapitel stehen und die
Knöpfe direkt darunter liegen – für ein zusätzliches Feld ist dort kein Platz.

Frühere Testversionen hatten noch die Form *Feinleiste* direkt **unter** dem Fortschrittsbalken. Sie ist entfallen: Unter dem
Balken liegen Zeiten und Knöpfe so dicht, dass der Zeiger beim Feinjustieren leicht einen Knopf traf. Wer sie gewählt hatte,
bekommt jetzt automatisch *Panel über dem Balken*.

### Wie stelle ich den Bildschirmschoner ein?
Unter **Einstellungen → Oberfläche**. *Bildschirmschoner nach* (Aus, 1, 2, 5, 10, 15 oder 30 Minuten; Standard 5) startet ihn, wenn keine Taste gedrückt wurde – nie während ein Video läuft. Dazu:

| Einstellung | Auswahl (Standard zuerst) | Wirkung |
|---|---|---|
| Schoner-Bilder aus | Bibliotheken · Startseite | Bibliotheken: zufällige Titel mit Hintergrundbild aus ganzen Bibliotheken, keiner doppelt, bis alle dran waren. Startseite: nur Titel von dort (keine zusätzlichen Anfragen). |
| Bibliotheken im Schoner | Filme & Serien · eigene Auswahl | Welche Bibliotheken genutzt werden. Musik zeigt Künstlerbilder. |
| Nur Ungesehenes zeigen | Aus · An | Nur Filme und Serien, die du noch nicht zu Ende gesehen hast. |
| Bildwechsel alle | 30 · 10 · 20 · 60 Sekunden | Wie lange jedes Bild bleibt. |
| Bildübergang | Überblenden · Schnitt · Über Schwarz · Langsamer Zoom · Langsames Gleiten · Zoom-Durchflug · Vorhang · Jalousie · Kacheln · Zufällig | Wie das nächste Bild erscheint. Bei *Reduzierte Bewegung* wird aus Bewegung ein Überblenden. |
| Einblendung im Schoner | Ambient · Klassisch · Filmplakat · Untertitel-Leiste · Große Uhr · Nur kleine Uhr · Aus | Wie Uhr und Titel erscheinen; INFO auf der Einstellung erklärt jeden Stil. Die Lage wechselt mit jedem Bild (gegen Einbrennen). |
| Schoner-Bilder unscharf | An · Aus | Weich und ruhig oder scharf. |

*Uhrzeit anzeigen* gilt auch im Schoner: Ist sie aus, zeigt kein Stil die Uhr. Kinderprofile nutzen die Standardwerte und sehen nur Bilder, die ihr eigenes Plex-Konto sehen darf.

### Was ist der farbige Hintergrund in den Bibliotheken? Kann ich ihn abschalten?
Das ist der **Hintergrund in Bibliotheken** (**Einstellungen → Oberfläche → Hintergrund in Bibliotheken**). *Farbstimmung* (Standard) färbt den Hintergrund sanft in den Farben des gewählten Titels – die liefert dein Plex-Server ohnehin mit, es wird nichts zusätzlich geladen. *Titelbild* zeigt das Bild des Titels, vom Server weichgezeichnet und abgedunkelt; *Zufallsbild* wählt bei jedem Öffnen der Bibliothek ein Bild daraus. *Aus* lässt den schlichten dunklen Hintergrund. **Stärke des Hintergrunds** wählt zwischen *Dezent* (Standard, am dunkelsten, Texte am besten lesbar) und *Kräftiger*. Der Hintergrund wechselt erst, wenn du kurz auf einem Titel stehen bleibst, nie beim Scrollen – so bleibt das Blättern flüssig. Sind **Hintergrundbilder** aus, zeigen *Titelbild* und *Zufallsbild* stattdessen die Farbstimmung; mit **Reduzierte Bewegung** wechselt er ohne Überblenden.

### Warum schlägt Entdecken nur Titel vor, die ich noch nicht habe? Kann ich alles sehen?
Mit dem optionalen [Helfer](INSTALL.de.md#13-optionaler-helfer-merkliste--trends) zeigt Entdecken zusätzlich Reihen von plex.tv: **Gerade beliebt**, **Neu erschienen** und **Bald verfügbar** (jeweils Filme und Serien). Standardmäßig zeigen diese Reihen nur Titel, die **nicht** auf deinem Server liegen – Entdecken soll reine Inspiration sein, und was du schon hast, steht ohnehin in den anderen Entdecken-Reihen und in deinen Bibliotheken. Damit die Reihen trotzdem voll bleiben, holt Neolume beim Helfer mehr Titel, als es anzeigt (bis zu 30 je Reihe), und prüft sie alle in einer einzigen Anfrage gegen deinen Server. Hast du aus einer Liste schon alles, steht in der Reihe ein kurzer Hinweis statt einer leeren Reihe.

Alles wieder sehen: **Einstellungen → Oberfläche → Nur Titel, die du noch nicht hast** ausschalten. Dann zeigen die Reihen alle Titel; was auf deinem Server liegt, trägt die Marke *Auf deinem Server* und lässt sich direkt abspielen. Nutzt du [für dich freigegebene Server](#kann-ich-mehrere-server-nutzen), blendet die zweite Einstellung **Auch Weitere Server beachten** (Standard an) auch deren Titel aus; antwortet so ein Server nicht innerhalb weniger Sekunden, bleiben seine Titel sichtbar. Erkannt wird über die Plex-Kennung jedes Titels – Titel aus Bibliotheken, die noch einen alten Plex-Agenten nutzen, erkennt Neolume dabei eventuell nicht als deine.

### Was passiert mit meinen anderen selbst installierten Apps?
Der Fernseher entfernt beim Sync **alle selbst installierten Apps, die nicht in der Liste stehen**. Trage sie im Einrichtungsprogramm unter *Erweitert* ein. Apps aus dem Samsung-Store sind nicht betroffen.

### Wird die alte Plex-App überschrieben?
Nein. Neolume ist eine eigene App mit eigenem Namen. Die vorinstallierte Plex-App bleibt, wie sie ist.

### Welche Daten sendet Neolume?
Nur Anfragen an deinen Plex Media Server (Bibliotheken, Bilder, Wiedergabe, Fortschritt). Keine Telemetrie, keine Werbung, keine Analyse. Ein Diagnose-Protokoll geht nur auf deinen Wunsch an einen Computer im Heimnetz.

### Wo liegen meine Zugangsdaten?
Auf dem Fernseher, im Speicher der App: je Profil ein Server-Token, das nur für deinen Server gilt. Dein Plex-Passwort wird nirgends gespeichert. Das Einrichtungsprogramm hält Tokens nur im Arbeitsspeicher und schreibt sie nicht auf die Festplatte – außer du nutzt den optionalen Helfer mit „Zugang auf diesem Computer merken“: Dann liegt eine geschützte Datei `helper.json` auf deinem Computer, die nur dein Benutzerkonto lesen kann.

### Wie entziehe ich Neolume den Zugang?
Auf plex.tv unter *Konto → Autorisierte Geräte* den Eintrag „Neolume“ entfernen. Freigaben für Profile verwaltest du unter *Einstellungen → Benutzer & Freigaben*.

### Ist die Verbindung verschlüsselt?
Zwischen Fernseher und Server nicht (HTTP im Heimnetz), weil der Fernseher keine aktuelle Verschlüsselung kann. Die Anmeldung bei plex.tv am Computer läuft verschlüsselt (HTTPS).

### Welche Videoformate spielt Neolume ab?
Was der Fernseher direkt kann (z. B. H.264 bis 1080p), spielt er direkt. Alles andere (z. B. HEVC, 10-Bit, manche Tonformate) wandelt dein Server um. Dafür braucht der Server genug Leistung.

### Wie aktualisiere ich Neolume?
Neue Version herunterladen, Einrichtungsprogramm starten, Paket bauen, am Fernseher erneut „Start User App Sync“. Siehe [Installation, Abschnitt 10](INSTALL.de.md#10-aktualisieren).

### Wie entferne ich Neolume?
Siehe [Installation, Abschnitt 11](INSTALL.de.md#11-deinstallieren).

### Darf ich Neolume weitergeben oder verändern?
Ja, unter der [MIT-Lizenz](../LICENSE). Veränderte Fassungen bitte mit eigenem Namen und Symbol weitergeben.

### Wie kann ich das Projekt unterstützen?
Fehlerberichte und Rückmeldungen zu weiteren Fernsehermodellen helfen am meisten. Wer Danke sagen möchte, kann auf [Ko-fi](https://ko-fi.com/itsab1989) einen Kaffee spendieren – ganz freiwillig.
