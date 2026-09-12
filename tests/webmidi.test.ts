import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Flx2Midi } from '../src/midi/Flx2Midi.ts';
import type { Flx2Event } from '../src/midi/types.ts';

/** Minimal fakes of the Web MIDI objects the driver touches. */
class FakePort {
  name: string;
  state: 'connected' | 'disconnected' = 'connected';
  sent: number[][] = [];
  onmidimessage: ((ev: { data: Uint8Array; timeStamp: number }) => void) | null = null;
  failOpen = false;
  constructor(name: string) {
    this.name = name;
  }
  async open() {
    if (this.failOpen) throw new Error('Port is busy');
  }
  async close() {}
  send(bytes: number[]) {
    this.sent.push(Array.from(bytes));
  }
  emit(bytes: number[], t = 1) {
    this.onmidimessage?.({ data: Uint8Array.from(bytes), timeStamp: t });
  }
}

class FakeAccess {
  inputs = new Map<string, FakePort>();
  outputs = new Map<string, FakePort>();
  onstatechange: (() => void) | null = null;
  plug(name: string) {
    const i = new FakePort(name);
    const o = new FakePort(name);
    this.inputs.set(name, i);
    this.outputs.set(name, o);
    return { i, o };
  }
  unplug(name: string) {
    this.inputs.get(name)!.state = 'disconnected';
    this.inputs.delete(name);
    this.outputs.delete(name);
  }
}

function install(access: FakeAccess) {
  (globalThis.navigator as unknown as { requestMIDIAccess: unknown }).requestMIDIAccess = async () => access;
}

const settle = () => new Promise((r) => setTimeout(r, 5));

describe('Flx2Midi with Web MIDI ports', () => {
  it('opens the DDJ-FLX2 ports, runs the init sequence and decodes input', async () => {
    const access = new FakeAccess();
    access.plug('Some Keyboard');
    const { i, o } = access.plug('DDJ-FLX2');
    install(access);
    const drv = new Flx2Midi();
    const events: Flx2Event[] = [];
    drv.onEvent((e) => events.push(e));
    await drv.start();
    assert.equal(drv.status.kind, 'connected');
    assert.equal(drv.status.kind === 'connected' && drv.status.input, 'DDJ-FLX2');
    assert.deepEqual(o.sent.slice(0, 2), [[0x90, 0x17, 0x7f], [0x91, 0x17, 0x7f]], 'vinyl ON to both decks first');
    i.emit([0x90, 0x0b, 0x7f]);
    assert.deepEqual(events[0], { kind: 'deckButton', deck: 0, id: 'play', pressed: true });
    drv.dispose();
  });

  it('handles unplug and replug, flagging the reconnect', async () => {
    const access = new FakeAccess();
    access.plug('DDJ-FLX2');
    install(access);
    const drv = new Flx2Midi();
    const connects: boolean[] = [];
    drv.onConnect((c) => connects.push(c.reconnect));
    await drv.start();
    access.unplug('DDJ-FLX2');
    access.onstatechange!();
    await settle();
    assert.equal(drv.status.kind, 'searching');
    const { o } = access.plug('DDJ-FLX2');
    access.onstatechange!();
    await settle();
    assert.equal(drv.status.kind, 'connected');
    assert.deepEqual(connects, [false, true]);
    assert.deepEqual(o.sent[0], [0x90, 0x17, 0x7f], 'init runs again on the new port');
    drv.dispose();
  });

  it('accepts a single generic "USB MIDI Device" and flags it', async () => {
    const access = new FakeAccess();
    access.plug('USB MIDI Device');
    install(access);
    const drv = new Flx2Midi();
    await drv.start();
    assert.equal(drv.status.kind === 'connected' && drv.status.generic, true);
    drv.dispose();
  });

  it('refuses to guess between two generic devices', async () => {
    const access = new FakeAccess();
    access.plug('USB MIDI Device');
    access.inputs.set('USB MIDI Device 2', new FakePort('USB MIDI Device 2'));
    install(access);
    const drv = new Flx2Midi();
    await drv.start();
    assert.equal(drv.status.kind, 'searching');
  });

  it('explains a busy port (Windows MIDI is exclusive)', async () => {
    const access = new FakeAccess();
    const { i } = access.plug('DDJ-FLX2');
    i.failOpen = true;
    install(access);
    const drv = new Flx2Midi();
    await drv.start();
    assert.equal(drv.status.kind, 'searching');
    assert.match(drv.status.kind === 'searching' ? drv.status.message ?? '' : '', /exclusive/);
  });

  it('MIDI learn binds an unmapped ch-7 CC pair to MASTER LEVEL', async () => {
    const access = new FakeAccess();
    const { i } = access.plug('DDJ-FLX2');
    install(access);
    const drv = new Flx2Midi();
    drv.clearLearned();
    const events: Flx2Event[] = [];
    drv.onEvent((e) => events.push(e));
    await drv.start();
    drv.startLearn('masterLevel');
    i.emit([0xb6, 0x28, 0x10]); // user turned the knob; LSB arrived first
    assert.equal(drv.learnTarget, null);
    assert.deepEqual(drv.learned[0], { channel: 6, msb: 0x08, lsb: 0x28, id: 'masterLevel' });
    i.emit([0xb6, 0x08, 0x7f]);
    i.emit([0xb6, 0x28, 0x7f]);
    const last = events.at(-1)!;
    assert.deepEqual(last, { kind: 'globalAbs', id: 'masterLevel', value: 1, raw14: 16383 });
    drv.clearLearned();
    drv.dispose();
  });
});
