# Betriebsanleitung

Diese Anleitung beschreibt Aufbau, Einrichtung und Betrieb am Fest.

## 1. Hardware

| Teil | Empfehlung |
|---|---|
| **Server** | Mini-PC (z. B. Intel-N100-Klasse) oder Raspberry Pi 5 **mit SSD**. Die Datenbank schreibt ständig, und SD-Karten gehen dabei gerne kaputt. Per **LAN-Kabel** an den Router. |
| **Druck-Agent** | Ein Rechner direkt am USB-Drucker: **Raspberry Pi** (3/4/5, Zero 2 W), ein **Linux-PC** oder ein **Windows-10/11-PC**. Pro Standort mit Drucker ein Rechner; ein Rechner kann mehrere Drucker bedienen (z. B. Getränke und Bier nebeneinander). Ein Windows-PC in der Küche kann gleichzeitig im Browser das Küchen-Tablet ersetzen. |
| **Bondrucker** | ESC/POS-Drucker mit USB (Epson TM-T20/TM-T88, Bixolon, Star, viele günstige 58/80-mm-Drucker). Linux: muss als `/dev/usb/lp0` erscheinen (siehe 4.4). Windows: muss in Windows installiert sein (siehe 4.3). |
| **Tablets** | Beliebiges Android-Tablet mit Chrome. Bildschirm-Timeout hochsetzen und die Seite über „Zum Startbildschirm hinzufügen“ ablegen. |
| **Handys** | Jedes Smartphone mit aktuellem Browser. |
| **Strom** | Kleine USV oder Powerbank für Server, Router und Raspberry Pis. |

**Netzwerk:** Ein vorhandenes WLAN-Intranet reicht. Wichtig ist, dass Server und
Druck-Agenten wenn möglich per Kabel angebunden sind und der Server eine **feste
IP-Adresse** hat (DHCP-Reservierung im Router). Ein Internetzugang ist am Fest nicht
nötig.

## 2. Server installieren

Auf dem Server (Debian, Ubuntu oder Raspberry Pi OS):

```bash
curl -fsSL https://get.docker.com | sudo sh
git clone <Repository> bestellsystem && cd bestellsystem
cp .env.example .env && nano .env      # DB_PASSWORD setzen
sudo docker compose up -d
```

Die Oberfläche ist dann unter `http://<Server-IP>:8080` erreichbar. Die Container
starten nach einem Stromausfall automatisch neu.

## 3. Ersteinrichtung

1. `http://<Server-IP>:8080` öffnen → **Ersteinrichtung**: Verein und Betreiber-Konto
   anlegen. Zum Ausprobieren die Beispieldaten anhaken.
2. **Veranstaltungen:** Fest anlegen und aktivieren. Fürs nächste Jahr einfach kopieren.
3. **Gänge & Tische:** z. B. „Gang A“ mit Tischen 1–20 („Tische hinzufügen“).
4. **Drucker:** zuerst einen **Simulator** anlegen, um alles ohne Hardware zu testen.
   Die „gedruckten“ Bons erscheinen unter **Druckaufträge**.
5. **Stationen:** z. B. Küche, Getränke, Bier. Pro Station festlegen:
   - *Warteschlange am Tablet* ja/nein
   - *Bon drucken*: sofort, beim Annehmen, beim Fertigmelden oder nie
   - *Drucker*
6. **Produkte:** Kategorien und Produkte anlegen und jedem Produkt eine Station
   zuordnen. Bei Bedarf **Optionen** (Beilage, Soße, Größe …) und **Pfand**.
7. **Benutzer:** Bedienungen mit PIN anlegen. Der Name steht später auf dem Bon.
8. **Einstellungen:** Preise anzeigen, Rechnungshilfe, Pfand, To-Go, Abholbon-Drucker,
   Euro-Werte in der Statistik.

### Typische Einstellungen

| Wunsch | Station einstellen |
|---|---|
| Küche mit Tablet, Bon kommt beim „Fertig“ | Tablet: ja · Bon: beim Fertigmelden · Drucker: Küche |
| Getränke direkt auf den Drucker | Tablet: nein · Drucker: Schank |
| Getränke mit Warteschlange am Tablet (anderer Verein) | Tablet: ja · Bon: beim Annehmen · Drucker: Schank |
| Bier nur Bier | eigene Station „Bier“ mit eigenem Drucker, nur Bierprodukte zuordnen |
| Ein Zettel pro Teller | bei der Station „Ein Bon pro Stück“ |

## 4. Drucker anschließen (Druck-Agenten)

### 4.0 Prinzip: ein Agent pro Rechner mit Drucker

```
                     ┌─────────── Server (Bestellsystem) ───────────┐
                     │                                              │
     Raspberry Pi „Schank“      Windows-PC „Küche“        Raspberry Pi „Bierstand“
       └─USB─ Getränke-Drucker    └─USB─ Küchen-Drucker     └─USB─ Bier-Drucker
```

- Jeder Rechner, an dem direkt ein Drucker hängt, bekommt einen **eigenen Druck-Agenten**
  mit eigenem Token (Admin → Drucker → **Neuer Druck-Agent**, z. B. „Raspi Schank“,
  „Windows-PC Küche“).
- Die Rechner können an **verschiedenen Standorten** stehen. Sie müssen nur im selben
  Netz sein und den Server erreichen. Der Agent baut die Verbindung selbst auf, es
  sind keine Portfreigaben nötig.
- Im Admin wird jeder Drucker einem Agenten zugeordnet; die Station (Küche, Getränke
  …) wählt den Drucker. Fällt ein Rechner aus, warten seine Aufträge auf dem Server
  oder werden per **Umleiten** auf einen anderen Drucker geschickt.
- Linux/Raspberry Pi und Windows lassen sich beliebig mischen.

### 4.1 Raspberry Pi vorbereiten

Raspberry Pi OS **Lite** installieren (mit dem Raspberry Pi Imager: WLAN, SSH und
Benutzer gleich mit einrichten) und den Bondrucker per USB anstecken.

### 4.2 Agent auf dem Raspberry Pi / Linux installieren

Im Admin-Bereich unter **Drucker → Neuer Druck-Agent** einen Namen vergeben, z. B.
„Raspi Küche“. Es erscheint ein Befehl wie

```bash
curl -fsSL http://192.168.1.10:8080/downloads/install-agent.sh | sudo bash -s -- http://192.168.1.10:8080 <TOKEN>
```

Diesen Befehl auf dem Raspberry Pi ausführen. Das Skript installiert Node.js, legt den
Agenten als Dienst an (Start beim Booten) und zeigt die gefundenen Drucker an.
Danach erscheint der Agent im Admin-Bereich als **verbunden**.

Anschließend unter **Drucker → Neuer Drucker** den Typ „USB“ wählen, dann den Agenten
und den angezeigten USB-Drucker auswählen. Mit **Testdruck** prüfen:

- **Umlaute falsch** (z. B. „KYCHE“ statt „KÜCHE“, „GETRONKE“ statt „GETRÄNKE“)?
  Beim Drucker auf **Zeichensatz-Test** klicken. Der Bon zeigt dieselbe Zeile in jedem
  Zeichensatz; den Namen der richtigen Zeile unter **Bearbeiten → Zeichensatz**
  einstellen. Hintergrund: Günstige Bondrucker nummerieren ihre Zeichensätze
  unterschiedlich. PC437 (Standard) klappt fast überall, PC858 bei vielen Nachbauten
  nicht.
- **Zeile zu lang oder zu kurz?** Papierbreite anpassen (58 mm = 32, 80 mm = 48 Zeichen;
  manche 80-mm-Drucker drucken nur 512 Punkte breit = 42 Zeichen). Im Testdruck muss die
  Ziffernzeile genau eine Zeile füllen.

**Erfahrungswerte einzelner Modelle**

| Drucker | Papierbreite | Zeichensatz | Hinweise |
|---|---|---|---|
| MUNBYN ITPP047 (Treiber „POS Printer Driver V8.11“) | 80 mm, laut Druckerdatenbank 512 Punkte → **42 Zeichen** (per Testdruck prüfen, sonst 48) | **PC437** (PC858 lieferte im Praxistest griechische Zeichen: „KYCHE“) | Schneidwerk vorhanden; hat auch einen **LAN-Anschluss** → per Kabel als „Netzwerk (TCP 9100)“ ohne Agent-PC nutzbar |
| Epson TM-T20/TM-T88 | 48 Zeichen | PC858 (mit €) oder PC437 | – |
- **Kein Schnitt?** Manche Drucker haben kein Schneidwerk. Dann „Papier abschneiden“ ausschalten.

### 4.3 Windows-PC als Druck-Agent

**Voraussetzungen:** Windows 10 oder 11, der Bondrucker ist per USB angeschlossen und
**in Windows installiert** (Einstellungen → Bluetooth und Geräte → Drucker und Scanner),
mit dem Treiber des Herstellers oder – falls es keinen gibt – mit dem Windows-Treiber
**„Generic / Text Only“** am passenden USB-Anschluss (USB001 …). Den Druckernamen
möglichst kurz und eindeutig wählen, z. B. „Bon-Kueche“. Ein Windows-Testdruck muss
nicht schön aussehen; der Agent schickt die Bon-Daten im **RAW-Modus** am Treiber
vorbei.

**Installation:** Im Admin-Bereich den Agenten anlegen. Den angezeigten
Windows-Befehl in einer **PowerShell „Als Administrator ausführen“** einfügen. Das
Skript

1. installiert bei Bedarf Node.js (über `winget`, sonst Hinweis auf nodejs.org),
2. legt den Agenten nach `C:\ProgramData\Bestellsystem-Agent` (Konfiguration mit Token
   nur für Administratoren lesbar),
3. richtet eine geplante Aufgabe **„Bestellsystem Druck-Agent“** ein, die beim
   Hochfahren unter dem SYSTEM-Konto startet – auch ohne Anmeldung, und nach einem
   Absturz automatisch neu,
4. zeigt die gefundenen Drucker an.

Danach erscheint der Agent im Admin als **verbunden** (Badge „Windows“). Beim Drucker
„Am Rechner angeschlossen“ wählen, dann Agent und Drucker auswählen, **Testdruck**.

**Fehlersuche unter Windows** (PowerShell):

- **Fehlermeldungen mit `<!doctype html>` oder „Die Benennung "<" wurde nicht …
  erkannt“:** Der Server hat statt des Skripts die Webseite geschickt, weil ihm die
  Dateien des Druck-Agenten fehlen. Auf dem **Server** den aktuellen Stand bauen und
  neu starten: mit Docker `git pull` und `docker compose up -d --build`, ohne Docker
  `git pull`, `npm install`, `npm run build` und den Server neu starten. Prüfen: Im
  Browser `http://<Server>:8080/downloads/install-agent.ps1` öffnen – es muss Text
  erscheinen, der mit „# Installiert den Druck-Agenten“ beginnt.

```powershell
Get-Content C:\ProgramData\Bestellsystem-Agent\agent.log -Tail 30 -Wait   # Protokoll
node C:\ProgramData\Bestellsystem-Agent\agent.mjs --list                  # welche Drucker sieht der Agent?
node C:\ProgramData\Bestellsystem-Agent\agent.mjs --test "Bon-Kueche" --width 48
Get-ScheduledTask "Bestellsystem Druck-Agent" | Get-ScheduledTaskInfo         # läuft der Dienst?
```

- **Drucker fehlt in der Liste:** Er ist nicht in Windows installiert, oder es ist ein
  virtueller Drucker (PDF, XPS, Fax – werden bewusst ausgeblendet). Netzwerk-Drucker,
  die nur für einen angemeldeten Benutzer verbunden sind (`\\Server\Drucker`), sieht
  der SYSTEM-Dienst nicht; Bondrucker direkt per USB anschließen.
- **„Windows meldet den Drucker als offline“:** Nur ein Hinweis. Viele USB-Bondrucker
  gelten bei Windows im Energiesparmodus als offline und wachen erst auf, wenn Daten
  kommen – der Agent druckt deshalb trotzdem. Kommt wirklich nichts: USB-Kabel, Strom,
  in den Druckereinstellungen „Drucker offline verwenden“ abschalten.
- **„Windows-Druckerwarteschlange hängt“:** Ein Auftrag steckt länger als 20 s in der
  Windows-Warteschlange. In Windows die Warteschlange des Druckers öffnen und den
  hängenden Auftrag löschen; danach druckt der Agent automatisch weiter.
- **Energiesparen:** Der Agent verhindert den automatischen Standby, solange er läuft.
  Zuklappen des Laptops oder manuelles „Energie sparen“ verhindert er nicht.
- **Bons kommen verzögert?** Im Admin unter **Druckaufträge** steht bei jedem Bon, nach
  wie vielen Sekunden er gedruckt wurde. Im `agent.log` steht pro Bon die Dauer am
  Rechner („Auftrag 12 gedruckt auf … (85 ms)“). Ist die Zeit im Protokoll kurz, aber im
  Admin lang, liegt es am Netz/WLAN; ist sie im Protokoll lang, am PC oder Drucker.
  Außerdem hilft: in den Windows-Energieoptionen „Selektives USB-Energiesparen“
  deaktivieren und beim Drucker (falls einstellbar) den Ruhemodus abschalten.
- **Agent aktualisieren:** Den Installationsbefehl aus dem Admin einfach erneut
  ausführen (mit dem bisherigen Token). Der Agent wird gestoppt, ersetzt und neu
  gestartet.
- **Updates:** Windows-Updates mit Neustart vor dem Fest erledigen, nicht währenddessen.

Hinweis: Die automatischen Tests simulieren den Windows-Druckdienst; der erste
Praxistest auf einem Windows-PC hat bereits zwei Fehler aufgedeckt (falscher
Zeichensatz bei Nachbau-Druckern, Verzögerung durch „offline“). Bitte im Probelauf
mit jedem Drucker Testdruck und Zeichensatz-Test machen.

### 4.4 Fehlersuche unter Linux / Raspberry Pi

```bash
journalctl -u bestellsystem-agent -f                 # Protokoll des Agenten
node /opt/bestellsystem-agent/agent.mjs --list       # welche Drucker sieht der Agent?
ls -l /dev/usb/                                      # gibt es lp0, lp1 …?
sudo dmesg | grep -i -E "usblp|usb"                  # hat Linux den Drucker erkannt?
sudo node /opt/bestellsystem-agent/agent.mjs --test /dev/usb/lp0 --width 32
```

- **Kein `/dev/usb/lp0`:** Manche sehr günstigen Drucker melden sich nicht als
  „Drucker“, sondern als herstellerspezifisches USB-Gerät. Dann bindet Linux sie nicht
  an `usblp`. Diese Drucker werden derzeit **nicht** unterstützt. Bitte vorher mit
  `dmesg` prüfen. Mit einem anderen Drucker bzw. einer libusb-Erweiterung lässt sich das
  lösen.
- **„Gerät belegt“:** Läuft auf dem Pi CUPS, kann es den Drucker blockieren:
  `sudo systemctl disable --now cups cups-browsed`.
- **„Keine Schreibrechte“:** Der Dienst läuft als Benutzer `bestell-agent` in der
  Gruppe `lp`. Nach manuellen Änderungen `sudo systemctl restart bestellsystem-agent`.
- **Drucker umgesteckt:** Hat der Drucker eine Seriennummer, bleibt die Zuordnung
  erhalten. Ohne Seriennummer hängt sie am USB-Port, also beim Umstecken denselben
  Port nehmen oder den Drucker im Admin neu auswählen.

### 4.5 Alternativen

- **Agent mit Docker auf dem Pi:** `agent.mjs` von `http://<Server>:8080/downloads/agent.mjs`
  herunterladen und daneben eine `docker-compose.yml` anlegen:

  ```yaml
  services:
    agent:
      image: node:22-alpine
      restart: unless-stopped
      privileged: true          # Zugriff auf /dev/usb/lp*, auch nach Umstecken
      volumes: ["/dev:/dev", "./agent.mjs:/agent.mjs:ro"]
      environment:
        SERVER_URL: http://192.168.1.10:8080
        AGENT_TOKEN: <TOKEN>
      command: ["node", "/agent.mjs"]
  ```

- **Drucker direkt am Server:** `AGENT_TOKEN=<TOKEN> docker compose --profile usb up -d`
  startet einen Agenten im Server-Rechner.
- **Netzwerkdrucker:** Typ „Netzwerk (TCP 9100)“, dafür ist kein Agent nötig.

## 5. Während des Festes

- **Admin → Übersicht** zeigt Warnungen (Drucker offline, Agent getrennt, Station
  ohne Drucker), wartende Druckaufträge und offene Tickets pro Station.
- **Papier leer / Drucker aus:** Die Aufträge warten und werden automatisch in der
  richtigen Reihenfolge nachgedruckt, sobald der Drucker wieder da ist. Es geht nichts
  verloren.
- **Drucker defekt:** Unter **Drucker → Umleiten** wartende und künftige Bons auf einen
  anderen Drucker schicken.
- **WLAN-Aussetzer:** Die Bedienung sieht oben „1 wartet“. Die Bestellung wird
  automatisch nachgesendet. **Nicht noch einmal eingeben**, das System erkennt die
  Wiederholung und druckt nicht doppelt.
- **Ausverkauft:** Küche (Tablet → „Ausverkauft“) oder Admin schaltet das Produkt aus.
  Es ist sofort auf allen Handys gesperrt.
- **Storno:** Die Bedienung kann eigene Bestellungen innerhalb des eingestellten
  Zeitfensters stornieren, Admins jederzeit. Die Station bekommt einen Storno-Bon.
  Jeder Storno steht im **Protokoll**.
- **Nachdruck:** am Tablet unter „Erledigt“ oder im Admin unter „Druckaufträge“.

## 6. Nach dem Fest

- **Statistik → Excel** herunterladen und zusammen mit den Kassenberichten archivieren.
  Bestelldaten nicht löschen, sie können bei einer Prüfung relevant sein.
- Die Veranstaltung bleibt in der Datenbank. Fürs nächste Fest **kopieren** statt neu
  anlegen.

## 7. Sicherung und Wiederherstellung

Der Container `backup` legt alle 10 Minuten eine Sicherung in `./backups` ab und
löscht Sicherungen, die älter als drei Tage sind. Für das Archiv eine Kopie auf einen
USB-Stick ziehen.

Wiederherstellen:

```bash
docker compose stop app
docker compose exec -T db pg_restore -U bestell -d bestell --clean --if-exists < backups/bestell-YYYYMMDD-HHMM.dump
docker compose start app
```

## 8. Aktualisieren

```bash
git pull
docker compose up -d --build
```

Datenbank-Migrationen laufen beim Start automatisch.

## 9. Checkliste Probelauf (vor jedem Fest)

- [ ] Server, Router und Raspberry Pis starten ohne Eingriff (Strom aus und wieder an)
- [ ] Alle Agenten „verbunden“, alle Drucker „bereit“, **Testdruck** auf jedem Drucker
- [ ] Umlaute, €-Zeichen und Schnitt auf dem echten Papier korrekt
- [ ] Jede Bedienung kann sich mit ihrer PIN anmelden
- [ ] Je eine Testbestellung pro Station; landet sie am richtigen Drucker bzw. Tablet?
- [ ] Küche: „Fertig“ druckt den Bon, „Rückgängig“ funktioniert
- [ ] WLAN-Test: an der entferntesten Stelle im Zelt bestellen
- [ ] Drucker während einer Bestellung ausschalten und wieder ein, damit der Bon nachkommt
- [ ] Testbestellungen danach stornieren oder Veranstaltung frisch kopieren

## 10. Bekannte Grenzen

- **Kein HTTPS im Standardaufbau:** Im lokalen Netz läuft alles über HTTP. Das
  funktioniert, aber Browser erlauben dann kein „echtes“ Installieren als App und keinen
  Bildschirm-Wachhalter. Lösung bei Bedarf: eigene Domain mit Zertifikat, die auf die
  lokale IP zeigt, und ein Reverse-Proxy (z. B. Caddy) davor.
- **PINs** sind Komfort, keine Hochsicherheit. Das Netz sollte nicht öffentlich sein.
- **Druckerstatus:** Erkannt werden „nicht verbunden“, „nicht gefunden“, Schreibfehler
  und „hängt“. Ein genaues „Papier leer“ meldet nicht jeder USB-Drucker.
- **Kein Kassensystem:** Es werden keine Zahlungen erfasst (siehe README, Hinweis zu
  Kasse und TSE).
