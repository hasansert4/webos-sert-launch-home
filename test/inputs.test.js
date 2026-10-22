import {describe, expect, it} from 'vitest';
import {orderInputs} from '../src/js/inputs.js';

const ids = function (list) {
  return list.map(function (d) { return d.id; });
};

describe('orderInputs', function () {
  const devices = [{id: 'HDMI_1'}, {id: 'HDMI_2'}, {id: 'HDMI_3'}, {id: 'TV'}];

  it('keeps the TV order without a saved order', function () {
    expect(ids(orderInputs(devices, undefined))).toEqual(['HDMI_1', 'HDMI_2', 'HDMI_3', 'TV']);
    expect(ids(orderInputs(devices, []))).toEqual(['HDMI_1', 'HDMI_2', 'HDMI_3', 'TV']);
  });

  it('follows the saved order', function () {
    expect(ids(orderInputs(devices, ['TV', 'HDMI_3', 'HDMI_1', 'HDMI_2'])))
      .toEqual(['TV', 'HDMI_3', 'HDMI_1', 'HDMI_2']);
  });

  it('puts inputs missing from the saved order last, in TV order', function () {
    expect(ids(orderInputs(devices, ['HDMI_2']))).toEqual(['HDMI_2', 'HDMI_1', 'HDMI_3', 'TV']);
  });

  it('ignores saved ids the TV no longer has', function () {
    expect(ids(orderInputs(devices, ['HDMI_4', 'TV']))).toEqual(['TV', 'HDMI_1', 'HDMI_2', 'HDMI_3']);
  });
});
