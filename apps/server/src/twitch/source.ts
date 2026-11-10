import tmi from 'tmi.js';
import type { TwitchVoteSource } from '../game/types';

/** Разбирает команду голосования: «!1», «!2 лучший» → номер варианта. */
export function parseVoteCommand(message: string): number | null {
  const match = /^!(\d{1,2})(?:\s|$)/.exec(message.trim());
  if (!match) return null;
  const n = Number(match[1]);
  return n >= 1 ? n : null;
}

/** Анонимное чтение чата Twitch: ни ключей, ни входа в аккаунт не требуется. */
export class TmiVoteSource implements TwitchVoteSource {
  private client: tmi.Client | null = null;

  async connect(channel: string, onVote: (user: string, choice: number) => void): Promise<void> {
    const client = new tmi.Client({
      channels: [channel],
      connection: { secure: true, reconnect: true, timeout: 8_000 },
      options: { debug: false, skipUpdatingEmotesets: true, skipMembership: true },
      logger: { info() {}, warn() {}, error() {} },
    });
    this.client = client;
    client.on('message', (_channel, tags, message, self) => {
      if (self) return;
      const choice = parseVoteCommand(message);
      // user-id стабилен при смене ника; username — запасной вариант.
      const user = tags['user-id'] ?? tags.username;
      if (choice !== null && user) onVote(user, choice);
    });

    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Twitch connection timed out')), 10_000);
    });
    try {
      await Promise.race([client.connect(), timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }

  async disconnect(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (!client) return;
    client.removeAllListeners();
    await client.disconnect().catch(() => {});
  }
}
