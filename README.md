# Bestellsystem für Vereinsfeste

Bestellungen per Handy aufnehmen (Gang → Tisch → Produkte) und automatisch an die
richtige Station verteilen: als Bon auf dem passenden Drucker und/oder als
Warteschlange auf einem Tablet. Läuft komplett lokal, ohne Internet.

- **Bedienung (Handy):** PIN-Anmeldung, Gang und Tisch wählen, Produkte mit Optionen
  (Beilage, Soße …) und Notizen, Senden mit einem Tipp. Bei WLAN-Aussetzern wird die
  Bestellung zwischengespeichert und automatisch nachgesendet, ohne Doppeldruck.
- **Stationen:** pro Station einstellbar, ob es eine Warteschlange am Tablet gibt und
  wann der Bon gedruckt wird (sofort / beim Annehmen / beim Fertigmelden / nie).
  Jedes Produkt gehört zu einer Station.
- **Küchen-Tablet:** Live-Kacheln mit Wartezeit, Summen („7× Schnitzel“), „Fertig“
  druckt den Bon, Rückgängig, Nachdruck, Ausverkauft-Schalter.
- **To-Go:** Abholnummern, Abholbon für den Gast, Abholmonitor für einen Fernseher.
- **Rechnungshilfe:** Summe, getrennt zahlen, Pfand, Rückgeld. Reiner Rechner, der
  nichts speichert. Pro Verein ein- und ausschaltbar.
- **Admin:** Veranstaltungen (kopierbar), Gänge/Tische, Produkte, Optionen, Pfand,
  Stationen, Drucker, Druck-Agenten, Benutzer, Einstellungen, Protokoll.
- **Statistik:** Stückzahlen nach Produkt/Kategorie/Station/Bedienung, Verlauf,
  Durchlaufzeit der Küche; Export als Excel und CSV.
- **Mehrere Vereine (Mandanten):** vollständig getrennte Daten und Einstellungen auf
  einer Installation.
- **Drucker:** USB-Bondrucker an beliebig vielen Rechnern an verschiedenen Standorten
  im selben Netz. Auf jedem Rechner läuft ein **Druck-Agent**: Raspberry Pi, Linux-PC
  oder **Windows-PC**. Außerdem gibt es Netzwerk-Drucker (TCP 9100) und einen
  **Simulator**, der Bons im Browser zeigt.

## Schnellstart

Voraussetzung: ein Rechner mit Docker (Mini-PC, Raspberry Pi 4/5, Laptop) im selben
Netz wie Handys und Tablets.

```bash
git clone <dieses Repository> bestellsystem && cd bestellsystem
cp .env.example .env          # Passwort anpassen
docker compose up -d
```

Dann im Browser `http://<IP-des-Rechners>:8080` öffnen. Bei der Ersteinrichtung
kann man **Beispieldaten** anlegen lassen: ein Demo-Fest mit Simulator-Druckern und
den PINs `1111`/`2222` (Bedienung), `3333` (Küche) und `4444` (To-Go).

Für USB-Drucker legt man im Admin-Bereich unter **Drucker → Neuer Druck-Agent** pro
Rechner einen Agenten an. Dann den angezeigten Befehl auf dem Rechner am Drucker
ausführen: im Terminal (Raspberry Pi/Linux) oder in der PowerShell als Administrator
(Windows). Details stehen in [docs/BETRIEB.md](docs/BETRIEB.md).

## Aufbau

```
 Handys / Tablets / Admin  ──HTTP + WebSocket──▶  app (Server + Weboberfläche)  ──▶  db (PostgreSQL)
                                                      │
                                    WebSocket (jeder Agent verbindet sich selbst)
                       ┌──────────────────────────────┼──────────────────────────────┐
                       ▼                              ▼                              ▼
          Raspberry Pi „Schank“           Windows-PC „Küche“             Raspberry Pi „Bier“
             └─USB─ Bondrucker               └─USB─ Bondrucker              └─USB─ Bondrucker
```

| Container     | Aufgabe                                                                   |
| ------------- | ------------------------------------------------------------------------- |
| `db`          | PostgreSQL: Stammdaten, Bestellungen, Druck-Warteschlange                 |
| `app`         | API, Live-Updates, Druck-Warteschlange, Weboberfläche, Agent-Download     |
| `backup`      | Datenbanksicherung alle 10 Minuten nach `./backups`                       |
| `print-agent` | optional (`--profile usb`): Agent für USB-Drucker direkt am Server-Rechner |

Druckaufträge liegen in der Datenbank und gehen nicht verloren, wenn ein Drucker
oder Agent kurz weg ist. Sie werden in der richtigen Reihenfolge nachgedruckt.

## Entwicklung

```bash
npm install
# PostgreSQL lokal (oder: docker compose up -d db)
npm run dev:server     # API auf :8080 (DATABASE_URL, Standard postgres://bestell:bestell@localhost/bestell)
npm run dev:web        # Oberfläche auf :5173 mit Proxy auf die API
npm test               # Tests (brauchen PostgreSQL, TEST_DATABASE_URL)
npm run typecheck
npm run build
```

| Ordner            | Inhalt                                                   |
| ----------------- | -------------------------------------------------------- |
| `packages/shared` | Typen, Bon-Layout, ESC/POS-Encoder, Codetabellen         |
| `apps/server`     | Fastify-Server, Drizzle-Schema und Migrationen           |
| `apps/web`        | React-Oberfläche (Bedienung, Station, To-Go, Admin)      |
| `apps/agent`      | Druck-Agent für USB-Drucker unter Linux und Windows (eine Datei, Node.js ≥ 18) |

Schemaänderungen: `apps/server/src/db/schema.ts` anpassen, dann `npm run db:generate`.
Die Migration wird beim Start automatisch ausgeführt.

## Hinweis zu Kasse und TSE

Das System ist als **Bestellsystem ohne Zahlungsfunktion** gebaut: Es erfasst und
speichert keine Zahlungen. Die Rechnungshilfe ist ein Rechner, der nichts speichert.
Ob ein konkreter Einsatz (z. B. To-Go mit Barzahlung am selben Gerät) steuerlich als
Kassenfunktion gilt, entscheidet die Funktion und nicht der Name. Das bitte mit
Steuerberater oder Finanzamt klären. Die ausführliche Einordnung mit Rechtsgrundlagen,
Bedingungen und Grauzonen steht in [docs/TSE-ABGRENZUNG.md](docs/TSE-ABGRENZUNG.md)
und im Admin-Bereich unter **TSE-Abgrenzung** (mit Prüfung der aktuellen Einstellungen
und Druckfunktion).
