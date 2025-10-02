import fs from 'fs/promises';
import path from 'path';
import ical from 'ical';
import yaml from 'yaml';
import {
    loadConfig,
    replaceClubNames,
    replaceCompetitionNames,
    replaceRoundNames,
    addGenderPrefix
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

    // Path for YAML file
    const yamlPath = 'temp/test-calendar-summary-processing.yaml';

    // Load existing YAML data if it exists
    let existingData = [];
    try {
        const existingContent = await fs.readFile(yamlPath, 'utf8');
        existingData = yaml.parse(existingContent) || [];
    } catch (error) {
        // File doesn't exist yet, start fresh
    }

    // Create a map of existing entries by filename for preservation of Target Summary
    const existingMap = new Map(
        existingData.map(entry => {
            const filename = Object.keys(entry)[0];
            return [filename, entry];
        })
    );

    // Prepare YAML data
    const yamlData = [];

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
                // Remove line breaks from original summary
                const cleanedOriginal = originalSummary.replace(/\s+/g, ' ').trim();

                // Process the summary
                let processedSummary = cleanedOriginal;
                processedSummary = replaceClubNames(processedSummary, config.clubMappings);
                processedSummary = replaceCompetitionNames(processedSummary, config.competitionNames.competitionReplacements);
                processedSummary = replaceRoundNames(processedSummary, config.competitionNames.roundPatterns);
                processedSummary = addGenderPrefix(processedSummary, cleanedOriginal);

                // Add to YAML data, preserving existing Target Summary if present
                const existingEntry = existingMap.get(file);
                yamlData.push({
                    [file]: {
                        'Original Summary': cleanedOriginal,
                        'Processed Summary': processedSummary,
                        'Target Summary': existingEntry && existingEntry[file] ? existingEntry[file]['Target Summary'] : ''
                    }
                });

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

    // Write YAML file with options to prevent line wrapping
    const yamlContent = yaml.stringify(yamlData, {
        lineWidth: 0
    });
    await fs.writeFile(yamlPath, yamlContent, 'utf8');

    console.log(`\n✅ YAML saved to: ${yamlPath}`);
    console.log(`   Total files processed: ${yamlData.length}`);
}

// Run the test
testNameProcessing().catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
});