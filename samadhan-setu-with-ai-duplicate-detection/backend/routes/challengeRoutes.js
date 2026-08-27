const express = require('express');
const router = express.Router();
const {
  createChallenge,
  getChallenges,
  getChallengeById,
  updateChallengeStatus,
  voteChallenge,
  addComment,
  getComments,
  checkHasVoted,
  checkSimilarChallenges,
  getSimilarChallenges,
  mergeChallengeIntoMaster,
} = require('../controllers/challengeController');
const { submitProposal, getProposals } = require('../controllers/proposalController');
const { postProgressUpdate, getProgressUpdates } = require('../controllers/progressController');
const { protect, authorize } = require('../middleware/auth');
const upload = require('../middleware/upload');

// Base challenge routes
router
  .route('/')
  .post(protect, upload.single('image'), createChallenge)
  .get(getChallenges);

// AI duplicate-detection: check similarity BEFORE submitting a new report.
// Registered before '/:id' so 'check-similar' isn't swallowed as an :id param.
router.route('/check-similar').post(protect, checkSimilarChallenges);

router.route('/:id').get(getChallengeById);

router.route('/:id/status').patch(protect, authorize('admin'), updateChallengeStatus);

// Duplicate-detection review & manual merge (admin)
router.route('/:id/similar').get(protect, authorize('admin'), getSimilarChallenges);
router.route('/:id/merge/:masterId').post(protect, authorize('admin'), mergeChallengeIntoMaster);

// Voting & comments
router.route('/:id/vote').post(protect, voteChallenge);
router.route('/:id/hasVoted').get(protect, checkHasVoted);
router.route('/:id/comments').post(protect, addComment).get(getComments);

// Proposals for challenge
router
  .route('/:id/proposals')
  .post(protect, authorize('institution', 'admin'), submitProposal)
  .get(protect, getProposals);

// Progress updates for challenge
router
  .route('/:id/progress')
  .post(protect, authorize('institution', 'admin'), upload.single('image'), postProgressUpdate)
  .get(getProgressUpdates);

module.exports = router;
