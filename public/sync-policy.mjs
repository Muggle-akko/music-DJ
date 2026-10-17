export function syncDelay({agents=false,playing=false,hidden=false,pending=false,failures=0}={}) {
  if(hidden && !playing && !agents && !pending)return null;
  if(failures)return Math.min(120000,5000*2**Math.min(failures,5));
  if(pending)return 5000;
  if(agents)return hidden ? 10000 : 5000;
  return hidden || !playing ? 60000 : 30000;
}
