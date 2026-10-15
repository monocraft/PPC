/* Always-visible category comparison. Values and chart colors come from the dashboard. */
(function () {
  'use strict';
  const palette = ['#895EF6', '#6984ED', '#4DA1F7', '#20CBDD', '#7AE3A9', '#FFC63B'];
  let sequence = 0;
  const numeric = value => value === null || value === undefined || value === '' || typeof value === 'boolean' || !Number.isFinite(Number(value)) ? null : Number(value);
  const key = value => value && typeof value === 'object' ? String(value.id ?? value.category ?? value.name ?? value.label ?? '') : String(value ?? '');
  const label = value => value && typeof value === 'object' ? String(value.label ?? value.name ?? value.category ?? value.id ?? '') : String(value ?? '');
  const isAll = value => /^(all|all categories)?$/i.test(key(value));
  const canonical = value => isAll(value) ? 'all' : key(value);
  const validColor = value => typeof value === 'string' && /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value);
  function selectedKeys(value, available) {
    const keys = [...new Set((Array.isArray(value) ? value : [value]).map(canonical))];
    if (keys.includes('all')) return ['all'];
    const selection = keys.filter(id => available.has(id));
    return selection.length ? selection : ['all'];
  }
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  function money(value, currency, precise) {
    const amount = numeric(value);
    if (amount === null) return 'Unavailable';
    if (precise) return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
    const absolute = Math.abs(amount), prefix = currency === 'USD' ? '$' : `${currency} `;
    const sign = amount < 0 ? '−' : '';
    if (absolute >= 1e9) return `${sign}${prefix}${(absolute / 1e9).toFixed(2)}B`;
    if (absolute >= 1e6) return `${sign}${prefix}${(absolute / 1e6).toFixed(2)}M`;
    if (absolute >= 1e3) return `${sign}${prefix}${(absolute / 1e3).toFixed(1)}K`;
    return `${sign}${prefix}${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(absolute)}`;
  }
  function share(value) {
    const amount = numeric(value);
    return amount === null ? null : `${amount < 0 ? '−' : ''}${(Math.abs(amount) * 100).toFixed(1)}%`;
  }
  function mount(container, initial) {
    if (!container || typeof container.append !== 'function') throw new TypeError('Category strip requires a container element.');
    let config = { categories: [], selected: ['all'], categoryColors: {}, items: [], period: '', ...initial };
    let destroyed = false;
    let available = new Set(['all']);
    const fallbackColors = new Map();
    const identifier = `hx-category-strip-${++sequence}`;
    const strip = node('section', 'hx-category-strip');
    const header = node('div', 'hx-category-strip-header');
    const heading = node('h2', 'hx-category-strip-title', 'Compare categories');
    heading.id = `${identifier}-title`;
    const context = node('p', 'hx-category-strip-context');
    context.id = `${identifier}-context`;
    header.append(heading, context);
    const grid = node('div', 'hx-category-strip-grid');
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-labelledby', heading.id);
    grid.setAttribute('aria-describedby', context.id);
    strip.append(header, grid);
    container.append(strip);
    const tiles = new Map();
    const view = container.ownerDocument?.defaultView || window;
    const reducedMotion = view.matchMedia?.('(prefers-reduced-motion: reduce)');
    const movements = new Map();
    const cancelMovements = () => { for (const animation of movements.values()) animation.cancel(); movements.clear(); };
    const motionChanged = () => { if (reducedMotion?.matches) cancelMovements(); };
    reducedMotion?.addEventListener?.('change', motionChanged);

    function makeTile(categoryKey) {
      const button = node('button', 'hx-category-tile');
      button.type = 'button';
      button.dataset.category = categoryKey;
      const top = node('span', 'hx-category-tile-top');
      const name = node('span', 'hx-category-tile-name');
      top.append(name);
      const metrics = node('span', 'hx-category-tile-metrics');
      const value = node('span', 'hx-category-tile-value');
      const proportion = node('span', 'hx-category-tile-share');
      metrics.append(value, proportion);
      button.append(top, metrics);
      button.addEventListener('click', () => {
        if (destroyed) return;
        const current = selectedKeys(config.selected, available);
        if (categoryKey === 'all' && current[0] === 'all') return;
        let selection;
        if (categoryKey === 'all') selection = ['all'];
        else if (current.includes('all')) selection = [categoryKey];
        else if (current.includes(categoryKey)) selection = current.filter(id => id !== categoryKey);
        else selection = [...current, categoryKey];
        if (!selection.length) selection = ['all'];
        config = { ...config, selected: selection };
        render();
        if (typeof config.onChange === 'function') config.onChange([...selection]);
      });
      return { button, name, value, proportion };
    }
    function render() {
      const period = config.period && typeof config.period === 'object' ? config.period : { label: String(config.period ?? '') };
      const currency = /^[A-Z]{3}$/.test(period.currency || '') ? period.currency : 'USD';
      const items = Array.isArray(config.items) ? config.items : [];
      const source = Array.isArray(config.categories) && config.categories.length ? config.categories : items.map(item => item.category);
      const seen = new Set(['all']);
      const categories = [{ id: 'all', label: 'All categories' }, ...source.filter(category => {
        const id = canonical(category);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })];
      const itemById = new Map();
      for (const item of items) if (item && !itemById.has(canonical(item.category))) itemById.set(canonical(item.category), item);
      categories.sort((left, right) => {
        const a = canonical(left), b = canonical(right);
        if (a === 'all' || b === 'all') return a === b ? 0 : a === 'all' ? -1 : 1;
        const av = numeric(itemById.get(a)?.revenue), bv = numeric(itemById.get(b)?.revenue);
        if (av === null || bv === null) { if (av !== bv) return av === null ? 1 : -1; }
        else if (av !== bv) return av > bv ? -1 : 1;
        return a < b ? -1 : a > b ? 1 : 0;
      });
      const reordered = categories.length !== grid.children.length || categories.some((category, index) => grid.children[index]?.dataset.category !== canonical(category));
      const focused = [...tiles.values()].find(tile => tile.button === document.activeElement)?.button;
      const previous = new Map();
      if (reordered) {
        // Retarget from the visible position if another year is chosen mid-motion.
        if (!reducedMotion?.matches) for (const { button } of tiles.values()) {
          if (typeof button.animate !== 'function') continue;
          const rect = button.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) previous.set(button, rect);
        }
        cancelMovements();
      }
      available = seen;
      const selection = selectedKeys(config.selected, available);
      config = { ...config, selected: selection };
      // Stable during reorder and period updates, even without a supplied chart palette.
      [...available].filter(id => id !== 'all').sort().forEach(id => {
        if (!fallbackColors.has(id)) fallbackColors.set(id, palette[fallbackColors.size % palette.length]);
      });
      const periodText = period.label ?? period.period ?? period.year ?? '';
      const basisText = period.basis ?? period.kind ?? period.sourceKind ?? '';
      context.textContent = [periodText, basisText, 'Source revenue, highest to lowest · % of portfolio', 'Select categories to compare'].filter(Boolean).join(' · ');
      const ordered = [];
      categories.forEach(category => {
        const id = canonical(category), name = isAll(category) ? 'All categories' : label(category);
        const item = itemById.get(id) || {};
        let tile = tiles.get(id);
        if (!tile) { tile = makeTile(id); tiles.set(id, tile); }
        const selected = selection.includes(id);
        const mappedColor = config.categoryColors instanceof Map ? config.categoryColors.get(id) : config.categoryColors?.[id];
        const color = validColor(mappedColor) ? mappedColor : validColor(item.color) ? item.color : id === 'all' ? '#B6A0F1' : fallbackColors.get(id);
        tile.button.style.setProperty('--category-color', color);
        tile.button.classList.toggle('is-selected', selected);
        tile.button.setAttribute('aria-pressed', String(selected));
        tile.name.textContent = name;
        tile.value.textContent = money(item.revenue, currency, false);
        tile.value.classList.toggle('is-unavailable', numeric(item.revenue) === null);
        const ratio = share(item.share);
        tile.proportion.textContent = ratio ?? 'Share unavailable';
        tile.proportion.classList.toggle('is-unavailable', ratio === null);
        const productCount = numeric(item.productCount);
        const detail = [name, `${periodText} ${basisText}`.trim(), `Source revenue ${money(item.revenue, currency, true)}`, ratio === null ? 'Portfolio share unavailable' : `${ratio} of portfolio`, productCount === null ? null : `${new Intl.NumberFormat('en-US').format(productCount)} product groups`].filter(Boolean).join(' · ');
        const action=id==='all'?'Show the combined portfolio and clear individual selections':selected?'Remove this category from comparison':'Add this category to comparison';
        tile.button.title = `${detail} · ${action}`;
        tile.button.setAttribute('aria-label', `${detail}. ${action}.`);
        ordered.push(tile.button);
      });
      for (const [id, tile] of tiles) if (!seen.has(id)) { tile.button.remove(); tiles.delete(id); }
      // Reuse keyed buttons so selection and color stay with the category, not its rank.
      ordered.forEach((button, index) => {
        if (grid.children[index] !== button) grid.insertBefore(button, grid.children[index] || null);
      });
      if (focused?.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
      for (const [button, before] of previous) {
        if (!button.isConnected) continue;
        const after = button.getBoundingClientRect(), dx = before.left - after.left, dy = before.top - after.top;
        if (Math.abs(dx) < .5 && Math.abs(dy) < .5) continue;
        const animation = button.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], { duration: 220, easing: 'cubic-bezier(.2,.75,.2,1)' });
        movements.set(button, animation);
        animation.onfinish = animation.oncancel = () => { if (movements.get(button) === animation) movements.delete(button); };
      }
    }
    render();
    return {
      update(next) { if (!destroyed) { config = { ...config, ...next }; render(); } },
      destroy() { if (!destroyed) { destroyed = true; cancelMovements(); reducedMotion?.removeEventListener?.('change', motionChanged); strip.remove(); tiles.clear(); } }
    };
  }
  window.HX_CATEGORY_STRIP = Object.freeze({ mount });
})();
