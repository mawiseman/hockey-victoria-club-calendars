// Shared HTTP client for all Hockey Victoria scrapes (ladders, scores, iCal
// downloads). Centralises the anti-blocking measures that the three scrapers
// used to each half-implement:
//
//   • Retry-with-backoff on WAF challenges (HTTP 202 `x-amzn-waf-action`),
//     rate-limits (429) and transient 5xx — a single 202 no longer drops a
//     competition for the whole day.
//   • A shared cookie jar so the `aws-waf-token` cookie issued once a challenge
//     is solved is carried on every later request. node-fetch keeps no cookies
//     of its own, so without this each request looked like a brand-new visitor
//     and kept re-triggering the challenge.
//   • A one-off warm-up request to seed that session before the real work.
//   • A keep-alive agent so repeated requests reuse one TCP/TLS connection —
//     faster and less conspicuous to a rate-based WAF.
//   • A per-run User-Agent chosen from a pool, plus a fuller set of browser
//     headers, so the traffic doesn't carry one static bot fingerprint.
//
// See also shuffle() below — used by the scrapers to randomise work order so
// no single competition is always first in line to absorb a cold-start
// challenge.

import fetch from 'node-fetch';
import https from 'https';
import { logInfo, logWarning } from './error-utils.js';

const HV_ORIGIN = 'https://www.hockeyvictoria.org.au';

// Realistic desktop UA strings. One is chosen per process (below) so a run
// presents a consistent identity — a session that changes UA mid-flight looks
// more bot-like than one that doesn't.
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
];

const SESSION_UA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

// Keep-alive so repeated requests reuse the TCP/TLS connection.
const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 4 });

// In-process cookie jar. HV's AWS WAF issues an `aws-waf-token` cookie once a
// challenge is solved; carrying it on later requests is what actually stops the
// repeated 202s.
const cookieJar = new Map();

function storeCookies(res) {
    const raw = res.headers.raw()['set-cookie'];
    if (!raw) return;
    for (const line of raw) {
        const [pair] = line.split(';');
        const idx = pair.indexOf('=');
        if (idx === -1) continue;
        const name = pair.slice(0, idx).trim();
        const value = pair.slice(idx + 1).trim();
        if (name) cookieJar.set(name, value);
    }
}

function cookieHeader() {
    if (cookieJar.size === 0) return '';
    return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function baseHeaders(accept) {
    // Note: Accept-Encoding is intentionally left to node-fetch (it sets
    // gzip/deflate/br and decompresses the response itself) — setting it here
    // risks receiving compressed bytes it won't decode.
    const headers = {
        'User-Agent': SESSION_UA,
        'Accept': accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': `${HV_ORIGIN}/`,
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1',
    };
    const cookie = cookieHeader();
    if (cookie) headers['Cookie'] = cookie;
    return headers;
}

// Sleep a random duration in [minMs, maxMs). Wider jitter than the old fixed
// 200–500ms spreads requests out so a rate-based WAF rule is less likely to
// fire.
export function jitterSleep(minMs = 800, maxMs = 2500) {
    const ms = minMs + Math.random() * (maxMs - minMs);
    return new Promise(r => setTimeout(r, ms));
}

// Fisher–Yates. Shuffling the work order each run means no single competition
// is always first in line to absorb a cold-start WAF challenge — the failures
// (if any) land on a different, random subset each day.
export function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// Fetch an HV URL, retrying transient blocks. Resolves to a node-fetch Response
// guaranteed to be ok and non-202; throws once retries are exhausted (or
// immediately on a non-retryable 4xx). The cookie jar is updated on every
// response, including the failed attempts that carry the challenge token.
export async function hvFetch(url, { accept, headers = {}, retries = 3, baseDelay = 1500, label = url } = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, {
                headers: { ...baseHeaders(accept), ...headers },
                agent: (parsedUrl) => (parsedUrl.protocol === 'https:' ? keepAliveAgent : undefined),
                redirect: 'follow',
            });
            storeCookies(res);

            if (res.status === 202) {
                const wafAction = res.headers.get('x-amzn-waf-action');
                throw new Error(`WAF challenge (status 202, action=${wafAction})`);
            }
            if (res.status === 429 || res.status >= 500) {
                throw new Error(`HTTP ${res.status} ${res.statusText}`);
            }
            if (!res.ok) {
                // Other 4xx (404, 403…) won't fix themselves on retry.
                const err = new Error(`HTTP ${res.status} ${res.statusText}`);
                err.noRetry = true;
                throw err;
            }
            return res;
        } catch (err) {
            lastErr = err;
            if (err.noRetry || attempt === retries) break;
            // Exponential backoff with full jitter — WAF challenges clear on a
            // short wait, and backing off harder each attempt eases rate rules.
            const cap = baseDelay * Math.pow(2, attempt);
            const wait = cap / 2 + Math.random() * (cap / 2);
            logWarning(`${label}: ${err.message} — retry ${attempt + 1}/${retries} in ${Math.round(wait)}ms`);
            await new Promise(r => setTimeout(r, wait));
        }
    }
    throw lastErr;
}

// One-off request to the homepage to seed the cookie jar (and solve any initial
// WAF challenge) before the scraping loop begins. Best-effort: a failure here
// just means we start cold, exactly as before.
export async function warmUpHvSession() {
    try {
        const res = await hvFetch(`${HV_ORIGIN}/`, { retries: 2, label: 'warm-up' });
        await res.text(); // drain body so the socket is freed for keep-alive reuse
        logInfo(`HV session warmed up (${cookieJar.size} cookie(s), UA "${SESSION_UA.slice(0, 32)}…")`);
    } catch (err) {
        logWarning(`HV warm-up failed (continuing without a seeded session): ${err.message}`);
    }
}
