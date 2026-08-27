/**
 * duplicateDetectionService.js
 * ---------------------------------------------------------------------------
 * Wires the similarity engine (utils/similarity.js) into the Challenge
 * lifecycle:
 *
 *  1. findMatches(challenge)   -> compares a challenge against every other
 *                                 non-duplicate challenge in the system and
 *                                 returns a ranked list of { challenge, score }.
 *
 *  2. processNewChallenge(ch)  -> called right after a new report is created.
 *       - Runs findMatches().
 *       - If the best match's score >= AUTO_MERGE_THRESHOLD (95), the new
 *         report is automatically merged into that master problem:
 *           * new report gets isDuplicate = true, masterProblem = master._id
 *           * master gets isMasterProblem = true, duplicateCount += 1,
 *             votesCount += 1 (an extra citizen backing the same issue),
 *             and a note in its statusHistory.
 *       - Otherwise, every match scoring >= SUGGEST_THRESHOLD is stored on
 *         both reports' `similarProblems` array for admins to review and
 *         merge manually if they judge it appropriate.
 * ---------------------------------------------------------------------------
 */

const Challenge = require('../models/Challenge');
const {
  scoreChallenges,
  AUTO_MERGE_THRESHOLD,
  SUGGEST_THRESHOLD,
} = require('../utils/similarity');

/**
 * Compare `challenge` against all other eligible challenges (not itself,
 * not already a duplicate of something else) and return matches sorted by
 * score, descending.
 */
async function findMatches(challenge) {
  const candidates = await Challenge.find({
    _id: { $ne: challenge._id },
    isDuplicate: false, // never match against something that's already merged away
  }).select('title description location category createdBy votesCount duplicateCount isMasterProblem createdAt');

  const matches = candidates
    .map((candidate) => {
      const { score, breakdown } = scoreChallenges(challenge, candidate);
      return { challenge: candidate, score, breakdown };
    })
    .filter((m) => m.score >= SUGGEST_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  return matches;
}

/**
 * Run right after a new Challenge document has been created.
 * Returns { merged: boolean, master: Challenge|null, matches: [...] }
 */
async function processNewChallenge(newChallenge, reportingUserId) {
  const matches = await findMatches(newChallenge);

  if (matches.length === 0) {
    return { merged: false, master: null, matches: [] };
  }

  const best = matches[0];

  // ----- Auto-merge path (>= 95% similar) --------------------------------
  if (best.score >= AUTO_MERGE_THRESHOLD) {
    const master = best.challenge;

    newChallenge.isDuplicate = true;
    newChallenge.masterProblem = master._id;
    newChallenge.duplicateCount = 1;
    await newChallenge.save();

    master.isMasterProblem = true;
    master.duplicateCount = (master.duplicateCount || 1) + 1;
    master.votesCount = (master.votesCount || 0) + 1; // extra citizen backing the same issue
    master.statusHistory.push({
      status: master.status,
      changedBy: reportingUserId,
      changedAt: new Date(),
      note: `Merged a ${best.score}% similar duplicate report ("${newChallenge.title}") from another citizen into this problem.`,
    });
    await master.save();

    return { merged: true, master, matches };
  }

  // ----- Suggestion path (45-94% similar) --------------------------------
  // Store cross-references so admins can review and merge manually.
  const toStore = matches.slice(0, 5); // keep the top few, no need to hoard everything

  newChallenge.similarProblems = toStore.map((m) => ({
    challenge: m.challenge._id,
    score: m.score,
  }));
  await newChallenge.save();

  // Also let the existing challenges know a possible sibling appeared.
  await Promise.all(
    toStore.map((m) =>
      Challenge.findByIdAndUpdate(m.challenge._id, {
        $push: { similarProblems: { challenge: newChallenge._id, score: m.score } },
      })
    )
  );

  return { merged: false, master: null, matches };
}

/**
 * Manually merge `duplicateId` into `masterId` (used by the admin UI for
 * borderline matches the auto-merge threshold didn't catch).
 */
async function mergeChallenges(masterId, duplicateId, adminUserId) {
  if (String(masterId) === String(duplicateId)) {
    throw new Error('Cannot merge a problem into itself');
  }

  const [master, duplicate] = await Promise.all([
    Challenge.findById(masterId),
    Challenge.findById(duplicateId),
  ]);

  if (!master || !duplicate) {
    throw new Error('Master or duplicate challenge not found');
  }
  if (duplicate.isDuplicate) {
    throw new Error('This challenge has already been merged elsewhere');
  }

  duplicate.isDuplicate = true;
  duplicate.masterProblem = master._id;
  await duplicate.save();

  master.isMasterProblem = true;
  master.duplicateCount = (master.duplicateCount || 1) + (duplicate.duplicateCount || 1);
  master.votesCount = (master.votesCount || 0) + 1;
  master.statusHistory.push({
    status: master.status,
    changedBy: adminUserId,
    changedAt: new Date(),
    note: `Admin manually merged report "${duplicate.title}" into this master problem.`,
  });
  await master.save();

  return { master, duplicate };
}

module.exports = {
  findMatches,
  processNewChallenge,
  mergeChallenges,
};
