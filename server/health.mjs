/* Liveness and readiness helpers shared by the HTTP host and tests. */

export function readiness(adapters = {}) {
  const list = Object.values(adapters);
  const configured = list.filter(a => a && a.status !== 'off');
  const unavailable = configured.filter(a => a.status !== 'connected');
  const ok = unavailable.length === 0;

  return {
    ok,
    ready: ok,
    service: 'fight-host',
    adapters,
    detail: ok
      ? (configured.length ? 'all configured adapters are connected' : 'no chat adapters configured')
      : 'one or more configured adapters are not connected',
  };
}
