export function isMobileClient({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) || platform === 'MacIntel' && maxTouchPoints > 1;
}
export const mobileClient = typeof navigator !== 'undefined' && isMobileClient(navigator);
export function mobileRequest(req) {
  return req.headers['x-awudio-client'] === 'mobile' || isMobileClient({ userAgent:req.headers['user-agent'] || '' });
}
