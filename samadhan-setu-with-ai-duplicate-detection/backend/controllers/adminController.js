const Challenge = require('../models/Challenge');
const Proposal = require('../models/Proposal');
const User = require('../models/User');
const { SUGGEST_THRESHOLD } = require('../utils/similarity');

// @desc    Get dashboard statistics for admin
// @route   GET /api/admin/stats
// @access  Admin / Private
const getAdminStats = async (req, res) => {
  try {
    const [
      pending,
      open,
      underReview,
      inProgress,
      resolved,
      totalChallenges,
      totalProposals,
      totalUsers,
      mergedDuplicates,
      pendingReview,
    ] = await Promise.all([
      Challenge.countDocuments({ status: 'Pending' }),
      Challenge.countDocuments({ status: 'Open' }),
      Challenge.countDocuments({ status: 'Under Review' }),
      Challenge.countDocuments({ status: 'In Progress' }),
      Challenge.countDocuments({ status: 'Resolved' }),
      Challenge.countDocuments({}),
      Proposal.countDocuments({}),
      User.countDocuments({}),
      Challenge.countDocuments({ isDuplicate: true }),
      Challenge.countDocuments({ isDuplicate: false, 'similarProblems.0': { $exists: true } }),
    ]);

    res.json({
      pending,
      open,
      underReview,
      inProgress,
      resolved,
      totalChallenges,
      totalProposals,
      totalUsers,
      mergedDuplicates,
      pendingReview,
    });
  } catch (error) {
    console.error('Get Admin Stats Error:', error);
    res.status(500).json({ message: 'Server error fetching admin statistics' });
  }
};

// @desc    Get all reports flagged by the AI matcher as possible duplicates
//          (45-94% similarity) that an admin hasn't merged yet, for review.
// @route   GET /api/admin/duplicates
// @access  Admin / Private
const getPossibleDuplicates = async (req, res) => {
  try {
    const flagged = await Challenge.find({
      isDuplicate: false,
      'similarProblems.0': { $exists: true },
    })
      .select('title description location category status votesCount similarProblems createdBy createdAt')
      .populate('createdBy', 'name email')
      .populate('similarProblems.challenge', 'title location status votesCount')
      .sort({ createdAt: -1 });

    // Only surface matches that are still above the review threshold and
    // whose paired challenge hasn't itself already been merged elsewhere.
    const result = flagged
      .map((c) => ({
        _id: c._id,
        title: c.title,
        description: c.description,
        location: c.location,
        category: c.category,
        status: c.status,
        votesCount: c.votesCount,
        createdBy: c.createdBy,
        createdAt: c.createdAt,
        matches: (c.similarProblems || [])
          .filter((m) => m.challenge && m.score >= SUGGEST_THRESHOLD)
          .sort((a, b) => b.score - a.score),
      }))
      .filter((c) => c.matches.length > 0);

    res.json(result);
  } catch (error) {
    console.error('Get Possible Duplicates Error:', error);
    res.status(500).json({ message: 'Server error fetching possible duplicates' });
  }
};

module.exports = {
  getAdminStats,
  getPossibleDuplicates,
};
