/**
 * similarity.js
 * ---------------------------------------------------------------------------
 * A lightweight, dependency-free "AI" text-similarity engine used to detect
 * repetitive / duplicate civic problem reports.
 *
 * Why not call an external ML API?
 *   - Reports are short (title + description + location), domain-specific,
 *     and need to score in real time on every submission.
 *   - A classic Information-Retrieval approach (TF-IDF cosine similarity)
 *     combined with character n-gram similarity for locations gives very
 *     strong results for this use case, runs instantly, and needs no API key
 *     or network call.
 *
 * The exported `scoreChallenges()` function returns a 0-100 similarity score
 * exactly like the spec requested:
 *   - 0   => completely unrelated problems
 *   - 100 => identical problem, same location
 *   - >= AUTO_MERGE_THRESHOLD (95) => caller should auto-merge into a master
 * ---------------------------------------------------------------------------
 */

// ----- Tunables --------------------------------------------------------
const AUTO_MERGE_THRESHOLD = 95; // >= this => auto-merge into master problem
const SUGGEST_THRESHOLD = 45;    // >= this => surface as "possible duplicate" for admin review

// Weight given to each signal when producing the final 0-100 score.
const WEIGHTS = {
  text: 0.55,      // similarity of title + description (what the problem IS)
  location: 0.35,  // similarity of the location string (where it IS)
  category: 0.10,  // same category bonus
};

// A small stopword list so common filler words don't dilute the signal.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'and', 'or',
  'but', 'this', 'that', 'these', 'those', 'it', 'its', 'we', 'our', 'us',
  'i', 'my', 'me', 'you', 'your', 'there', 'here', 'as', 'not', 'no',
  'please', 'also', 'very', 'much', 'has', 'have', 'had', 'will', 'would',
  'should', 'near', 'area', 'problem', 'issue',
]);

/**
 * Normalize free text: lowercase, strip punctuation, collapse whitespace.
 */
function normalize(str = '') {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tokenize into meaningful words (stopwords removed, length > 1).
 */
function tokenize(str = '') {
  return normalize(str)
    .split(' ')
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/**
 * Generate character n-grams (default bigrams) for fuzzy string matching.
 * Useful for short strings like locations ("XYZ Nagar" vs "xyz ngar").
 */
function charNGrams(str = '', n = 2) {
  const clean = normalize(str).replace(/\s+/g, '');
  if (clean.length < n) return [clean];
  const grams = [];
  for (let i = 0; i <= clean.length - n; i++) {
    grams.push(clean.slice(i, i + n));
  }
  return grams;
}

/**
 * Sorensen-Dice coefficient over character n-grams — great for short,
 * typo-tolerant strings such as location names.
 */
function diceCoefficient(a, b) {
  const gramsA = charNGrams(a);
  const gramsB = charNGrams(b);
  if (gramsA.length === 0 || gramsB.length === 0) return 0;

  const mapB = new Map();
  gramsB.forEach((g) => mapB.set(g, (mapB.get(g) || 0) + 1));

  let intersection = 0;
  gramsA.forEach((g) => {
    const count = mapB.get(g) || 0;
    if (count > 0) {
      intersection++;
      mapB.set(g, count - 1);
    }
  });

  return (2 * intersection) / (gramsA.length + gramsB.length);
}

/**
 * Build a TF (term-frequency) map for a token list.
 */
function termFrequency(tokens) {
  const tf = new Map();
  tokens.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
  return tf;
}

/**
 * Cosine similarity between two documents using TF-IDF weighting, where the
 * "corpus" for IDF purposes is simply the two documents being compared
 * (a standard, dependency-free approximation that works well for short,
 * pairwise text comparisons like this).
 */
function cosineSimilarity(textA, textB) {
  const tokensA = tokenize(textA);
  const tokensB = tokenize(textB);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const tfA = termFrequency(tokensA);
  const tfB = termFrequency(tokensB);

  const vocab = new Set([...tfA.keys(), ...tfB.keys()]);

  // IDF: log(N / docFrequency), N = 2 documents.
  const idf = new Map();
  vocab.forEach((term) => {
    const df = (tfA.has(term) ? 1 : 0) + (tfB.has(term) ? 1 : 0);
    idf.set(term, Math.log(1 + 2 / df));
  });

  let dot = 0;
  let magA = 0;
  let magB = 0;

  vocab.forEach((term) => {
    const wA = (tfA.get(term) || 0) * idf.get(term);
    const wB = (tfB.get(term) || 0) * idf.get(term);
    dot += wA * wB;
    magA += wA * wA;
    magB += wB * wB;
  });

  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Jaccard similarity of token sets — a good complement to cosine similarity
 * because it rewards exact shared vocabulary regardless of repetition.
 */
function jaccardSimilarity(textA, textB) {
  const setA = new Set(tokenize(textA));
  const setB = new Set(tokenize(textB));
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  setA.forEach((t) => {
    if (setB.has(t)) intersection++;
  });
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Combined text similarity (0-1): blend of TF-IDF cosine + Jaccard so both
 * "topical overlap" and "exact shared wording" are rewarded.
 */
function textSimilarity(textA, textB) {
  const cosine = cosineSimilarity(textA, textB);
  const jaccard = jaccardSimilarity(textA, textB);
  return 0.65 * cosine + 0.35 * jaccard;
}

/**
 * Location similarity (0-1): blend of exact/substring matching and
 * character n-gram Dice coefficient so "XYZ Nagar" vs "Xyz nagar, near
 * water tank" still scores highly.
 */
function locationSimilarity(locA = '', locB = '') {
  const a = normalize(locA);
  const b = normalize(locB);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const dice = diceCoefficient(a, b);
  const substringBonus = a.includes(b) || b.includes(a) ? 0.25 : 0;

  return Math.min(1, dice + substringBonus);
}

/**
 * Score two challenge/problem reports against each other.
 *
 * @param {Object} a - { title, description, location, category }
 * @param {Object} b - { title, description, location, category }
 * @returns {{ score: number, breakdown: Object }}
 *          score is 0-100 (rounded), breakdown gives the raw 0-1 sub-scores
 *          for transparency/debugging/admin UI.
 */
function scoreChallenges(a, b) {
  const combinedTextA = `${a.title || ''}. ${a.description || ''}`;
  const combinedTextB = `${b.title || ''}. ${b.description || ''}`;

  const textSim = textSimilarity(combinedTextA, combinedTextB);
  const locSim = locationSimilarity(a.location, b.location);
  const categorySim = a.category && b.category && normalize(a.category) === normalize(b.category) ? 1 : 0;

  const weighted =
    textSim * WEIGHTS.text +
    locSim * WEIGHTS.location +
    categorySim * WEIGHTS.category;

  // Guardrail: if the locations are clearly unrelated (very low location
  // similarity), cap the overall score — two identical-sounding complaints
  // in two different cities are not the same civic problem.
  let finalScore = weighted;
  if (locSim < 0.2) {
    finalScore = Math.min(finalScore, 0.35);
  }

  const score = Math.round(Math.max(0, Math.min(1, finalScore)) * 100);

  return {
    score,
    breakdown: {
      textSimilarity: Number(textSim.toFixed(3)),
      locationSimilarity: Number(locSim.toFixed(3)),
      categoryMatch: Boolean(categorySim),
    },
  };
}

module.exports = {
  scoreChallenges,
  textSimilarity,
  locationSimilarity,
  normalize,
  AUTO_MERGE_THRESHOLD,
  SUGGEST_THRESHOLD,
};
