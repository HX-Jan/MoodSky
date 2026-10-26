// Local opt-in assembly. The production index imports only ./router, never this module.
const { createRouter } = require('./router');
const { createJournalService } = require('./services/journal');
const { createReviewService } = require('./services/review');
const { createDecorationService } = require('./services/decorations');
const { createTaskSuggestionsService } = require('./services/task-suggestions');

function createCandidateRouter(adapters = {}) {
  const domainHandlers = { ...adapters.domainHandlers };
  if (adapters.taskCatalogueRepository) {
    const publicTasks = createTaskSuggestionsService({
      repository: adapters.taskCatalogueRepository,
    });
    const privateTasks = domainHandlers.tasks;
    domainHandlers.tasks = (request) =>
      ['tasks.suggestions', 'tasks.quickChoice'].includes(request.action) || !privateTasks
        ? publicTasks(request)
        : privateTasks(request);
  }
  if (adapters.journalRepository) {
    const options = {
      repository: adapters.journalRepository,
      now: adapters.now,
      receiptPolicy: adapters.journalReceiptPolicy,
    };
    domainHandlers.journal = createJournalService(options);
    domainHandlers.review = createReviewService(options);
    if (adapters.decorationCatalogue) {
      const readReview = domainHandlers.review;
      const decorations = createDecorationService({
        ...options,
        catalogue: adapters.decorationCatalogue,
      });
      domainHandlers.review = (request) =>
        request.action === 'review.decorations' ? decorations(request) : readReview(request);
    }
  }
  return createRouter({ ...adapters, domainHandlers });
}
module.exports = { createCandidateRouter };
