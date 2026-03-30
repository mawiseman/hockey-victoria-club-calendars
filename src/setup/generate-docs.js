import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import ical from 'ical';

// Import shared utilities
import { loadCompetitionData, categorizeCompetitions } from '../lib/competition-utils.js';
import { OUTPUT_DIR, COMPETITIONS_FILE, getSettings, getClubName, getCategoryCalendars, CATEGORY_LABELS } from '../lib/config.js';
import { withErrorHandling, logSuccess, logInfo } from '../lib/error-utils.js';

const __filename = fileURLToPath(import.meta.url);
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'competitions.md');
const OUTPUT_FILE_MOBILE = path.join(OUTPUT_DIR, 'competitions-mobile.md');

// Calendar embed colors for different categories
const CALENDAR_COLORS = [
    '%23285F9B',  // Royal blue
    '%23D50000',  // Red
    '%23008000',  // Green
    '%23FF8C00',  // Orange
    '%239C27B0',  // Purple
    '%23F09300',  // Amber
    '%230B8043',  // Dark green
    '%23E67C73'   // Coral
];

// ─── Shared helpers ──────────────────────────────────────────────────

/**
 * Get club calendar source params if configured
 */
async function getClubCalendarParams() {
    try {
        const settings = await getSettings();
        if (settings.clubCalendar && settings.clubCalendar.calendarId) {
            return {
                src: `&src=${encodeURIComponent(settings.clubCalendar.calendarId)}`,
                color: `&color=%23616161`
            };
        }
    } catch (error) {
        // Continue without club calendar
    }
    return { src: '', color: '' };
}

/**
 * Build a Google Calendar embed URL from a list of calendar sources
 */
function buildEmbedUrl(calendarSources, colorParams) {
    return `https://calendar.google.com/calendar/embed?height=600&wkst=2&ctz=Australia%2FMelbourne&showPrint=0&showTz=0${calendarSources}${colorParams}`;
}

/**
 * Get competition link data
 */
function getCompetitionLinks(comp) {
    const links = [];
    if (comp.fixtureUrl) {
        links.push({ url: comp.fixtureUrl, icon: '🏑', label: 'Fixture' });
    }
    if (comp.competitionUrl) {
        links.push({ url: comp.competitionUrl, icon: '🏆', label: 'Competition' });
    }
    if (comp.googleCalendar?.publicUrl) {
        links.push({ url: comp.googleCalendar.publicUrl, icon: '📅', label: 'Google Calendar' });
    }
    return links;
}

/**
 * Generate subscribe instructions for Google Calendar (HTML, single line for tables)
 */
function googleCalendarSubscribeHtml(publicUrl) {
    return `<b>Google Calendar:</b><br>1. Open the <a href="${publicUrl}" target="_blank">Google Calendar link</a><br>2. On mobile, tap the <b>+</b> button in the bottom right corner<br>3. On desktop, click <b>Add to Google Calendar</b> at the bottom of the page<br>`;
}

/**
 * Generate subscribe instructions for iOS Calendar (HTML, single line for tables)
 */
function iosCalendarSubscribeHtml(icalUrl) {
    return `<b>iOS Calendar:</b><br>1. Go to <b>Settings > Calendar > Accounts</b><br>2. Tap <b>Add Account > Other</b><br>3. Tap <b>Add Subscribed Calendar</b><br>4. Paste the <a href="${icalUrl}">iCal link</a> and tap <b>Next</b><br>`;
}

/**
 * Generate category subscribe block (shared between desktop and mobile)
 */
function formatCategorySubscribeHtml(categoryCal, categoryName) {
    let html = `<details><summary>📲 Subscribe to all ${categoryName} fixtures</summary>`;
    html += `<br><b>Google Calendar:</b><br>1. Open the <a href="${categoryCal.publicUrl}" target="_blank">Google Calendar link</a><br>2. On mobile, tap the <b>+</b> button in the bottom right corner<br>3. On desktop, click <b>Add to Google Calendar</b> at the bottom of the page<br>`;
    html += `<br><b>iOS Calendar:</b><br>1. Go to <b>Settings > Calendar > Accounts</b><br>2. Tap <b>Add Account > Other</b><br>3. Tap <b>Add Subscribed Calendar</b><br>4. Paste the <a href="${categoryCal.icalUrl}">iCal link</a> and tap <b>Next</b><br>`;
    html += `</details>\n\n`;
    return html;
}

// ─── Calendar URL builders ───────────────────────────────────────────

/**
 * Build combined calendar URL with category-specific color
 */
async function buildCombinedCalendarUrl(competitions, categoryIndex = 0) {
    const competitionsWithCalendars = competitions.filter(comp =>
        comp.googleCalendar && comp.googleCalendar.calendarId
    );

    if (competitionsWithCalendars.length === 0) return null;

    const clubParams = await getClubCalendarParams();
    let calendarSources = clubParams.src;
    let colorParams = clubParams.color;

    const categoryColor = CALENDAR_COLORS[categoryIndex % CALENDAR_COLORS.length];
    competitionsWithCalendars.forEach(comp => {
        calendarSources += `&src=${encodeURIComponent(comp.googleCalendar.calendarId)}`;
        colorParams += `&color=${categoryColor}`;
    });

    return buildEmbedUrl(calendarSources, colorParams);
}

/**
 * Build combined calendar URL with mixed colors for all categories
 */
async function buildCombinedCalendarUrlWithMixedColors(categories) {
    const clubParams = await getClubCalendarParams();
    let calendarSources = clubParams.src;
    let colorParams = clubParams.color;
    let hasCalendars = false;
    let colorIndex = 0;

    Object.keys(categories).forEach(categoryName => {
        const categoryColor = CALENDAR_COLORS[colorIndex % CALENDAR_COLORS.length];
        colorIndex++;

        categories[categoryName].forEach(comp => {
            if (comp.googleCalendar && comp.googleCalendar.calendarId) {
                calendarSources += `&src=${encodeURIComponent(comp.googleCalendar.calendarId)}`;
                colorParams += `&color=${categoryColor}`;
                hasCalendars = true;
            }
        });
    });

    if (!hasCalendars) return null;
    return buildEmbedUrl(calendarSources, colorParams);
}

// ─── Desktop (table) format ──────────────────────────────────────────

/**
 * Generate index markdown content with all calendars
 */
async function generateIndexMarkdown(categories, activeCompetitions) {
    const clubName = await getClubName();

    let markdown = `# ${clubName} - Competition Calendars\n\n`;
    markdown += `**Active Competitions:** ${activeCompetitions.length}  \n`;
    markdown += `[![Sync Status](https://github.com/mawiseman/hockey-victoria-club-calendars/actions/workflows/sync-calendars.yml/badge.svg)](https://github.com/mawiseman/hockey-victoria-club-calendars/actions/workflows/sync-calendars.yml)  \n\n`;
    markdown += `---\n\n`;

    // Combined calendar view of ALL competitions
    const allCompetitions = Object.values(categories).flat();
    const competitionsWithCalendars = allCompetitions.filter(comp =>
        comp.googleCalendar && comp.googleCalendar.calendarId
    );

    if (competitionsWithCalendars.length > 0) {
        markdown += `## All Competitions - Combined Calendar View\n\n`;
        const combinedCalendarUrl = await buildCombinedCalendarUrlWithMixedColors(categories);
        if (combinedCalendarUrl) {
            markdown += `📅 **<a href="${combinedCalendarUrl}" target="_blank">View All Competitions Calendar</a>**\n\n`;
            markdown += `*Opens Google Calendar with all ${competitionsWithCalendars.length} competition calendars combined in one view.*\n\n`;
        }
        markdown += `---\n\n`;
    }

    // Add individual competition sections for each category
    let categoryIndex = 0;
    for (const [categoryKey, competitions] of Object.entries(categories)) {
        const categoryName = CATEGORY_LABELS[categoryKey] || categoryKey;
        if (competitions.length > 0) {
            markdown += `## ${categoryName}\n\n`;
            markdown += await formatCompetitionTable(competitions, categoryKey, categoryIndex);
            markdown += `\n`;
            categoryIndex++;
        }
    }

    // Footer
    markdown += `---\n\n`;
    markdown += `*This documentation is automatically generated from competitions.json*  \n`;
    markdown += `*To update calendars, run: \`npm run process-fixture\`*\n`;

    return markdown;
}

/**
 * Format competitions as a table with combined calendar link
 */
async function formatCompetitionTable(competitions, categoryKey, categoryIndex = 0) {
    const categoryName = CATEGORY_LABELS[categoryKey] || categoryKey;
    const competitionsWithCalendars = competitions.filter(comp =>
        comp.googleCalendar && comp.googleCalendar.calendarId
    );

    let content = '';

    if (competitionsWithCalendars.length > 0) {
        const combinedCalendarUrl = await buildCombinedCalendarUrl(competitions, categoryIndex);
        if (combinedCalendarUrl) {
            content += `📅 **<a href="${combinedCalendarUrl}" target="_blank">View All ${categoryName} Fixtures</a>**\n\n`;
            content += `*Opens Google Calendar with all ${competitionsWithCalendars.length} competition calendars in one view.*\n\n`;
        }
    }

    // Category calendar subscribe link
    const categoryCalendars = await getCategoryCalendars();
    const categoryCal = categoryCalendars[categoryKey];
    if (categoryCal) {
        content += formatCategorySubscribeHtml(categoryCal, categoryName);
    }

    let table = `| Competition | Fixture | Competition | Google Calendar | Subscribe |\n`;
    table += `|-------------|----------|-------------|----------|----------------|\n`;

    for (const competition of competitions) {
        const links = getCompetitionLinks(competition);
        const fixtureLink = links.find(l => l.label === 'Fixture');
        const competitionLink = links.find(l => l.label === 'Competition');
        const calendarLink = links.find(l => l.label === 'Google Calendar');

        const fixtureCol = fixtureLink
            ? `<a href="${fixtureLink.url}" target="_blank">${fixtureLink.icon} ${fixtureLink.label}</a>`
            : `*Not available*`;

        const competitionCol = competitionLink
            ? `<a href="${competitionLink.url}" target="_blank">${competitionLink.icon} ${competitionLink.label}</a>`
            : `*Not available*`;

        const webViewCol = calendarLink
            ? `<a href="${calendarLink.url}" target="_blank">📅 View</a>`
            : competition.googleCalendar ? `*Not available*` : `*Not configured*`;

        let subscribeCol;
        if (competition.googleCalendar?.publicUrl || competition.googleCalendar?.icalUrl) {
            let subscribeHtml = `<details><summary>📲 Subscribe</summary>`;
            if (competition.googleCalendar.publicUrl) {
                subscribeHtml += `<br>` + googleCalendarSubscribeHtml(competition.googleCalendar.publicUrl);
            }
            if (competition.googleCalendar.icalUrl) {
                subscribeHtml += `<br>` + iosCalendarSubscribeHtml(competition.googleCalendar.icalUrl);
            }
            subscribeHtml += `</details>`;
            subscribeCol = subscribeHtml;
        } else {
            subscribeCol = competition.googleCalendar ? `*Not available*` : `*Not configured*`;
        }

        table += `| ${competition.name} | ${fixtureCol} | ${competitionCol} | ${webViewCol} | ${subscribeCol} |\n`;
    }

    content += table + `\n`;
    return content;
}

// ─── Mobile (card) format ────────────────────────────────────────────

/**
 * Generate mobile-friendly markdown with card-style layout
 */
async function generateMobileMarkdown(categories, activeCompetitions) {
    const clubName = await getClubName();

    let md = `# ${clubName}\n\n`;
    md += `**${activeCompetitions.length} Active Competitions**  \n`;
    md += `[![Sync Status](https://github.com/mawiseman/hockey-victoria-club-calendars/actions/workflows/sync-calendars.yml/badge.svg)](https://github.com/mawiseman/hockey-victoria-club-calendars/actions/workflows/sync-calendars.yml)  \n\n`;

    // Combined calendar link
    const combinedUrl = await buildCombinedCalendarUrlWithMixedColors(categories);
    if (combinedUrl) {
        md += `> **<a href="${combinedUrl}" target="_blank">View All Competitions Calendar</a>**\n\n`;
    }

    // Table of contents
    for (const [categoryKey, competitions] of Object.entries(categories)) {
        if (competitions.length === 0) continue;
        const categoryName = CATEGORY_LABELS[categoryKey] || categoryKey;
        const anchor = categoryName.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-');
        md += `**[${categoryName}](#${anchor})**  \n`;
        for (const comp of competitions) {
            const compAnchor = comp.name.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-');
            md += `- [${comp.name}](#${compAnchor})  \n`;
        }
        md += `\n`;
    }

    md += `---\n\n`;

    const categoryCalendars = await getCategoryCalendars();
    let categoryIndex = 0;
    for (const [categoryKey, competitions] of Object.entries(categories)) {
        if (competitions.length === 0) continue;
        const categoryName = CATEGORY_LABELS[categoryKey] || categoryKey;

        md += `## ${categoryName}\n\n`;

        const categoryUrl = await buildCombinedCalendarUrl(competitions, categoryIndex);
        if (categoryUrl) {
            md += `> 📅 **<a href="${categoryUrl}" target="_blank">View All ${categoryName} Fixtures</a>**\n\n`;
        }

        // Category calendar subscribe link
        const categoryCal = categoryCalendars[categoryKey];
        if (categoryCal) {
            md += formatCategorySubscribeHtml(categoryCal, categoryName);
        }

        for (const comp of competitions) {
            md += `### ${comp.name}\n\n`;

            // Links line
            const links = getCompetitionLinks(comp);
            if (links.length > 0) {
                md += links.map(l => `<a href="${l.url}" target="_blank">${l.icon} ${l.label}</a>`).join(' | ') + '\n\n';
            }

            // Subscribe section
            if (comp.googleCalendar?.icalUrl || comp.googleCalendar?.publicUrl) {
                md += `<details><summary>📲 Subscribe</summary>\n\n`;
                if (comp.googleCalendar?.publicUrl) {
                    md += `**Google Calendar**\n\n`;
                    md += `1. Open the <a href="${comp.googleCalendar.publicUrl}" target="_blank">Google Calendar link</a>\n`;
                    md += `2. On mobile, tap the **+** button in the bottom right corner\n`;
                    md += `3. On desktop, click **Add to Google Calendar** at the bottom of the page\n\n`;
                }
                if (comp.googleCalendar?.icalUrl) {
                    md += `**iOS Calendar**\n\n`;
                    md += `1. Go to **Settings > Calendar > Accounts**\n`;
                    md += `2. Tap **Add Account > Other**\n`;
                    md += `3. Tap **Add Subscribed Calendar**\n`;
                    md += `4. Paste the <a href="${comp.googleCalendar.icalUrl}">iCal link</a> and tap **Next**\n\n`;
                }
                md += `</details>\n\n`;
            }
        }

        md += `---\n\n`;
        categoryIndex++;
    }

    md += `*Automatically generated from competitions.json*\n`;

    return md;
}

// ─── Filtering ───────────────────────────────────────────────────────

/**
 * Get the latest event date from a competition's calendar file
 */
async function getLatestEventDate(competitionName) {
    try {
        const processedFile = `temp/processed/${competitionName.replace(/[^a-z0-9]/gi, '_')}_processed.ics`;
        const downloadFile = `temp/downloads/${competitionName.replace(/[^a-z0-9]/gi, '_')}.ics`;

        let calendarFile;
        try {
            await fs.access(processedFile);
            calendarFile = processedFile;
        } catch {
            await fs.access(downloadFile);
            calendarFile = downloadFile;
        }

        const icalData = await fs.readFile(calendarFile, 'utf8');
        const parsedCal = ical.parseICS(icalData);

        let latestDate = null;
        for (const key in parsedCal) {
            const event = parsedCal[key];
            if (event.type === 'VEVENT' && event.start) {
                const eventDate = event.start instanceof Date ? event.start : new Date(event.start);
                if (!latestDate || eventDate > latestDate) {
                    latestDate = eventDate;
                }
            }
        }
        return latestDate;
    } catch (error) {
        return null;
    }
}

/**
 * Filter competitions to only those with events in the future
 */
async function filterActiveCompetitions(competitions) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const results = await Promise.all(
        competitions.map(async (comp) => {
            const latestDate = await getLatestEventDate(comp.name);
            if (!latestDate || latestDate >= today) return comp;
            return null;
        })
    );

    return results.filter(comp => comp !== null);
}

// ─── Main ────────────────────────────────────────────────────────────

async function generateDocs() {
    logInfo('Starting documentation generation...');

    const competitionsData = await loadCompetitionData();
    logInfo(`Loaded ${competitionsData.competitions.length} competitions from ${COMPETITIONS_FILE}`);

    let activeCompetitions = competitionsData.competitions.filter(comp => comp.isActive !== false);
    logInfo(`Filtered to ${activeCompetitions.length} active competitions (by isActive flag)`);

    activeCompetitions = await filterActiveCompetitions(activeCompetitions);
    logInfo(`Filtered to ${activeCompetitions.length} competitions with current or future events`);

    // Group competitions by category key (mens, womens, midweek, juniors)
    const categorized = categorizeCompetitions(activeCompetitions);
    const categories = {};
    if (categorized.mens.length > 0) categories.mens = categorized.mens;
    if (categorized.womens.length > 0) categories.womens = categorized.womens;
    if (categorized.midweek.length > 0) categories.midweek = categorized.midweek;
    if (categorized.juniors.length > 0) categories.juniors = categorized.juniors;

    logInfo(`Found competitions by category:`);
    Object.keys(categories).forEach(category => {
        console.log(`  - ${category}: ${categories[category].length}`);
    });

    // Ensure output directory exists
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    // Generate desktop markdown
    logInfo('Generating index markdown...');
    const indexMarkdown = await generateIndexMarkdown(categories, activeCompetitions);
    await fs.writeFile(OUTPUT_FILE, indexMarkdown, 'utf8');
    logSuccess(`Index documentation generated: ${OUTPUT_FILE}`);

    // Generate mobile-friendly markdown
    logInfo('Generating mobile-friendly markdown...');
    const mobileMarkdown = await generateMobileMarkdown(categories, activeCompetitions);
    await fs.writeFile(OUTPUT_FILE_MOBILE, mobileMarkdown, 'utf8');
    logSuccess(`Mobile documentation generated: ${OUTPUT_FILE_MOBILE}`);

    logInfo(`Total active competitions documented: ${activeCompetitions.length}`);
}

function showHelp() {
    console.log(`
📖 Competition Documentation Generator

Generates markdown documentation for competitions with Google Calendar links

Usage:
  npm run generate-docs [-- options]

Options:
  --help, -h       Show this help message

Examples:
  npm run generate-docs                    # Generate competition documentation
  npm run generate-docs -- --help         # Show this help

Process:
  1. Reads competition data from ${COMPETITIONS_FILE}
  2. Categorizes competitions by type (Men's, Women's, Midweek, Juniors)
  3. Generates markdown documentation with Google Calendar links
  4. Saves output to ${OUTPUT_FILE} and ${OUTPUT_FILE_MOBILE}

Requirements:
  • ${COMPETITIONS_FILE} must exist (run npm run scrape-competitions first)
  • Google Calendars should be created (run npm run create-calendars)

Output Format:
  • Organized by competition category
  • Desktop: table format with competition names and calendar subscribe links
  • Mobile: card-style layout with collapsible subscribe instructions
  • Competitions sorted by weight (Premier League > Pennant > Metro)
`);
}

function parseArguments() {
    const args = process.argv.slice(2);
    const options = { help: false };
    for (const arg of args) {
        if (arg === '--help' || arg === '-h') options.help = true;
    }
    return options;
}

async function main() {
    const options = parseArguments();
    if (options.help) {
        showHelp();
        return;
    }
    await generateDocs();
}

// Run if called directly
if (process.argv[1] === __filename) {
    await withErrorHandling(main, 'generate-docs')();
}

export { generateDocs, categorizeCompetitions };
