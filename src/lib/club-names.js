// Club name → short name ("Altona Hockey Club 2" → "ALT 2").
//
// config/mappings-club-names.json lists each club once, with every spelling
// Hockey Victoria uses for it, plus exact overrides for the few names the rule
// can't produce:
//   { "clubs": { "ALT": ["Altona"], ... }, "overrides": { "SUHC - Mentone": "SUHC - MNT" } }
//
// Rule: ignore "Hockey Club"/"Hockey" etc. and case, take the longest club
// name the team name starts with, then append its team suffix: a number is
// kept ("2" → "ALT 2"); words win over a number and become their initials
// ("WHITE" → "BRU W", "1 - Black" → "ESS B", "1 - Red Dragons" → "ESS RD").
// The first word of the result is the logo file name.

import fs from 'fs/promises';
import { MAPPINGS_CLUB_FILE } from './config.js';

// HV adds these inconsistently ("Altona" vs "Altona Hockey Club").
const NOISE = /\b(?:hockey club|hockey section|hockey association|hockey)\b/gi;

export function normaliseClubName(name) {
    return name.replace(NOISE, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function buildClubMatcher({ clubs = {}, overrides = {} }) {
    const aliases = Object.entries(clubs)
        .flatMap(([abbr, names]) => names.map(n => [normaliseClubName(n), abbr]))
        .sort(([a], [b]) => b.length - a.length);
    const exact = new Map(Object.entries(overrides).map(([n, abbr]) => [normaliseClubName(n), abbr]));
    const knownAbbrs = new Set([...Object.keys(clubs), ...exact.values()]);
    return { aliases, exact, knownAbbrs };
}

// One club per line, sorted, so the file stays scannable and diffs stay small.
export function stringifyClubMappings({ clubs, overrides = {} }) {
    const lines = (obj, fmt) => Object.entries(obj)
        .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
        .map(([k, v]) => `    ${JSON.stringify(k)}: ${fmt(v)}`)
        .join(',\n');
    const list = names => JSON.stringify([...names].sort()).replace(/","/g, '", "');
    return `{\n  "clubs": {\n${lines(clubs, list)}\n  },\n  "overrides": {\n${lines(overrides, JSON.stringify)}\n  }\n}\n`;
}

export async function loadClubMatcher(file = MAPPINGS_CLUB_FILE) {
    return buildClubMatcher(JSON.parse(await fs.readFile(file, 'utf8')));
}

// Returns the short name, or null when no club matches.
export function abbreviateClub(name, { aliases, exact }) {
    const n = normaliseClubName(name);
    if (exact.has(n)) return exact.get(n);
    for (const [alias, abbr] of aliases) {
        if (n === alias) return abbr;
        if (!n.startsWith(alias + ' ')) continue;
        const tokens = n.slice(alias.length).split(/[\s-]+/).filter(Boolean);
        if (tokens.length === 0) return abbr;
        const words = tokens.filter(t => /^[a-z]+$/.test(t));
        return `${abbr} ${words.length ? words.map(w => w[0].toUpperCase()).join('') : tokens[0]}`;
    }
    return null;
}
