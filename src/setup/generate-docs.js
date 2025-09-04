import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Import shared utilities
import { loadCompetitionData, categorizeCompetitions } from '../lib/competition-utils.js';
import { OUTPUT_DIR, COMPETITIONS_FILE, getSettings } from '../lib/config.js';
import { withErrorHandling, logSuccess, logInfo } from '../lib/error-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'competitions.md');

/**
 * Build combined calendar URL with club calendar first and category-specific colors
 */
async function buildCombinedCalendarUrl(competitions, category = null) {
    const competitionsWithCalendars = competitions.filter(comp => 
        comp.googleCalendar && comp.googleCalendar.calendarId
    );
    
    if (competitionsWithCalendars.length === 0) {
        return null;
    }
    
    // Define colors for each category
    const categoryColors = {
        'mens': '%23285F9B',        // Royal blue
        'womens': '%23D50000',      // Red
        'midweek': '%23008000',     // Green
        'juniors': '%23FF8C00'      // Orange
    };
    
    let calendarSources = '';
    let colorParams = '';
    let calendarIndex = 0;
    
    // Try to get club calendar from settings and add it first
    try {
        const settings = await getSettings();
        if (settings.clubCalendar && settings.clubCalendar.calendarId) {
            calendarSources += `&src=${encodeURIComponent(settings.clubCalendar.calendarId)}`;
            // Club calendar gets a neutral color (grey)
            colorParams += `&color=%23616161`;
            calendarIndex++;
        }
    } catch (error) {
        // Continue without club calendar if settings can't be loaded
    }
    
    // Add individual competition calendars with category-specific colors
    const categoryColor = category ? categoryColors[category] : null;
    
    competitionsWithCalendars.forEach(comp => {
        calendarSources += `&src=${encodeURIComponent(comp.googleCalendar.calendarId)}`;
        
        // Add color parameter if we have a category color
        if (categoryColor) {
            colorParams += `&color=${categoryColor}`;
        }
    });
    
    return `https://calendar.google.com/calendar/embed?height=600&wkst=2&ctz=Australia%2FMelbourne&showPrint=0&showTz=0${calendarSources}${colorParams}`;
}

/**
 * Build combined calendar URL with mixed colors for all categories
 */
async function buildCombinedCalendarUrlWithMixedColors(categories) {
    // Define colors for each category
    const categoryColors = {
        'mens': '%23285F9B',        // Royal blue
        'womens': '%23D50000',      // Red
        'midweek': '%23008000',     // Green
        'juniors': '%23FF8C00'      // Orange
    };
    
    let calendarSources = '';
    let colorParams = '';
    
    // Try to get club calendar from settings and add it first
    try {
        const settings = await getSettings();
        if (settings.clubCalendar && settings.clubCalendar.calendarId) {
            calendarSources += `&src=${encodeURIComponent(settings.clubCalendar.calendarId)}`;
            // Club calendar gets a neutral color (grey)
            colorParams += `&color=%23616161`;
        }
    } catch (error) {
        // Continue without club calendar if settings can't be loaded
    }
    
    // Add competitions from each category with their respective colors
    const categoryMappings = [
        { competitions: categories.mens, color: categoryColors.mens },
        { competitions: categories.womens, color: categoryColors.womens },
        { competitions: categories.midweek, color: categoryColors.midweek },
        { competitions: categories.juniors, color: categoryColors.juniors }
    ];
    
    let hasCalendars = false;
    
    categoryMappings.forEach(({ competitions, color }) => {
        competitions.forEach(comp => {
            if (comp.googleCalendar && comp.googleCalendar.calendarId) {
                calendarSources += `&src=${encodeURIComponent(comp.googleCalendar.calendarId)}`;
                colorParams += `&color=${color}`;
                hasCalendars = true;
            }
        });
    });
    
    if (!hasCalendars) {
        return null;
    }
    
    return `https://calendar.google.com/calendar/embed?height=600&wkst=2&ctz=Australia%2FMelbourne&showPrint=0&showTz=0${calendarSources}${colorParams}`;
}

/**
 * Generate index markdown content with all calendars
 */
async function generateIndexMarkdown(competitionsData, categories) {
    const { clubName, totalCompetitions, lastUpdated } = competitionsData;
    
    let markdown = `# ${clubName} - Competition Calendars\n\n`;
    markdown += `**Total Competitions:** ${totalCompetitions}  \n`;
    markdown += `**Last Updated:** ${new Date(lastUpdated).toLocaleString()}  \n\n`;
    markdown += `---\n\n`;
    
    // Get all competitions with calendars for combined view
    const allCompetitions = [
        ...categories.mens,
        ...categories.womens, 
        ...categories.midweek,
        ...categories.juniors
    ];
    
    const competitionsWithCalendars = allCompetitions.filter(comp => 
        comp.googleCalendar && comp.googleCalendar.calendarId
    );
    
    // Combined calendar view of ALL competitions
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
    if (categories.mens.length > 0) {
        markdown += `## Men's Competitions\n\n`;
        markdown += await formatCompetitionTable(categories.mens, "Men's");
        markdown += `\n`;
    }
    
    if (categories.womens.length > 0) {
        markdown += `## Women's Competitions\n\n`;
        markdown += await formatCompetitionTable(categories.womens, "Women's");
        markdown += `\n`;
    }
    
    if (categories.midweek.length > 0) {
        markdown += `## Midweek Competitions\n\n`;
        markdown += await formatCompetitionTable(categories.midweek, "Midweek");
        markdown += `\n`;
    }
    
    if (categories.juniors.length > 0) {
        markdown += `## Junior Competitions\n\n`;
        markdown += await formatCompetitionTable(categories.juniors, "Junior");
        markdown += `\n`;
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
async function formatCompetitionTable(competitions, categoryName) {
    // Filter competitions with calendars for combined link
    const competitionsWithCalendars = competitions.filter(comp => 
        comp.googleCalendar && comp.googleCalendar.calendarId
    );
    
    let content = '';
    
    // Add combined calendar link if there are competitions with calendars
    if (competitionsWithCalendars.length > 0) {
        // Determine category key for color coding
        const categoryKey = categoryName.toLowerCase().includes("men's") ? 'mens' :
                           categoryName.toLowerCase().includes("women's") ? 'womens' :
                           categoryName.toLowerCase().includes('midweek') ? 'midweek' :
                           categoryName.toLowerCase().includes('junior') ? 'juniors' : null;
        
        const combinedCalendarUrl = await buildCombinedCalendarUrl(competitions, categoryKey);
        
        if (combinedCalendarUrl) {
            content += `📅 **<a href="${combinedCalendarUrl}" target="_blank">View Combined ${categoryName} Calendar</a>**\n\n`;
            content += `*Opens Google Calendar with all ${competitionsWithCalendars.length} ${categoryName.toLowerCase()} competition calendars in one view.*\n\n`;
        }
    }
    
    // Add individual competitions table
    let table = `| Competition |  Google Calendar | iCal Subscribe |\n`;
    table += `|-------------|----------|----------------|\n`;
    
    for (const competition of competitions) {
        const name = competition.name;
        
        // Google Calendar columns
        let webViewCol;
        let icalCol;
        if (competition.googleCalendar) {
            if (competition.googleCalendar.publicUrl) {
                webViewCol = `<a href="${competition.googleCalendar.publicUrl}" target="_blank">📅 View</a>`;
            } else {
                webViewCol = `*Not available*`;
            }
            
            if (competition.googleCalendar.icalUrl) {
                icalCol = `<a href="${competition.googleCalendar.icalUrl}" target="_blank">📲 Subscribe</a>`;
            } else {
                icalCol = `*Not available*`;
            }
        } else {
            webViewCol = `*Not configured*`;
            icalCol = `*Not configured*`;
        }
        
        table += `| ${name} | ${webViewCol} | ${icalCol} |\n`;
    }
    
    content += table + `\n`;
    return content;
}


/**
 * Main function to generate documentation
 */
async function generateDocs() {
    logInfo('Starting documentation generation...');
    
    // Load competition data
    const competitionsData = await loadCompetitionData();
    
    logInfo(`Loaded ${competitionsData.competitions.length} competitions from ${COMPETITIONS_FILE}`);
    
    // Categorize competitions
    const categories = categorizeCompetitions(competitionsData.competitions);
    
    // Print category summary
    logInfo(`Found competitions:`);
    console.log(`  - Men's: ${categories.mens.length}`);
    console.log(`  - Women's: ${categories.womens.length}`);
    console.log(`  - Midweek: ${categories.midweek.length}`);
    console.log(`  - Juniors: ${categories.juniors.length}`);
    
    // Generate index markdown
    logInfo('Generating index markdown...');
    const indexMarkdown = await generateIndexMarkdown(competitionsData, categories);
    
    // Ensure output directory exists
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    
    // Write index markdown file
    await fs.writeFile(OUTPUT_FILE, indexMarkdown, 'utf8');
    logSuccess(`Index documentation generated: ${OUTPUT_FILE}`);
    
    
    logInfo(`Total competitions documented: ${competitionsData.totalCompetitions}`);
}

/**
 * Show help information
 */
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
  4. Saves output to ${OUTPUT_FILE}

Requirements:
  • ${COMPETITIONS_FILE} must exist (run npm run scrape-competitions first)
  • Google Calendars should be created (run npm run create-calendars)

Output Format:
  • Organized by competition category
  • Table format with competition names and calendar subscribe links
  • Competitions maintain order from JSON file
`);
}

/**
 * Parse command line arguments
 */
function parseArguments() {
    const args = process.argv.slice(2);
    const options = {
        help: false
    };
    
    for (const arg of args) {
        if (arg === '--help' || arg === '-h') {
            options.help = true;
        }
    }
    
    return options;
}

/**
 * Main execution
 */
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