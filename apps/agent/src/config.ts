import fs from 'node:fs';

export interface AgentConfig {
  serverUrl?: string;
  token?: string;
  /** Zusätzliche Geräte/Dateien, kommagetrennt (z. B. "file:/tmp/bons.bin"). */
  extraDevices?: string;
  /** Protokoll zusätzlich in diese Datei schreiben. */
  logFile?: string;
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

/**
 * Einstellungen aus Konfigurationsdatei (--config / AGENT_CONFIG), überschrieben
 * von Umgebungsvariablen und Kommandozeile. Unter Windows startet der Dienst mit
 * einer Datei, unter Linux mit Umgebungsvariablen.
 */
export function loadConfig(argv: string[] = process.argv, env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const file = arg(argv, '--config') ?? env.AGENT_CONFIG;
  let fromFile: AgentConfig = {};
  if (file) {
    // Windows-Editoren und PowerShell 5 schreiben gerne ein BOM vor UTF-8.
    const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    fromFile = JSON.parse(text) as AgentConfig;
  }
  return {
    serverUrl: env.SERVER_URL || fromFile.serverUrl,
    token: env.AGENT_TOKEN || fromFile.token,
    extraDevices: env.EXTRA_DEVICES || fromFile.extraDevices,
    logFile: arg(argv, '--log') ?? (env.LOG_FILE || fromFile.logFile),
  };
}

const MAX_LOG_BYTES = 5 * 1024 * 1024;

export function createLogger(logFile?: string) {
  return (message: string) => {
    const line = `${new Date().toISOString()} ${message}`;
    console.log(line);
    if (!logFile) return;
    try {
      // Einfache Rotation: ab 5 MB wird die Datei zu .1 und neu begonnen.
      if (fs.existsSync(logFile) && fs.statSync(logFile).size > MAX_LOG_BYTES) {
        fs.renameSync(logFile, `${logFile}.1`);
      }
      fs.appendFileSync(logFile, line + '\n');
    } catch {
      // Protokolldatei ist nicht wichtig genug, um den Druck zu stören.
    }
  };
}
