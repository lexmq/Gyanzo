import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

/**
 * GET /api/auth/google/url?origin=<browser-origin>
 *
 * Step 1 of the Google OAuth 2.0 authorization-code flow. Builds the
 * Google consent URL and plants a one-time CSRF `state` in an HttpOnly
 * cookie (paired with the browser origin, base64url-encoded, so the
 * callback can rebuild the exact same redirect_uri behind proxies).
 *
 * - redirect_uri = <origin>/api/auth/google/callback (or the
 *   GOOGLE_REDIRECT_URI env override — mirrored exactly in /callback).
 * - scope: openid + email + profile (the minimum needed to identify
 *   the user and link the local account).
 * - prompt=select_account so the chooser always shows every Google
 *   email the visitor is signed in with.
 *
 * Returns { ok, configured, url } — url is null when the server has no
 * credentials (the client then falls back to the honest demo sign-in).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ ok: true, configured: false, url: null });
  }

  const origin = (request.nextUrl.searchParams.get('origin') ?? '').replace(
    /\/+$/,
    ''
  );
  if (!/^https?:\/\//.test(origin)) {
    return NextResponse.json(
      { ok: false, error: 'invalidOrigin' },
      { status: 400 }
    );
  }

  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI?.trim() ||
    `${origin}/api/auth/google/callback`;

  // One-time CSRF token; the base64url origin rides along in the cookie
  // (NOT in the state Google echoes back) so the callback can rebuild
  // the identical redirect_uri even when this server sits behind a
  // public preview proxy it can't know its own public URL of.
  const state = randomBytes(16).toString('hex');
  const originB64 = Buffer.from(origin).toString('base64url');

  const consent = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  consent.searchParams.set('client_id', clientId);
  consent.searchParams.set('redirect_uri', redirectUri);
  consent.searchParams.set('response_type', 'code');
  consent.searchParams.set(
    'scope',
    'openid email profile https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile'
  );
  consent.searchParams.set('state', state);
  consent.searchParams.set('prompt', 'select_account');

  const res = NextResponse.json({ ok: true, configured: true, url: consent.toString() });
  const isHttps = origin.startsWith('https://');
  res.cookies.set('g_oauth_state', `${state}~${originB64}`, {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });
  console.log(
    `[auth/google/url] consent URL built (redirect_uri=${redirectUri})`
  );
  return res;
}
