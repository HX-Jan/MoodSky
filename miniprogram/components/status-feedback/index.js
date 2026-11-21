const { withButtonPressComponent } = require('../../modules/presentation/button-press');
const { feedbackFor } = require('../../modules/system/feedback');
const pageDefinition = {
  properties: {
    state: {
      type: String,
      value: 'empty',
      observer(value) {
        this.setData({ view: feedbackFor(value) });
      },
    },
    requestId: { type: String, value: '' },
    code: { type: String, value: '' },
  },
  data: { view: feedbackFor('empty') },
  methods: {
    onAction() {
      this.triggerEvent('action', { state: this.data.state });
    },
  },
};

Component(withButtonPressComponent(pageDefinition));
