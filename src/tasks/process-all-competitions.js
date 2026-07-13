import fs from 'fs/promises';
import readline from 'readline';
import { spawn } from 'child_process';
import { processFixtures } from './fixture-processor.js';

// Import shared utilities
import { loadCompetitionData } from '../lib/competition-utils.js';
import { logInfo } from '../lib/error-utils.js';
import { TEMP_DIR } from '../lib/config.js';

// The full-pipeline steps that run after download/process/upload when --full is
// passed. Mirrors the sync-calendars workflow: refresh active status, scrape
// scores + ladders (tolerant — partial data ships rather than blocking), then
// regenerate the published JSON + docs (strict — a failure here aborts the
// rest). Each runs as its own `node` process so its top-level main()/exit
// stays isolated from this orchestrator.
const PIPELINE_STEPS = [
    { label: 'Update competition status', script: 'src/setup/update-competition-status.js', tolerant: true },
    { label: 'Scrape scores', script: 'src/tasks/score-scraper.js', tolerant: true },
    { label: 'Scrape ladders', script: 'src/tasks/ladder-scraper.js', tolerant: true },
    { label: 'Generate fixtures.json', script: 'src/setup/generate-fixtures-json.js', tolerant: false },
    { label: 'Generate season.json', script: 'src/setup/generate-season-json.js', tolerant: false },
    { label: 'Generate docs', script: 'src/setup/generate-docs.js', tolerant: false },
];

// Run one pipeline script as a child process, streaming its output. Resolves to
// true on exit code 0, false otherwise (including a spawn error).
function runScript(scriptPath, label) {
    return new Promise((resolve) => {
        console.log(`\n▶️  ${label}...`);
        const child = spawn(process.execPath, [scriptPath], { stdio: 'inherit' });
        child.on('close', (code) => resolve(code === 0));
        child.on('error', (err) => {
            console.error(`❌ Failed to launch ${label}: ${err.message}`);
            resolve(false);
        });
    });
}

// Run the post-processing pipeline in order. Tolerant steps warn-and-continue;
// a strict step failing aborts the remainder. Returns true if every strict step
// succeeded.
async function runPipeline() {
    console.log('\n========================================');
    console.log('Running full pipeline (status, scores, ladders, generate)');
    console.log('========================================');

    for (const step of PIPELINE_STEPS) {
        const ok = await runScript(step.script, step.label);
        if (ok) continue;
        if (step.tolerant) {
            console.warn(`⚠️  ${step.label} failed — continuing (partial data is acceptable).`);
        } else {
            console.error(`❌ ${step.label} failed — aborting remaining pipeline steps.`);
            return false;
        }
    }
    return true;
}

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
        full: false,
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
        } else if (arg === '--full') {
            // --all plus the downstream pipeline (status, scores, ladders,
            // generate) — the whole daily sync in one command.
            options.steps = ['download', 'process', 'upload'];
            options.all = true;
            options.full = true;
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
  --all             Run the calendar steps (download, process, upload)
  --full            Run the entire daily sync: --all, then update status,
                    scrape scores + ladders, and regenerate fixtures.json /
                    season.json / docs
  --steps <steps>   Comma-separated list of steps to run
                    Available: download, process, upload
  --use-cache      Use cached results from previous runs
  --help, -h       Show this help message

Examples:
  npm run process-all-competitions                                # Interactive mode (default)
  npm run process-all-competitions -- --all                      # Calendar steps only
  npm run process-all-competitions -- --full                     # Whole pipeline in one command
  npm run process-all-competitions -- --steps download           # Download fixtures only
  npm run process-all-competitions -- --steps process            # Process fixtures only
  npm run process-all-competitions -- --steps upload             # Upload to Google Calendar only
  npm run process-all-competitions -- --steps download,process   # Download and process only
  npm run process-all-competitions -- --steps process --use-cache # Use cached download results

Modes:
  • No arguments: Interactive menu to choose steps
  • --all: Run the download/process/upload steps automatically
  • --full: Run --all plus the downstream scrape + generate pipeline
  • --steps: Run specific steps

--full pipeline order (mirrors the sync-calendars workflow):
  download → process → upload → update-competition-status →
  scrape-scores → scrape-ladders → generate-fixtures-json →
  generate-season-json → generate-docs
The scrape steps are tolerant (partial data is fine); a failed generate
step aborts the rest and exits non-zero.

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
    console.log('4. All (download, process, upload)');
    console.log('5. Full sync (all + scores, ladders, generate)');
    console.log('6. Exit');
    console.log('');

    return new Promise((resolve) => {
        rl.question('Enter your choice (1-6): ', (answer) => {
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
                    resolve({ steps: ['download', 'process', 'upload'], interactive: true });
                    break;
                case 5:
                    // Full pipeline — same as the --full flag.
                    resolve({ steps: ['download', 'process', 'upload'], full: true, interactive: true });
                    break;
                case 6:
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
            full: interactiveResult.full || false,
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

        // Filter to only active competitions
        const competitions = allCompetitions.filter(comp => comp.isActive !== false);
        logInfo(`Filtered to ${competitions.length} active competitions (${allCompetitions.length} total)`);
        
        // Create temp directory
        await fs.mkdir(TEMP_DIR, { recursive: true });
        
        // Process all competitions
        const result = await processFixtures(competitions, options);
        let hadErrors = !!(result && result.hasErrors);

        // With --full, chain the rest of the daily sync. Skipped when core
        // processing errored — matching the workflow, where the generate steps
        // are guarded by `if: success()` on the process step.
        if (options.full) {
            if (hadErrors) {
                console.error('\n❌ Skipping pipeline steps — core processing had errors.');
            } else if (!await runPipeline()) {
                hadErrors = true;
            }
        }

        console.log('\n========================================');
        console.log(`Completed at: ${new Date().toISOString()}`);
        console.log('========================================');

        // Exit with error code if there were failures
        if (hadErrors) {
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