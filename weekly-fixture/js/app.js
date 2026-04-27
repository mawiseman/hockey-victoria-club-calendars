// ───────────────────────────────────────────────────────────────────
// Weekly Fixture page logic.
//
// Data source: season.json — a per-team grouped fixture file built daily by
// `npm run generate-season-json`. We read it once (cached in memory) and
// derive whichever view the user is on.
//
// Routing: hash-based.
//   ` ` / `#`              → current week, week view
//   `#/week/2026-04-20`    → week starting that Monday (any tab still filters)
//   `#/team/men-pl`        → that team's full season (added in a later phase)
// ───────────────────────────────────────────────────────────────────

const VIEWS = {
    all:        { label: 'All', title: 'WEEKLY FIXTURES' },
    pl:         { label: 'Premier League', title: 'PREMIER LEAGUE' },
    club:       { label: 'Seniors', title: 'SENIOR FIXTURES' },
    midweek:    { label: 'Midweek', title: 'MIDWEEK FIXTURES' },
    juniors:    { label: 'Juniors', title: 'JUNIOR FIXTURES' },
    favourites: { label: 'FAV', title: 'FAVOURITES' },
};

// Logo file extensions (most are .png, exceptions listed here)
const LOGO_EXTENSIONS = {
    FAL: 'png',
};

const ACTIVE_VIEW_KEY = 'fhc.weeklyFixture.activeView';

let activeView = loadActiveView();
let seasonCache = null;

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

// ─── Favourites (per-team starred grades) ────────────────────────────
//
// Stored as a JSON array of team slugs. Powers:
//   • The star button on the team-season page.
//   • The "Favourites" tab on the homepage, which is hidden when empty
//     and filters fixtures to just the user's starred grades.

const FAVOURITES_KEY = 'fhc.weeklyFixture.favourites';

function loadFavourites() {
    try {
        const raw = localStorage.getItem(FAVOURITES_KEY);
        if (raw) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) return new Set(arr);
        }
    } catch { /* localStorage unavailable */ }
    return new Set();
}

function saveFavourites(set) {
    try { localStorage.setItem(FAVOURITES_KEY, JSON.stringify([...set])); } catch { /* ignore */ }
}

function isFavourite(slug) {
    return loadFavourites().has(slug);
}

function toggleFavourite(slug) {
    const favs = loadFavourites();
    if (favs.has(slug)) favs.delete(slug);
    else favs.add(slug);
    saveFavourites(favs);
    return favs.has(slug);
}

// ─── Data loading ────────────────────────────────────────────────────

const SEASON_URL = ['localhost', '127.0.0.1'].includes(location.hostname)
    ? '/data/season.json'
    : 'https://cdn.jsdelivr.net/gh/mawiseman/hockey-victoria-club-calendars@main/weekly-fixture/data/season.json';

async function getSeason() {
    if (seasonCache) return seasonCache;
    const res = await fetch(SEASON_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    seasonCache = await res.json();
    renderBuildInfo(seasonCache.generatedAt);
    return seasonCache;
}

// Convert one season.json event + its team metadata into the fixture shape
// the renderer expects. Decoupling lets us reuse renderFixtures() across
// week view and team view.
function eventToFixture(event, team) {
    return {
        comp: team.name,
        shortCode: team.label,
        view: team.view,
        slug: team.slug,
        home: event.home,
        away: event.away,
        isHome: event.isHome,
        time: new Date(event.dtstart),
        endTime: event.dtend ? new Date(event.dtend) : null,
        location: event.location || '',
        score: event.score || null,
    };
}

// ─── Date helpers ────────────────────────────────────────────────────

// Mon 00:00 (local) of the week containing `date`.
function startOfWeek(date) {
    const d = new Date(date);
    const dow = d.getDay();
    d.setDate(d.getDate() - ((dow + 6) % 7));
    d.setHours(0, 0, 0, 0);
    return d;
}

// Bounds for a week, given any date in that week.
function getWeekBounds(weekStart) {
    const monday = startOfWeek(weekStart);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return { monday, sunday };
}

// "2026-04-20" for use in URL hashes — local Mon date, no TZ.
function formatWeekKey(date) {
    const m = startOfWeek(date);
    const yyyy = m.getFullYear();
    const mm = String(m.getMonth() + 1).padStart(2, '0');
    const dd = String(m.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function parseWeekKey(key) {
    const m = key && key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return Number.isNaN(d.getTime()) ? null : startOfWeek(d);
}

function shiftWeek(date, weeks) {
    const d = new Date(date);
    d.setDate(d.getDate() + weeks * 7);
    return startOfWeek(d);
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

// "WED 22 APR 19:00" — date + time inline for the team-season view.
function formatDateTime(date) {
    const day = date.toLocaleDateString('en-AU', { weekday: 'short', timeZone: 'Australia/Melbourne' }).toUpperCase();
    const dayNum = date.toLocaleDateString('en-AU', { day: 'numeric', timeZone: 'Australia/Melbourne' });
    const month = date.toLocaleDateString('en-AU', { month: 'short', timeZone: 'Australia/Melbourne' }).toUpperCase();
    const time = date.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: false, timeZone: 'Australia/Melbourne' });
    return `${day} ${dayNum} ${month} ${time}`;
}

// "20 – 26 APR" for the week navigation label.
function formatWeekRange(monday, sunday) {
    const mDay = monday.toLocaleDateString('en-AU', { day: 'numeric', timeZone: 'Australia/Melbourne' });
    const sDay = sunday.toLocaleDateString('en-AU', { day: 'numeric', timeZone: 'Australia/Melbourne' });
    const mMonth = monday.toLocaleDateString('en-AU', { month: 'short', timeZone: 'Australia/Melbourne' }).toUpperCase();
    const sMonth = sunday.toLocaleDateString('en-AU', { month: 'short', timeZone: 'Australia/Melbourne' }).toUpperCase();
    if (mMonth === sMonth) return `${mDay} – ${sDay} ${mMonth}`;
    return `${mDay} ${mMonth} – ${sDay} ${sMonth}`;
}

// ─── Logo handling ───────────────────────────────────────────────────

function getLogoPath(abbr) {
    // Multi-word abbreviations (e.g. "ESS Jets", "BRU B", "PEGS M") are
    // team-name suffixes appended to the base club abbr. Use the first
    // whitespace-separated token for the logo file so all teams from one
    // club share the same image.
    const baseAbbr = abbr.split(/\s+/)[0];
    const ext = LOGO_EXTENSIONS[baseAbbr] || 'png';
    return `/images/logos/${baseAbbr}.${ext}`;
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

// ─── Rendering: tabs, week nav, fixture rows ─────────────────────────

function renderViewTabs() {
    const container = document.getElementById('viewTabs');
    container.innerHTML = '';
    const favCount = loadFavourites().size;
    for (const [key, cfg] of Object.entries(VIEWS)) {
        // Favourites tab is conditional — only meaningful once there's at least
        // one starred grade.
        if (key === 'favourites' && favCount === 0) continue;

        const btn = document.createElement('button');
        btn.className = 'view-tab' + (key === activeView ? ' active' : '');
        btn.textContent = cfg.label;
        btn.onclick = () => {
            activeView = key;
            saveActiveView(key);
            renderRoute();
        };
        container.appendChild(btn);
    }
}

function renderWeekNav(monday, sunday) {
    const container = document.getElementById('fixtures');
    const nav = document.createElement('div');
    nav.className = 'week-nav';

    const currentMonday = startOfWeek(new Date());
    const isCurrent = monday.getTime() === currentMonday.getTime();

    const prev = document.createElement('button');
    prev.className = 'week-nav-btn';
    prev.setAttribute('aria-label', 'Previous week');
    prev.textContent = '‹';
    prev.onclick = () => {
        const prevWeek = shiftWeek(monday, -1);
        location.hash = `#/week/${formatWeekKey(prevWeek)}`;
    };

    const label = document.createElement('span');
    label.className = 'week-nav-label';
    label.textContent = formatWeekRange(monday, sunday);

    const next = document.createElement('button');
    next.className = 'week-nav-btn';
    next.setAttribute('aria-label', 'Next week');
    next.textContent = '›';
    next.onclick = () => {
        const nextWeek = shiftWeek(monday, 1);
        location.hash = `#/week/${formatWeekKey(nextWeek)}`;
    };

    nav.appendChild(prev);
    nav.appendChild(label);
    nav.appendChild(next);

    // Standalone "this week" pill — only present when we're not already on it.
    if (!isCurrent) {
        const today = document.createElement('button');
        today.className = 'week-nav-today';
        today.textContent = 'This Week';
        today.setAttribute('aria-label', 'Jump to this week');
        today.onclick = () => { location.hash = ''; };
        nav.appendChild(today);
    }

    container.appendChild(nav);
}

function renderFixtures(fixtures, linkContext = null) {
    const container = document.getElementById('fixtures');

    if (fixtures.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'No fixtures this week';
        container.appendChild(empty);
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

    const now = new Date();
    for (const key of sortedKeys) {
        const dayFixtures = groups.get(key);

        const banner = document.createElement('div');
        banner.className = 'day-banner';
        banner.textContent = formatDayBanner(dayFixtures[0].time);
        container.appendChild(banner);

        for (const f of dayFixtures) {
            container.appendChild(buildFixtureRow(f, now, 'week', linkContext));
        }
    }
}

function buildFixtureRow(f, now, mode = 'week', linkContext = null) {
    // Treat as "past" once the end time has gone (fall back to a 90-min
    // window when DTEND is absent).
    const endsAt = f.endTime || new Date(f.time.getTime() + 90 * 60 * 1000);
    const isPast = endsAt < now;

    // Week-view rows are anchor links into the team's season. Team-view rows
    // are plain divs (you're already there).
    const row = document.createElement(mode === 'team' ? 'div' : 'a');
    row.className = 'fixture-row'
        + (mode === 'team' ? ' team-view' : '')
        + (f.isHome ? ' is-home' : '')
        + (isPast ? ' is-past' : '');
    if (mode !== 'team' && f.slug) {
        row.href = `#/team/${f.slug}${buildReturnQuery(linkContext)}`;
    }

    const fhcLogo = createLogo('FHC');
    fhcLogo.classList.add('logo-fhc');
    row.appendChild(fhcLogo);

    if (mode === 'team') {
        // Date + time take the place of grade + time; the user is already
        // looking at one team so the grade chip would be redundant.
        const when = document.createElement('span');
        when.className = 'team-when';
        when.textContent = formatDateTime(f.time);
        row.appendChild(when);
    } else {
        const grade = document.createElement('span');
        grade.className = 'grade';
        grade.textContent = f.shortCode;
        row.appendChild(grade);

        const time = document.createElement('span');
        time.className = 'time';
        time.textContent = formatTimeSimple(f.time);
        row.appendChild(time);
    }

    const home = document.createElement('span');
    home.className = 'team home' + (f.home.startsWith('FHC') ? ' is-fhc' : '');
    home.textContent = f.home;
    row.appendChild(home);

    // Score chip in the VS slot when a result exists; otherwise the usual VS marker.
    const vs = document.createElement('span');
    if (f.score) {
        vs.className = 'vs has-score';
        vs.textContent = f.score.replace('-', ' – ');
    } else {
        vs.className = 'vs';
        vs.textContent = 'VS';
    }
    row.appendChild(vs);

    const away = document.createElement('span');
    away.className = 'team away' + (f.away.startsWith('FHC') ? ' is-fhc' : '');
    away.textContent = f.away;
    row.appendChild(away);

    const oppAbbr = f.home.startsWith('FHC') ? f.away : f.home;
    const oppLogo = createLogo(oppAbbr);
    oppLogo.classList.add('logo-opp');
    row.appendChild(oppLogo);

    if (mode !== 'team' && f.slug) {
        const chev = document.createElement('span');
        chev.className = 'row-chev';
        chev.textContent = '›';
        chev.setAttribute('aria-hidden', 'true');
        row.appendChild(chev);
    }

    return row;
}

// ─── Routes ──────────────────────────────────────────────────────────

function parseRoute() {
    const hash = location.hash || '';
    const [path, queryStr] = hash.split('?');
    const params = new URLSearchParams(queryStr || '');

    const teamMatch = path.match(/^#?\/team\/([a-z0-9-]+)/);
    if (teamMatch) {
        return {
            mode: 'team',
            slug: teamMatch[1],
            // Optional return-state — set by the chevron-row link so that the
            // "‹ Fixtures" affordance can land the user back where they were.
            returnWeek: params.get('w') || null,
            returnTab: params.get('t') || null,
        };
    }

    const weekMatch = path.match(/^#?\/week\/(\d{4}-\d{2}-\d{2})/);
    if (weekMatch) {
        const start = parseWeekKey(weekMatch[1]);
        if (start) return { mode: 'week', weekStart: start };
    }
    return { mode: 'week', weekStart: startOfWeek(new Date()) };
}

async function renderRoute() {
    let season;
    try {
        season = await getSeason();
    } catch (err) {
        console.warn('Failed to load season:', err.message);
        document.getElementById('fixtures').innerHTML =
            '<div class="empty-state">Could not load fixtures.</div>';
        return;
    }

    const route = parseRoute();
    if (route.mode === 'team') {
        // If the route carried a remembered tab, restore it before rendering
        // so the back-link comes out to the same filter.
        if (route.returnTab && Object.prototype.hasOwnProperty.call(VIEWS, route.returnTab)) {
            activeView = route.returnTab;
            saveActiveView(route.returnTab);
        }
        renderTeamView(season, route.slug, {
            returnWeek: route.returnWeek,
            returnTab: route.returnTab,
        });
    } else {
        renderWeekView(season, route.weekStart);
    }
}

function renderWeekView(season, weekStart) {
    // Tabs only matter when we're showing a list of teams' fixtures.
    setViewTabsVisible(true);
    setSubscribeCtaVisible(true);

    // If the user lands on `favourites` with nothing starred (e.g. they cleared
    // browser data, or unfavourited the last grade on a different page), fall
    // back to `all` so they don't see an empty page or stale title.
    if (activeView === 'favourites' && loadFavourites().size === 0) {
        activeView = 'all';
        saveActiveView('all');
    }

    renderViewTabs();

    const cfg = VIEWS[activeView];
    document.getElementById('viewTitle').textContent = cfg.title;

    const { monday, sunday } = getWeekBounds(weekStart);

    const fixtures = [];
    for (const team of season.teams) {
        for (const event of team.events) {
            const t = new Date(event.dtstart);
            if (t < monday || t > sunday) continue;
            fixtures.push(eventToFixture(event, team));
        }
    }
    fixtures.sort((a, b) => a.time - b.time);

    let visible;
    if (activeView === 'all') {
        visible = fixtures;
    } else if (activeView === 'favourites') {
        const favs = loadFavourites();
        visible = fixtures.filter(f => favs.has(f.slug));
    } else {
        visible = fixtures.filter(f => f.view === activeView);
    }

    const container = document.getElementById('fixtures');
    container.innerHTML = '';
    renderWeekNav(monday, sunday);
    // Pass current week + tab so the chevron links remember where to return.
    const linkContext = {
        returnWeek: formatWeekKey(monday),
        returnTab: activeView,
    };
    renderFixtures(visible, linkContext);
}

function renderTeamView(season, slug, returnState = {}) {
    // Hide the tabs and the homepage subscribe CTA — neither makes sense
    // when scoped to one team. The team-specific subscribe block is rendered
    // inline at the bottom of the team's fixtures.
    setViewTabsVisible(false);
    setSubscribeCtaVisible(false);

    const team = season.teams.find(t => t.slug === slug);
    const container = document.getElementById('fixtures');
    container.innerHTML = '';

    if (!team) {
        document.getElementById('viewTitle').textContent = 'TEAM NOT FOUND';
        container.appendChild(makeBackToFixtures(null, returnState));
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'No team matches that link.';
        container.appendChild(empty);
        return;
    }

    document.getElementById('viewTitle').textContent = team.label;
    container.appendChild(makeBackToFixtures(team, returnState));

    if (team.events.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'No fixtures yet for this team.';
        container.appendChild(empty);
        return;
    }

    // Continuous list: no day grouping, full date+time on each row.
    const now = new Date();
    for (const event of team.events) {
        const f = eventToFixture(event, team);
        container.appendChild(buildFixtureRow(f, now, 'team'));
    }

    // Subscribe accordion specific to this team (replacing the homepage CTA).
    // Use the full competition name in the label rather than the short code —
    // "Subscribe to 40+ fixtures" is too cryptic; "Subscribe to Midweek Men's
    // 40+ NW - 2026 fixtures" makes the scope explicit.
    if (team.googleCalendar && (team.googleCalendar.publicUrl || team.googleCalendar.icalUrl)
        && typeof window.subscribeBlock === 'function') {
        container.appendChild(window.subscribeBlock(
            `Subscribe to ${team.name} fixtures`,
            team.googleCalendar.publicUrl,
            team.googleCalendar.icalUrl
        ));
    }
}

function makeBackToFixtures(team, returnState = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'team-header';

    const back = document.createElement('a');
    back.className = 'team-back';
    // If we know the originating week, send the user back there. Otherwise
    // empty hash → current week (with the user's stored tab).
    back.href = returnState && returnState.returnWeek
        ? `#/week/${returnState.returnWeek}`
        : '#';
    back.textContent = '‹ Fixtures';
    wrap.appendChild(back);

    if (team) {
        const links = document.createElement('div');
        links.className = 'team-header-links';

        // Favourite toggle — leftmost so it's the most prominent action.
        // Star fills when active; aria-pressed reflects state for screen readers.
        links.appendChild(makeFavouriteButton(team.slug));

        if (team.fixtureUrl) {
            const a = document.createElement('a');
            a.className = 'team-header-link';
            a.href = team.fixtureUrl;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = 'Fixture';
            links.appendChild(a);
        }
        if (team.ladderUrl) {
            const a = document.createElement('a');
            a.className = 'team-header-link';
            a.href = team.ladderUrl;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = 'Ladder';
            links.appendChild(a);
        }
        if (links.childNodes.length > 0) wrap.appendChild(links);
    }
    return wrap;
}

function makeFavouriteButton(slug) {
    const btn = document.createElement('button');
    btn.className = 'team-header-link team-fav';
    btn.type = 'button';

    function render() {
        const fav = isFavourite(slug);
        btn.classList.toggle('is-favourite', fav);
        btn.setAttribute('aria-pressed', fav ? 'true' : 'false');
        btn.title = fav ? 'Remove from favourites' : 'Add to favourites';
        // Star glyph + label so the action is unambiguous on first sight.
        btn.textContent = fav ? '★ Fav' : '☆ Fav';
    }

    btn.onclick = () => {
        toggleFavourite(slug);
        render();
    };

    render();
    return btn;
}

function setViewTabsVisible(visible) {
    const el = document.getElementById('viewTabs');
    if (el) el.style.display = visible ? '' : 'none';
}

function setSubscribeCtaVisible(visible) {
    const el = document.querySelector('.subscribe-cta');
    if (el) el.style.display = visible ? '' : 'none';
}

// Build "?w=...&t=..." for chevron-row team links so the team page knows
// which week + tab to return the user to. Empty string when context is null.
function buildReturnQuery(linkContext) {
    if (!linkContext) return '';
    const params = new URLSearchParams();
    if (linkContext.returnWeek) params.set('w', linkContext.returnWeek);
    if (linkContext.returnTab) params.set('t', linkContext.returnTab);
    const q = params.toString();
    return q ? `?${q}` : '';
}

// Show season.json's generatedAt as a small version-tag-style stamp.
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

// ─── PWA service worker ──────────────────────────────────────────────

// Register the service worker once the page has loaded so its install/
// fetch handlers don't compete with the initial render. Skipped on
// localhost dev — the cached assets get in the way of file edits.
if ('serviceWorker' in navigator && !['localhost', '127.0.0.1'].includes(location.hostname)) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(err => {
            console.warn('Service worker registration failed:', err.message);
        });
    });
}

// ─── Init ────────────────────────────────────────────────────────────

window.addEventListener('hashchange', renderRoute);
renderRoute();
