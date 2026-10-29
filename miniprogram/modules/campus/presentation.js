const PLACE_STATUS = Object.freeze({
  OPEN: 'open',
  EXPIRED: 'expired',
  CLOSED: 'closed',
  UNKNOWN: 'unknown',
});
const { businessDate, isBusinessDate } = require('../../shared/date');

function placeStatus(place, today) {
  if (!isBusinessDate(today)) {
    return PLACE_STATUS.UNKNOWN;
  }
  if (!place || place.enabled !== true || place.openState === 'closed') {
    return PLACE_STATUS.CLOSED;
  }
  // Server expiry is authoritative even when an ISO deadline rounds to today.
  if (
    place.verificationState === 'expired' ||
    place.verificationStatus === 'expired' ||
    place.stale === true
  ) {
    return PLACE_STATUS.EXPIRED;
  }
  if (place.openState !== 'open' || !isBusinessDate(place.validUntil)) {
    return PLACE_STATUS.UNKNOWN;
  }
  if (place.validUntil < today) {
    return PLACE_STATUS.EXPIRED;
  }
  return PLACE_STATUS.OPEN;
}

function canNavigateToPlace(place, today) {
  const location = place && place.location;
  return Boolean(
    isBusinessDate(today) &&
    place &&
    place.isSynthetic === false &&
    place.verificationStatus === 'verified' &&
    isBusinessDate(place.verifiedAt) &&
    place.verifiedAt <= today &&
    place.enabled === true &&
    place.openState === 'open' &&
    place.coordinateStatus === 'verified' &&
    isBusinessDate(place.validUntil) &&
    place.validUntil >= today &&
    location &&
    location.coordinateSystem === 'gcj02' &&
    Number.isFinite(location.latitude) &&
    location.latitude >= -90 &&
    location.latitude <= 90 &&
    Number.isFinite(location.longitude) &&
    location.longitude >= -180 &&
    location.longitude <= 180,
  );
}

function filterAndPagePlaces(places, filters = {}, today = businessDate()) {
  const page = Number.isInteger(filters.page) && filters.page > 0 ? filters.page : 1;
  const pageSize =
    Number.isInteger(filters.pageSize) && filters.pageSize > 0 ? filters.pageSize : 2;
  const matched = places
    .filter(
      (place) =>
        !filters.campus || filters.campus === '全部校区' || place.campus === filters.campus,
    )
    .filter(
      (place) =>
        !filters.tag ||
        filters.tag === '全部标签' ||
        (Array.isArray(place.environmentTags) &&
          place.environmentTags.some((tag) => tag === filters.tag)),
    )
    .map((place) => ({
      ...place,
      status: placeStatus(place, today),
      recommendable:
        place.isSynthetic === false &&
        place.verificationStatus === 'verified' &&
        isBusinessDate(place.verifiedAt) &&
        place.verifiedAt <= today &&
        placeStatus(place, today) === PLACE_STATUS.OPEN,
      navigationAvailable: canNavigateToPlace(place, today),
    }));
  const start = (page - 1) * pageSize;
  const items = matched.slice(start, start + pageSize);
  return {
    items,
    page,
    pageSize,
    total: matched.length,
    hasMore: start + items.length < matched.length,
  };
}

function navigationOptions(place, today = businessDate()) {
  if (!place || !canNavigateToPlace(place, today)) {
    return null;
  }
  return {
    latitude: place.location.latitude,
    longitude: place.location.longitude,
    name: place.name,
    address: place.address,
    scale: 16,
  };
}

module.exports = {
  PLACE_STATUS,
  placeStatus,
  canNavigateToPlace,
  filterAndPagePlaces,
  navigationOptions,
};
