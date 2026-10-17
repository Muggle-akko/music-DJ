// Reconnect even when no music tool is being called; never replay player commands.
export function createHeartbeat({ connect, ping, invalidate }) {
  let busy = false;
  return async () => {
    if (busy) return false;
    busy = true;
    try {
      await connect();
      await ping();
      return true;
    } catch {
      invalidate();
      return false;
    } finally {
      busy = false;
    }
  };
}

export function createAgentActivity({now=Date.now,idleMs=300000,sessionMs=55000}={}) {
  let lastUse=null,lastSeen=null;
  return {used(){lastUse=now();},seen(){lastSeen=now();},
    get active(){return lastUse!==null && now()-lastUse<idleMs;},
    get sessionFresh(){return lastSeen!==null && now()-lastSeen<sessionMs;}};
}
