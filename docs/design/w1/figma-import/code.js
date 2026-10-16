/* global figma, __html__ */
/* Moodsky W1 native Figma importer. No network, no destructive cleanup.
 * JSON nodes produce editable Figma text, vector shapes, frames and instances.
 * This is the standard development-plugin API, not an MCP-specific API wrapper.
 */

function validateDesign(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.pages)) {
    throw new Error('文件格式不符：需要 version: 1 的 Moodsky design.json。');
  }
  const ids = new Set();
  const componentIds = new Set();
  const supported = new Set(['frame', 'text', 'rect', 'ellipse', 'line', 'svg', 'instance']);
  const instances = [];
  function visit(n, path) {
    if (!n || !supported.has(n.type)) {
      throw new Error(path + '：不支持的图层类型。');
    }
    if (!n.id || ids.has(n.id)) {
      throw new Error(path + '：图层 ID 缺失或重复 ' + n.id);
    }
    ids.add(n.id);
    if (n.w !== undefined && (!Number.isFinite(n.w) || n.w <= 0)) {
      throw new Error(path + '：宽度必须大于 0。');
    }
    if (
      n.h !== undefined &&
      (!Number.isFinite(n.h) || n.h < 0 || (n.h === 0 && n.type !== 'line'))
    ) {
      throw new Error(path + '：高度无效。');
    }
    if (n.type === 'instance') {
      instances.push(n);
    }
    if (n.type === 'svg' && typeof n.svg !== 'string') {
      throw new Error(path + '：缺少 SVG 源码。');
    }
    for (const c of n.children || []) {
      visit(c, path + '/' + (c.name || c.id));
    }
  }
  const pages = new Set();
  for (const p of data.pages) {
    if (!p.id || !p.name || pages.has(p.id)) {
      throw new Error('页面 ID 或名称缺失，或 ID 重复。');
    }
    pages.add(p.id);
    for (const n of p.frames || []) {
      visit(n, p.name);
    }
  }
  for (const c of data.components || []) {
    if (!c.id || componentIds.has(c.id) || !c.node || c.node.type !== 'frame') {
      throw new Error('组件定义无效：' + c.id);
    }
    componentIds.add(c.id);
    visit(c.node, '组件/' + c.id);
    if (/button|按钮/i.test(c.family || '') && (c.node.h || 0) < 48) {
      throw new Error('按钮组件须至少 48 px 高：' + c.id);
    }
  }
  for (const n of instances) {
    if (!componentIds.has(n.componentId)) {
      throw new Error('找不到实例的组件：' + n.componentId);
    }
  }
  return { nodes: ids.size, pages: pages.size, components: componentIds.size };
}

function normalizeHex(value) {
  if (typeof value !== 'string' || !/^#[\da-f]{3,8}$/i.test(value)) {
    throw new Error('无效颜色：' + value);
  }
  let v = value.slice(1);
  if (v.length === 3 || v.length === 4) {
    v = v
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (v.length !== 6 && v.length !== 8) {
    throw new Error('无效颜色长度：' + value);
  }
  return '#' + v.toUpperCase();
}

function colorParts(value) {
  const v = normalizeHex(value).slice(1);
  return {
    r: parseInt(v.slice(0, 2), 16) / 255,
    g: parseInt(v.slice(2, 4), 16) / 255,
    b: parseInt(v.slice(4, 6), 16) / 255,
    a: v.length === 8 ? parseInt(v.slice(6, 8), 16) / 255 : 1,
  };
}

async function buildDesign(figma, data) {
  const input = validateDesign(data);
  if (figma.editorType !== 'figma') {
    throw new Error('请在 Figma Design 设计文件中运行，不能使用 FigJam 或 Slides。');
  }
  const ledger = {
    name: data.name || 'Moodsky W1',
    version: 1,
    input,
    createdNodeIds: [],
    mutatedNodeIds: [],
    reusedPage: null,
    pages: {},
    screens: {},
    components: {},
    componentSets: {},
    collections: {},
    variables: {},
    styles: {},
    fonts: {},
    componentLabelProperties: {},
    links: [],
    unresolved: [],
    warnings: [],
    counts: {},
  };
  let currentOperation = '准备导入';
  try {
    // A brand-new Design file already contains one blank page. Reuse only the
    // current empty page; never rename or remove a page containing user work.
    const emptyCurrentPage =
      figma.currentPage && figma.currentPage.children.length === 0 ? figma.currentPage : null;
    const existingNames = new Set(
      figma.root.children.filter((p) => p !== emptyCurrentPage).map((p) => p.name),
    );
    const componentSourceDefinition =
      data.pages.find((p) => p.id === 'spec-page') ||
      data.pages.find((p) => /视觉规范/.test(p.name));
    const wantedNames = (data.pages || [])
      .map((p) => p.name)
      .concat(componentSourceDefinition ? [] : ['组件源']);
    let batch = 1;
    while (
      wantedNames.some((name) => existingNames.has(name + (batch === 1 ? '' : ' · 导入 ' + batch)))
    ) {
      batch++;
    }
    const suffix = batch === 1 ? '' : ' · 导入 ' + batch;
    ledger.batchSuffix = suffix;
    const nodeMap = new Map();
    const sourceMap = new Map();
    const pages = new Map();
    const screenMap = new Map();
    const pendingLinks = [];
    const tokens = (data.tokens && data.tokens.colors) || {};
    const colorVars = new Map();
    const colorByHex = new Map();
    const spacingVars = new Map();
    const radiusVars = new Map();
    const styles = new Map();
    const loadedFonts = new Set();

    function record(node) {
      ledger.createdNodeIds.push(node.id);
      return node;
    }
    function recordTree(node) {
      record(node);
      if ('children' in node) {
        for (const child of node.children) {
          recordTree(child);
        }
      }
    }
    async function loadFont(font) {
      const key = font.family + '/' + font.style;
      if (!loadedFonts.has(key)) {
        await figma.loadFontAsync(font);
        loadedFonts.add(key);
      }
    }
    async function loadCurrentFonts(text) {
      const segments = text.getStyledTextSegments(['fontName']);
      if (!segments.length && text.fontName !== figma.mixed) {
        await loadFont(text.fontName);
      }
      for (const s of segments) {
        await loadFont(s.fontName);
      }
    }

    currentOperation = '检查中文字体';
    const available = await figma.listAvailableFontsAsync();
    const families = [
      'Noto Sans SC',
      'Source Han Sans SC',
      'PingFang SC',
      'Microsoft YaHei',
      'Noto Sans CJK SC',
      'Inter',
    ];
    const family = families.find((f) => available.some((a) => a.fontName.family === f));
    if (!family) {
      throw new Error('没有可用字体。请安装 Noto Sans SC，并在 Figma Desktop 中重试。');
    }
    const candidates = available.filter((a) => a.fontName.family === family).map((a) => a.fontName);
    function chooseStyle(names) {
      for (const style of names) {
        const found = candidates.find((c) => c.style === style);
        if (found) {
          return found;
        }
      }
      return candidates.find((c) => /regular|normal|book/i.test(c.style)) || candidates[0];
    }
    const fonts = {
      Regular: chooseStyle(['Regular', 'Normal', 'Book', 'Light']),
      Medium: chooseStyle(['Medium', 'Semibold', 'SemiBold', 'Semi Bold', 'DemiBold', 'Regular']),
      Bold: chooseStyle([
        'Bold',
        'Semibold',
        'SemiBold',
        'Semi Bold',
        'Heavy',
        'Medium',
        'Regular',
      ]),
    };
    for (const font of Object.values(fonts)) {
      await loadFont(font);
    }
    const defaultFont = available.find(
      (a) => a.fontName.family === 'Inter' && a.fontName.style === 'Regular',
    );
    if (defaultFont) {
      await loadFont(defaultFont.fontName);
    }
    ledger.fonts = fonts;
    if (family === 'Inter') {
      ledger.warnings.push(
        '当前仅使用 Inter，中文由 Figma 字体回退显示；建议安装 Noto Sans SC 后重新导入并检查换行。',
      );
    }
    for (const w of ['Medium', 'Bold']) {
      if (fonts[w].style === fonts.Regular.style) {
        ledger.warnings.push(w + ' 字重不可用，已回退到 ' + fonts[w].style + '。');
      }
    }

    currentOperation = '创建颜色、间距与圆角变量';
    const primitiveColl = figma.variables.createVariableCollection('Moodsky · Primitives' + suffix);
    const semanticColl = figma.variables.createVariableCollection('Moodsky · Color' + suffix);
    const metricsColl = figma.variables.createVariableCollection(
      'Moodsky · Spacing & Radius' + suffix,
    );
    primitiveColl.renameMode(primitiveColl.defaultModeId, 'Value');
    semanticColl.renameMode(semanticColl.defaultModeId, 'Light');
    metricsColl.renameMode(metricsColl.defaultModeId, 'Value');
    ledger.collections = {
      primitives: primitiveColl.id,
      color: semanticColl.id,
      metrics: metricsColl.id,
    };
    const primitives = new Map();
    const allFills = ['FRAME_FILL', 'SHAPE_FILL', 'TEXT_FILL', 'STROKE_COLOR'];
    function addColor(key, value) {
      const hex = normalizeHex(value);
      let primitive = primitives.get(hex);
      if (!primitive) {
        primitive = figma.variables.createVariable(
          'palette/' + hex.slice(1),
          primitiveColl,
          'COLOR',
        );
        primitive.scopes = [];
        primitive.hiddenFromPublishing = true;
        primitive.setValueForMode(primitiveColl.defaultModeId, colorParts(hex));
        primitive.setVariableCodeSyntax(
          'WEB',
          'var(--moodsky-palette-' + hex.slice(1).toLowerCase() + ')',
        );
        primitives.set(hex, primitive);
        ledger.variables['palette/' + hex.slice(1)] = primitive.id;
      }
      const semantic = figma.variables.createVariable('color/' + key, semanticColl, 'COLOR');
      semantic.scopes = /text$|^(secondary|muted)$/i.test(key)
        ? ['TEXT_FILL']
        : /^(border|outline)$/i.test(key)
          ? ['STROKE_COLOR']
          : allFills;
      semantic.description = '第一版提议 token；请与 Linghan 现有实现核对。';
      semantic.setValueForMode(semanticColl.defaultModeId, {
        type: 'VARIABLE_ALIAS',
        id: primitive.id,
      });
      semantic.setVariableCodeSyntax(
        'WEB',
        'var(--moodsky-color-' +
          key
            .replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
            .replace(/[^a-z\d-]/gi, '-')
            .toLowerCase() +
          ')',
      );
      colorVars.set(key, semantic);
      if (!colorByHex.has(hex)) {
        colorByHex.set(hex, semantic);
      }
      ledger.variables['color/' + key] = semantic.id;
      return semantic;
    }
    for (const key of Object.keys(tokens)) {
      addColor(key, tokens[key]);
    }
    function floatVar(prefix, value, scopes, target) {
      const v = figma.variables.createVariable(prefix + '/' + value, metricsColl, 'FLOAT');
      v.scopes = scopes;
      v.setValueForMode(metricsColl.defaultModeId, value);
      v.setVariableCodeSyntax('WEB', 'var(--moodsky-' + prefix + '-' + value + ')');
      target.set(value, v);
      ledger.variables[prefix + '/' + value] = v.id;
    }
    for (const value of [
      ...new Set((data.tokens && data.tokens.spacing) || [4, 8, 12, 16, 24, 32]),
    ]) {
      floatVar('spacing', value, ['GAP'], spacingVars);
    }
    for (const value of [...new Set((data.tokens && data.tokens.radii) || [12, 20, 28])]) {
      floatVar('radius', value, ['CORNER_RADIUS'], radiusVars);
    }

    function makePaint(value) {
      const raw = tokens[value] || value;
      if (raw === 'none' || raw === 'transparent') {
        return null;
      }
      const rgba = colorParts(raw);
      let paint = { type: 'SOLID', color: { r: rgba.r, g: rgba.g, b: rgba.b }, opacity: rgba.a };
      const hex = normalizeHex(raw);
      const variable =
        colorVars.get(value) || colorByHex.get(hex) || addColor('custom/' + hex.slice(1), raw);
      paint = figma.variables.setBoundVariableForPaint(paint, 'color', variable);
      return paint;
    }
    function assignPaint(node, property, value) {
      if (!(property in node)) {
        return;
      }
      if (value === undefined) {
        if (property === 'fills' && node.type !== 'TEXT') {
          node.fills = [];
        }
        return;
      }
      const paint = makePaint(value);
      node[property] = paint ? [paint] : [];
    }
    function bindNumber(node, field, value, map) {
      if (value !== undefined && field in node) {
        node[field] = value;
        const variable = map.get(value);
        if (variable) {
          node.setBoundVariable(field, variable);
        }
      }
    }
    async function textStyle(size, weight, lineHeight) {
      const actualWeight = fonts[weight] ? weight : 'Regular';
      const leading = lineHeight || Math.round(size * 1.5);
      const key = size + '/' + actualWeight + '/' + leading;
      if (!styles.has(key)) {
        const style = figma.createTextStyle();
        style.name = 'Moodsky/' + size + '/' + actualWeight + '/' + leading + suffix;
        style.fontName = fonts[actualWeight];
        style.fontSize = size;
        style.lineHeight = { unit: 'PIXELS', value: leading };
        style.letterSpacing = { unit: 'PIXELS', value: 0 };
        styles.set(key, style);
        ledger.styles[key] = style.id;
      }
      return styles.get(key);
    }

    function configureGeometry(node, n, parent) {
      node.name = n.name || n.id || n.type;
      if ('resize' in node) {
        const width = n.w === undefined ? node.width : n.w;
        const height = n.h === undefined ? node.height : n.h;
        if (node.type === 'LINE') {
          node.resize(Math.max(0.01, width), Math.max(0, height));
        } else {
          node.resize(Math.max(0.01, width), Math.max(0.01, height));
        }
      }
      if ('layoutMode' in node && n.type !== 'instance') {
        node.layoutMode = n.layout || 'NONE';
        if (n.layout) {
          node.primaryAxisSizingMode = 'FIXED';
          node.counterAxisSizingMode = 'FIXED';
          node.primaryAxisAlignItems = n.justify || 'MIN';
          node.counterAxisAlignItems = n.align || 'MIN';
          bindNumber(node, 'itemSpacing', n.gap || 0, spacingVars);
          const p = Array.isArray(n.padding)
            ? n.padding
            : [n.padding || 0, n.padding || 0, n.padding || 0, n.padding || 0];
          ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].forEach((field, i) =>
            bindNumber(node, field, p[i] || 0, spacingVars),
          );
        }
      }
      if ('clipsContent' in node && n.type !== 'instance') {
        node.clipsContent = n.clip === true;
      }
      if (n.radius !== undefined && 'cornerRadius' in node) {
        bindNumber(node, 'cornerRadius', n.radius, radiusVars);
      }
      if (n.opacity !== undefined && 'opacity' in node) {
        node.opacity = n.opacity;
      }
      if (n.strokeWidth !== undefined && 'strokeWeight' in node) {
        node.strokeWeight = n.strokeWidth;
      } else if (n.stroke !== undefined && 'strokeWeight' in node) {
        node.strokeWeight = 1;
      }
      // Instances inherit their source component's appearance unless the JSON
      // explicitly supplies an override. Clearing missing fills here would
      // erase the main component's button background.
      if (n.type !== 'instance' || n.fill !== undefined) {
        assignPaint(node, 'fills', n.fill);
      }
      if (n.type !== 'instance' || n.stroke !== undefined) {
        assignPaint(node, 'strokes', n.stroke);
      }
      parent.appendChild(node);
      // Button and chip labels must respond to instance width changes. Set
      // FILL only after attachment to the auto-layout parent; retain all other
      // text widths, including fixed-width wrapping body and input text.
      if (
        node.type === 'TEXT' &&
        node.name === 'Label' &&
        'layoutMode' in parent &&
        parent.layoutMode === 'HORIZONTAL'
      ) {
        node.layoutSizingHorizontal = 'FILL';
      }
      if (!(parent.type !== 'PAGE' && 'layoutMode' in parent && parent.layoutMode !== 'NONE')) {
        node.x = n.x || 0;
        node.y = n.y || 0;
      }
    }

    async function createNode(n, parent, asComponent) {
      let node;
      if (asComponent) {
        node = record(figma.createComponent());
      } else if (n.type === 'frame') {
        node = record(figma.createFrame());
      } else if (n.type === 'rect') {
        node = record(figma.createRectangle());
      } else if (n.type === 'ellipse') {
        node = record(figma.createEllipse());
      } else if (n.type === 'line') {
        node = record(figma.createLine());
      } else if (n.type === 'text') {
        node = record(figma.createText());
        const weight = n.weight || 'Regular';
        const font = fonts[weight] || fonts.Regular;
        await loadFont(font);
        node.fontName = font;
        node.characters = String(n.text || '');
        const style = await textStyle(n.size || 16, weight, n.lineHeight);
        await node.setTextStyleIdAsync(style.id);
        node.textAlignHorizontal = n.textAlign || 'LEFT';
        node.textAutoResize = 'NONE';
        node.textAlignVertical = n.textVerticalAlign || 'CENTER';
      } else if (n.type === 'svg') {
        node = figma.createNodeFromSvg(n.svg);
        recordTree(node);
        if (n.w && node.width > 0 && Math.abs(n.w - node.width) > 0.01) {
          node.rescale(n.w / node.width);
        }
      } else if (n.type === 'instance') {
        const component = sourceMap.get(n.componentId);
        if (!component) {
          throw new Error('组件依赖顺序错误：' + n.componentId);
        }
        node = component.createInstance();
        recordTree(node);
        for (const [name, value] of Object.entries(n.overrides || {})) {
          const texts = node.findAll((child) => child.type === 'TEXT' && child.name === name);
          if (!texts.length) {
            ledger.warnings.push('实例 ' + n.id + ' 找不到文字覆盖层：' + name);
          }
          for (const text of texts) {
            await loadCurrentFonts(text);
            text.characters = String(value);
          }
        }
      }
      configureGeometry(node, n, parent);
      if (n.type === 'svg') {
        // Preserve SVG vector geometry and paint appearance, while binding its
        // solid paints to the same semantic variables used by native layers.
        const artwork = [node].concat(node.findAll(() => true));
        for (const child of artwork) {
          if (child.type === 'TEXT') {
            await loadCurrentFonts(child);
          }
          for (const field of ['fills', 'strokes']) {
            if (!(field in child) || child[field] === figma.mixed) {
              continue;
            }
            child[field] = child[field].map((paint) => {
              if (paint.type !== 'SOLID') {
                return paint;
              }
              const hex =
                '#' +
                ['r', 'g', 'b']
                  .map((c) =>
                    Math.round(paint.color[c] * 255)
                      .toString(16)
                      .padStart(2, '0'),
                  )
                  .join('')
                  .toUpperCase();
              const variable = colorByHex.get(hex) || addColor('custom/' + hex.slice(1), hex);
              return figma.variables.setBoundVariableForPaint(paint, 'color', variable);
            });
          }
        }
      }
      nodeMap.set(n.id, node);
      if (n.link) {
        pendingLinks.push({ from: n.id, to: n.link });
      }
      for (const child of n.children || []) {
        await createNode(child, node, false);
      }
      return node;
    }

    currentOperation = '创建页面与原生组件';
    for (let pageIndex = 0; pageIndex < data.pages.length; pageIndex++) {
      const p = data.pages[pageIndex];
      const page =
        pageIndex === 0 && emptyCurrentPage && emptyCurrentPage.children.length === 0
          ? emptyCurrentPage
          : record(figma.createPage());
      if (page === emptyCurrentPage) {
        ledger.reusedPage = { sourcePageId: p.id, nodeId: page.id, previousName: page.name };
        ledger.mutatedNodeIds.push(page.id);
      }
      page.name = p.name + suffix;
      page.backgrounds = [{ type: 'SOLID', color: { r: 0.93, g: 0.94, b: 0.94 } }];
      pages.set(p.id, page);
      ledger.pages[p.id] = page.id;
    }
    const componentPage = componentSourceDefinition
      ? pages.get(componentSourceDefinition.id)
      : record(figma.createPage());
    if (!componentSourceDefinition) {
      componentPage.name = '组件源' + suffix;
    }
    ledger.pages.componentSource = componentPage.id;
    // Main components share the visual-specification page. Compute clear space
    // before importing its frames, so foundations and source components never
    // overlap despite component construction occurring first.
    let componentX = 100;
    if (componentSourceDefinition) {
      let proposedRightEdge = 100;
      let sourceMaxX = 0;
      for (const frame of componentSourceDefinition.frames || []) {
        const x = frame.x === undefined ? proposedRightEdge : frame.x;
        const edge = x + (frame.w || 100);
        sourceMaxX = Math.max(sourceMaxX, edge);
        proposedRightEdge = Math.max(proposedRightEdge, edge + 64);
      }
      componentX = sourceMaxX + 100;
    }
    await figma.setCurrentPageAsync(componentPage);
    const definitions = data.components || [];
    const unresolvedComponents = definitions.slice();
    const familiesMap = new Map();
    function dependencies(n, result) {
      if (n.type === 'instance') {
        result.push(n.componentId);
      }
      for (const c of n.children || []) {
        dependencies(c, result);
      }
      return result;
    }
    while (unresolvedComponents.length) {
      let progress = false;
      for (let i = unresolvedComponents.length - 1; i >= 0; i--) {
        const def = unresolvedComponents[i];
        if (dependencies(def.node, []).some((id) => !sourceMap.has(id))) {
          continue;
        }
        const node = await createNode(def.node, componentPage, true);
        node.name =
          def.variant && def.variant.includes('=')
            ? def.variant
            : 'Variant=' + (def.variant || def.id);
        node.description = def.description || def.family || def.id;
        sourceMap.set(def.id, node);
        ledger.components[def.id] = node.id;
        const familyKey = def.family || def.id;
        if (!familiesMap.has(familyKey)) {
          familiesMap.set(familyKey, []);
        }
        familiesMap.get(familyKey).push({ def, node });
        unresolvedComponents.splice(i, 1);
        progress = true;
      }
      if (!progress) {
        throw new Error('组件存在循环依赖：' + unresolvedComponents.map((c) => c.id).join(', '));
      }
    }
    let familyY = 100;
    for (const [familyName, entries] of familiesMap) {
      let owner;
      if (entries.length > 1) {
        owner = record(
          figma.combineAsVariants(
            entries.map((e) => e.node),
            componentPage,
          ),
        );
        owner.name = familyName;
        owner.description = entries.map((e) => e.def.description || e.def.id).join('\n');
        owner.layoutMode = 'NONE';
        owner.fills = [];
        owner.x = componentX;
        owner.y = familyY;
        const cellW = Math.max(...entries.map((e) => e.node.width)) + 24;
        const cellH = Math.max(...entries.map((e) => e.node.height)) + 24;
        entries.forEach((e, i) => {
          e.node.x = 24 + (i % 3) * cellW;
          e.node.y = 24 + Math.floor(i / 3) * cellH;
        });
        owner.resize(
          48 + Math.min(entries.length, 3) * cellW,
          48 + Math.ceil(entries.length / 3) * cellH,
        );
        ledger.componentSets[familyName] = owner.id;
      } else {
        owner = entries[0].node;
        owner.name = familyName;
        owner.x = componentX;
        owner.y = familyY;
      }
      const labelTexts = [];
      for (const e of entries) {
        labelTexts.push(...e.node.findAll((n) => n.type === 'TEXT' && n.name === 'Label'));
      }
      const labelDefaults = new Set(labelTexts.map((text) => text.characters));
      // A set-level TEXT property's single default would collapse distinct
      // weather names or state copy. Expose one only when all defaults agree.
      // Otherwise native text and direct instance text overrides stay editable.
      if (labelTexts.length && labelDefaults.size === 1) {
        const labelProperty = owner.addComponentProperty('Label', 'TEXT', labelTexts[0].characters);
        for (const text of labelTexts) {
          await loadCurrentFonts(text);
          text.componentPropertyReferences = Object.assign(
            {},
            text.componentPropertyReferences || {},
            { characters: labelProperty },
          );
        }
        ledger.componentLabelProperties[familyName] = { exposed: true, property: labelProperty };
      } else if (labelTexts.length) {
        ledger.componentLabelProperties[familyName] = {
          exposed: false,
          reason: '保留每个变体不同的默认文字；通过原生文字层和实例文字覆盖编辑。',
        };
      }
      familyY += owner.height + 80;
    }

    for (const p of data.pages) {
      currentOperation = '导入页面：' + p.name;
      const page = pages.get(p.id);
      await figma.setCurrentPageAsync(page);
      let rightEdge = 100;
      for (const n of p.frames || []) {
        const positioned = Object.assign({}, n);
        if (positioned.x === undefined) {
          positioned.x = rightEdge;
        }
        if (positioned.y === undefined) {
          positioned.y = 100;
        }
        const node = await createNode(positioned, page, false);
        screenMap.set(n.id, node);
        ledger.screens[n.id] = node.id;
        rightEdge = Math.max(rightEdge, node.x + node.width + 64);
      }
    }

    currentOperation = '连接可点击原型';
    const requestedLinks = pendingLinks.concat(data.links || []);
    const seenLinks = new Set();
    function pageOf(node) {
      let parent = node;
      while (parent && parent.type !== 'PAGE') {
        parent = parent.parent;
      }
      return parent;
    }
    for (const link of requestedLinks) {
      const key = link.from + '→' + link.to;
      if (seenLinks.has(key)) {
        continue;
      }
      seenLinks.add(key);
      const from = nodeMap.get(link.from);
      const to = screenMap.get(link.to);
      if (!from || !to || !('setReactionsAsync' in from)) {
        ledger.unresolved.push({
          from: link.from,
          to: link.to,
          reason: '源图层或目标画板不存在，或图层不支持交互。',
        });
        continue;
      }
      if (pageOf(from) !== pageOf(to)) {
        ledger.unresolved.push({
          from: link.from,
          to: link.to,
          reason: '原型屏幕不在同一页面；请移到同一页后连接。',
        });
        continue;
      }
      try {
        await from.setReactionsAsync([
          {
            trigger: { type: 'ON_CLICK' },
            actions: [
              { type: 'NODE', destinationId: to.id, navigation: 'NAVIGATE', transition: null },
            ],
          },
        ]);
        ledger.links.push({ from: link.from, to: link.to, fromNodeId: from.id, toNodeId: to.id });
      } catch (error) {
        ledger.unresolved.push({
          from: link.from,
          to: link.to,
          reason: String(error.message || error),
        });
      }
    }
    for (const p of data.pages) {
      const points = [];
      for (const flow of data.flows || []) {
        if (flow.pageId !== p.id) {
          continue;
        }
        const screen = screenMap.get(flow.screenId);
        if (!screen || pageOf(screen) !== pages.get(p.id)) {
          ledger.unresolved.push({ flow: flow.name, reason: '流程起点不存在或页面不符。' });
          continue;
        }
        points.push({ nodeId: screen.id, name: flow.name });
      }
      pages.get(p.id).flowStartingPoints = points;
    }

    currentOperation = '检查导入结果';
    ledger.createdNodeIds = [...new Set(ledger.createdNodeIds)];
    ledger.mutatedNodeIds = [...new Set(ledger.mutatedNodeIds)];
    const affectedIds = [...new Set(ledger.createdNodeIds.concat(ledger.mutatedNodeIds))];
    const createdNodes = await Promise.all(affectedIds.map((id) => figma.getNodeByIdAsync(id)));
    for (const node of createdNodes) {
      if (!node) {
        continue;
      }
      ledger.counts[node.type] = (ledger.counts[node.type] || 0) + 1;
      if (node.type === 'TEXT' && node.hasMissingFont) {
        ledger.warnings.push('文字图层缺少字体：' + node.name + ' (' + node.id + ')');
      }
    }
    ledger.counts.variables = Object.keys(ledger.variables).length;
    ledger.counts.textStyles = Object.keys(ledger.styles).length;
    ledger.counts.links = ledger.links.length;
    ledger.counts.unresolved = ledger.unresolved.length;
    const firstFlow = (data.flows || [])[0];
    const firstPage =
      (firstFlow && pages.get(firstFlow.pageId)) ||
      pages.get(data.pages[0] && data.pages[0].id) ||
      componentPage;
    await figma.setCurrentPageAsync(firstPage);
    const firstScreen =
      (firstFlow && screenMap.get(firstFlow.screenId)) ||
      firstPage.children.find((n) => n.type === 'FRAME');
    if (firstScreen) {
      firstPage.selection = [firstScreen];
      figma.viewport.scrollAndZoomIntoView([firstScreen]);
    }
    ledger.status = ledger.unresolved.length ? 'imported-with-unresolved-links' : 'imported';
    return ledger;
  } catch (error) {
    error.moodskyReport = Object.assign(ledger, {
      status: 'partial',
      operation: currentOperation,
      error: String(error.message || error),
    });
    throw error;
  }
}

// Guard keeps the importer core reusable in a local Node validation harness.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildDesign, validateDesign, normalizeHex, colorParts };
}

if (typeof figma !== 'undefined' && typeof __html__ !== 'undefined') {
  figma.showUI(__html__, { width: 460, height: 600, themeColors: true });
  let busy = false;
  figma.ui.onmessage = async (message) => {
    if (!message || message.type !== 'import') {
      return;
    }
    if (busy) {
      return;
    }
    busy = true;
    figma.ui.postMessage({ type: 'running' });
    try {
      const report = await buildDesign(figma, message.data);
      figma.ui.postMessage({ type: 'result', report });
    } catch (error) {
      figma.ui.postMessage({
        type: 'error',
        error: String(error.message || error),
        report: error.moodskyReport || null,
      });
    } finally {
      busy = false;
    }
  };
}
