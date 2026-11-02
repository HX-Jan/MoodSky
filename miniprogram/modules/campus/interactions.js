function requestCurrentLocation(platform, handlers = {}) {
  if (!platform || typeof platform.getLocation !== 'function') {
    if (handlers.onFailure) {
      handlers.onFailure('unavailable');
    }
    return false;
  }

  if (handlers.onRequest) {
    handlers.onRequest();
  }
  const readLocation = () => {
    try {
      platform.getLocation({
        type: 'gcj02',
        success() {
          // Deliberately discard exact coordinates; this UI only needs the permission result.
          if (handlers.onSuccess) {
            handlers.onSuccess();
          }
        },
        fail() {
          // Keep the list usable and do not log or retain the platform error or coordinates.
          if (handlers.onFailure) {
            handlers.onFailure('denied-or-unavailable');
          }
        },
      });
    } catch (_error) {
      if (handlers.onFailure) {
        handlers.onFailure('denied-or-unavailable');
      }
    }
  };

  try {
    if (typeof platform.requirePrivacyAuthorize === 'function') {
      platform.requirePrivacyAuthorize({
        success: readLocation,
        fail() {
          if (handlers.onFailure) {
            handlers.onFailure('denied-or-unavailable');
          }
        },
      });
    } else {
      readLocation();
    }
  } catch (_error) {
    if (handlers.onFailure) {
      handlers.onFailure('denied-or-unavailable');
    }
  }
  return true;
}

const { navigationOptions } = require('./presentation');

function openVerifiedPlace(platform, place, handlers = {}) {
  const options = navigationOptions(place);
  if (!options || !platform || typeof platform.openLocation !== 'function') {
    if (handlers.onFailure) {
      handlers.onFailure('unavailable');
    }
    return false;
  }
  try {
    platform.openLocation({
      ...options,
      success() {
        if (handlers.onSuccess) {
          handlers.onSuccess();
        }
      },
      fail() {
        if (handlers.onFailure) {
          handlers.onFailure('map-failed');
        }
      },
    });
  } catch (_error) {
    if (handlers.onFailure) {
      handlers.onFailure('map-failed');
    }
    return false;
  }
  return true;
}

module.exports = { requestCurrentLocation, openVerifiedPlace };
