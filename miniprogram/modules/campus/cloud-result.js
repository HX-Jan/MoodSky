// Bridge the reviewed campus projection to the existing page contract. This
// never promotes coordinates: native navigation still needs separate evidence.
const { businessDate, isBusinessDate } = require('../../shared/date');
const { AppError } = require('../../shared/result');
const businessDay = (value) => {
  if (isBusinessDate(value)) {
    return value;
  }
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? businessDate(new Date(time)) : null;
};
function placeView(row) {
  if (!row || !Object.hasOwn(row, 'verificationState')) {
    return row;
  }
  return {
    ...row,
    environmentTags: Array.isArray(row.tags) ? [...row.tags] : [],
    openState:
      { OPEN: 'open', CLOSED: 'closed', LIMITED: 'unknown', UNKNOWN: 'unknown' }[row.openState] ||
      'unknown',
    verificationStatus: ['verified', 'expiring'].includes(row.verificationState)
      ? 'verified'
      : 'pending_review',
    enabled: row.verificationState !== 'disabled',
    isSynthetic: row.verificationState === 'synthetic',
    verifiedAt: businessDay(row.verifiedAt),
    validUntil: businessDay(row.validUntil),
    coordinateStatus: 'unverified',
    location: null,
    navigationAvailable: false,
  };
}
function campusResult(action, result) {
  const data = result?.data;
  if (!data || typeof data !== 'object' || data.truncated === true) {
    throw new AppError('INVALID_RESPONSE', '校园资料不完整，请重新读取。');
  }
  if (action === 'campus.listPlaces' && Array.isArray(data.items)) {
    return { ...result, data: { ...data, items: data.items.map(placeView) } };
  }
  if (action === 'campus.getPlace') {
    const place = data.place || (typeof data.placeId === 'string' ? data : null);
    return { ...result, data: { place: placeView(place) } };
  }
  if (action === 'campus.supportResources' && Array.isArray(data.items)) {
    return {
      ...result,
      data: {
        ...data,
        items: data.items.map((row) =>
          row && Object.hasOwn(row, 'verificationState')
            ? {
                ...row,
                id: row.resourceId,
                enabled: ['verified', 'expiring'].includes(row.verificationState),
                verificationStatus: ['verified', 'expiring'].includes(row.verificationState)
                  ? 'verified'
                  : 'pending_review',
                description:
                  row.description ||
                  [row.category, row.openHours, row.contact].filter(Boolean).join(' · '),
                verifiedAt: businessDay(row.verifiedAt),
                validUntil: businessDay(row.validUntil),
              }
            : row,
        ),
      },
    };
  }
  return result;
}
module.exports = { campusResult };
