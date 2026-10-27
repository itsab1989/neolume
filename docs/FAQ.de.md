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

### Welche Auflösung nutzt Neolume?
Die Oberfläche ist für **1280 × 720** gebaut (so groß ist eine App auf der Orsay-Plattform); der Fernseher skaliert sie auf sein
Panel – 720p, 1080p und 4K (HU) sehen gleich aus. **Videos** zeigt der Fernseher in voller Auflösung: bis **1080p** direkt (H.264, 8 Bit),
alles darüber (z. B. 4K) wandelt dein Server in 1080p um.

### Brauche ich einen Plex Pass?
Nein. Einige Funktionen nutzen Daten, die der Server nur mit Plex Pass erzeugt (z. B. Intro-/Abspann-Marken, Vorschaubilder beim Spulen). Ohne sie fehlen nur diese Funktionen.

### Brauche ich den Computer dauerhaft?
Nein. Nur für die Einrichtung und für Updates. Danach kann der Computer aus sein.

### Braucht Neolume Internet?
Im Alltag nicht – nur dein Plex Media Server im Heimnetz. Die einmalige Einrichtung braucht Internet (plex.tv). Ausnahme: die Merkliste und die Trend-Reihen in „Entdecken“ brauchen plex.tv und dafür den optionalen Helfer im Heimnetz (siehe INSTALL, Nachtrag).

### Funktioniert Neolume außerhalb des Heimnetzes (Fernzugriff)?
Nein, bewusst nicht. Neolume nutzt nur Server-Adressen im Heimnetz.

### Kann ich mehrere Server nutzen?
Derzeit wird bei der Einrichtung ein Server gewählt. Mehrere Server sind nicht geplant.

### Kann ich Profile wechseln?
Ja, alle bei der Einrichtung gewählten Plex-Home-Profile. Jedes Profil sieht nur seine eigenen Bibliotheken und hat seinen eigenen Gesehen-Status.

### Warum wird meine Plex-PIN nicht abgefragt?
Ohne plex.tv kann der Fernseher die Plex-PIN nicht prüfen. Stattdessen kann jedes Profil in Neolume eine eigene **App-PIN** bekommen. Gespeichert wird nur ein gesalzener Hash.

### Kann ich die Farben ändern?
Ja. Unter **Einstellungen → Oberfläche → Akzentfarbe** stehen sieben Farben für Fokus, Knöpfe und Fortschrittsbalken zur Wahl: Türkis (Standard), Bernstein, Koralle, Rosé, Lavendel, Himmelblau und Mintgrün. Die Wahl gilt je Profil und wirkt sofort. Alle Farben sind auf guten Kontrast geprüft (mindestens 4,5:1 für Schrift auf der Farbe und für die Farbe auf dem dunklen Hintergrund).

### Was passiert mit meinen anderen selbst installierten Apps?
Der Fernseher entfernt beim Sync **alle selbst installierten Apps, die nicht in der Liste stehen**. Trage sie im Einrichtungsprogramm unter *Erweitert* ein. Apps aus dem Samsung-Store sind nicht betroffen.

### Wird die alte Plex-App überschrieben?
Nein. Neolume ist eine eigene App mit eigenem Namen. Die vorinstallierte Plex-App bleibt, wie sie ist.

### Welche Daten sendet Neolume?
Nur Anfragen an deinen Plex Media Server (Bibliotheken, Bilder, Wiedergabe, Fortschritt). Keine Telemetrie, keine Werbung, keine Analyse. Ein Diagnose-Protokoll geht nur auf deinen Wunsch an einen Computer im Heimnetz.

### Wo liegen meine Zugangsdaten?
Auf dem Fernseher, im Speicher der App: je Profil ein Server-Token, das nur für deinen Server gilt. Dein Plex-Passwort wird nirgends gespeichert. Das Einrichtungsprogramm hält Tokens nur im Arbeitsspeicher und schreibt sie nicht auf die Festplatte.

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
