/**
 * Node.js-only instrumentation: sandbox local-Postgres bootstrap.
 *
 * When LOCAL_PG=1 (set in the local .env only):
 *   1. Repair the inherited environment — this sandbox exports a legacy
 *      SQLite `file:` DATABASE_URL into every process, which the
 *      postgres-provider Prisma client rejects outright.
 *   2. Start the user-space Postgres via `pg_ctl start` (daemonized).
 *      A daemonized postmaster is re-parented to PID 1 and survives this
 *      sandbox's background-process reaper; directly-attached children
 *      and `nohup`/`setsid` keepers do not.
 *
 * On Vercel (LOCAL_PG unset) everything below is a no-op — production
 * uses Supabase via DATABASE_URL/DIRECT_URL.
 */

const PG_CTL = 'node_modules/@embedded-postgres/linux-x64/native/bin/pg_ctl';
const DATA_DIR = 'db/pgdata';
const PORT = 5433;
const HOST = '127.0.0.1';
const LOCAL_URL = `postgresql://postgres:postgres@${HOST}:${PORT}/gyanzo`;

/** True when something accepts TCP connections on HOST:PORT. */
async function portReady(timeoutMs = 1500): Promise<boolean> {
  const net = await import('node:net');
  return new Promise((resolve) => {
    const sock = net.connect({ host: HOST, port: PORT });
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

async function waitUntilReady(maxMs: number): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await portReady(800)) return true;
    await new Promise((res) => setTimeout(res, 400));
  }
  return false;
}

export async function register() {
  if (process.env.LOCAL_PG !== '1') return;

  // 1. Repair a legacy inherited DATABASE_URL.
  if (process.env.DATABASE_URL?.startsWith('file:')) {
    process.env.DATABASE_URL = LOCAL_URL;
    process.env.DIRECT_URL = process.env.DIRECT_URL?.startsWith('postgresql://')
      ? process.env.DIRECT_URL
      : LOCAL_URL;
    console.log('[instrumentation] DATABASE_URL pointed at the local sandbox Postgres');
  }

  // 2. Start the local server (daemonized via pg_ctl).
  const { existsSync, readFileSync, unlinkSync } = await import('node:fs');
  if (!existsSync(PG_CTL) || !existsSync(`${DATA_DIR}/PG_VERSION`)) {
    console.log('[instrumentation] local postgres binaries/data not present — skipping');
    return;
  }

  if (await waitUntilReady(1500)) {
    console.log('[instrumentation] local postgres already running on :5433/gyanzo');
    return;
  }

  // A SIGKILLed previous instance leaves a stale postmaster.pid; drop it
  // when the recorded pid is provably dead, otherwise postgres refuses to
  // start ("lock file already exists").
  const pidFile = `${DATA_DIR}/postmaster.pid`;
  try {
    if (existsSync(pidFile)) {
      const pid = parseInt(readFileSync(pidFile, 'utf8').split('\n')[0].trim(), 10);
      let alive = true;
      try {
        process.kill(pid, 0);
      } catch {
        alive = false;
      }
      if (!alive) {
        unlinkSync(pidFile);
        console.log('[instrumentation] removed stale postmaster.pid');
      }
    }
  } catch {
    /* best effort */
  }

  const { execFile } = await import('node:child_process');
  await new Promise<void>((resolve) => {
    execFile(
      PG_CTL,
      ['-D', DATA_DIR, '-l', `${DATA_DIR}/pg.log`, '-w', '-t', '20', '-o', `-p ${PORT}`, 'start'],
      { cwd: process.cwd() },
      (err, stdout, stderr) => {
        const out = `${stdout}${stderr}`;
        if (err && !/already running/i.test(out)) {
          console.warn('[instrumentation] local postgres start failed:', out.slice(0, 300));
        }
        resolve();
      }
    );
  });

  if (await waitUntilReady(15_000)) {
    console.log('[instrumentation] local postgres ready on :5433/gyanzo');
  } else {
    console.warn('[instrumentation] local postgres not reachable — see db/pgdata/pg.log');
  }
}
