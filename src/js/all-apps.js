/**
 * All apps: every app on the TV in one grid, opened from the All apps tile on
 * the home row. OK opens an app, Back closes. Opening an app that isn't on
 * the home row used to mean pinning it in Settings, opening it, and removing
 * it again.
 */

import {BUNDLED_SETTINGS_ICON, listInstalledApps} from './apps.js';
import {lazyLoadIcon} from './app-catalog.js';
import {REMOTE_KEY} from './remote.js';

const LAUNCH_HOME_ID = 'org.webosbrew.lounge.launcher';
// Holding OK this long on an app picks it up to move it.
const LONG_PRESS_MS = 600;
const HINT = 'OK opens an app · Hold OK to move it · Back closes';
const MOVE_HINT = 'Arrows move the app · OK places it · Back cancels';

/**
 * `apps` in the user's saved `order` (app ids); apps it doesn't list keep
 * their current order, after the listed ones.
 */
export function orderApps(apps, order) {
  const rank = Array.isArray(order) ? order : [];
  return apps.map(function (app, i) {
    const pos = rank.indexOf(app && app.id);
    return {app: app, key: pos >= 0 ? pos : rank.length + i};
  }).sort(function (a, b) { return a.key - b.key; }).map(function (x) { return x.app; });
}

/**
 * @param {{mount: Element, focus: object, launch: function(object), openTvSettings: function()}} options
 *   mount: inside the focus manager's root; launch(app): open an app record;
 *   openTvSettings(): the TV's own Settings (first tile of the grid).
 */
export function createAllApps(options) {
  let panel = null;
  let grid = null;
  let open = false;
  let listed = null;
  let loadGen = 0;
  let hint = null;
  // OK held on an app tile: {tile, timer} until it is released or picked up.
  let pressed = null;
  // The app tile being moved, and where it started (for Back).
  let moving = null;
  let ignoreEnterUp = false;

  function build() {
    panel = document.createElement('div');
    panel.className = 'all-apps';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'All apps');

    const head = document.createElement('div');
    head.className = 'all-apps-head';
    const title = document.createElement('h2');
    title.textContent = 'All apps';
    hint = document.createElement('span');
    hint.className = 'all-apps-hint';
    hint.textContent = HINT;
    head.appendChild(title);
    head.appendChild(hint);

    grid = document.createElement('div');
    grid.className = 'all-apps-grid';

    panel.appendChild(head);
    panel.appendChild(grid);
    options.mount.appendChild(panel);
    // Capture phase: ahead of the focus manager, which opens a tile as soon
    // as OK goes down and would never see a long press.
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
  }

  function appTiles() {
    return Array.prototype.slice.call(grid.querySelectorAll('.all-apps-tile[data-app-id]'));
  }

  function stop(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function focusTile(tile) {
    if (!(options.focus.focusElement && options.focus.focusElement(tile))) {
      try { tile.focus({preventScroll: true}); } catch (err) { /* ignore */ }
    }
    if (tile.scrollIntoView) tile.scrollIntoView({block: 'nearest'});
  }

  function startMove(tile) {
    moving = {tile: tile, start: appTiles().map(function (t) { return t.dataset.appId; })};
    ignoreEnterUp = true;
    tile.classList.add('moving');
    hint.textContent = MOVE_HINT;
  }

  function endMove() {
    if (!moving) return;
    moving.tile.classList.remove('moving');
    moving = null;
    hint.textContent = HINT;
  }

  // Tiles per row, from where they sit on screen.
  function columns(tiles) {
    const top = tiles[0].offsetTop;
    let n = 0;
    while (n < tiles.length && tiles[n].offsetTop === top) n += 1;
    return n || 1;
  }

  function moveBy(code) {
    const tiles = Array.prototype.slice.call(grid.children).filter(function (el) {
      return el.classList.contains('all-apps-tile');
    });
    const from = tiles.indexOf(moving.tile);
    const cols = columns(tiles);
    let to = from;
    if (code === REMOTE_KEY.LEFT) to = from - 1;
    else if (code === REMOTE_KEY.RIGHT) to = from + 1;
    else if (code === REMOTE_KEY.UP) to = from - cols;
    else if (code === REMOTE_KEY.DOWN) to = from + cols;
    // TV Settings stays first; apps move among themselves.
    const first = tiles[0] && !tiles[0].dataset.appId ? 1 : 0;
    to = Math.max(first, Math.min(tiles.length - 1, to));
    if (to === from) return;
    const ref = to > from ? tiles[to].nextSibling : tiles[to];
    grid.insertBefore(moving.tile, ref);
    appTiles().forEach(function (t, i) { t.dataset.focusIndex = String(5000 + i); });
    focusTile(moving.tile);
  }

  function placeMove() {
    const order = appTiles().map(function (t) { return t.dataset.appId; });
    const byId = {};
    (listed || []).forEach(function (app) { byId[app.id] = app; });
    listed = order.map(function (id) { return byId[id]; }).filter(Boolean);
    endMove();
    if (options.saveOrder) options.saveOrder(order);
  }

  function cancelMove() {
    const id = moving.tile.dataset.appId;
    endMove();
    render(listed);
    const tile = grid.querySelector('[data-app-id="' + cssEscape(id) + '"]');
    if (tile) focusTile(tile);
  }

  function onKeyDown(event) {
    if (!open) return;
    const code = event.keyCode || event.which;
    if (moving) {
      if (code === REMOTE_KEY.LEFT || code === REMOTE_KEY.RIGHT ||
          code === REMOTE_KEY.UP || code === REMOTE_KEY.DOWN) {
        stop(event);
        moveBy(code);
      } else if (code === REMOTE_KEY.ENTER) {
        stop(event);
        if (!event.repeat && !ignoreEnterUp) placeMove();
      } else if (code === REMOTE_KEY.BACK || code === 27) {
        stop(event);
        cancelMove();
      }
      return;
    }
    if (code !== REMOTE_KEY.ENTER) return;
    const tile = document.activeElement;
    if (!(tile && grid.contains(tile) && tile.dataset && tile.dataset.appId)) return;
    stop(event);
    if (pressed) return; // auto-repeat while held
    pressed = {
      tile: tile,
      timer: setTimeout(function () {
        const held = pressed;
        pressed = null;
        if (held && open) startMove(held.tile);
      }, LONG_PRESS_MS)
    };
  }

  function onKeyUp(event) {
    const code = event.keyCode || event.which;
    if (code !== REMOTE_KEY.ENTER) return;
    if (ignoreEnterUp) {
      // The release of the long press that picked the app up.
      ignoreEnterUp = false;
      stop(event);
      return;
    }
    if (!pressed) return;
    stop(event);
    clearTimeout(pressed.timer);
    const tile = pressed.tile;
    pressed = null;
    if (open) tile.click();
  }

  function badge(title) {
    const fallback = document.createElement('span');
    fallback.className = 'app-fallback';
    fallback.textContent = String(title || '').slice(0, 2).toUpperCase();
    return fallback;
  }

  function tile(app, index) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'app-tile all-apps-tile focusable';
    button.dataset.focusIndex = String(5000 + index);
    button.dataset.appId = app.id;
    button.setAttribute('aria-label', app.title);

    const label = document.createElement('span');
    label.className = 'app-label';
    label.textContent = app.title;

    if (app.icon) {
      const img = document.createElement('img');
      img.className = 'app-icon';
      img.alt = '';
      img.addEventListener('error', function () {
        if (img.parentNode) img.parentNode.replaceChild(badge(app.title), img);
      });
      // Read as root only when it scrolls into view: a TV can have dozens.
      lazyLoadIcon(img, app.icon, grid);
      button.appendChild(img);
    } else {
      button.appendChild(badge(app.title));
    }
    button.appendChild(label);

    button.addEventListener('click', function () {
      options.launch(app);
    });
    return button;
  }

  // TV Settings: first tile of the grid (off the home row by default, see apps.js).
  function tvSettingsTile() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'app-tile all-apps-tile settings-tile focusable';
    button.dataset.focusIndex = '4999';
    button.dataset.action = 'tv-settings';
    button.setAttribute('aria-label', 'TV Settings');
    const img = document.createElement('img');
    img.className = 'app-icon';
    img.alt = '';
    img.addEventListener('error', function () {
      if (img.parentNode) img.parentNode.replaceChild(badge('\u2699'), img);
    });
    img.src = BUNDLED_SETTINGS_ICON;
    button.appendChild(img);
    const label = document.createElement('span');
    label.className = 'app-label';
    label.textContent = 'TV Settings';
    button.appendChild(label);
    button.addEventListener('click', function () {
      if (options.openTvSettings) options.openTvSettings();
    });
    return button;
  }

  function render(apps) {
    grid.innerHTML = '';
    if (options.openTvSettings) grid.appendChild(tvSettingsTile());
    if (!apps.length) {
      const empty = document.createElement('p');
      empty.className = 'all-apps-note';
      empty.textContent = 'Couldn’t read the TV’s apps. This needs root (Homebrew Channel).';
      grid.appendChild(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    apps.forEach(function (app, i) {
      fragment.appendChild(tile(app, i));
    });
    grid.appendChild(fragment);
  }

  async function load() {
    const apps = (await listInstalledApps()).filter(function (app) {
      return app && app.id && !app.hidden && app.id !== LAUNCH_HOME_ID;
    });
    apps.sort(function (a, b) {
      return (a.title || a.id).localeCompare(b.title || b.id);
    });
    return orderApps(apps, options.getOrder ? options.getOrder() : []);
  }

  async function show() {
    if (!panel) build();
    open = true;
    panel.hidden = false;
    document.body.classList.add('all-apps-open');
    grid.scrollTop = 0;

    // Show the last list at once, then read the TV's apps again every time,
    // so an app installed meanwhile shows up without waiting for a cache.
    if (listed) {
      render(listed);
      options.focus.focusWithin('.all-apps');
    } else {
      grid.innerHTML = '';
      const loading = document.createElement('p');
      loading.className = 'all-apps-note';
      loading.textContent = 'Reading the TV’s apps…';
      grid.appendChild(loading);
    }
    const gen = ++loadGen;
    const apps = await load();
    if (gen !== loadGen || !open || moving) return;
    const changed = !listed || listKey(apps) !== listKey(listed);
    // Keep the old list if a read fails rather than blanking the grid.
    if (!apps.length && listed) return;
    listed = apps;
    if (!changed) return;
    const focused = document.activeElement && grid.contains(document.activeElement)
      ? document.activeElement.dataset.appId : null;
    render(apps);
    const again = focused && grid.querySelector('[data-app-id="' + cssEscape(focused) + '"]');
    if (!(again && options.focus.focusElement(again))) options.focus.focusWithin('.all-apps');
  }

  function listKey(apps) {
    return apps.map(function (app) { return app.id + '|' + (app.title || ''); }).join('\n');
  }

  function cssEscape(value) {
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function hide() {
    if (!panel || !open) return;
    if (pressed) clearTimeout(pressed.timer);
    pressed = null;
    ignoreEnterUp = false;
    endMove();
    open = false;
    loadGen += 1;
    panel.hidden = true;
    document.body.classList.remove('all-apps-open');
    // Back on the All apps tile, however it was opened (OK, or a pointer click).
    const launcher = document.querySelector('#app-grid [data-action="all-apps"]');
    if (!(launcher && options.focus.focusElement(launcher))) options.focus.focusHomeDock();
  }

  return {
    show: show,
    hide: hide,
    isOpen: function () { return open; },
    /** After Launch Home regains input: stay on the app the remote was on. */
    refocus: function () {
      const active = document.activeElement;
      if (panel && active && panel.contains(active) && options.focus.focusElement(active)) return;
      options.focus.focusWithin('.all-apps');
    }
  };
}
