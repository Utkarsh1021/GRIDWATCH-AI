import type { Response } from 'express';

interface Client {
  id: number;
  res: Response;
}

export class EventHub {
  private clients = new Map<number, Client>();
  private nextId = 0;

  add(res: Response): number {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    const id = ++this.nextId;
    this.clients.set(id, { id, res });
    res.on('close', () => this.clients.delete(id));
    return id;
  }

  send(type: string, data: unknown) {
    const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of this.clients.values()) {
      try {
        c.res.write(payload);
      } catch {
        this.clients.delete(c.id);
      }
    }
  }

  count() {
    return this.clients.size;
  }
}