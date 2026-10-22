import {beforeEach, describe, expect, it, vi} from 'vitest';

// A fake TV: two running apps; closeByAppId only answers when the test says so.
let running = [];
let releaseClose = null;

vi.mock('../src/js/luna.js', () => ({
  listApps: vi.fn(async () => ({apps: [{id: 'netflix', title: 'Netflix'}, {id: 'youtube', title: 'YouTube'}]})),
  launchAppViaRoot: vi.fn(async () => 'ok'),
  execRoot: vi.fn(async (command) => {
    const reply = function (data) { return {stdoutString: JSON.stringify(data)}; };
    if (command.indexOf('/tmp/launch-home-user-apps') >= 0) return {stdoutString: '__none__'};
    if (command.indexOf('listRunningApps') >= 0) {
      return reply({returnValue: true, running: running.map((id, i) => ({id: id, webprocessid: String(100 + i)}))});
    }
    if (command.indexOf('closeByAppId') >= 0) {
      const id = JSON.parse(command.slice(command.indexOf("'") + 1, command.lastIndexOf("'"))).id;
      await new Promise((resolve) => { releaseClose = resolve; });
      running = running.filter((r) => r !== id);
      return reply({returnValue: true});
    }
    if (command.indexOf('applicationManager/running') >= 0) {
      return reply({returnValue: true, running: running.map((id, i) => ({id: id, processid: String(100 + i), appType: 'web'}))});
    }
    return {stdoutString: ''};
  })
}));

import {launchAppViaRoot} from '../src/js/luna.js';
import {createRunningApps} from '../src/js/running-apps.js';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function openSwitcher() {
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const toasts = [];
  const switcher = createRunningApps({
    mount: mount,
    focus: {focusWithin: function () {}, focusElement: function () { return true; }, focusHomeDock: function () {}},
    toast: function (text) { toasts.push(text); },
    hide: function () {}
  });
  switcher.show();
  for (let i = 0; i < 10; i += 1) await flush();
  return {mount, switcher, toasts};
}

function rowFor(mount, title) {
  return Array.from(mount.querySelectorAll('.running-apps-row'))
    .find((row) => row.querySelector('.running-apps-name').textContent === title);
}

function buttonIn(row, text) {
  return Array.from(row.querySelectorAll('button')).find((b) => b.textContent === text);
}

beforeEach(() => {
  running = ['netflix', 'youtube'];
  releaseClose = null;
  document.body.innerHTML = '';
  vi.mocked(launchAppViaRoot).mockClear();
});

describe('running apps switcher: Close', () => {
  it('removes the app at once and keeps the switcher usable while it closes', async () => {
    const {mount} = await openSwitcher();
    const row = rowFor(mount, 'Netflix');
    buttonIn(row, 'Close').click();
    buttonIn(row, 'Confirm close').click();

    // The close is still pending on the TV, the row is already gone...
    expect(rowFor(mount, 'Netflix')).toBeUndefined();
    // ...and another app can be resumed right away.
    buttonIn(rowFor(mount, 'YouTube'), 'Resume').click();
    expect(launchAppViaRoot).toHaveBeenCalledWith('youtube');
  });

  it('does not list an app again while it is still closing', async () => {
    const {mount, switcher} = await openSwitcher();
    const row = rowFor(mount, 'Netflix');
    buttonIn(row, 'Close').click();
    buttonIn(row, 'Confirm close').click();

    switcher.refresh();
    for (let i = 0; i < 10; i += 1) await flush();
    expect(rowFor(mount, 'Netflix')).toBeUndefined();
    expect(rowFor(mount, 'YouTube')).toBeDefined();
  });
});
