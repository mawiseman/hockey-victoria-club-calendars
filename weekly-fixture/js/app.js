// Google Calendar iCal feed IDs (public feeds). The actual fetch URL is
// built by `feedUrl()` below so we can route through Netlify in production
// and only fall back to a public CORS proxy for `npm run dev`.
const CALENDAR_IDS = {
    mens:    'b120156e90f1b5db3b0aba2c617c0ccb06891dfce71934824d2ea52522163cc6@group.calendar.google.com',
    womens:  '45c236109820085226cabd0f84c97574e25fe27183d8155d6ce9fe89e1b486a9@group.calendar.google.com',
    midweek: 'fb9a60cb22b1a5af884d53ea7a439b15264a29d9790c2b3a06e607dc25233c3e@group.calendar.google.com',
    juniors: 'a621fd9b3e4a3996c8ea70697cab4198ad5605847234af74be60fc91345c08c9@group.calendar.google.com',
};

const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);

/**
 * Build the URL to fetch an iCal feed:
 *  - Production (Netlify): /proxy/calendar/ical/... — rewritten to
 *    calendar.google.com by netlify.toml. Same-origin, no CORS.
 *  - Local dev: corsproxy.io, to avoid needing Netlify CLI locally.
 */
function feedUrl(calendarId) {
    const path = `/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`;
    if (IS_LOCAL) {
        return `https://corsproxy.io/?url=${encodeURIComponent('https://calendar.google.com' + path)}`;
    }
    return `/proxy${path}`;
}

// The views shown as tabs, in order
const VIEWS = {
    all:     { label: 'All', title: 'WEEKLY FIXTURES' },
    pl:      { label: 'Premier League', title: 'PREMIER LEAGUE' },
    club:    { label: 'Seniors', title: 'SENIOR FIXTURES' },
    midweek: { label: 'Midweek', title: 'MIDWEEK FIXTURES' },
    juniors: { label: 'Juniors', title: 'JUNIOR FIXTURES' },
};

// Logo file extensions (most are .png, exceptions listed here)
const LOGO_EXTENSIONS = {
    FAL: 'png',
};

const ACTIVE_VIEW_KEY = 'fhc.weeklyFixture.activeView';

let allFixtures = [];
let activeView = loadActiveView();

function loadActiveView() {
    try {
        const stored = localStorage.getItem(ACTIVE_VIEW_KEY);
        if (stored && Object.prototype.hasOwnProperty.call(VIEWS, stored)) return stored;
    } catch { /* localStorage unavailable (private mode, etc.) */ }
    return 'all';
}

function saveActiveView(view) {
    try { localStorage.setItem(ACTIVE_VIEW_KEY, view); } catch { /* ignore */ }
}

// ─── iCal Parsing ────────────────────────────────────────────────────

function parseICS(icsText) {
    const events = [];
    const blocks = icsText.split('BEGIN:VEVENT');

    for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i].split('END:VEVENT')[0];
        const event = {};

        // Unfold long lines (RFC 5545 line folding)
        const unfolded = block.replace(/\r?\n[ \t]/g, '');

        for (const line of unfolded.split(/\r?\n/)) {
            if (line.startsWith('SUMMARY:')) {
                event.summary = line.substring(8).trim();
            } else if (line.startsWith('DTSTART')) {
                event.dtstart = extractDateTime(line);
            } else if (line.startsWith('DTEND')) {
                event.dtend = extractDateTime(line);
            } else if (line.startsWith('LOCATION:')) {
                event.location = line.substring(9).trim();
            }
        }

        if (event.summary && event.dtstart) {
            events.push(event);
        }
    }

    return events;
}

function extractDateTime(line) {
    const value = line.split(':').pop().trim();
    if (value.length >= 15) {
        const y = value.substring(0, 4);
        const m = value.substring(4, 6);
        const d = value.substring(6, 8);
        const h = value.substring(9, 11);
        const min = value.substring(11, 13);
        const sec = value.substring(13, 15);
        const isUTC = value.endsWith('Z');
        return new Date(`${y}-${m}-${d}T${h}:${min}:${sec}${isUTC ? 'Z' : ''}`);
    }
    return new Date(value);
}

// ─── Fixture Parsing + Classification ────────────────────────────────

function parseFixture(event, feedCategory) {
    const summary = event.summary || '';
    // Expected: "Men PL - FHC vs MCC" / "Women PEN A - ALT vs FHC" / "U12 ... - FHC vs X"
    const m = summary.match(/^(.+?)\s*-\s*(.+?)\s+vs\s+(.+)$/i);
    if (!m) return null;

    const comp = m[1].trim();
    const home = m[2].trim();
    const away = m[3].trim();

    return {
        comp,
        shortCode: buildShortCode(comp, feedCategory),
        view: classifyView(comp, feedCategory),
        home,
        away,
        isHome: home.startsWith('FHC'),
        isFhcGame: home.startsWith('FHC') || away.startsWith('FHC'),
        time: event.dtstart,
        endTime: event.dtend,
        location: event.location || '',
    };
}

/**
 * Which tab does this fixture belong to?
 */
function classifyView(comp, feedCategory) {
    if (feedCategory === 'midweek') return 'midweek';
    if (feedCategory === 'juniors') return 'juniors';

    // Seniors — split into PL vs Club
    // Match "PL" or "PLR" as a whole word (e.g. "Men PL - ...", "Women PLR - ...")
    if (/\b(PL|PLR)\b/i.test(comp)) return 'pl';
    return 'club';
}

/**
 * Build a short grade code for display, e.g. "Men PL" → "MPL", "Women PEN A" → "WPA".
 */
function buildShortCode(comp, feedCategory) {
    let c = comp.replace(/\s+NW$/i, '').trim();        // strip trailing region
    c = c.replace(/\s+\d{4}$/, '').trim();             // strip trailing year

    // Seniors — "Men PL" / "Women PEN A" / "Men M1" / etc.
    const seniorMatch = c.match(/^(Men|Women)\s+(.+)$/i);
    if (seniorMatch) {
        const prefix = seniorMatch[1][0].toUpperCase();            // M or W
        const rest = seniorMatch[2]
            .replace(/PEN\s+([A-Z])/i, 'P$1')                       // "PEN A" → "PA"
            .replace(/\s+/g, '')                                    // collapse spaces
            .toUpperCase();
        return prefix + rest;                                       // WPA, MM1, MPL, MPLR
    }

    if (feedCategory === 'juniors') {
        const u = c.match(/U\s*(\d{2})/i) || c.match(/Under\s*(\d{2})/i);
        if (u) return `U${u[1]}`;
    }

    if (feedCategory === 'midweek') {
        const m = c.match(/(\d{2}\+|Masters|Wednesday|Tuesday|Monday|Thursday|Friday)/i);
        if (m) return m[1].toUpperCase();
    }

    return c.toUpperCase().substring(0, 8);
}

// ─── Week / Date Formatting ──────────────────────────────────────────

function getWeekBounds() {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
    monday.setHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    return { monday, sunday };
}

function formatTimeSimple(date) {
    return date.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: false, timeZone: 'Australia/Melbourne' });
}

function formatDayBanner(date) {
    const dayName = date.toLocaleDateString('en-AU', { weekday: 'short', timeZone: 'Australia/Melbourne' }).toUpperCase();
    const dayNum = date.toLocaleDateString('en-AU', { day: 'numeric', timeZone: 'Australia/Melbourne' });
    const month = date.toLocaleDateString('en-AU', { month: 'short', timeZone: 'Australia/Melbourne' }).toUpperCase();
    return `${dayName} ${dayNum} ${month}`;
}

// ─── Logo Handling ───────────────────────────────────────────────────

function getLogoPath(abbr) {
    const ext = LOGO_EXTENSIONS[abbr] || 'png';
    return `/images/logos/${abbr}.${ext}`;
}

function createLogo(abbr) {
    const wrap = document.createElement('div');
    wrap.className = 'logo';
    const img = document.createElement('img');
    img.src = getLogoPath(abbr);
    img.alt = abbr;
    img.onerror = function () {
        this.style.display = 'none';
        const fallback = document.createElement('span');
        fallback.className = 'logo-fallback';
        fallback.textContent = abbr;
        wrap.appendChild(fallback);
    };
    wrap.appendChild(img);
    return wrap;
}

// ─── Rendering ───────────────────────────────────────────────────────

function renderViewTabs() {
    const container = document.getElementById('viewTabs');
    container.innerHTML = '';
    for (const [key, cfg] of Object.entries(VIEWS)) {
        const btn = document.createElement('button');
        btn.className = 'view-tab' + (key === activeView ? ' active' : '');
        btn.textContent = cfg.label;
        btn.onclick = () => {
            activeView = key;
            saveActiveView(key);
            renderActiveView();
        };
        container.appendChild(btn);
    }
}

function renderActiveView() {
    renderViewTabs();

    const cfg = VIEWS[activeView];
    document.getElementById('viewTitle').textContent = cfg.title;

    const fixtures = allFixtures
        .filter(f => activeView === 'all' || f.view === activeView)
        .sort((a, b) => a.time - b.time);

    renderFixtures(fixtures);
}

function renderFixtures(fixtures) {
    const container = document.getElementById('fixtures');
    container.innerHTML = '';

    if (fixtures.length === 0) {
        container.innerHTML = '<div class="empty-state">No fixtures this week</div>';
        return;
    }

    // Group by calendar day (in Melbourne time) so each day gets a separator banner.
    const groups = new Map();
    for (const f of fixtures) {
        const key = f.time.toLocaleDateString('en-AU', {
            timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit'
        });
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(f);
    }

    const sortedKeys = [...groups.keys()].sort((a, b) =>
        groups.get(a)[0].time - groups.get(b)[0].time
    );

    for (const key of sortedKeys) {
        const dayFixtures = groups.get(key);

        const banner = document.createElement('div');
        banner.className = 'day-banner';
        banner.textContent = formatDayBanner(dayFixtures[0].time);
        container.appendChild(banner);

        const now = new Date();
        for (const f of dayFixtures) {
            // Treat as "past" once the end time has gone (fall back to a 90-min
            // window when DTEND is absent).
            const endsAt = f.endTime || new Date(f.time.getTime() + 90 * 60 * 1000);
            const isPast = endsAt < now;

            const row = document.createElement('div');
            row.className = 'fixture-row'
                + (f.isHome ? ' is-home' : '')
                + (isPast ? ' is-past' : '');

            const fhcLogo = createLogo('FHC');
            fhcLogo.classList.add('logo-fhc');

            const grade = document.createElement('span');
            grade.className = 'grade';
            grade.textContent = f.shortCode;

            const time = document.createElement('span');
            time.className = 'time';
            time.textContent = formatTimeSimple(f.time);

            const home = document.createElement('span');
            home.className = 'team home' + (f.home.startsWith('FHC') ? ' is-fhc' : '');
            home.textContent = f.home;

            const vs = document.createElement('span');
            vs.className = 'vs';
            vs.textContent = 'VS';

            const away = document.createElement('span');
            away.className = 'team away' + (f.away.startsWith('FHC') ? ' is-fhc' : '');
            away.textContent = f.away;

            const oppAbbr = f.home.startsWith('FHC') ? f.away : f.home;
            const oppLogo = createLogo(oppAbbr);
            oppLogo.classList.add('logo-opp');

            row.appendChild(fhcLogo);
            row.appendChild(grade);
            row.appendChild(time);
            row.appendChild(home);
            row.appendChild(vs);
            row.appendChild(away);
            row.appendChild(oppLogo);

            container.appendChild(row);
        }
    }
}

// ─── Data Loading ────────────────────────────────────────────────────

async function fetchCalendar(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
}

async function loadFixtures() {
    const { monday, sunday } = getWeekBounds();
    const fixtures = [];

    const fetchPromises = Object.entries(CALENDAR_IDS).map(async ([feedCategory, calendarId]) => {
        try {
            const icsText = await fetchCalendar(feedUrl(calendarId));
            const events = parseICS(icsText);
            for (const event of events) {
                if (event.dtstart >= monday && event.dtstart <= sunday) {
                    const fixture = parseFixture(event, feedCategory);
                    if (fixture) fixtures.push(fixture);
                }
            }
        } catch (err) {
            console.warn(`Failed to load ${feedCategory} calendar:`, err.message);
        }
    });

    await Promise.all(fetchPromises);

    allFixtures = fixtures.sort((a, b) => a.time - b.time);
    renderActiveView();
}

// ─── Init ────────────────────────────────────────────────────────────

loadFixtures();
