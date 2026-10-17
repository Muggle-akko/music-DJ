import { AsyncLocalStorage } from 'node:async_hooks';

const fields = ['queue', 'queueCurrentIndex', 'queueRevision', 'queueUpdatedAt'];
export function createDeviceState(enabled) {
  const context = new AsyncLocalStorage(), views = new WeakMap();
  const valid = value => /^[a-f0-9-]{16,64}$/.test(value || '');
  const run = (id, task) => context.run(enabled && valid(id) ? id : null, task);
  function view(state) {
    const id = context.getStore();
    if (!id) return state;
    views.set(state, { id, root:Object.fromEntries(fields.map(key => [key, state[key]])) });
    const device = state.deviceQueues?.[id] || { queue:[], queueCurrentIndex:-1, queueRevision:0, queueUpdatedAt:null };
    for (const key of fields) state[key] = device[key];
    return state;
  }
  function pack(state) {
    const scope = views.get(state);
    if (!scope) return state;
    const devices = { ...state.deviceQueues };
    if (!devices[scope.id] && Object.keys(devices).length >= 50) throw new Error('设备数量已达上限，请清理不用的设备队列');
    devices[scope.id] = Object.fromEntries(fields.map(key => [key, state[key]]));
    return { ...state, ...scope.root, deviceQueues:devices };
  }
  return { run, view, pack };
}
