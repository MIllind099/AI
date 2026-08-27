const mongoose = require('mongoose');

const StatusHistorySchema = new mongoose.Schema({
  status: {
    type: String,
    enum: ['Pending', 'Open', 'Under Review', 'In Progress', 'Resolved'],
    required: true,
  },
  changedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  changedAt: {
    type: Date,
    default: Date.now,
  },
  note: {
    type: String,
    default: '',
  },
});

const ChallengeSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    required: true,
  },
  location: {
    type: String,
    required: true,
    trim: true,
  },
  category: {
    type: String,
    required: true,
    trim: true,
  },
  image: {
    type: String,
    default: '',
  },
  status: {
    type: String,
    enum: ['Pending', 'Open', 'Under Review', 'In Progress', 'Resolved'],
    default: 'Pending',
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  votesCount: {
    type: Number,
    default: 0,
  },
  selectedProposal: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Proposal',
    default: null,
  },
  statusHistory: [StatusHistorySchema],

  // ----- Duplicate / repetitive-problem detection -----------------------
  // If this report was auto/admin-merged into another (older) report,
  // masterProblem points at that report and isDuplicate is true.
  masterProblem: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Challenge',
    default: null,
  },
  isDuplicate: {
    type: Boolean,
    default: false,
  },
  // True once at least one other report has been merged into this one.
  isMasterProblem: {
    type: Boolean,
    default: false,
  },
  // How many citizen reports (including itself) point at this problem.
  duplicateCount: {
    type: Number,
    default: 1,
  },
  // Every other (non-duplicate) challenge this one was compared against,
  // with the similarity score, kept for admin transparency / review of
  // borderline matches that weren't auto-merged.
  similarProblems: [
    {
      challenge: { type: mongoose.Schema.Types.ObjectId, ref: 'Challenge' },
      score: { type: Number },
      computedAt: { type: Date, default: Date.now },
    },
  ],

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Challenge', ChallengeSchema);
