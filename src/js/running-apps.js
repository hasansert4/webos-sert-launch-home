/** Running apps task switcher, only user apps are eligible for termination. */
import {execRoot, launchAppViaRoot, listApps} from './luna.js';
import {t} from './i18n.js';

const PROTECTED = new Set([
  'org.webosbrew.lounge.launcher', 'com.webos.app.home',
  'com.webos.app.starfish_flutter_systemui', 'com.webos.app.launcher',
  'com.webos.app.homelauncher', 'com.webos.app.dashboard',
  'com.palm.app.home', 'com.webos.app.homeupdater'
]);
function allowed(id) {
  return !!id && !PROTECTED.has(id) &&
    !/^com\.webos\.app\.(hdmi[0-9]+|livetv|inputcommon)$/i.test(id) &&
    !/^com\.webos\.service\./.test(id);
}
// Apps the user really brought to the foreground since boot, kept by
// home-watcher.sh. webOS also preloads apps (Netflix, YouTube, ...) in the
// background and restarts them after a close: those are left out.
const USER_APPS_FILE = '/tmp/launch-home-user-apps';
function output(res) {
  let text = res && res.stdoutString ? String(res.stdoutString) : '';
  if (!text && res && res.stdoutBytes) {
    try { text = atob(res.stdoutBytes); } catch (e) { /* ignore */ }
  }
  return text.trim();
}
async function rootCallAt(uri, params, methodLabel) {
  const payload = JSON.stringify(params);
  // Use the exact syntax confirmed working on this LG G3. Some webOS
  // luna-send builds silently emit no output with -i/-w.
  const command = 'luna-send -n 1 -f ' + uri + ' ' +
    "'" + payload.replace(/'/g, "'\\''") + "'";
  const result = await execRoot(command);
  const raw = output(result);
  const label = methodLabel || uri;
  if (!raw) throw new Error('No Luna reply (' + label + '): ' +
    (result && (result.stderrString || result.errorText || result.returnValue) || 'empty output'));
  let data;
  try { data = JSON.parse(raw); } catch (e) { throw new Error(label + ' invalid reply: ' + raw.slice(0, 180)); }
  if (data.returnValue !== true) throw new Error(data.errorText || label + ' failed');
  return data;
}
async function rootCall(method, params) {
  return rootCallAt('luna://com.webos.applicationManager/' + method, params, method);
}
export function createRunningApps(options) {
  const panel = document.createElement('div');
  panel.className = 'running-apps';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', t('Running applications'));
  panel.innerHTML = '<div class="running-apps-head"><h2>' + t('Open apps') + '</h2><span>' +
    t('OK resumes · Back closes') + '</span></div>' +
    '<div class="running-apps-items"></div><div class="running-apps-actions"></div>';
  options.mount.appendChild(panel);
  const items = panel.querySelector('.running-apps-items');
  const actions = panel.querySelector('.running-apps-actions');
  let generation = 0;
  let busy = false;
  let ignoreBackUntil = 0;
  // Apps being closed in the background: kept off the list meanwhile.
  const closing = new Set();
  function focusFirst() { options.focus.focusWithin('.running-apps'); }
  function button(text, action, idx, css) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'running-apps-button focusable ' + (css || '');
    el.dataset.focusIndex = String(6000 + idx);
    el.textContent = text;
    el.addEventListener('click', action);
    return el;
  }
  async function getRows() {
    // The webappmanager API exposes webprocessid, which is the PID accepted
    // by applicationManager/close on this LG webOS 26 TV. Its processid is
    // only the webappmanager's internal process identifier.
    const webData = await rootCallAt(
      'luna://com.webos.service.webappmanager/listRunningApps',
      {subscribe: false, includeSysApps: false},
      'listRunningApps'
    );
    const webApps = Array.isArray(webData.running) ? webData.running : [];
    const rows = [];
    const seen = new Set();

    webApps.forEach(function (app) {
      if (!allowed(app.id) || !app.webprocessid || seen.has(app.id)) return;
      seen.add(app.id);
      rows.push(Object.assign({}, app, {
        closeProcessId: String(app.webprocessid),
        processKind: 'web'
      }));
    });

    // Native apps may be exposed by applicationManager/running. This method
    // has returned an empty response on some calls, so keep web-app support
    // working even when the optional native-app query is unavailable.
    try {
      const nativeData = await rootCall('running', {subscribe: false});
      const nativeApps = Array.isArray(nativeData.running) ? nativeData.running : [];
      nativeApps.forEach(function (app) {
        if (app.appType === 'web' || !allowed(app.id) || !app.processid || seen.has(app.id)) return;
        seen.add(app.id);
        rows.push(Object.assign({}, app, {
          closeProcessId: String(app.processid),
          processKind: 'native'
        }));
      });
    } catch (e) {
      // The web-app list remains usable if the native-app query is unavailable.
    }

    return filterUserOpened(rows);
  }
  async function filterUserOpened(rows) {
    try {
      const text = output(await execRoot('test -f ' + USER_APPS_FILE + ' && cat ' +
        USER_APPS_FILE + ' || echo __none__'));
      // No list yet (older home-watcher): show everything, as before.
      if (text === '__none__') return rows;
      const opened = new Set(text.split('\n').map(function (s) { return s.trim(); }).filter(Boolean));
      return rows.filter(function (row) { return opened.has(row.id); });
    } catch (e) {
      return rows;
    }
  }
  function forgetUserOpened(appId) {
    const id = String(appId).replace(/'/g, '');
    execRoot('[ -f ' + USER_APPS_FILE + " ] && grep -vxF '" + id + "' " + USER_APPS_FILE +
      ' > ' + USER_APPS_FILE + '.n; mv -f ' + USER_APPS_FILE + '.n ' + USER_APPS_FILE)
      .catch(function () { /* list is best effort */ });
  }
  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  async function closeAndVerify(app) {
    const appId = String(app.id || '');

    if (!appId) {
      throw new Error(t('Missing application ID'));
    }

    // Use the same applicationManager API for closing and verification.
    // This includes native_mvpd apps such as Netflix and YouTube.
    const before = await rootCall('running', {subscribe: false});
    const beforeApps = Array.isArray(before.running) ? before.running : [];
    const current = beforeApps.find(function (item) {
      return item.id === appId;
    });

    if (!current) {
      return {
        closed: true,
        message: t('Already closed')
      };
    }

    const originalPid = String(current.processid || '');

    await rootCall('closeByAppId', {id: appId});
    forgetUserOpened(appId);

    // Verify that the application actually disappears.
    // A successful Luna response alone does not prove termination.
    let disappeared = false;

    for (let attempt = 0; attempt < 8; attempt++) {
      await new Promise(function (resolve) {
        setTimeout(resolve, 500);
      });

      const response = await rootCall('running', {
        subscribe: false
      });

      const running = Array.isArray(response.running)
        ? response.running
        : [];

      const found = running.find(function (item) {
        return item.id === appId;
      });

      if (!found) {
        disappeared = true;
        continue;
      }

      if (disappeared) {
        return {
          closed: false,
          message: t('App disappeared then returned')
        };
      }

      const currentPid = String(found.processid || '');

      if (originalPid && currentPid && currentPid !== originalPid) {
        return {
          closed: false,
          message: t('App restarted with a new PID')
        };
      }
    }

    const finalResponse = await rootCall('running', {
      subscribe: false
    });

    const finalApps = Array.isArray(finalResponse.running)
      ? finalResponse.running
      : [];

    const stillRunning = finalApps.some(function (item) {
      return item.id === appId;
    });

    if (!stillRunning) {
      return {
        closed: true,
        message: t('Closed and verified')
      };
    }

    return {
      closed: false,
      message: t('App still running')
    };
  }

  // Close and verify without holding up the switcher: the row is already
  // gone; the app comes back on the list only if the close fails.
  async function closeInBackground(app, name) {
    closing.add(app.id);
    let failed = false;
    try {
      // Re-fetch PID immediately before closing: process IDs are transient.
      const latest = await getRows();
      const current = latest.find(function (a) { return a.id === app.id; });
      if (!current) return true;
      const result = await closeAndVerify(current);
      failed = !result.closed;
      if (failed) options.toast(result.message + ': ' + name);
      return result.closed;
    } catch (e) {
      failed = true;
      options.toast(t('Close failed: ') + name + ': ' + e.message);
      return false;
    } finally {
      closing.delete(app.id);
      if (failed && !panel.hidden) refresh();
    }
  }

  function removeRow(row) {
    const rows = Array.prototype.slice.call(items.querySelectorAll('.running-apps-row'));
    const next = rows[rows.indexOf(row) + 1] || rows[rows.indexOf(row) - 1];
    row.remove();
    if (!items.querySelector('.running-apps-row')) {
      items.textContent = t('No user applications currently running.');
    }
    const target = next && next.querySelector('.running-apps-button');
    if (!(target && options.focus.focusElement && options.focus.focusElement(target))) focusFirst();
  }

  async function refresh() {
    const gen = ++generation;
    items.textContent = t('Loading running apps…');
    actions.textContent = '';
    try {
      const results = await Promise.all([getRows(), listApps().catch(function () { return {apps: []}; })]);
      if (gen !== generation || panel.hidden) return;
      const rows = results[0].filter(function (app) { return !closing.has(app.id); });
      const catalog = results[1].apps || [];
      const names = {};
      catalog.forEach(function (app) { names[app.id] = app.title || app.name || app.id; });
      items.textContent = '';
      if (!rows.length) items.textContent = t('No user applications currently running.');
      rows.forEach(function (app, index) {
        const row = document.createElement('div');
        row.className = 'running-apps-row';
        const label = document.createElement('span');
        label.className = 'running-apps-name';
        label.textContent = names[app.id] || app.id;
        row.appendChild(label);
        row.appendChild(button(t('Resume'), function () {
          options.hide();
          launchAppViaRoot(app.id).catch(function (e) { options.toast(t('Resume failed: ') + e.message); });
        }, index * 2));
        row.appendChild(button(t('Close'), function () {
          if (this.dataset.confirmClose !== 'yes') {
            this.dataset.confirmClose = 'yes';
            this.textContent = t('Confirm close');
            options.toast(t('Press Confirm close again to close ') + label.textContent);
            return;
          }
          removeRow(row);
          closeInBackground(app, label.textContent);
        }, index * 2 + 1, 'running-apps-danger'));
        items.appendChild(row);
      });
      actions.appendChild(button(t('Refresh'), refresh, 900));
      actions.appendChild(button(t('Close all'), async function () {
        if (busy) return;
        if (this.dataset.confirmClose !== 'yes') {
          this.dataset.confirmClose = 'yes';
          this.textContent = t('Confirm close all');
          options.toast(t('Press Confirm close all again to close user apps'));
          return;
        }
        busy = true;
        const all = rows.filter(function (app) { return !closing.has(app.id); });
        all.forEach(function (app) { closing.add(app.id); });
        items.textContent = t('No user applications currently running.');
        this.dataset.confirmClose = '';
        this.textContent = t('Close all');
        focusFirst();
        (async function () {
          let closed = 0;
          for (const app of all) {
            closing.delete(app.id);
            if (await closeInBackground(app, names[app.id] || app.id)) closed++;
          }
          busy = false;
          if (closed < all.length) options.toast(t('Closed ') + closed + t(' of ') + all.length + t(' apps'));
        })();
      }, 901, 'running-apps-danger'));
      focusFirst();
    } catch (e) {
      if (gen !== generation || panel.hidden) return;
      items.textContent = t('Could not read running apps: ') + e.message;
      actions.appendChild(button(t('Retry'), refresh, 900));
      focusFirst();
    }
  }
  return {
    show: function () {
      // BACK is observed passively by the root watcher. The second press
      // can still be delivered to our window after it opens; do not close
      // the switcher in response to that same physical press.
      ignoreBackUntil = Date.now() + 1100;
      panel.hidden = false;
      document.body.classList.add('running-apps-open');
      refresh();
    },
    shouldIgnoreBack: function () { return !panel.hidden && Date.now() < ignoreBackUntil; },
    hide: function () { generation++; panel.hidden = true; document.body.classList.remove('running-apps-open'); options.focus.focusHomeDock(); },
    isOpen: function () { return !panel.hidden; },
    refocus: focusFirst,
    refresh: refresh
  };
}
