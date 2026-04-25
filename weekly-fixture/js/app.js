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
        score: event.score || null,
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
    c = c.replace(/\s*\([^)]*\)/g, '').trim();         // strip parentheticals like "(Monday)"
    c = c.replace(/\s+/g, ' ');                        // collapse doubled spaces

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

            // Show the score in the VS chevron slot once a result exists,
            // otherwise the usual VS marker. Score format is "home-away".
            const vs = document.createElement('span');
            if (f.score) {
                vs.className = 'vs has-score';
                vs.textContent = f.score.replace('-', ' – ');
            } else {
                vs.className = 'vs';
                vs.textContent = 'VS';
            }

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

// Loads pre-built fixture data. The file is regenerated daily by the
// sync-calendars GitHub Action and committed to main. In production we read
// it from jsDelivr (mirrors GitHub) so a data refresh doesn't require a
// Netlify rebuild — locally we keep using the same-origin path for `npm run dev`.
const FIXTURES_URL = ['localhost', '127.0.0.1'].includes(location.hostname)
    ? '/data/fixtures.json'
    : 'https://cdn.jsdelivr.net/gh/mawiseman/hockey-victoria-club-calendars@main/weekly-fixture/data/fixtures.json';

async function loadFixtures() {
    const { monday, sunday } = getWeekBounds();
    const fixtures = [];

    try {
        const res = await fetch(FIXTURES_URL, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        renderBuildInfo(data.generatedAt);

        for (const event of data.events || []) {
            const dtstart = new Date(event.dtstart);
            if (dtstart < monday || dtstart > sunday) continue;

            const fixture = parseFixture({
                summary: event.summary,
                dtstart,
                dtend: event.dtend ? new Date(event.dtend) : undefined,
                location: event.location,
                score: event.score,
            }, event.category);

            if (fixture) fixtures.push(fixture);
        }
    } catch (err) {
        console.warn('Failed to load fixtures:', err.message);
    }

    allFixtures = fixtures.sort((a, b) => a.time - b.time);
    renderActiveView();
}

// Show fixtures.json's generatedAt as a version-tag-style stamp
// (e.g. "v2026.04.23-1739"). UTC so it matches the JSON source verbatim.
function renderBuildInfo(generatedAt) {
    const el = document.getElementById('buildInfo');
    if (!el || !generatedAt) return;
    const d = new Date(generatedAt);
    if (Number.isNaN(d.getTime())) return;
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mn = String(d.getUTCMinutes()).padStart(2, '0');
    el.textContent = `v${yyyy}.${mm}.${dd}-${hh}${mn}`;
}

// ─── Init ────────────────────────────────────────────────────────────

loadFixtures();
