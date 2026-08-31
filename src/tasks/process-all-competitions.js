import fs from 'fs/promises';
import readline from 'readline';
import { processFixtures } from './fixture-processor.js';

// Import shared utilities
import { loadCompetitionData } from '../lib/competition-utils.js';
import { logInfo } from '../lib/error-utils.js';
import { TEMP_DIR } from '../lib/config.js';

/**
 * Parse command line arguments
 */
function parseArguments() {
    const args = process.argv.slice(2);
    const options = {
        steps: null, // null means interactive mode
        useCache: false,
        help: false,
        all: false,
        interactive: true
    };
    
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        
        if (arg === '--steps' && i + 1 < args.length) {
            options.steps = args[i + 1].split(',').map(s => s.trim());
            options.interactive = false;
            i++; // Skip next argument
        } else if (arg === '--all') {
            options.steps = ['download', 'process', 'upload'];
            options.all = true;
            options.interactive = false;
        } else if (arg === '--use-cache') {
            options.useCache = true;
        } else if (arg === '--help' || arg === '-h') {
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
📖 Hockey Victoria Fixture Processor Usage:

npm run process-fixture [-- options]

Options:
  --all             Run all steps (download, process, upload)
  --steps <steps>   Comma-separated list of steps to run
                    Available: download, process, upload
  --use-cache      Use cached results from previous runs
  --help, -h       Show this help message

Examples:
  npm run process-all-competitions                                # Interactive mode (default)
  npm run process-all-competitions -- --all                      # Run all steps
  npm run process-all-competitions -- --steps download           # Download fixtures only
  npm run process-all-competitions -- --steps process            # Process fixtures only  
  npm run process-all-competitions -- --steps upload             # Upload to Google Calendar only
  npm run process-all-competitions -- --steps download,process   # Download and process only
  npm run process-all-competitions -- --all                      # Re-run all steps (default)
  npm run process-all-competitions -- --steps process --use-cache # Use cached download results

Modes:
  • No arguments: Interactive menu to choose steps
  • --all: Run all steps automatically
  • --steps: Run specific steps

Step Dependencies:
  • download: No dependencies (reads competition data)
  • process: Requires download results (or will re-download)
  • upload: Requires process results (or will re-download & process)

By default, all steps are re-run from scratch.
Use --use-cache to reuse results from previous runs.
`);
}

/**
 * Interactive step selection
 */
async function selectStepsInteractively() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    console.log('\n🎯 Hockey Victoria Fixture Processor');
    console.log('=====================================');
    console.log('');
    console.log('What would you like to do?');
    console.log('');
    console.log('1. Download Fixtures');
    console.log('2. Process Fixtures');
    console.log('3. Upload Fixtures');
    console.log('4. Exit');
    console.log('');
    
    return new Promise((resolve) => {
        rl.question('Enter your choice (1-4): ', (answer) => {
            rl.close();
            
            const choice = parseInt(answer);
            
            switch (choice) {
                case 1:
                    resolve({ steps: ['download'], interactive: true });
                    break;
                case 2:
                    resolve({ steps: ['process'], interactive: true });
                    break;
                case 3:
                    resolve({ steps: ['upload'], interactive: true });
                    break;
                case 4:
                    console.log('👋 Goodbye!');
                    process.exit(0);
                    break;
                default:
                    console.log('❌ Invalid choice. Please try again.');
                    resolve(selectStepsInteractively());
            }
        });
    });
}

/**
 * Main orchestration function
 */
async function main() {
    console.log('========================================');
    console.log('Hockey Victoria Fixture Processor');
    console.log(`Started at: ${new Date().toISOString()}`);
    console.log('========================================\n');
    
    // Parse command line arguments
    let options = parseArguments();
    
    if (options.help) {
        showHelp();
        return;
    }
    
    // Handle interactive mode
    if (options.interactive) {
        const interactiveResult = await selectStepsInteractively();
        
        // Merge interactive selection with parsed options
        options = {
            ...options,
            steps: interactiveResult.steps,
            interactive: false
        };
    }
    
    // Validate steps
    const validSteps = ['download', 'process', 'upload'];
    const invalidSteps = options.steps ? options.steps.filter(step => !validSteps.includes(step)) : [];
    
    if (invalidSteps.length > 0) {
        console.error(`❌ Invalid steps: ${invalidSteps.join(', ')}`);
        console.error(`Valid steps: ${validSteps.join(', ')}`);
        process.exit(1);
    }
    
    console.log(`🎯 Running steps: ${options.steps.join(', ')}`);
    if (options.force) {
        console.log('🔄 Force mode: Ignoring cached results');
    }
    console.log('');
    
    try {
        // Load competition data
        logInfo('Loading competitions from config/competitions.json...');
        const competitionData = await loadCompetitionData();
        const allCompetitions = competitionData.competitions;

        // Not filtered on isActive: temp/ doesn't persist between CI runs, so
        // skipping an inactive competition here means generate-season-json.js
        // never gets a processed ICS for it and the team's fixture history
        // disappears from season.json entirely, even though nothing else
        // deletes that history short of the interactive
        // cleanup-inactive-competitions.js. Keep reprocessing every
        // configured competition until it's actually removed.
        const competitions = allCompetitions.filter(comp => comp.fixtureUrl);
        logInfo(`Processing ${competitions.length} competitions (${allCompetitions.length} total)`);
        
        // Create temp directory
        await fs.mkdir(TEMP_DIR, { recursive: true });
        
        // Process all competitions
        const result = await processFixtures(competitions, options);

        console.log('\n========================================');
        console.log(`Completed at: ${new Date().toISOString()}`);
        console.log('========================================');

        // Exit with error code if there were failures
        if (result && result.hasErrors) {
            console.error('\n❌ Process completed with errors. See details above.');
            process.exit(1);
        }

    } catch (error) {
        console.error('\n❌ Fatal error:', error);
        process.exit(1);
    }
}

// Run the main function
main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
});