import { parseOsc, toSample } from './osc.js';

const SERVICE = 0x5501, DATA_CHAR = 0x113B;

// Connect one MUGIC over Web Bluetooth (firmware >= 2.2.0 in BLE output mode). Call again for a second device.
// onSample(sample, seconds) gets every packet with its arrival time; log(event, data) reports each step and
// unreadable packets (the first few, then every 100th).
export async function connect(onSample, onDisconnect, log = () => {}) {
  if (!navigator.bluetooth) throw new Error('This browser has no Web Bluetooth: use Chrome or Edge.');
  log('ble.chooser');
  const dev = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: 'mu' }], optionalServices: [SERVICE] });
  log('ble.chosen', { name: dev.name, id: dev.id });
  dev.addEventListener('gattserverdisconnected', onDisconnect);
  const server = await dev.gatt.connect();
  log('ble.gatt');
  const ch = await (await server.getPrimaryService(SERVICE)).getCharacteristic(DATA_CHAR);
  log('ble.characteristic');
  let packets = 0, bad = 0;
  ch.addEventListener('characteristicvaluechanged', e => {
    const f = parseOsc(e.target.value), s = toSample(f);
    if (++packets === 1) log('ble.first-packet', { bytes: e.target.value.byteLength, floats: f.length });
    if (s) onSample(s, performance.now() / 1000);
    else if (++bad <= 3 || bad % 100 === 0) log('ble.bad-packet', { bad, bytes: e.target.value.byteLength, floats: f.length });
  });
  await ch.startNotifications();
  log('ble.notifying');
  return { id: dev.name, disconnect: () => dev.gatt.disconnect() };
}
