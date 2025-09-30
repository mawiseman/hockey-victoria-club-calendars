import fs from 'fs/promises';
import path from 'path';
import ical from 'ical';
import {
    loadConfig,
    replaceClubNames,
    replaceCompetitionNames,
    replaceRoundNames
} from '../tasks/calendar-processor.js';

/**
 * Test name processing
 */
async function testNameProcessing() {
    console.log('🧪 Testing name processing...\n');

    // Load config
    const config = await loadConfig();

    // Get all ICS files from downloads folder
    const downloadsDir = 'temp/downloads';
    const files = await fs.readdir(downloadsDir);
    const icsFiles = files.filter(f => f.endsWith('.ics'));

    console.log(`Found ${icsFiles.length} ICS files\n`);

    // Prepare CSV data
    const csvRows = [
        ['Filename', 'Original Summary', 'Processed Summary']
    ];

    // Process each file
    for (const file of icsFiles) {
        const filePath = path.join(downloadsDir, file);

        try {
            // Read and parse ICS file
            const icalData = await fs.readFile(filePath, 'utf8');
            const parsedCal = ical.parseICS(icalData);

            // Find first event with a summary
            let originalSummary = null;
            for (const key in parsedCal) {
                const event = parsedCal[key];
                if (event.type === 'VEVENT' && event.summary) {
                    originalSummary = event.summary;
                    break;
                }
            }

            if (originalSummary) {
                // Process the summary
                let processedSummary = originalSummary;
                processedSummary = replaceClubNames(processedSummary, config.clubMappings);
                processedSummary = replaceCompetitionNames(processedSummary, config.competitionNames.competitionReplacements);
                processedSummary = replaceRoundNames(processedSummary, config.competitionNames.roundPatterns);

                // Add to CSV rows
                csvRows.push([
                    file,
                    `"${originalSummary}"`,
                    `"${processedSummary}"`
                ]);

                console.log(`✓ ${file}`);
                console.log(`  Original: ${originalSummary}`);
                console.log(`  Processed: ${processedSummary}\n`);
            } else {
                console.log(`⚠ ${file} - No events found\n`);
            }
        } catch (error) {
            console.error(`❌ Error processing ${file}: ${error.message}\n`);
        }
    }

    // Write CSV file
    const csvContent = csvRows.map(row => row.join(',')).join('\n');
    const csvPath = 'temp/test-calendar-summary-processing.csv';
    await fs.writeFile(csvPath, csvContent, 'utf8');

    console.log(`\n✅ CSV saved to: ${csvPath}`);
    console.log(`   Total files processed: ${csvRows.length - 1}`);
}

// Run the test
testNameProcessing().catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
});