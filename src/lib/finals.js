// Finals-round labels Hockey Victoria uses on fixture/event summaries, in
// playing order. Shared by calendar-processor.js (suppresses the "Current
// Round" link for finals) and generate-season-json.js (finals detection when
// building season.json events from the processed ICS calendars).
export const FINALS_LABELS = [
    'Qualifying Final',
    'Elimination Final',
    'Semi Final',
    'Preliminary Final',
    'Grand Final'
];

// Classify an event summary as a regular round or a finals round.
// Returns { round: number, finalsLabel: null } for "Round N" / "Rd N",
// { round: null, finalsLabel: string } for a recognised finals round, or
// { round: null, finalsLabel: null } if neither pattern matches.
export function parseRoundFromSummary(summary) {
    const roundMatch = summary.match(/\b(?:Round|Rd)\s+(\d+)/i);
    if (roundMatch) {
        return { round: parseInt(roundMatch[1], 10), finalsLabel: null };
    }

    const summaryLower = summary.toLowerCase();
    for (const label of FINALS_LABELS) {
        if (summaryLower.includes(label.toLowerCase())) {
            return { round: null, finalsLabel: label };
        }
    }

    return { round: null, finalsLabel: null };
}
