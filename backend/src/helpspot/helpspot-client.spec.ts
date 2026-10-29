import { describe, expect, it } from 'vitest';
import { HelpSpotClient } from './helpspot-client';

/** fetch, das die vorgegebenen Antworten der Reihe nach liefert und die Aufrufe festhält */
function fakeFetch(responses: { status: number; body: unknown }[]) {
  const calls: { url: string; auth: string | null }[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, auth: new Headers(init?.headers).get('authorization') });
    const next = responses.shift() ?? { status: 500, body: {} };
    return new Response(typeof next.body === 'string' ? next.body : JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('Client der HelpSpot-API', () => {
  it('ruft die Methode mit Bearer-Token und JSON auf', async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: { status: [{ xStatus: 3, sStatus: 'Problem Solved' }] } }]);
    const client = new HelpSpotClient('https://hs.example/', 'geheim', { fetch: fn, sleep: async () => undefined });
    expect(await client.statusTypes()).toEqual([{ id: 3, name: 'Problem Solved' }]);
    expect(calls[0]!.url).toBe('https://hs.example/api/index.php?method=private.request.getStatusTypes&output=json&fActiveOnly=0');
    expect(calls[0]!.auth).toBe('Bearer geheim');
  });

  it('wartet bei HTTP 429 immer länger und versucht es erneut', async () => {
    const { fn, calls } = fakeFetch([
      { status: 429, body: 'Too Many' },
      { status: 429, body: 'Too Many' },
      { status: 200, body: { xRequest: [12401, 12400, 12401] } },
    ]);
    const waits: number[] = [];
    const client = new HelpSpotClient('https://hs.example', 'k', { fetch: fn, sleep: async (ms) => void waits.push(ms), minIntervalMs: 0, retryDelayMs: 10 });
    expect(await client.changedSince(1)).toEqual([12400, 12401]);
    expect(calls).toHaveLength(3);
    expect(waits.filter((w) => w >= 10)).toEqual([10, 20]);
  });

  it('gibt nach mehreren 429 auf und erklärt Fehler', async () => {
    const client429 = new HelpSpotClient('https://hs.example', 'k', {
      fetch: fakeFetch([{ status: 429, body: '' }, { status: 429, body: '' }]).fn,
      sleep: async () => undefined,
      maxRetries: 1,
    });
    await expect(client429.request(1)).rejects.toThrow('HTTP 429');
    const client401 = new HelpSpotClient('https://hs.example', 'k', { fetch: fakeFetch([{ status: 401, body: { reply: 'Invalid key' } }]).fn, sleep: async () => undefined });
    await expect(client401.request(1)).rejects.toThrow('HelpSpot lehnt den API-Schlüssel ab (HTTP 401): Invalid key');
  });

  it('hält den Mindestabstand zwischen Anfragen', async () => {
    const { fn } = fakeFetch([
      { status: 200, body: {} },
      { status: 200, body: {} },
    ]);
    const waits: number[] = [];
    const client = new HelpSpotClient('https://hs.example', 'k', { fetch: fn, sleep: async (ms) => void waits.push(ms), minIntervalMs: 1000 });
    await client.call('a');
    await client.call('b');
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeGreaterThan(900);
  });

  it('liest Anhänge (Base64) und blättert in der Suche', async () => {
    const page = Array.from({ length: 1000 }, (_, i) => ({ xRequest: i + 1 }));
    const { fn, calls } = fakeFetch([
      { status: 200, body: { sBody: Buffer.from('Inhalt').toString('base64') } },
      { status: 200, body: { request: page } },
      { status: 200, body: { request: [{ xRequest: 1001 }] } },
    ]);
    const client = new HelpSpotClient('https://hs.example', 'k', { fetch: fn, sleep: async () => undefined, minIntervalMs: 0 });
    expect((await client.document('9001')).toString()).toBe('Inhalt');
    expect(await client.search({ fOpen: 1 })).toHaveLength(1001);
    expect(calls[2]!.url).toContain('start=1000');
  });
});
