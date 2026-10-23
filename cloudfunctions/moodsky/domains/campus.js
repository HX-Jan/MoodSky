const { notImplemented, AppError } = require('../shared/result');
const { ERROR_CODES } = require('../shared/contracts');
const rules = require('./campus-rules');

// Junhan Huang: F11-F16. All place/support data requires real verification.
//
// The handler is a dispatcher only: it reads from `repositories` and hands the
// decision to campus-rules.js. Nothing here decides what a student may see, so
// the same rules can be tested without a database.

// Fixed simulation, unchanged since week one. It stays explicit: no private
// record, and no invented weather for a real campus.
const WEATHER_PREVIEW = Object.freeze({
  simulated: true,
  label: '固定虚构示意',
  description: '首版校园气象仅作界面示意，不读取私人天气记录，也不采集真实贡献。',
});

function requireRepository(repositories, name) {
  if (!repositories || !repositories[name]) {
    // Unwired deployment must answer honestly instead of inventing data.
    return notImplemented();
  }
  return repositories[name];
}

function requireActor(actor) {
  if (!actor || typeof actor.accountId !== 'string' || actor.accountId.length === 0) {
    // The router already enforces this; the guard keeps the handler safe if it
    // is ever called directly.
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, '请先登录。');
  }
  return actor;
}

function readNow(now) {
  return typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
}

async function listPlaces(payload, repositories, nowMs) {
  const query = rules.validateListPlaces(payload);
  const store = requireRepository(repositories, 'places');
  const { rows, truncated } = await store.listAll();
  const page = rules.selectPublicList(rows, query, nowMs);
  // `truncated` says the sweep hit its ceiling; the page is still honest about
  // what it contains, but the caller is told the result may be incomplete.
  return { ...page, truncated };
}

async function getPlace(payload, repositories, nowMs) {
  const query = rules.validateGetPlace(payload);
  const store = requireRepository(repositories, 'places');
  const place = await store.findByPlaceId(query.placeId);
  return rules.selectPublicDetail(place ? [place] : [], query.placeId, nowMs);
}

async function supportResources(payload, repositories, nowMs) {
  rules.validateSupportResources(payload);
  const store = requireRepository(repositories, 'supportResources');
  const { rows, truncated } = await store.listAll();
  return { ...rules.selectSupportResources(rows, nowMs), truncated };
}

async function favorites(payload, actor, repositories, nowMs) {
  const query = rules.validateFavorites(payload);
  const { accountId } = requireActor(actor);
  const favoriteStore = requireRepository(repositories, 'favorites');
  const placeStore = requireRepository(repositories, 'places');

  if (query.operation === 'list') {
    const [favoritesResult, placesResult] = await Promise.all([
      favoriteStore.listByOwner(accountId),
      placeStore.listAll(),
    ]);
    // Owner comes from the trusted actor, never from the payload: a favorite
    // list is private and the router already rejects an ownerId field.
    return {
      ...rules.selectFavorites(favoritesResult.rows, placesResult.rows, query, nowMs),
      truncated: Boolean(favoritesResult.truncated || placesResult.truncated),
    };
  }

  if (query.operation === 'add') {
    const place = await placeStore.findByPlaceId(query.placeId);
    // Favoriting something the public cannot read would create a personal
    // record pointing at an unreachable or unverified place.
    rules.assertPlaceVisible(place, nowMs);
    const result = await favoriteStore.add(accountId, query.placeId, new Date(nowMs).toISOString());
    return {
      favorite: { placeId: query.placeId, createdAt: new Date(nowMs).toISOString() },
      duplicated: result.duplicated,
    };
  }

  // remove: allowed even when the place has since been disabled or deleted,
  // otherwise a student could never clean up an old favorite.
  const result = await favoriteStore.remove(accountId, query.placeId);
  return { placeId: query.placeId, removed: result.removed > 0 };
}

async function correctPlace(payload, actor, repositories, nowMs) {
  const query = rules.validateCorrectPlace(payload);
  const { accountId } = requireActor(actor);
  const placeStore = requireRepository(repositories, 'places');
  const correctionStore = requireRepository(repositories, 'corrections');
  const place = await placeStore.findByPlaceId(query.placeId);
  rules.assertPlaceVisible(place, nowMs);
  const nowIso = new Date(nowMs).toISOString();
  const document = {
    // Private to the submitter until an operator reviews it; the public list
    // never reads this collection.
    ownerId: accountId,
    placeId: query.placeId,
    text: query.text,
    status: 'pending',
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const created = await correctionStore.create(document);
  return {
    correction: rules.correctionReceipt({ ...document, _id: created.id }),
    published: false,
  };
}

async function handle({ action, payload, actor, repositories, now }) {
  if (action === 'campus.weatherPreview') {
    return { ...WEATHER_PREVIEW };
  }
  // Unwired deployment answers NOT_IMPLEMENTED before looking at the payload: an
  // environment without campus collections must not read as a client mistake.
  if (!repositories) {
    return notImplemented();
  }
  const nowMs = readNow(now);
  if (action === 'campus.listPlaces') {
    return listPlaces(payload, repositories, nowMs);
  }
  if (action === 'campus.getPlace') {
    return getPlace(payload, repositories, nowMs);
  }
  if (action === 'campus.supportResources') {
    return supportResources(payload, repositories, nowMs);
  }
  if (action === 'campus.favorites') {
    return favorites(payload, actor, repositories, nowMs);
  }
  if (action === 'campus.correctPlace') {
    return correctPlace(payload, actor, repositories, nowMs);
  }
  return notImplemented();
}

module.exports = { handle };
