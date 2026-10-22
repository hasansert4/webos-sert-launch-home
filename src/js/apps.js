import {launchApp, launchAppViaRoot, listApps} from './luna.js';
import {
  isAppInstalled,
  isCatalogComplete,
  loadAppCatalog,
  normalizeAppRecord,
  prefersBundledIcons,
  resolvePinnedApp,
  setIconSrc
} from './app-catalog.js';
import {getAppIdCandidates, getBuiltinAppIcon} from './app-icons.js';

export const BUNDLED_SETTINGS_ICON = 'assets/app-icons/tv-settings.png';

/**
 * Launch an app by trying every candidate id, sandboxed then root.
 * Prime Video is `amazon.html` on older TVs and native `amazon` on current
 * OLEDs — the first id often 404s or hangs, so we must fall through.
 */
export async function launchAppCandidates(ids) {
  const unique = [];
  (ids || []).forEach(function (id) {
    if (id && unique.indexOf(id) < 0) unique.push(id);
  });

  for (let i = 0; i < unique.length; i += 1) {
    try {
      await launchApp(unique[i]);
      return unique[i];
    } catch (err) {
      // Missing id or sandboxed launch denied (native Prime Video).
    }
    try {
      await launchAppViaRoot(unique[i]);
      return unique[i];
    } catch (err2) {
      // Try the next candidate.
    }
  }
  return '';
}

const APP_ID = 'org.webosbrew.lounge.launcher';

export function createAppGrid(container, getConfig, options) {
  let catalog = {};

  // Each tile's app: a late app list updates tiles in place (see
  // retryNames), which leaves the remote's focus where it is.
  const tileApps = new WeakMap();

  function fallbackBadge(title) {
    const fallback = document.createElement('span');
    fallback.className = 'app-fallback';
    fallback.textContent = String(title || '').slice(0, 2).toUpperCase();
    return fallback;
  }


  function applyIconTileColor(img) {
    if (!img || !img.parentNode) return;

    const tile = img.closest('.app-tile');
    if (!tile) return;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = 24;
      canvas.height = 24;

      const context = canvas.getContext('2d', {willReadFrequently: true});
      if (!context) return;

      context.drawImage(img, 0, 0, 24, 24);

      const pixels = context.getImageData(0, 0, 24, 24).data;
      let r = 0;
      let g = 0;
      let b = 0;
      let total = 0;

      for (let i = 0; i < pixels.length; i += 4) {
        const alpha = pixels[i + 3] / 255;
        if (alpha < 0.3) continue;

        const red = pixels[i];
        const green = pixels[i + 1];
        const blue = pixels[i + 2];

        const brightness = Math.max(red, green, blue);
        const saturation = brightness - Math.min(red, green, blue);

        if (brightness < 35 || saturation < 25) continue;

        const weight = alpha * (1 + saturation / 255);

        r += red * weight;
        g += green * weight;
        b += blue * weight;
        total += weight;
      }

      if (!total) return;

      r = Math.round(r / total);
      g = Math.round(g / total);
      b = Math.round(b / total);

      tile.style.setProperty('--tile-logo-rgb', r + ', ' + g + ', ' + b);
      tile.classList.add('logo-colored-tile');
    } catch (err) {
      // Cross-origin or unreadable images retain the existing glass theme.
    }
  }

  function watchIconTileColor(img) {
    if (!img) return;

    img.addEventListener('load', function () {
      applyIconTileColor(img);
    });

    if (img.complete && img.naturalWidth > 0) {
      applyIconTileColor(img);
    }
  }

  function tileIcon(app) {
    if (!app.icon) return fallbackBadge(app.title);
    const img = document.createElement('img');
    img.className = 'app-icon';
    watchIconTileColor(img);
    img.alt = '';
    img.addEventListener('error', function () {
      const fallbackIcon = getBuiltinAppIcon(app.id);
      if (fallbackIcon && img.dataset.iconUrl !== fallbackIcon) {
        setIconSrc(img, fallbackIcon);
        return;
      }
      if (img.parentNode) img.parentNode.replaceChild(fallbackBadge(app.title), img);
    });
    setIconSrc(img, app.icon, {keep: true});
    return img;
  }

  function makeTile(app, index) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'app-tile focusable';
    button.dataset.focusIndex = String(index);
    button.dataset.appId = app.id;
    button.setAttribute('aria-label', app.title);

    const label = document.createElement('span');
    label.className = 'app-label';
    label.textContent = app.title;

    const appIcon = tileIcon(app);
    button.appendChild(appIcon);
    if (appIcon.tagName === 'IMG' && appIcon.complete) {
      applyIconTileColor(appIcon);
    }
    button.appendChild(label);

    tileApps.set(button, app);
    button.addEventListener('click', function () {
      openApp(tileApps.get(button) || app);
    });

    return button;
  }

  function updateTile(button, app) {
    tileApps.set(button, app);
    button.setAttribute('aria-label', app.title);
    const label = button.querySelector('.app-label');
    if (label) label.textContent = app.title;
    button.classList.remove('logo-colored-tile');
    button.style.removeProperty('--tile-logo-rgb');

    const icon = tileIcon(app);
    const old = button.querySelector('.app-icon, .app-fallback');
    if (old) button.replaceChild(icon, old);
    else button.insertBefore(icon, label);

    if (icon.tagName === 'IMG' && icon.complete && icon.naturalWidth > 0) {
      applyIconTileColor(icon);
    }
  }

  function makeSettingsTile(index, iconUrl) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'app-tile settings-tile focusable';
    button.dataset.focusIndex = String(index);
    button.dataset.action = 'tv-settings';
    button.setAttribute('aria-label', 'TV Settings');

    const img = document.createElement('img');
    img.className = 'app-icon';
    watchIconTileColor(img);
    img.alt = '';
    img.addEventListener('error', function () {
      if (img.dataset.iconUrl !== BUNDLED_SETTINGS_ICON) {
        setIconSrc(img, BUNDLED_SETTINGS_ICON);
        return;
      }
      img.remove();
      const fallback = document.createElement('span');
      fallback.className = 'app-fallback';
      fallback.textContent = '\u2699';
      button.insertBefore(fallback, label);
    });
    setIconSrc(img, iconUrl || BUNDLED_SETTINGS_ICON);
    button.appendChild(img);

    const label = document.createElement('span');
    label.className = 'app-label';
    label.textContent = 'TV Settings';
    button.appendChild(label);

    button.addEventListener('click', function () {
      if (options.onOpenTvSettings) options.onOpenTvSettings();
    });

    return button;
  }

  // All apps: opens the grid of every app on the TV (all-apps.js).
  const ALL_APPS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor">' +
    [3, 9.5, 16].map(function (y) {
      return [3, 9.5, 16].map(function (x) {
        return '<rect x="' + x + '" y="' + y + '" width="5" height="5" rx="1.4"/>';
      }).join('');
    }).join('') + '</g></svg>';

  function makeAllAppsTile(index) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'app-tile all-apps-launcher focusable';
    button.dataset.focusIndex = String(index);
    button.dataset.action = 'all-apps';
    button.setAttribute('aria-label', 'All apps');

    const icon = document.createElement('span');
    icon.className = 'app-fallback all-apps-icon';
    icon.innerHTML = ALL_APPS_ICON;
    button.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'app-label';
    label.textContent = 'All apps';
    button.appendChild(label);

    button.addEventListener('click', function () {
      if (options.onOpenAllApps) options.onOpenAllApps();
    });
    return button;
  }

  async function openApp(app) {
    if (options.onBeforeLaunch) options.onBeforeLaunch();

    const ids = [];
    function addId(id) {
      if (id && ids.indexOf(id) < 0) ids.push(id);
    }
    if (app && Array.isArray(app.ids)) {
      app.ids.forEach(addId);
    }
    addId(app && app.launchId);
    getAppIdCandidates((app && app.id) || '').forEach(addId);
    getAppIdCandidates((app && app.launchId) || '').forEach(addId);

    const launched = await launchAppCandidates(ids);
    if (launched) return launched;

    const label = app && app.title ? app.title : (app && app.id) || 'app';
    if (options.onToast) options.onToast('Could not launch ' + label);
    return '';
  }

  // What the current dock was built from; see refresh({reuse}).
  let builtSignature = '';
  let lastSignature = '';

  // Built without the TV's full app list (root not answering yet, Luna late
  // after power-on): ask again a few times and fill names and icons in place.
  const NAME_RETRY_MS = [20000, 60000, 180000];
  let nameRetry = null;
  let nameRetries = 0;

  function scheduleNameRetry(listed) {
    if (nameRetry) clearTimeout(nameRetry);
    nameRetry = null;
    if (listed) {
      nameRetries = 0;
      return;
    }
    if (nameRetries >= NAME_RETRY_MS.length) return;
    nameRetry = setTimeout(retryNames, NAME_RETRY_MS[nameRetries]);
    nameRetries += 1;
  }

  async function retryNames() {
    nameRetry = null;
    const fresh = await loadAppCatalog();
    const listed = isCatalogComplete(fresh);
    const listedAny = Object.keys(fresh).length > 0;
    const tiles = container.querySelectorAll('.app-tile[data-app-id]');
    for (let i = 0; i < tiles.length; i += 1) {
      const current = tileApps.get(tiles[i]);
      if (!current || current.custom) continue;
      const info = await resolvePinnedApp(tiles[i].dataset.appId, fresh);
      if (info.title !== current.title || info.icon !== current.icon) updateTile(tiles[i], info);
    }
    if (listedAny) {
      catalog = fresh;
      builtSignature = lastSignature;
    }
    scheduleNameRetry(listed);
  }

  /**
   * @param {{reuse?: boolean}} [opts] reuse: keep the current dock when its
   *   inputs are unchanged. Returning from an app used to redo every Luna
   *   lookup (app list + one getAppInfo per pinned app) and redraw the dock.
   */
  async function refresh(opts) {
    const config = getConfig();
    const pinned = (config.launcher && config.launcher.pinnedApps) || [];
    const customApps = (config.launcher && config.launcher.customApps) || [];
    const customById = {};
    customApps.forEach(function (entry) {
      if (entry && entry.id) customById[entry.id] = entry;
    });
    const scaleBySize = {'x-small': 0.62, small: 0.78, medium: 1, large: 1.28, 'x-large': 1.48};
    const iconSize = (config.launcher && config.launcher.iconSize) || 'medium';
    container.style.setProperty('--tile-scale', String(scaleBySize[iconSize] || 1));
    const allAppsTile = !(config.launcher && config.launcher.allAppsTile === false);
    const numberKeys = !(config.launcher && config.launcher.numberKeyLaunch === false);
    // TV Settings lives in All apps unless asked for on the home row.
    const tvSettingsOnHome = !!(config.launcher && config.launcher.tvSettingsOnHome);
    const signature = JSON.stringify([pinned, customApps, iconSize, prefersBundledIcons(), allAppsTile, numberKeys,
      tvSettingsOnHome]);
    if (opts && opts.reuse && signature === builtSignature && container.children.length) {
      return;
    }
    const tiles = [];

    catalog = await loadAppCatalog();

    for (let i = 0; i < pinned.length; i += 1) {
      const custom = customById[pinned[i]];
      if (custom) {
        tiles.push(makeTile({
          id: custom.launchId || custom.id,
          launchId: custom.launchId || custom.id,
          title: custom.title || custom.launchId || custom.id,
          icon: custom.icon || '',
          custom: true
        }, i));
        continue;
      }
      // Pinned but not on this TV (a default pin, or an app since removed):
      // no tile that can't open. Settings still lists it, marked.
      if (!isAppInstalled(catalog, pinned[i])) continue;
      const info = await resolvePinnedApp(pinned[i], catalog);
      tiles.push(makeTile(info, i));
    }

    let settingsIcon = '';
    if (!prefersBundledIcons()) {
      const settingsApp = catalog['com.webos.app.settings'] || catalog['com.palm.app.settings'];
      settingsIcon = (settingsApp && settingsApp.icon) || '';
    }
    if (allAppsTile) tiles.push(makeAllAppsTile(pinned.length));
    if (tvSettingsOnHome) tiles.push(makeSettingsTile(pinned.length + 1, settingsIcon));

    // Number the home row 1-9 in the order it reads (pinned apps, then All
    // apps, then TV Settings) so the remote's number keys open a tile by
    // position. The badge is the visible half of the shortcut.
    if (numberKeys) {
      tiles.slice(0, 9).forEach(function (tile, i) {
        const key = String(i + 1);
        tile.dataset.appKey = key;
        const badge = document.createElement('span');
        badge.className = 'app-key';
        badge.setAttribute('aria-hidden', 'true');
        badge.textContent = key;
        tile.appendChild(badge);
      });
    }

    // Swap in the freshly built tiles atomically. Clearing the container up
    // front instead would leave the dock empty (and unselectable) for the whole
    // async catalog fetch above -- and if that fetch stalls after a failed app
    // launch, the dock would stay empty and focus would never be restored.
    const fragment = document.createDocumentFragment();
    for (const tile of tiles) {
      fragment.appendChild(tile);
    }
    container.innerHTML = '';
    container.appendChild(fragment);
    // Only reuse a dock built from a real app list: at power-on the Luna
    // services can be late, and that first dock uses fallback titles/icons.
    builtSignature = Object.keys(catalog).length ? signature : '';
    lastSignature = signature;
    scheduleNameRetry(isCatalogComplete(catalog));
  }

  return {
    refresh: refresh,
    isLoungeApp: function (id) {
      return id === APP_ID;
    },
    launchApp: openApp,
    /**
     * Open the home row tile numbered `n` (1-9), exactly as pressing Select on
     * it would. False when there is no such tile.
     */
    launchByNumber: function (n) {
      const config = getConfig();
      if (config.launcher && config.launcher.numberKeyLaunch === false) return false;
      const num = Number(n);
      if (!(num >= 1 && num <= 9)) return false;
      const tile = container.querySelector('.app-tile[data-app-key="' + num + '"]');
      if (!tile) return false;
      tile.click();
      return true;
    }
  };
}

export async function listInstalledApps(options) {
  const includeHidden = !!(options && options.includeHidden);
  try {
    const res = await listApps();
    return (res.apps || [])
      .filter(function (app) {
        const id = (app && (app.id || app.appId)) || '';
        if (includeHidden) return true;
        const record = (app && app.appInfo) || app || {};
        return record.visible !== false;
      })
      .map(function (app) {
        // hidden: a system or background app LG keeps off its own home screen.
        const record = (app && app.appInfo) || app || {};
        return Object.assign(normalizeAppRecord(app, app && app.id), {hidden: record.visible === false});
      });
  } catch (err) {
    return [];
  }
}