function motionKey(event) {
  const key = event.currentTarget?.dataset?.motionKey;
  return typeof key === 'string' && /^[a-zA-Z0-9_]+$/.test(key) ? key : '';
}

function isDisabled(event) {
  const disabled = event.currentTarget?.dataset?.motionDisabled;
  return disabled === true || disabled === 'true';
}

function resetButtonPress() {
  this._lastButtonRelease = {};
  if (Object.keys(this.data?.buttonMotionStates || {}).length) {
    this.setData({ buttonMotionStates: {} });
  }
}

const methods = {
  onButtonPressStart(event) {
    const key = motionKey(event);
    if (!key || isDisabled(event)) {
      return;
    }
    this.setData({ [`buttonMotionStates.${key}`]: 'button-held' });
  },
  onButtonPressRelease(event) {
    const key = motionKey(event);
    if (!key || this.data.buttonMotionStates?.[key] !== 'button-held') {
      return;
    }
    if (isDisabled(event)) {
      this.setData({ [`buttonMotionStates.${key}`]: '' });
      return;
    }
    this._lastButtonRelease = this._lastButtonRelease || {};
    // Alternate names so a rapid re-press restarts even if view updates coalesce.
    const release =
      this._lastButtonRelease[key] === 'button-released-a'
        ? 'button-released-b'
        : 'button-released-a';
    this._lastButtonRelease[key] = release;
    this.setData({ [`buttonMotionStates.${key}`]: release });
  },
  onButtonPressAnimationEnd(event) {
    const key = motionKey(event);
    if (!key || event.target?.dataset?.motionKey !== key) {
      return;
    }
    const state = this.data.buttonMotionStates?.[key];
    const animation = event.detail?.animationName;
    if (
      (state === 'button-released-a' && animation === 'button-release-a') ||
      (state === 'button-released-b' && animation === 'button-release-b') ||
      (state?.startsWith('button-released-') && animation === 'button-settle')
    ) {
      this.setData({ [`buttonMotionStates.${key}`]: '' });
    }
  },
};

function withButtonPress(options) {
  return {
    ...options,
    data: { ...options.data, buttonMotionStates: {} },
    ...methods,
    onHide(...args) {
      resetButtonPress.call(this);
      return options.onHide?.apply(this, args);
    },
  };
}

function withButtonPressComponent(options) {
  return {
    ...options,
    data: { ...options.data, buttonMotionStates: {} },
    methods: { ...options.methods, ...methods },
    pageLifetimes: {
      ...options.pageLifetimes,
      hide(...args) {
        resetButtonPress.call(this);
        return options.pageLifetimes?.hide?.apply(this, args);
      },
    },
  };
}

module.exports = { withButtonPress, withButtonPressComponent };
