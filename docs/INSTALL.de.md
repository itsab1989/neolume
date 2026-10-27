# Neolume installieren – Schritt für Schritt

[English version](INSTALL.md) · [FAQ](FAQ.de.md) · [Zurück zur Übersicht](../README.de.md)

Diese Anleitung ist für Menschen ohne Technik-Vorwissen gedacht. Zeitbedarf: etwa **20 Minuten** beim ersten Mal.

> **Hinweis:** Die [englische Anleitung](INSTALL.md) ist die ausführlichste (mit Tastenübersicht). Schritte, die noch nicht wortgenau an einem Fernseher geprüft wurden, sind mit **(noch zu prüfen)** markiert.
> Menünamen am Fernseher stehen jeweils **deutsch / englisch**, weil das Menü der Sprache des Fernsehers folgt. Einige Einträge (z. B. „IP Setting“, „Start User App Sync“) sind auch auf deutschen Geräten englisch.

## Inhalt

1. [Was du brauchst](#1-was-du-brauchst)
2. [Wie die Installation funktioniert (kurz)](#2-wie-die-installation-funktioniert-kurz)
3. [Fernseher vorbereiten](#3-fernseher-vorbereiten)
4. [Computer vorbereiten](#4-computer-vorbereiten)
5. [Einrichtungsprogramm starten](#5-einrichtungsprogramm-starten)
6. [Anmelden, Server und Profile wählen, Paket bauen](#6-anmelden-server-und-profile-wählen-paket-bauen)
7. [App auf den Fernseher übertragen](#7-app-auf-den-fernseher-übertragen)
8. [So sieht Erfolg aus](#8-so-sieht-erfolg-aus)
9. [Erster Start am Fernseher](#9-erster-start-am-fernseher)
10. [Aktualisieren](#10-aktualisieren)
11. [Deinstallieren](#11-deinstallieren)
12. [Fehlerbehebung](#12-fehlerbehebung)

---

## 1. Was du brauchst

- Einen **Samsung-Fernseher der H-Serie von 2014** mit Smart Hub (Orsay). Getestet ist der **UE48H8000**. Die Modellnummer steht auf der Rückseite oder unter `MENU` → **Unterstützung / Support** → **Samsung kontaktieren / Contact Samsung** – dort stehen **Modellcode** und **Softwareversion**. Ein „H“ an der fünften Stelle (z. B. UE48**H**8000) bedeutet Jahrgang 2014.
- Den Fernseher **mit dem Heimnetz verbunden** (WLAN oder Kabel).
- Einen **Plex Media Server** im selben Heimnetz, der läuft. Du musst **Besitzer** dieses Servers sein.
- Dein **Plex-Konto** (E-Mail/Passwort oder Google/Apple-Anmeldung).
- Einen **Computer** (Mac, Windows oder Linux) im **selben Heimnetz** – nicht im Gast-WLAN und ohne aktives VPN.
- Die **Fernbedienung** des Fernsehers (die normale Fernbedienung reicht; die Smart Control geht auch).

## 2. Wie die Installation funktioniert (kurz)

Samsung nimmt für Fernseher von 2014 keine neuen Apps mehr in seinen Store auf. Für eigene Apps gibt es aber einen offiziellen Entwickler-Weg:

1. Man meldet sich am Fernseher mit dem besonderen Benutzer **`develop`** an.
2. Man trägt am Fernseher die **Adresse eines Computers** im Heimnetz ein („IP Setting“).
3. Man startet **„Start User App Sync“**. Der Fernseher holt sich dann vom Computer eine Liste (`widgetlist.xml`) und das App-Paket.

Das Einrichtungsprogramm auf deinem Computer erledigt alles Übrige: Es meldet dich einmal bei Plex an, holt die Zugänge für deine Profile, baut das App-Paket und stellt es für den Fernseher bereit.

> ⚠️ **Wichtig:** Beim Sync **entfernt der Fernseher alle selbst installierten Apps, die nicht in der Liste stehen.** Apps aus dem Samsung-Store sind davon nicht betroffen. Nutzt du weitere selbst installierte Apps, siehe [Schritt 6.4](#64-profile-wählen-und-weitere-apps-eintragen).

## 3. Fernseher vorbereiten

Diese Schritte sind nur **einmal** nötig.

### 3.1 Netzwerk prüfen
`MENU` → **Netzwerk / Network** → **Netzwerkstatus / Network Status**. Dort soll stehen, dass der Fernseher mit dem Internet bzw. dem Netzwerk verbunden ist.

### 3.2 Mit dem Benutzer „develop“ anmelden
1. Taste **`MENU`** (bei der Smart Control: Taste **`MORE`** → **Menü / Menu** auf dem Bildschirm) (noch zu prüfen: Weg mit der Smart Control).
2. **Smart Hub** → **Samsung-Konto / Samsung Account**.
   Bist du angemeldet, steht oben **Abmelden / Log out** und unten rechts das angemeldete Konto (englisch *My Account: …*). Steht dort schon
   `develop`, bist du fertig (weiter mit [Schritt 3.3](#33-das-feld-samsung-apps-finden)). Ist ein anderes Konto angemeldet, zuerst abmelden.
3. **Anmeld.** wählen. Es erscheint die Liste der Konten auf diesem Fernseher.
4. **`develop` steht in der Liste:** auswählen und **Anmelden** wählen – **ohne Passwort**.
5. **`develop` fehlt noch:** als Kennung **`develop`** (Kleinbuchstaben) eingeben. Das Passwort füllt sich meist selbst aus,
   sonst **`any`** (noch zu prüfen für die allererste Anlage; manche Geräte erwarten `111111`). Dann **Anmelden**.

Die Anmeldung bleibt gespeichert, auch nach dem Ausschalten. Ohne `develop`-Anmeldung fehlen später **IP Setting** und **Start User App Sync**.

### 3.3 Das Feld „SAMSUNG APPS“ finden
1. Taste **`SMART HUB`** (bunte Taste in der Mitte der Fernbedienung).
2. Unten erscheint eine Leiste mit den Gruppen **Zuletzt / Recent** und **Featured**. In **Featured** das türkise Feld
   **SAMSUNG APPS** wählen (neben *Multimedia* und *Tutorial*) und **OK** drücken (noch zu prüfen: deutsche Bezeichnung der Gruppen).
3. Es öffnet sich SAMSUNG APPS mit den Abschnitten **EMPFOHLEN** und **EIGENE APPS** (englisch: RECOMMENDED / MY APPS).

Lass den Fernseher hier stehen und mach am Computer weiter.

## 4. Computer vorbereiten

### 4.1 Einrichtungsprogramm herunterladen
Auf der Seite **[Neuestes Release](https://github.com/itsab1989/neolume/releases/latest)** unter **Assets** die passende Datei laden:

| Computer | Datei |
|---|---|
| Windows 10/11 (normaler PC/Laptop) | `neolume-setup-windows-x64.exe` |
| Windows auf ARM (Surface Pro X, Snapdragon-Laptops) | `neolume-setup-windows-arm64.exe` |
| Mac mit Apple-Chip (M1, M2, M3, M4 …) | `neolume-setup-macos-arm64.zip` |
| Mac mit Intel-Chip | `neolume-setup-macos-x64.zip` |
| Linux-PC | `neolume-setup-linux-x64` |
| Linux auf ARM (z. B. Raspberry Pi 4/5, 64 Bit) | `neolume-setup-linux-arm64` |
| Alles andere mit Python 3.8+ | `neolume-setup.pyz` |

Die TV-App steckt bereits darin – nichts muss selbst gebaut werden.

### 4.2 Adresse des Computers (optional)
Das Programm zeigt die Adresse später groß an. Sie sieht aus wie `192.168.1.20`. In dieser Anleitung heißt sie **`<Computer-IP>`**.

## 5. Einrichtungsprogramm starten

**Windows:** Im Ordner *Downloads* die Datei doppelklicken. Erscheint **„Der Computer wurde durch Windows geschützt“**:
**Weitere Informationen** → **Trotzdem ausführen**. Fragt die Windows-Sicherheit nach Netzwerkzugriff: **Private Netzwerke**
ankreuzen → **Zugriff zulassen**. Das schwarze Fenster offen lassen.

**Mac:** Im Ordner *Downloads* die `.zip`-Datei doppelklicken, dann `neolume-setup` doppelklicken. Beim ersten Mal lehnt
macOS das Programm ab (nicht von Apple beglaubigt):
- **macOS 15 und neuer:** **Fertig** klicken, **Systemeinstellungen → Datenschutz & Sicherheit** öffnen, nach unten zu
  *„neolume-setup“ wurde blockiert* → **Dennoch öffnen**, mit Passwort bestätigen, erneut doppelklicken.
- **macOS 14 und älter:** Rechtsklick (oder `Ctrl`-Klick) auf `neolume-setup` → **Öffnen** → **Öffnen**.

Es öffnet sich ein Terminal-Fenster (das ist das Programm). Fragt macOS nach eingehenden Verbindungen: **Erlauben**.

**Linux:** `chmod +x neolume-setup-linux-x64` und `sudo ./neolume-setup-linux-x64` (Port 80 braucht Administratorrechte).

**Python-Fassung:** `python3 neolume-setup.pyz` (Windows: `py neolume-setup.pyz`, Linux mit `sudo`).

Der Browser öffnet **`http://127.0.0.1:32480/`** – sonst diese Adresse selbst eingeben.

## 6. Anmelden, Server und Profile wählen, Paket bauen

Die Oberfläche im Browser gibt es auf Deutsch und Englisch.

### 6.1 Mit Plex anmelden
1. **„Mit Plex anmelden“** klicken.
2. Es öffnet sich ein Fenster von plex.tv. Dort wie gewohnt anmelden und **Zulassen / Allow** wählen.
3. Die Seite des Einrichtungsprogramms geht von selbst weiter.

Alternative: **„Lieber mit Code auf plex.tv/link“** – den angezeigten Code auf `plex.tv/link` eingeben (geht auch am Handy).

Dein Passwort gibst du dabei nur bei plex.tv ein.

### 6.2 Server wählen
Deine Server erscheinen als Liste. **Klicke deinen Server an.** Er sollte **„im Heimnetz gefunden“** anzeigen.
Wird er nicht gefunden: Läuft der Server? Ist der Computer im selben Netz? Siehe [Fehlerbehebung](#12-fehlerbehebung).

### 6.3 Profile prüfen
Alle Profile deines Plex Home erscheinen mit Haken. Jedes Profil bekommt einen eigenen Zugang zu deinem Server – mit eigenen Bibliotheken und eigenem Gesehen-Status.
- Steht bei einem Profil „kein Zugang“: in Plex unter *Einstellungen → Benutzer & Freigaben / Settings → Users & Sharing* den Server für dieses Profil freigeben, dann **Zurück** und den Server erneut wählen.

### 6.4 Profile wählen und weitere Apps eintragen
Öffne **Erweitert**, wenn einer dieser Punkte zutrifft:
- **Du nutzt weitere selbst installierte Apps** auf dem Fernseher (nicht aus dem Samsung-Store). Trage je Zeile den Pfad zu deren `.zip`-Paket ein, z. B. `<Ordner>/MeineApp.zip`. **Sonst werden sie beim Sync gelöscht.**
- Du willst, dass **nur dein Fernseher** die App abholen darf: Trage die **IP-Adresse des Fernsehers** ein (`MENU` → **Netzwerk / Network** → **Netzwerkstatus / Network Status** → **IP-Einstellungen / IP Settings**; noch zu prüfen).

### 6.5 Paket bauen
1. **Übersicht** prüfen. Dort gibt es zwei Extras, beide ohne Haken aus: **Weitere Server** (Server, die jemand für dich freigegeben hat,
   siehe [Nachtrag](#nachtrag-weitere-server-optional)) und den **Helfer** (siehe [Nachtrag](#nachtrag-optionaler-helfer-merkliste--trends)).
2. **„App-Paket erstellen“** klicken.
3. Danach startet der Sync-Server automatisch. Das Programm zeigt die **Adresse deines Computers groß** an und wartet auf den Fernseher.

## 7. App auf den Fernseher übertragen

Zurück zum Fernseher (Feld **SAMSUNG APPS** aus [Schritt 3.3](#33-das-feld-samsung-apps-finden)).

### 7.1 Adresse des Computers eintragen („IP Setting“)
1. Mit den Pfeiltasten auf **irgendeine App-Kachel** gehen (z. B. eine vorinstallierte App).
2. **OK gedrückt halten – etwa 5 bis 6 Sekunden**, bis ein Menü erscheint: *Verschieben, Entfernen, Mehr löschen, Details anzeigen,
   Ansicht ändern, Sperren/Sperre aus, Apps aktualisieren*, **IP Setting**, **Start User App Sync** (die letzten beiden immer englisch).
   Erscheint das Menü nicht: Fokus wirklich auf einer App-Kachel? Bist du als `develop` angemeldet ([Schritt 3.2](#32-mit-dem-benutzer-develop-anmelden))?
3. **IP Setting** wählen. Es öffnet sich **Develop IP Setting** mit **vier leeren Kästchen** und **OK**.
   > ⚠️ Der Fernseher **zeigt die gespeicherte Adresse nie an** – die Kästchen sind immer leer. **Den leeren Dialog nicht mit OK
   > bestätigen** (das kann die Adresse löschen): entweder die ganze Adresse neu eintragen oder mit `RETURN` abbrechen.
4. Die **`<Computer-IP>`** eingeben, die das Einrichtungsprogramm anzeigt: je Kästchen einen Block, mit **►** zum nächsten
   Kästchen, falls der Fernseher nicht selbst weiterspringt (noch zu prüfen). Dann **OK**.

Das musst du nur wiederholen, wenn sich die Adresse deines Computers ändert.

### 7.2 Sync starten
1. Wieder **OK etwa 5–6 Sekunden halten** auf einer App-Kachel.
2. **Start User App Sync** wählen.
3. Es erscheint die Meldung *„User Apps Sync is requested“* (auch im deutschen Menü englisch). **Nur einmal OK** drücken.
   Ist danach das Menü noch offen und ein Eintrag wie „Verschieben“ aktiv: mit **`RETURN`** abbrechen – das ist harmlos.
4. Warten. Der Fernseher holt erst die Liste, dann die App – meist **20–30 Sekunden**.

## 8. So sieht Erfolg aus

- **Im Einrichtungsprogramm** erscheinen nacheinander: *„Fernseher … hat widgetlist.xml abgeholt“* und *„… App-Paket abgeholt“*.
- **Am Fernseher** steht **„Neolume“** unter **EIGENE APPS / MY APPS** (mit einem Symbol: Fokusrahmen um eine Posterkarte).
  Erscheint die App nicht sofort: Smart Hub schließen und wieder öffnen, oder den Fernseher kurz aus- und wieder einschalten.
- Weitere selbst installierte Apps, die du in [Schritt 6.4](#64-profile-wählen-und-weitere-apps-eintragen) eingetragen hast, sind weiterhin da.

Dann im Einrichtungsprogramm **„Die App ist auf dem Fernseher“** → **„Zugangsdaten aus dem Speicher löschen und beenden“** klicken, das Browserfenster schließen und das Programm beenden (im Terminal `Ctrl` + `C`).

## 9. Erster Start am Fernseher

1. **Neolume** in **EIGENE APPS / MY APPS** öffnen.
2. Neolume startet direkt im **Hauptprofil**. Zum Wechseln mit `◄` die Seitenleiste öffnen und oben das Profilbild wählen.
   Unter **Einstellungen → Profil & Konto → Startprofil** kann stattdessen die **Profilwahl** beim Start erscheinen.
3. Beim ersten Start fragt Neolume, ob Erwachsenenprofile mit einer **App-PIN** geschützt werden sollen. Die PIN gilt nur für Neolume; deine Plex-PIN wird nicht verwendet.
4. Die Startseite lädt Weiterschauen, Nächste Folgen und Neues aus deinen Bibliotheken.

Neolume spricht ab jetzt **nur mit deinem Server**. Computer und Internet werden im Alltag nicht gebraucht (der Server selbst braucht für Metadaten natürlich weiter Internet).

## 10. Aktualisieren

1. Neue Version von Neolume herunterladen ([Schritt 4.2](#42-plex-neo-herunterladen)).
2. Einrichtungsprogramm erneut starten und die Schritte 6 und 7 wiederholen. „IP Setting“ ist nur nötig, wenn sich die Adresse deines Computers geändert hat.
3. Der Sync ersetzt Neolume; es entsteht keine zweite App. Einstellungen und App-PINs in Neolume bleiben erhalten.

**Erneut einrichten** musst du außerdem, wenn ein Profil dazukommt, eine Freigabe neu angelegt wird, du dein Plex-Passwort änderst oder auf plex.tv „Von allen Geräten abmelden“ nutzt. Neolume zeigt dann „Einrichtung am Rechner erneut ausführen“.


## 11. Deinstallieren

1. **SMART HUB** → **SAMSUNG APPS** → auf **Neolume** gehen.
2. **OK etwa 5–6 Sekunden halten** → **Entfernen / Delete** → bestätigen.
3. Auf plex.tv unter **Konto → Autorisierte Geräte / Account → Authorized Devices** den Eintrag **„Neolume“** entfernen. Damit wird der Zugang des Hauptkontos ungültig.
4. Optional: Freigaben, die du nur für Neolume angelegt hast, in Plex wieder entfernen.
5. Optional: Am Fernseher wieder vom Benutzer `develop` abmelden (`MENU` → **Smart Hub** → **Samsung-Konto** → **Abmelden / Log out**).

Am Fernseher selbst (Firmware, System) wird nichts verändert.

## 12. Fehlerbehebung

### Das Menü mit „IP Setting“ / „Start User App Sync“ erscheint nicht
- Bist du als **`develop`** angemeldet? ([Schritt 3.2](#32-mit-dem-benutzer-develop-anmelden)) Nur dann gibt es diese Einträge.
- Bist du im großen Feld **SAMSUNG APPS** und steht der Fokus auf einer **App-Kachel**?
- **OK lange genug halten** (5–6 Sekunden), nicht mehrfach drücken.

### Sync läuft, aber keine App erscheint
- Hat das Einrichtungsprogramm *„widgetlist.xml abgeholt“* gemeldet?
  - **Nein:** Der Fernseher erreicht den Computer nicht – siehe nächster Punkt.
  - **Ja, aber kein „App-Paket abgeholt“:** Sync erneut starten. Paket im Programm neu erstellen.
  - **Beides ja:** Smart Hub schließen/öffnen oder Fernseher aus-/einschalten. Unter **EIGENE APPS / MY APPS** nachsehen, nicht nur in der kleinen Leiste.
- Ist bei **IP Setting** genau die Adresse eingetragen, die das Programm anzeigt? Der Dialog zeigt die gespeicherte Adresse nie an –
  einfach alle vier Kästchen neu eintragen und **OK**; den leeren Dialog nie bestätigen.

### Der Fernseher erreicht den Computer nicht
- **Firewall:** Der Computer muss eingehende Verbindungen auf **Port 80** zulassen.
  - Mac: **Systemeinstellungen → Netzwerk → Firewall → Optionen**: „Python“ auf **Eingehende Verbindungen erlauben**.
  - Windows: **Windows-Sicherheit → Firewall- & Netzwerkschutz → Zugriff von App durch Firewall zulassen**: „Python“ für **Privat** erlauben. Das Netzwerk muss als **Privat** eingestuft sein, nicht „Öffentlich“.
  - Linux: z. B. `sudo ufw allow 80/tcp` (nur solange nötig).
- **Port 80 belegt:** Meldet das Programm „Port ist schon belegt“, läuft ein anderer Webserver (oder das Programm zweimal). Diesen beenden.
- **Gleiches Netz:** Computer und Fernseher im selben Heimnetz? Kein Gast-WLAN, kein VPN, kein getrenntes „IoT-Netz“. Manche Router trennen WLAN-Geräte voneinander („Client-Isolation“/„AP-Isolation“) – im Router ausschalten.
- **Sperre auf ersten Fernseher:** Hat ein anderes Gerät zuerst abgeholt, lässt das Programm nur noch dieses zu. Im Programm **„Freigeben“** drücken.

### Nach dem Sync sind andere selbst installierte Apps verschwunden
Der Fernseher **entfernt beim Sync alle selbst installierten Apps, die nicht in der Liste stehen**. Das ist ein Verhalten des Fernsehers, nicht von Neolume.
Lösung: Im Einrichtungsprogramm unter **Erweitert** die `.zip`-Pakete **aller** gewünschten Apps eintragen, Paket neu erstellen, Sync wiederholen. Ihre Daten (z. B. Anmeldungen) musst du dort ggf. neu einrichten.

### Server wird nicht gefunden
- Läuft der Plex Media Server? Erreichst du ihn am Computer unter `http://<Server-IP>:32400/web`?
- Ist der Computer im selben Netz wie der Server?
- Neolume nutzt nur Adressen im Heimnetz. Ein Server, der nur über das Internet erreichbar ist, wird nicht unterstützt.

### „Port 80 darf nicht geöffnet werden“
- Linux: das Programm mit `sudo` starten.
- Mac/Windows: Firewall-Abfrage erlauben, ggf. das Programm neu starten.

### Warum nicht über HTTPS? (TLS-Hinweis)
Der Fernseher beherrscht nur alte Verschlüsselung (TLS bis 1.1). plex.tv verlangt TLS 1.2 oder neuer. Deshalb erledigt der Computer die Anmeldung, und der Fernseher spricht **im Heimnetz per HTTP** mit Computer und Server. Daran lässt sich am Fernseher nichts ändern. Benutze Neolume deshalb nur in einem Heimnetz, dem du vertraust.

### Neolume meldet „Einrichtung am Rechner erneut ausführen“
Ein Zugang ist ungültig geworden (neues Passwort, „Von allen Geräten abmelden“, Freigabe geändert). Schritte 5–7 wiederholen.

### App-PIN vergessen
Das Hauptprofil kann die PIN jedes Profils unter **Einstellungen → Profil & Konto → PINs aller Profile** ändern oder entfernen.
PIN des **Hauptprofils** vergessen? Einrichtung erneut ausführen, in der Übersicht **„App-PINs zurücksetzen“** ankreuzen und neu aufspielen.

### Smart Hub zurücksetzen – Vorsicht
**Smart Hub zurücksetzen / Reset Smart Hub** (unter `MENU` → **Smart Hub** → **Smart Hub zurücksetzen**) löscht **alle** selbst installierten Apps samt Daten und meldet `develop` ab. Danach Schritt 3.2 und Schritte 5–7 wiederholen. Nur als letztes Mittel nutzen.
Ein Zurücksetzen auf Werkseinstellungen hat dieselbe Wirkung (und mehr).

### Ältere Fernseher (E/F-Serie 2012/2013)
Nicht getestet. Laut Berichten: Smart Hub → rote Taste **A** (Anmelden) → `develop` (Passwort ggf. `111111`) → **TOOLS** → **Einstellungen / Settings** → **Entwicklung / Development** → **Server-IP** → **Synchronisieren / User Application Synchronization** (noch zu prüfen).

Weitere Fragen: [FAQ](FAQ.de.md).

## Nachtrag: Optionaler Helfer (Merkliste & Trends)
Alles in Neolume funktioniert mit deinem Plex-Server allein. Nur die **Plex-Merkliste** und in „Entdecken“ die Reihen **„Gerade beliebt“, „Neu erschienen“,
„Bald verfügbar“** liegen bei plex.tv, das der Fernseher nicht erreicht. Wer sie möchte:
1. Im Einrichtungsprogramm in der **Übersicht** „Helfer einrichten“ ankreuzen, dann wie gewohnt „App-Paket erstellen“ und aufspielen.
2. Unten auf der Seite **„Helfer starten“**. Der Helfer läuft, solange das Programm offen ist – oder dauerhaft per Autostart bzw. auf einem NAS
   (Befehle für Autostart und Docker/NAS: [englische Anleitung, Abschnitt 13](INSTALL.md#13-optional-the-helper-for-watchlist-and-discover)).
3. Am Fernseher: Einstellungen › Oberfläche › „Merkliste“. Läuft der Helfer nicht, steht dort „Helfer nicht erreichbar“; die App versucht es nach einer Minute erneut.

Merkliste gibt es für den Besitzer und Plex-Home-Profile ohne Plex-PIN. Der Helfer ist kein offener Proxy: nur feste plex.tv-Abfragen, nur für Geräte im Heimnetz.
**Keine Portweiterleitung für Port 32499 im Router einrichten.**

## Nachtrag: Weitere Server (optional)
Hat jemand seinen Plex-Server für dich freigegeben, z. B. ein Freund? Dann kann Neolume dessen Bibliotheken **zusätzlich zu deinem eigenen Server** zeigen – standardmäßig aus.
1. In der **Übersicht** auf **„Freigegebene Server suchen“** klicken. Das Programm schaut nach, welche Server für die gewählten Profile freigegeben sind
   (nur dein eigener Zugang – es fragt nie nach fremden Passwörtern oder Zugängen), und prüft jeden von deinem Computer aus.
2. Gewünschte Server ankreuzen, **„App-Paket erstellen“** und wie gewohnt aufspielen. Jedes Profil bekommt nur die Server, die für **dieses** Profil freigegeben sind.
3. Am Fernseher stehen die Bibliotheken in der Seitenleiste mit dem Zusatz „von <Server>“. Ausblenden oder verschieben unter Einstellungen › Oberfläche ›
   „Seitenleiste anpassen“. Suche und Startseite bleiben bei deinem eigenen Server.

Was die Anzeige neben einem Server bedeutet:
- **erreichbar** – passt, der Fernseher kann ihn nutzen.
- **nur sichere Verbindungen** – der Server verlangt Verschlüsselung, die der Fernseher (2014) nicht kann. Der Besitzer kann in Plex unter
  *Einstellungen › Netzwerk* „Sichere Verbindungen“ auf **„Bevorzugt“** stellen; danach erneut suchen.
- **gerade nicht erreichbar** – vielleicht aus oder nur über das Plex-Relay erreichbar (braucht Verschlüsselung, geht am Fernseher nicht).
  Du kannst ihn trotzdem eintragen; die App versucht es später erneut.

> ⚠️ Der Fernseher kann nicht verschlüsseln. Die Verbindung zu einem freigegebenen Server läuft deshalb **unverschlüsselt über das Internet**;
> der Zugang zu diesem Server könnte unterwegs mitgelesen werden. Dein eigener Server bleibt wie bisher nur im Heimnetz.

Wechselt die Internet-Adresse des Servers, findet der optionale Helfer die neue von selbst; ohne Helfer die Einrichtung erneut ausführen.
Ist ein freigegebener Server nicht erreichbar, zeigen nur seine Bibliotheken eine Meldung – alles andere läuft weiter.
