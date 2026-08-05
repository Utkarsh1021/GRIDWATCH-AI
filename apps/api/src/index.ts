import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { createDb, seedDatabase, incidents as incidentsTable, tickets as ticketsTable } from '@gridwatch/db';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { Runtime } from './runtime.js';
import { Ingest } from './ingest.js';
import { Incidents } from './incidents.js';
import { Simulator } from './simulator.js';
import { FleetHeartbeater } from './fleet.js';
import { EventHub } from './sse.js';
import { createRouter } from './routes.js';
import { env } from './config.js';

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../packages/db/drizzle');

async function main() {
  const db = createDb(env.postgresUrl);

  // Start serving immediately. The heavy init below (migrations, seed, network
  // load) can take ~20s on a cold start; if we don't bind the port first, the
  // front-end proxy gets ECONNREFUSED and the deploy health check fails with
  // 502/504. We answer 503 until everything is wired up, then attach the router.
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '5mb' }));

  let ready = false;
  app.get('/health', (_req, res) => {
    res.status(ready ? 200 : 503).json({ ok: ready, ready });
  });

  const server = app.listen(env.port, () => {
    console.log(`[boot] API listening on :${env.port} (initializing)`);
  });

  let tick: () => Promise<void>;
  let shutdown: () => Promise<void> = async () => {};

  const boot = async () => {
    try {
      await migrate(db, { migrationsFolder });
      console.log('[db] migrations applied');

      if (env.seedOnStart) {
        await db.delete(incidentsTable);
        await db.delete(ticketsTable);
        const result = await seedDatabase(db, env.seedScale);
        console.log(
          `[seed] ${result.poles} poles / ${result.transformers} DTs / ${result.feeders} feeders / ` +
            `${result.recordedDts} recorded / ${result.missingDts} missing-topology DTs / ` +
            `${result.polesWithDevice} poles with device`,
        );
      }

      const runtime = new Runtime(db);
      await runtime.load();
      console.log(`[boot] network loaded: ${runtime.poles.length} poles, ${runtime.transformers.length} transformers, ${runtime.poleByDevice.size} devices`);

      const hub = new EventHub();
      const ingest = new Ingest(db, runtime);
      const incidents = new Incidents(db, runtime, hub);
      await incidents.loadOpen();
      const simulator = new Simulator(db, runtime, ingest, incidents);

      // Background fleet: the powered poles keep heartbeating so the network
      // does not silently decay to "all dark" from silence-detection.
      if (env.fleetEnabled) {
        const fleet = new FleetHeartbeater(runtime, ingest, env.fleetHeartbeatMs);
        fleet.start();
      }

      app.use(createRouter({ db, ingest, incidents, simulator, runtime, hub }));
      ready = true;
      console.log('[boot] API ready');

      tick = async () => {
        try {
          await incidents.tick();
        } catch (e) {
          console.error('[tick] detection failed', e);
        }
      };
      await tick();
      setInterval(tick, env.detectionTickMs);

      shutdown = async () => {
        await ingest.drainNow();
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    } catch (e) {
      console.error('[boot] fatal', e);
      server.close();
      process.exit(1);
    }
  };

  void boot();
}

main().catch((e) => {
  console.error('[boot] fatal', e);
  process.exit(1);
});