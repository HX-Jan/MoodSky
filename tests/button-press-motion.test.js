const test = require('node:test');
const assert = require('node:assert/strict');
const {
  withButtonPress,
  withButtonPressComponent,
} = require('../miniprogram/modules/presentation/button-press');

function fixture(options = {}, component = false) {
  const definition = component ? withButtonPressComponent(options) : withButtonPress(options);
  const patches = [];
  const instance = {
    ...definition,
    ...(component ? definition.methods : {}),
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) {
      patches.push(patch);
      for (const [key, value] of Object.entries(patch)) {
        if (key.startsWith('buttonMotionStates.')) {
          this.data.buttonMotionStates[key.slice('buttonMotionStates.'.length)] = value;
        } else {
          this.data[key] = value;
        }
      }
    },
  };
  return { instance, definition, patches };
}

function touch(key = 'primary', disabled = false) {
  const node = { dataset: { motionKey: key, motionDisabled: disabled } };
  return { currentTarget: node, target: node };
}

function finish(key, animationName) {
  return { ...touch(key), detail: { animationName } };
}

test('button motion starts idle, holds at touch start, and releases without changing business data', () => {
  const { instance: page, patches } = fixture({ data: { selectedWeather: 'SUNNY' } });
  assert.deepEqual(page.data.buttonMotionStates, {});
  assert.equal(patches.length, 0);
  page.onButtonPressStart(touch());
  assert.equal(page.data.buttonMotionStates.primary, 'button-held');
  page.onButtonPressRelease(touch());
  assert.equal(page.data.buttonMotionStates.primary, 'button-released-a');
  page.onButtonPressAnimationEnd(finish('primary', 'button-release-a'));
  assert.equal(page.data.buttonMotionStates.primary, '');
  assert.equal(page.data.selectedWeather, 'SUNNY');
});

test('touch cancel releases a held button and the settle animation clears reduced-motion state', () => {
  const { instance: page } = fixture();
  page.onButtonPressStart(touch('cancel'));
  page.onButtonPressRelease({ ...touch('cancel'), type: 'touchcancel' });
  assert.equal(page.data.buttonMotionStates.cancel, 'button-released-a');
  page.onButtonPressAnimationEnd(finish('cancel', 'button-settle'));
  assert.equal(page.data.buttonMotionStates.cancel, '');
});

test('disabled or loading controls ignore presses and disabling a held control clears its state', () => {
  const { instance: page } = fixture();
  page.onButtonPressStart(touch('disabled', true));
  page.onButtonPressStart(touch('loading', true));
  assert.deepEqual(page.data.buttonMotionStates, {});
  page.onButtonPressStart(touch());
  page.onButtonPressRelease(touch('primary', true));
  assert.equal(page.data.buttonMotionStates.primary, '');
});

test('release without a press and unsafe motion keys do not create animation states', () => {
  const { instance: page } = fixture();
  page.onButtonPressRelease(touch('unpressed'));
  page.onButtonPressStart(touch('nested.key'));
  page.onButtonPressStart(touch('bracket[0]'));
  page.onButtonPressStart(touch(''));
  assert.deepEqual(page.data.buttonMotionStates, {});
});

test('rapid repeated presses alternate release names and ignore a previous animation end', () => {
  const { instance: page } = fixture();
  page.onButtonPressStart(touch());
  page.onButtonPressRelease(touch());
  assert.equal(page.data.buttonMotionStates.primary, 'button-released-a');
  page.onButtonPressStart(touch());
  page.onButtonPressAnimationEnd(finish('primary', 'button-release-a'));
  assert.equal(page.data.buttonMotionStates.primary, 'button-held');
  page.onButtonPressRelease(touch());
  assert.equal(page.data.buttonMotionStates.primary, 'button-released-b');
  page.onButtonPressAnimationEnd(finish('primary', 'button-release-a'));
  assert.equal(page.data.buttonMotionStates.primary, 'button-released-b');
  page.onButtonPressAnimationEnd(finish('primary', 'button-release-b'));
  assert.equal(page.data.buttonMotionStates.primary, '');
});

test('two button keys and child animation events remain isolated', () => {
  const { instance: page } = fixture();
  page.onButtonPressStart(touch('first'));
  page.onButtonPressStart(touch('second'));
  page.onButtonPressRelease(touch('first'));
  assert.equal(page.data.buttonMotionStates.second, 'button-held');
  const childEvent = finish('first', 'button-release-a');
  childEvent.target = { dataset: { motionKey: 'childSpinner' } };
  page.onButtonPressAnimationEnd(childEvent);
  page.onButtonPressAnimationEnd(finish('first', 'spin'));
  assert.equal(page.data.buttonMotionStates.first, 'button-released-a');
  page.onButtonPressAnimationEnd(finish('first', 'button-release-a'));
  assert.equal(page.data.buttonMotionStates.first, '');
  assert.equal(page.data.buttonMotionStates.second, 'button-held');
  page.onButtonPressRelease(touch('second'));
  assert.equal(page.data.buttonMotionStates.second, 'button-released-a');
});

test('page hide clears motion state while preserving the original hook context, arguments and result', () => {
  const calls = [];
  const original = {
    data: { draft: 'synthetic draft' },
    onHide(reason) {
      calls.push({ context: this, reason });
      return 'business-hide-result';
    },
  };
  const { instance: page } = fixture(original);
  page.onButtonPressStart(touch());
  page.onButtonPressRelease(touch());
  assert.equal(page.onHide('background'), 'business-hide-result');
  assert.deepEqual(page.data.buttonMotionStates, {});
  assert.equal(calls[0].context, page);
  assert.equal(calls[0].reason, 'background');
  assert.equal(page.data.draft, 'synthetic draft');
  page.onButtonPressStart(touch());
  page.onButtonPressRelease(touch());
  assert.equal(page.data.buttonMotionStates.primary, 'button-released-a');
});

test('component motion keeps business methods and its page hide hook, with independent instance state', () => {
  const calls = [];
  const options = {
    data: { selected: 2 },
    methods: {
      onSelect() {
        return this.data.selected;
      },
    },
    pageLifetimes: {
      hide(reason) {
        calls.push({ context: this, reason });
        return 'component-hide-result';
      },
    },
  };
  const { instance: component, definition } = fixture(options, true);
  const { instance: other } = fixture(options, true);
  component.onButtonPressStart(touch('tab_2'));
  assert.equal(component.onSelect(), 2);
  assert.deepEqual(other.data.buttonMotionStates, {});
  assert.equal(definition.pageLifetimes.hide.call(component, 'switch'), 'component-hide-result');
  assert.deepEqual(component.data.buttonMotionStates, {});
  assert.equal(calls[0].context, component);
  assert.equal(calls[0].reason, 'switch');
});
