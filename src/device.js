import { parseOsc, toSample } from './osc.js';

const SERVICE = 0x5501, DATA_CHAR = 0x113B;

// Connect one MUGIC over Web Bluetooth (firmware >= 2.2.0 in BLE output mode). Call again for a second device.
// onSample(sample, seconds) gets every packet with its arrival time.
export async function connect(onSample, onDisconnect) {
  if (!navigator.bluetooth) throw new Error('This browser has no Web Bluetooth: use Chrome or Edge.');
  const dev = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: 'mu' }], optionalServices: [SERVICE] });
  dev.addEventListener('gattserverdisconnected', onDisconnect);
  const server = await dev.gatt.connect();
  const ch = await (await server.getPrimaryService(SERVICE)).getCharacteristic(DATA_CHAR);
  ch.addEventListener('characteristicvaluechanged', e => {
    const s = toSample(parseOsc(e.target.value));
    if (s) onSample(s, performance.now() / 1000);
  });
  await ch.startNotifications();
  return { id: dev.name, disconnect: () => dev.gatt.disconnect() };
}
