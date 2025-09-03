import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Import shared utilities
import { loadCompetitionData, categorizeCompetitions } from '../lib/competition-utils.js';
import { OUTPUT_DIR, COMPETITIONS_FILE } from '../lib/config.js';
import { withErrorHandling, logSuccess, logInfo } from '../lib/error-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'competitions.md');

/**
 * Generate markdown content
 */
function generateMarkdown(competitionsData, categories) {
    const { clubName, totalCompetitions, lastUpdated } = competitionsData;
    
    let markdown = `# ${clubName} - Competition Calendars\n\n`;
    markdown += `**Total Competitions:** ${totalCompetitions}  \n`;
    markdown += `**Last Updated:** ${new Date(lastUpdated).toLocaleString()}  \n\n`;
    markdown += `---\n\n`;
    
    // Men's Competitions
    if (categories.mens.length > 0) {
        markdown += `## Men's Competitions\n\n`;
        markdown += formatCompetitionTable(categories.mens);
        markdown += `\n`;
    }
    
    // Women's Competitions
    if (categories.womens.length > 0) {
        markdown += `## Women's Competitions\n\n`;
        markdown += formatCompetitionTable(categories.womens);
        markdown += `\n`;
    }
    
    // Midweek Competitions
    if (categories.midweek.length > 0) {
        markdown += `## Midweek Competitions\n\n`;
        markdown += formatCompetitionTable(categories.midweek);
        markdown += `\n`;
    }
    
    // Junior Competitions
    if (categories.juniors.length > 0) {
        markdown += `## Junior Competitions\n\n`;
        markdown += formatCompetitionTable(categories.juniors);
        markdown += `\n`;
    }
    
    // Footer
    markdown += `---\n\n`;
    markdown += `*This documentation is automatically generated from competitions.json*  \n`;
    markdown += `*To update calendars, run: \`npm run process-fixture\`*\n`;
    
    return markdown;
}

/**
 * Format competitions as a table
 */
function formatCompetitionTable(competitions) {
    let table = `| Competition | Google Calendar | iCal Subscribe |\n`;
    table += `|-------------|----------|----------------|\n`;
    
    for (const competition of competitions) {
        const name = competition.name;
        
        // Google Calendar columns
        let webViewCol;
        let icalCol;
        if (competition.googleCalendar) {
            if (competition.googleCalendar.publicUrl) {
                webViewCol = `[📅 View](${competition.googleCalendar.publicUrl})`;
            } else {
                webViewCol = `*Not available*`;
            }
            
            if (competition.googleCalendar.icalUrl) {
                icalCol = `[📲 Subscribe](${competition.googleCalendar.icalUrl})`;
            } else {
                icalCol = `*Not available*`;
            }
        } else {
            webViewCol = `*Not configured*`;
            icalCol = `*Not configured*`;
        }
        
        table += `| ${name} | ${webViewCol} | ${icalCol} |\n`;
    }
    
    table += `\n`;
    return table;
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
    
    // Generate markdown
    logInfo('Generating markdown...');
    const markdown = generateMarkdown(competitionsData, categories);
    
    // Ensure output directory exists
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    
    // Write markdown file
    await fs.writeFile(OUTPUT_FILE, markdown, 'utf8');
    
    logSuccess(`Documentation generated: ${OUTPUT_FILE}`);
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