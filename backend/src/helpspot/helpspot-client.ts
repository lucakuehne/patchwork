/**
 * Zugriff auf die Web Services API von HelpSpot (Private API, JSON, API-Schlüssel als Bearer-Token). HelpSpot bremst zu
 * viele Anfragen mit HTTP 429: Der Client hält einen Mindestabstand zwischen den Anfragen und wartet bei 429 immer
 * länger, bevor er es erneut versucht.
 */
export class HelpSpotError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface HelpSpotClientOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Mindestabstand zwischen zwei Anfragen */
  minIntervalMs?: number;
  /** Wartezeit nach dem ersten 429, danach jeweils länger */
  retryDelayMs?: number;
  maxRetries?: number;
  timeoutMs?: number;
}

type Json = Record<string, unknown>;

export class HelpSpotClient {
  private last = 0;
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly minIntervalMs: number;
  private readonly retryDelayMs: number;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    options: HelpSpotClientOptions = {},
  ) {
    this.fetch = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.minIntervalMs = options.minIntervalMs ?? 1000;
    this.retryDelayMs = options.retryDelayMs ?? 15_000;
    this.maxRetries = options.maxRetries ?? 5;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  /** Eine Methode der API aufrufen, z.B. «private.request.get» */
  async call(method: string, params: Record<string, string | number> = {}): Promise<Json> {
    const query = new URLSearchParams({ method, output: 'json', ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
    const url = `${this.baseUrl.replace(/\/+$/, '')}/api/index.php?${query}`;
    for (let attempt = 0; ; attempt++) {
      const wait = this.last + this.minIntervalMs - Date.now();
      if (wait > 0) await this.sleep(wait);
      this.last = Date.now();
      let res: Response;
      try {
        res = await this.fetch(url, { headers: { Authorization: `Bearer ${this.apiKey}` }, signal: AbortSignal.timeout(this.timeoutMs) });
      } catch (err) {
        throw new HelpSpotError(`HelpSpot nicht erreichbar: ${(err as Error).message}`);
      }
      if (res.status === 429 && attempt < this.maxRetries) {
        await this.sleep(this.retryDelayMs * (attempt + 1));
        continue;
      }
      const body = await res.text();
      if (!res.ok) throw new HelpSpotError(describeError(res.status, body), res.status);
      try {
        return JSON.parse(body) as Json;
      } catch {
        throw new HelpSpotError(`Unerwartete Antwort von HelpSpot (kein JSON) bei ${method}`, res.status);
      }
    }
  }

  /** Alle Status, auch nicht mehr aktive */
  async statusTypes(): Promise<{ id: number; name: string }[]> {
    const data = await this.call('private.request.getStatusTypes', { fActiveOnly: 0 });
    return listOf(data.status).map((s) => ({ id: Number(s.xStatus), name: String(s.sStatus ?? '') }));
  }

  /** Mitarbeitende, auch ehemalige: Name und E-Mail-Adresse */
  async staff(): Promise<{ name: string; email: string }[]> {
    const data = await this.call('private.util.getAllStaff');
    return listOf(data.person).map((p) => ({
      name: String(p.fullname ?? `${p.sFname ?? ''} ${p.sLname ?? ''}`).trim(),
      email: String(p.sEmail ?? '').trim().toLowerCase(),
    }));
  }

  /** Nummern der Tickets, die sich seit dem Zeitpunkt (Unix-Sekunden) geändert haben, ohne Doppelte, aufsteigend */
  async changedSince(unixSeconds: number): Promise<number[]> {
    const data = await this.call('private.request.getChanged', { dtGMTChange: Math.max(1, Math.floor(unixSeconds)) });
    const raw = data.xRequest ?? listOf(data.request).map((r) => r.xRequest);
    const ids = (Array.isArray(raw) ? raw : [raw]).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    return [...new Set(ids)].sort((a, b) => a - b);
  }

  /** Suche, seitenweise (höchstens 1000 pro Seite): Zusammenfassungen der Tickets */
  async search(params: Record<string, string | number>): Promise<Json[]> {
    const rows: Json[] = [];
    for (let start = 0; ; start += 1000) {
      const page = listOf((await this.call('private.request.search', { ...params, start, length: 1000 })).request);
      rows.push(...page);
      if (page.length < 1000) return rows;
    }
  }

  /** Ticket mit ganzem Verlauf */
  request(number: number): Promise<Json> {
    return this.call('private.request.get', { xRequest: number });
  }

  /** Inhalt eines Anhangs; leer, wenn der Anhang in HelpSpot leer ist */
  async document(documentId: string): Promise<Buffer> {
    const data = await this.call('private.document.get', { xDocumentId: documentId });
    return Buffer.from(String(data.sBody ?? ''), 'base64');
  }
}

/** Liste aus dem JSON von HelpSpot: Array oder Objekt mit IDs als Schlüssel */
function listOf(value: unknown): Json[] {
  if (Array.isArray(value)) return value.filter((v): v is Json => !!v && typeof v === 'object');
  if (value && typeof value === 'object') return Object.values(value).filter((v): v is Json => !!v && typeof v === 'object');
  return [];
}

function describeError(status: number, body: string): string {
  let reply = '';
  try {
    reply = String((JSON.parse(body) as Json).reply ?? (JSON.parse(body) as Json).error ?? '');
  } catch {
    reply = '';
  }
  if (status === 401 || status === 403) return `HelpSpot lehnt den API-Schlüssel ab (HTTP ${status})${reply ? `: ${reply}` : ''}`;
  if (status === 429) return 'HelpSpot bremst zu viele Anfragen (HTTP 429), auch nach mehreren Versuchen';
  return `HelpSpot meldet HTTP ${status}${reply ? `: ${reply}` : ''}`;
}
