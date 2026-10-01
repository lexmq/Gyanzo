/**
 * Minimal SMTP catcher used ONLY to prove the Gyanzo verification-email
 * pipeline end-to-end inside the sandbox (no real provider credentials
 * are available here). Accepts any message on :2525 and dumps it to
 * /tmp/smtp-catcher.mbox. NOT part of the app runtime.
 */
import { SMTPServer } from 'smtp-server';
import { appendFileSync } from 'node:fs';

const server = new SMTPServer({
  authOptional: true,
  // Local harness: built-in self-signed cert hangs the STARTTLS upgrade.
  disabledCommands: ['STARTTLS'],
  // The app sends AUTH (SMTP_USER/SMTP_PASS are set in dev env); accept any.
  onAuth(auth, _session, cb) {
    cb(null, { user: auth.username });
  },
  onRcptTo(address, _session, cb) {
    // Accept everything — this is a catcher, not a relay.
    cb();
  },
  onData(stream, _session, cb) {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      appendFileSync(
        '/tmp/smtp-catcher.mbox',
        `\n===== ${new Date().toISOString()} =====\n${raw}\n`
      );
      console.log('[catcher] captured message from', stream.remoteAddress);
      cb();
    });
  },
});

server.on('error', (e) => {
  console.error('[catcher] error:', e.message);
});

server.listen(2525, '127.0.0.1', () => {
  console.log('[catcher] listening on 127.0.0.1:2525');
});
