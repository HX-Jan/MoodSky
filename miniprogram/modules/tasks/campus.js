// These template tags describe activities for which a campus location is useful.
function offersCampusPlaces(tags) {
  return Array.isArray(tags) && tags.some((tag) => ['户外', '散步', '散心'].includes(tag));
}

module.exports = { offersCampusPlaces };
