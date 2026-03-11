/**
 * Generate GitHub-style adjective-noun combinations for worktree names
 */

const adjectives = [
    'clever', 'happy', 'swift', 'bright', 'calm',
    'bold', 'quiet', 'brave', 'wise', 'eager',
    'gentle', 'quick', 'sharp', 'smooth', 'fresh'
];

const nouns = [
    'ocean', 'forest', 'cloud', 'star', 'river',
    'mountain', 'valley', 'bridge', 'beacon', 'harbor',
    'garden', 'meadow', 'canyon', 'island', 'desert'
];

function randomChoice<T>(array: T[]): T {
    return array[Math.floor(Math.random() * array.length)];
}

export function generateWorktreeName(issueNumber?: number): string {
    const adjective = randomChoice(adjectives);
    const noun = randomChoice(nouns);
    const base = `${adjective}-${noun}`;
    return issueNumber != null ? `issue-${issueNumber}-${base}` : base;
}