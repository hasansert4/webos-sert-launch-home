import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('../src/js/luna.js', () => ({
  listApps: vi.fn(),
  getAppInfo: vi.fn(),
  launchApp: vi.fn(async () => 'ok'),
  launchAppViaRoot: vi.fn(async () => 'ok'),
  readFileAsDataUrl: vi.fn(async () => '')
}));

import {launchApp, listApps, getAppInfo} from '../src/js/luna.js';
import {createAppGrid} from '../src/js/apps.js';
import {createAllApps, orderApps} from '../src/js/all-apps.js';

function makeConfig(pinnedApps, numberKeyLaunch) {
  return function () {
    return {
      launcher: {
        pinnedApps: pinnedApps,
        customApps: [],
        iconSize: 'medium',
        allAppsTile: true,
        numberKeyLaunch: numberKeyLaunch
      }
    };
  };
}

function mockInstalled(ids) {
  listApps.mockResolvedValue({
    apps: ids.map((id) => ({id: id, title: id}))
  });
  getAppInfo.mockImplementation(async (id) => ({id: id, title: id}));
}

function buildGrid(pinnedApps, numberKeyLaunch) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const grid = createAppGrid(container, makeConfig(pinnedApps, numberKeyLaunch), {});
  return {container, grid};
}

beforeEach(() => {
  vi.mocked(launchApp).mockClear();
  document.body.innerHTML = '';
});

describe('home row numbering and badges', () => {
  it('numbers every tile in reading order and shows a badge', async () => {
    mockInstalled(['netflix', 'youtube.leanback.v4']);
    const {container, grid} = buildGrid(['netflix', 'youtube.leanback.v4']);
    await grid.refresh();

    const tiles = container.querySelectorAll('.app-tile');
    // netflix, youtube, All apps (TV Settings lives in All apps by default)
    expect(tiles.length).toBe(3);
    tiles.forEach((tile, i) => {
      expect(tile.dataset.appKey).toBe(String(i + 1));
      const badge = tile.querySelector('.app-key');
      expect(badge).not.toBeNull();
      expect(badge.textContent).toBe(String(i + 1));
    });
  });

  it('puts TV Settings back on the home row when tvSettingsOnHome is set', async () => {
    mockInstalled(['netflix']);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const config = makeConfig(['netflix']);
    const grid = createAppGrid(container, function () {
      const c = config();
      c.launcher.tvSettingsOnHome = true;
      return c;
    }, {});
    await grid.refresh();

    // netflix, All apps, TV Settings
    expect(container.querySelectorAll('.app-tile').length).toBe(3);
  });

  it('numbers only the first nine tiles', async () => {
    const ids = [];
    for (let i = 0; i < 12; i += 1) ids.push('app' + i);
    mockInstalled(ids);
    const {container, grid} = buildGrid(ids);
    await grid.refresh();

    expect(container.querySelectorAll('.app-tile[data-app-key]').length).toBe(9);
    expect(container.querySelectorAll('.app-key').length).toBe(9);
  });
});

describe('launchByNumber', () => {
  it('opens the tile at that position', async () => {
    mockInstalled(['netflix', 'youtube.leanback.v4']);
    const {grid} = buildGrid(['netflix', 'youtube.leanback.v4']);
    await grid.refresh();

    expect(grid.launchByNumber(2)).toBe(true);
    expect(launchApp).toHaveBeenCalledWith('youtube.leanback.v4');
  });

  it('returns false for 0, out of range and missing tiles', async () => {
    mockInstalled(['netflix']);
    const {grid} = buildGrid(['netflix']);
    await grid.refresh();

    expect(grid.launchByNumber(0)).toBe(false);
    expect(grid.launchByNumber(9)).toBe(false);
    expect(launchApp).not.toHaveBeenCalled();
  });
});

describe('All apps overlay', () => {
  it('shows no number badges on its tiles', async () => {
    mockInstalled(['netflix', 'youtube.leanback.v4']);
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const allApps = createAllApps({
      mount: mount,
      focus: {focusWithin: function () {}},
      launch: function () {}
    });

    await allApps.show();

    expect(mount.querySelectorAll('.app-tile').length).toBeGreaterThan(0);
    expect(mount.querySelectorAll('.app-key').length).toBe(0);
    expect(mount.querySelectorAll('[data-app-key]').length).toBe(0);
  });
});

describe('numberKeyLaunch off', () => {
  it('numbers no tiles and does not launch by number', async () => {
    mockInstalled(['netflix', 'youtube.leanback.v4']);
    const {container, grid} = buildGrid(['netflix', 'youtube.leanback.v4'], false);
    await grid.refresh();

    expect(container.querySelectorAll('.app-tile[data-app-key]').length).toBe(0);
    expect(container.querySelectorAll('.app-key').length).toBe(0);
    expect(grid.launchByNumber(1)).toBe(false);
    expect(launchApp).not.toHaveBeenCalled();
  });
});

describe('All apps list', () => {
  function buildAllApps() {
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const allApps = createAllApps({
      mount: mount,
      focus: {focusWithin: function () {}, focusElement: function () { return false; }, focusHomeDock: function () {}},
      launch: function () {}
    });
    return {mount, allApps};
  }

  it('shows an app installed since the last opening', async () => {
    mockInstalled(['netflix']);
    const {mount, allApps} = buildAllApps();
    await allApps.show();
    expect(mount.querySelector('[data-app-id="stz.player"]')).toBeNull();
    allApps.hide();

    mockInstalled(['netflix', 'stz.player']);
    await allApps.show();
    expect(mount.querySelector('[data-app-id="stz.player"]')).not.toBeNull();
  });

  it('keeps the last list when reading the apps fails', async () => {
    mockInstalled(['netflix']);
    const {mount, allApps} = buildAllApps();
    await allApps.show();
    allApps.hide();

    listApps.mockRejectedValue(new Error('no root'));
    await allApps.show();
    expect(mount.querySelector('[data-app-id="netflix"]')).not.toBeNull();
  });
});

describe('All apps: moving an app', () => {
  function key(type, keyCode) {
    document.activeElement.dispatchEvent(new KeyboardEvent(type, {keyCode: keyCode, bubbles: true}));
  }
  const OK = 13, RIGHT = 39, LEFT = 37, BACK = 461;

  async function openWith(ids, order) {
    mockInstalled(ids);
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const launched = [];
    const saved = [];
    const allApps = createAllApps({
      mount: mount,
      focus: {focusWithin: function () {}, focusElement: function (el) { el.focus(); return true; }, focusHomeDock: function () {}},
      launch: function (app) { launched.push(app.id); },
      getOrder: function () { return order || []; },
      saveOrder: function (o) { saved.push(o); }
    });
    await allApps.show();
    const ids2 = () => Array.from(mount.querySelectorAll('[data-app-id]')).map((t) => t.dataset.appId);
    const tile = (id) => mount.querySelector('[data-app-id="' + id + '"]');
    return {mount, allApps, launched, saved, ids: ids2, tile};
  }

  afterEach(() => { vi.useRealTimers(); });

  it('a short OK press opens the app', async () => {
    const t = await openWith(['a', 'b', 'c']);
    vi.useFakeTimers();
    t.tile('b').focus();
    key('keydown', OK);
    key('keyup', OK);
    expect(t.launched).toEqual(['b']);
    expect(t.tile('b').classList.contains('moving')).toBe(false);
  });

  it('a long OK press picks the app up; arrows move it; OK saves the order', async () => {
    const t = await openWith(['a', 'b', 'c']);
    vi.useFakeTimers();
    t.tile('a').focus();
    key('keydown', OK);
    vi.advanceTimersByTime(700);
    expect(t.tile('a').classList.contains('moving')).toBe(true);
    key('keyup', OK); // release of the long press: does not place it yet
    expect(t.saved).toEqual([]);
    key('keydown', RIGHT);
    key('keydown', RIGHT);
    expect(t.ids()).toEqual(['b', 'c', 'a']);
    key('keydown', OK);
    expect(t.saved).toEqual([['b', 'c', 'a']]);
    expect(t.launched).toEqual([]);
    expect(t.tile('a').classList.contains('moving')).toBe(false);
  });

  it('Back puts the app back where it was', async () => {
    const t = await openWith(['a', 'b', 'c']);
    vi.useFakeTimers();
    t.tile('a').focus();
    key('keydown', OK);
    vi.advanceTimersByTime(700);
    key('keyup', OK);
    key('keydown', RIGHT);
    key('keydown', BACK);
    expect(t.ids()).toEqual(['a', 'b', 'c']);
    expect(t.saved).toEqual([]);
  });

  it('an app cannot move before the TV Settings tile', async () => {
    mockInstalled(['a', 'b']);
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const allApps = createAllApps({
      mount: mount,
      focus: {focusWithin: function () {}, focusElement: function (el) { el.focus(); return true; }, focusHomeDock: function () {}},
      launch: function () {},
      openTvSettings: function () {}
    });
    await allApps.show();
    vi.useFakeTimers();
    mount.querySelector('[data-app-id="a"]').focus();
    key('keydown', OK);
    vi.advanceTimersByTime(700);
    key('keyup', OK);
    key('keydown', LEFT);
    expect(mount.querySelector('.all-apps-grid').firstElementChild.dataset.action).toBe('tv-settings');
  });

  it('opens in the saved order, new apps after it', async () => {
    const t = await openWith(['a', 'b', 'c', 'd'], ['c', 'a']);
    expect(t.ids()).toEqual(['c', 'a', 'b', 'd']);
    expect(orderApps([{id: 'x'}, {id: 'y'}], ['y', 'gone'])).toEqual([{id: 'y'}, {id: 'x'}]);
  });
});
