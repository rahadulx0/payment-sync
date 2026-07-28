import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ReceivedRequest {
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface ReceiverBehaviour {
  status?: number;
  /** Delay before responding, ms (to exercise timeouts). */
  delayMs?: number;
  /** A Location header to force a redirect response. */
  redirectTo?: string;
  headers?: Record<string, string>;
}

/**
 * A configurable local HTTP receiver for webhook delivery tests: it records
 * every request and responds per the current behaviour (2xx/4xx/5xx/slow/
 * redirect). Delivery must run with WEBHOOK_INSECURE_ALLOWED=true to reach it.
 */
export class WebhookReceiver {
  private server: Server | null = null;
  readonly received: ReceivedRequest[] = [];
  behaviour: ReceiverBehaviour = { status: 200 };

  async start(): Promise<string> {
    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        this.received.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
        const b = this.behaviour;
        const respond = () => {
          if (b.redirectTo !== undefined) {
            res.writeHead(302, { Location: b.redirectTo });
            res.end();
            return;
          }
          res.writeHead(b.status ?? 200, b.headers ?? {});
          res.end(JSON.stringify({ ok: (b.status ?? 200) < 300 }));
        };
        if (b.delayMs !== undefined && b.delayMs > 0) setTimeout(respond, b.delayMs);
        else respond();
      });
    });
    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve));
    const port = (this.server.address() as AddressInfo).port;
    return `http://127.0.0.1:${String(port)}/hook`;
  }

  reset(): void {
    this.received.length = 0;
    this.behaviour = { status: 200 };
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (this.server === null) {
        resolve();
        return;
      }
      this.server.close(() => {
        resolve();
      });
    });
  }
}
