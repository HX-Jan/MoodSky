/* Structural integration harness for the standard Plugin API calls.
 * This exercises importer logic and invariants; it is NOT a Figma editor run.
 */
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {buildDesign, validateDesign} = require('./code.js');

function createFigmaMock() {
  let serial = 0;
  const nodes = new Map();
  const loaded = new Set();
  const variables = new Map();
  const styles = new Map();
  const color = {r: 1, g: 1, b: 1};
  const mixed = Symbol('mixed');
  const families = ['Inter', 'Noto Sans SC'];
  const fonts = families.flatMap(family => ['Regular', 'Medium', 'Bold'].map(style => ({fontName: {family, style}})));
  const cloneValue = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const fontKey = font => font.family + '/' + font.style;
  function assertFont(text) {
    assert.ok(loaded.has(fontKey(text.fontName)), 'Font loaded before text mutation: ' + fontKey(text.fontName));
  }
  class Node {
    constructor(type) {
      this.id = 'mock:' + (++serial);
      this.type = type;
      this.name = type;
      this.width = 100;
      this.height = 100;
      this.x = 0;
      this.y = 0;
      this.opacity = 1;
      this.fills = [{type: 'SOLID', color: {...color}, opacity: 1}];
      this.strokes = [];
      this.strokeWeight = 1;
      this.boundVariables = {};
      this.reactions = [];
      this.parent = null;
      if (['DOCUMENT', 'PAGE', 'FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'].includes(type)) this.children = [];
      if (['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'].includes(type)) {
        this.layoutMode = 'NONE';
        this.primaryAxisSizingMode = 'FIXED';
        this.counterAxisSizingMode = 'FIXED';
        this.primaryAxisAlignItems = 'MIN';
        this.counterAxisAlignItems = 'MIN';
        this.itemSpacing = 0;
        this.paddingTop = this.paddingRight = this.paddingBottom = this.paddingLeft = 0;
        this.clipsContent = false;
        this.cornerRadius = 0;
      }
      if (['RECTANGLE'].includes(type)) this.cornerRadius = 0;
      if (type === 'TEXT') {
        this._characters = '';
        this.fontName = {family: 'Inter', style: 'Regular'};
        this.textAutoResize = 'WIDTH_AND_HEIGHT';
        this.textAlignHorizontal = 'LEFT';
        this.textAlignVertical = 'TOP';
        this.hasMissingFont = false;
      }
      if (type === 'PAGE') this._flowStartingPoints = [];
      if (type === 'COMPONENT' || type === 'COMPONENT_SET') this.componentPropertyDefinitions = {};
      this.componentPropertyReferences = null;
      nodes.set(this.id, this);
    }
    get characters() { assert.equal(this.type, 'TEXT'); return this._characters; }
    set characters(value) { assert.equal(this.type, 'TEXT'); assertFont(this); this._characters = value; }
    get componentPropertyReferences() {return this._componentPropertyReferences;}
    set componentPropertyReferences(value) {
      this._componentPropertyReferences = value;
      if (value && value.characters) {
        let owner = this.parent;
        while (owner && (!owner.componentPropertyDefinitions || !owner.componentPropertyDefinitions[value.characters])) owner = owner.parent;
        assert.ok(owner, 'Text property reference has a component owner');
        assertFont(this);
        this._characters = owner.componentPropertyDefinitions[value.characters].defaultValue;
      }
    }
    get layoutSizingHorizontal() { return this._horizontal || 'FIXED'; }
    set layoutSizingHorizontal(value) {
      assert.ok(['FIXED', 'HUG', 'FILL'].includes(value));
      if (value === 'FILL') assert.ok(this.parent && this.parent.layoutMode && this.parent.layoutMode !== 'NONE', 'FILL only after attaching to auto-layout parent');
      this._horizontal = value;
      if (value === 'FILL') this.parent.reflow();
    }
    get flowStartingPoints() { return this._flowStartingPoints; }
    set flowStartingPoints(value) {
      assert.equal(this.type, 'PAGE');
      for (const point of value) {
        const target = nodes.get(point.nodeId);
        assert.ok(target && target.parent === this && target.type === 'FRAME', 'Flow start must be top-level frame on page');
      }
      this._flowStartingPoints = value;
    }
    appendChild(node) {
      assert.ok(this.children, 'Only containers append children');
      assert.notEqual(this.type, 'INSTANCE', 'Instance children stay immutable');
      if (node.type === 'TEXT') assertFont(node);
      if (node.parent && node.parent.children) node.parent.children.splice(node.parent.children.indexOf(node), 1);
      node.parent = this;
      this.children.push(node);
      this.reflow();
    }
    resize(width, height) {
      assert.ok(width > 0 && (height > 0 || this.type === 'LINE'));
      this.width = width; this.height = height;
      this._horizontal = 'FIXED';
      this.reflow();
    }
    reflow() {
      if (!this.children || this.layoutMode !== 'HORIZONTAL') return;
      const fills = this.children.filter(c => c.layoutSizingHorizontal === 'FILL');
      const fixed = this.children.filter(c => c.layoutSizingHorizontal !== 'FILL').reduce((sum, c) => sum + c.width, 0);
      const available = this.width - this.paddingLeft - this.paddingRight - fixed - Math.max(0, this.children.length - 1) * this.itemSpacing;
      for (const child of fills) {child.width = Math.max(0.01, available / fills.length); child.reflow();}
    }
    rescale(scale) {
      assert.ok(scale >= 0.01);
      this.width *= scale; this.height *= scale;
      if (this.children) for (const child of this.children) {child.x *= scale; child.y *= scale; child.rescale(scale);}
    }
    setBoundVariable(field, variable) { assert.ok(variables.has(variable.id)); this.boundVariables[field] = {type: 'VARIABLE_ALIAS', id: variable.id}; }
    findAll(predicate) {
      assert.ok(this.children, 'findAll only on container');
      const result = [];
      function walk(node) {if (predicate(node)) result.push(node); if (node.children) node.children.forEach(walk);}
      this.children.forEach(walk);
      return result;
    }
    getStyledTextSegments() {assert.equal(this.type, 'TEXT'); return [{fontName: this.fontName}];}
    async setTextStyleIdAsync(id) {
      assert.equal(this.type, 'TEXT'); assertFont(this);
      const style = styles.get(id); assert.ok(style); assert.ok(loaded.has(fontKey(style.fontName)));
      this.fontName = cloneValue(style.fontName); this.fontSize = style.fontSize; this.lineHeight = cloneValue(style.lineHeight); this.textStyleId = id;
    }
    addComponentProperty(name, type, defaultValue) {
      assert.ok(this.type === 'COMPONENT' || this.type === 'COMPONENT_SET');
      assert.equal(type, 'TEXT');
      const key = name + '#' + (++serial);
      this.componentPropertyDefinitions[key] = {type, defaultValue};
      return key;
    }
    createInstance() {
      assert.equal(this.type, 'COMPONENT');
      function clone(source, rootType) {
        const node = new Node(rootType || source.type);
        const exclude = new Set(['id', 'type', 'children', 'parent', 'componentPropertyDefinitions', '_flowStartingPoints']);
        for (const key of Object.keys(source)) if (!exclude.has(key)) node[key] = cloneValue(source[key]);
        if (source.children) {
          node.children = source.children.map(child => clone(child));
          node.children.forEach(child => child.parent = node);
        }
        return node;
      }
      const instance = clone(this, 'INSTANCE');
      instance.mainComponent = this;
      return instance;
    }
    async setReactionsAsync(reactions) {
      for (const reaction of reactions) {
        assert.deepEqual(reaction.trigger, {type: 'ON_CLICK'});
        for (const action of reaction.actions) {
          assert.equal(action.type, 'NODE'); assert.equal(action.navigation, 'NAVIGATE'); assert.equal(action.transition, null);
          const target = nodes.get(action.destinationId);
          assert.ok(target && target.type === 'FRAME');
          let fromPage = this; while (fromPage.type !== 'PAGE') fromPage = fromPage.parent;
          assert.equal(target.parent, fromPage, 'Click destination must be on source page');
        }
      }
      this.reactions = reactions;
    }
  }
  const root = new Node('DOCUMENT');
  const initialPage = new Node('PAGE'); initialPage.name = 'Page 1'; root.appendChild(initialPage);
  const figma = {
    editorType: 'figma', root, currentPage: initialPage, mixed,
    viewport: {scrollAndZoomIntoView(nodesToShow) {assert.ok(nodesToShow.length > 0);}},
    async listAvailableFontsAsync() { return fonts; },
    async loadFontAsync(font) {assert.ok(fonts.some(f => fontKey(f.fontName) === fontKey(font))); loaded.add(fontKey(font));},
    async setCurrentPageAsync(page) {assert.equal(page.type, 'PAGE'); this.currentPage = page;},
    async getNodeByIdAsync(id) { return nodes.get(id) || null; },
    createPage() {const page = new Node('PAGE'); root.appendChild(page); return page;},
    createFrame() {return new Node('FRAME');},
    createComponent() {return new Node('COMPONENT');},
    createRectangle() {return new Node('RECTANGLE');},
    createEllipse() {return new Node('ELLIPSE');},
    createLine() {return new Node('LINE');},
    createText() {return new Node('TEXT');},
    createTextStyle() {const style = {id: 'style:' + (++serial)}; styles.set(style.id, style); return style;},
    createNodeFromSvg(svg) {
      const frame = new Node('FRAME');
      frame.width = +(svg.match(/\bwidth="([\d.]+)"/) || [0, 64])[1];
      frame.height = +(svg.match(/\bheight="([\d.]+)"/) || [0, 64])[1];
      // One representative vector paint is enough to exercise semantic binding
      // and SVG rescaling. This harness does not parse or render SVG artwork.
      const vector = new Node('VECTOR');
      vector.width = frame.width; vector.height = frame.height;
      vector.fills = [{type: 'SOLID', color: {r: 37 / 255, g: 51 / 255, b: 58 / 255}, opacity: 1}];
      frame.appendChild(vector);
      return frame;
    },
    combineAsVariants(components, parent) {
      const set = new Node('COMPONENT_SET'); parent.appendChild(set); components.forEach(c => set.appendChild(c)); return set;
    },
    variables: {
      createVariableCollection(name) {
        const id = 'collection:' + (++serial), mode = 'mode:' + (++serial);
        return {id, name, defaultModeId: mode, modes: [{modeId: mode, name: 'Mode 1'}], renameMode(modeId, nextName) {assert.equal(modeId, mode); this.modes[0].name = nextName;}};
      },
      createVariable(name, collection, type) {
        const variable = {id: 'variable:' + (++serial), name, collection, resolvedType: type, valuesByMode: {}, scopes: [],
          setValueForMode(modeId, value) {assert.equal(modeId, collection.defaultModeId); if (value && value.type === 'VARIABLE_ALIAS') assert.ok(variables.has(value.id)); this.valuesByMode[modeId] = value;},
          setVariableCodeSyntax(platform, value) {assert.equal(platform, 'WEB'); assert.ok(value.startsWith('var(--')); this.codeSyntax = {WEB: value};}};
        variables.set(variable.id, variable); return variable;
      },
      setBoundVariableForPaint(paint, field, variable) {
        assert.equal(paint.type, 'SOLID'); assert.equal(field, 'color'); assert.ok(variables.has(variable.id));
        for (const c of ['r', 'g', 'b']) assert.ok(paint.color[c] >= 0 && paint.color[c] <= 1);
        assert.equal(Object.hasOwn(paint.color, 'a'), false, 'Paint color uses RGB; alpha belongs in opacity');
        return {...paint, boundVariables: {color: {type: 'VARIABLE_ALIAS', id: variable.id}}};
      }
    },
    _nodes: nodes, _variables: variables
  };
  return figma;
}

async function main() {
  const sourcePath = process.argv[2] || 'deliverables/design/design.json';
  const data = JSON.parse(fs.readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/, ''));
  const source = validateDesign(data);
  const figma = createFigmaMock();
  const initialPage = figma.currentPage;
  const result = await buildDesign(figma, data);
  assert.equal(result.status, 'imported');
  assert.equal(result.counts.unresolved, 0);
  assert.equal(result.counts.COMPONENT, source.components);
  const componentsShareSpecs = data.pages.some(p => p.id === 'spec-page' || /视觉规范/.test(p.name));
  assert.equal(result.counts.PAGE, source.pages + (componentsShareSpecs ? 0 : 1));
  assert.equal(new Set(Object.values(result.pages)).size, source.pages + (componentsShareSpecs ? 0 : 1));
  assert.equal(result.reusedPage.nodeId, initialPage.id);
  assert.equal(result.reusedPage.sourcePageId, data.pages[0].id);
  assert.ok(result.mutatedNodeIds.includes(initialPage.id));
  assert.ok(!result.createdNodeIds.includes(initialPage.id));
  assert.equal(figma.root.children.length, source.pages + (componentsShareSpecs ? 0 : 1), 'Blank initial page is reused, so no fourth page remains');
  if (componentsShareSpecs) {
    const specs = data.pages.find(p => p.id === 'spec-page') || data.pages.find(p => /视觉规范/.test(p.name));
    assert.equal(result.pages.componentSource, result.pages[specs.id]);
    const sourceOwnerIds = new Set(Object.values(result.componentSets));
    const sourceOwners = [...figma._nodes.values()].filter(n => sourceOwnerIds.has(n.id));
    const specFrameIds = new Set(specs.frames.map(n => result.screens[n.id]));
    const maxSpecX = Math.max(...[...figma._nodes.values()].filter(n => specFrameIds.has(n.id)).map(n => n.x + n.width));
    assert.ok(sourceOwners.every(n => n.x >= maxSpecX + 100), 'Source components have clear canvas space to right of foundation frames');
  }
  assert.equal(result.fonts.Regular.family, 'Noto Sans SC');
  assert.equal(result.warnings.length, 0);
  const requested = new Map();
  function collect(n) {if (n.link) requested.set(n.id + '→' + n.link, true); (n.children || []).forEach(collect);}
  data.pages.forEach(p => (p.frames || []).forEach(collect));
  (data.links || []).forEach(l => requested.set(l.from + '→' + l.to, true));
  assert.equal(result.counts.links, requested.size);
  const instances = [...figma._nodes.values()].filter(n => n.type === 'INSTANCE');
  const narrowedButtons = instances.filter(n => n.mainComponent.parent.name === 'Button' && n.width < n.mainComponent.width);
  assert.ok(narrowedButtons.length > 0, 'Exercise narrowed button instances');
  for (const instance of narrowedButtons) {
    const labels = instance.findAll(n => n.type === 'TEXT' && n.name === 'Label');
    assert.equal(labels.length, 1);
    assert.equal(labels[0].layoutSizingHorizontal, 'FILL');
    assert.equal(labels[0].width, instance.width - instance.paddingLeft - instance.paddingRight);
    assert.deepEqual(instance.fills, instance.mainComponent.fills, 'Instance background inherits source component');
  }
  for (const definition of data.components.filter(c => c.family === 'WeatherChoice' || c.family === 'Input' || c.family === 'Button')) {
    const sourceNode = figma._nodes.get(result.components[definition.id]);
    const originalLabel = definition.node.children.find(c => c.type === 'text' && c.name === 'Label');
    assert.equal(sourceNode.findAll(n => n.type === 'TEXT' && n.name === 'Label')[0].characters, originalLabel.text, 'Distinct variant labels remain distinct: ' + definition.id);
  }
  for (const variable of figma._variables.values()) {
    assert.ok(!variable.scopes.includes('ALL_SCOPES'));
    if (variable.name.startsWith('color/')) assert.equal(variable.valuesByMode[variable.collection.defaultModeId].type, 'VARIABLE_ALIAS');
  }
  const boundVectorCount = [...figma._nodes.values()].filter(n => n.type === 'VECTOR' && n.fills.every(p => p.type !== 'SOLID' || p.boundVariables.color)).length;
  assert.ok(boundVectorCount > 0);
  const again = await buildDesign(figma, data);
  assert.equal(again.batchSuffix, ' · 导入 2');
  assert.equal(again.counts.unresolved, 0);
  assert.equal(again.reusedPage, null, 'Repeat import does not rename a populated current page');
  assert.equal(figma.root.children.length, 2 * (source.pages + (componentsShareSpecs ? 0 : 1)));
  assert.ok(figma.root.children.some(p => p.name === data.pages[0].name));
  assert.ok(figma.root.children.some(p => p.name === data.pages[0].name + ' · 导入 2'));
  const report = {status: 'local-mock-integration-passed', figmaEditorExecuted: false, source, counts: result.counts, blankDefaultPageReused: true, initialImportTotalPages: source.pages + (componentsShareSpecs ? 0 : 1), narrowedButtonsChecked: narrowedButtons.length, svgPaintsBound: boundVectorCount, duplicateImportPreservesPages: true};
  if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
main().catch(error => {console.error(error.stack || error); process.exitCode = 1;});
