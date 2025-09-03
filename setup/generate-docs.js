import fs from 'fs/promises';
import path from 'path';

const COMPETITIONS_FILE = 'config/competitions.json';
const OUTPUT_DIR = 'docs';
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'competitions.md');

/**
 * Load competition data
 */
async function loadCompetitionData() {
    try {
        const data = await fs.readFile(COMPETITIONS_FILE, 'utf8');
        const competitionsData = JSON.parse(data);
        
        if (!competitionsData.competitions || !Array.isArray(competitionsData.competitions)) {
            throw new Error('Invalid competition data format - missing competitions array');
        }
        
        return competitionsData;
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw new Error(`Competition file not found: ${COMPETITIONS_FILE}`);
        }
        throw error;
    }
}

/**
 * Categorize competitions
 */
function categorizeCompetitions(competitions) {
    const categories = {
        mens: [],
        womens: [],
        midweek: [],
        juniors: []
    };
    
    for (const competition of competitions) {
        const name = competition.name.toLowerCase();
        
        if (name.includes('midweek')) {
            categories.midweek.push(competition);
        } else if (name.includes('u12') || name.includes('u14') || name.includes('u16') || name.includes('u18')) {
            categories.juniors.push(competition);
        } else if (name.includes("women's") || name.includes('women ')) {
            categories.womens.push(competition);
        } else if (name.includes("men's") || name.includes('men ')) {
            categories.mens.push(competition);
        } else {
            // Default to appropriate category based on context
            if (name.includes('mixed')) {
                categories.juniors.push(competition);
            } else {
                // Add to a general category or skip
                console.warn(`Could not categorize competition: ${competition.name}`);
            }
        }
    }
    
    // Keep original order from JSON file (remove alphabetical sorting)
    
    return categories;
}

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
    let table = `| Competition | Google Calendar |\n`;
    table += `|-------------|----------------|\n`;
    
    for (const competition of competitions) {
        const name = competition.name;
        
        // Google Calendar column
        let calendarCol;
        if (competition.googleCalendar && competition.googleCalendar.publicUrl) {
            calendarCol = `[📅 Subscribe](${competition.googleCalendar.publicUrl})`;
        } else {
            calendarCol = `*Not configured*`;
        }
        
        table += `| ${name} | ${calendarCol} |\n`;
    }
    
    table += `\n`;
    return table;
}

/**
 * Main execution
 */
async function generateDocs() {
    try {
        console.log('🔍 Loading competition data...');
        const competitionsData = await loadCompetitionData();
        
        console.log('📂 Categorizing competitions...');
        const categories = categorizeCompetitions(competitionsData.competitions);
        
        // Print category summary
        console.log(`📊 Found competitions:`);
        console.log(`  - Men's: ${categories.mens.length}`);
        console.log(`  - Women's: ${categories.womens.length}`);
        console.log(`  - Midweek: ${categories.midweek.length}`);
        console.log(`  - Juniors: ${categories.juniors.length}`);
        
        console.log('📝 Generating markdown...');
        const markdown = generateMarkdown(competitionsData, categories);
        
        // Ensure output directory exists
        await fs.mkdir(OUTPUT_DIR, { recursive: true });
        
        // Write markdown file
        await fs.writeFile(OUTPUT_FILE, markdown, 'utf8');
        
        console.log(`✅ Documentation generated: ${OUTPUT_FILE}`);
        console.log(`📖 Total competitions documented: ${competitionsData.totalCompetitions}`);
        
    } catch (error) {
        console.error('❌ Error generating documentation:', error.message);
        process.exit(1);
    }
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
 * Display help information
 */
function showHelp() {
    console.log(`
📖 Competition Documentation Generator

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
`);
}

/**
 * Main function
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
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

if (process.argv[1] === __filename) {
    main();
}

export { generateDocs, categorizeCompetitions };