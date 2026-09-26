// Thin fetch wrapper. Every call throws an Error whose message is the server's own words.

async function call(method, path, body) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new Error('Could not reach the server. Check that it is running.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Server said ${res.status}`);
  return data;
}

export const api = {
  health: () => call('GET', '/api/health'),
  sessions: () => call('GET', '/api/sessions'),
  session: (id) => call('GET', `/api/sessions/${id}`),
  events: (id, since = 0, tail) => call('GET', `/api/sessions/${id}/events?since=${since}${tail ? `&tail=${tail}` : ''}`),
  frames: (id) => call('GET', `/api/sessions/${id}/frames`),
  message: (id, text) => call('POST', `/api/sessions/${id}/messages`, { text, from: 'Supervisor' }),
  command: (id, command) => call('POST', `/api/sessions/${id}/commands`, { command, by: 'supervisor' }),
  addRule: (id, text) => call('POST', `/api/sessions/${id}/rules`, { text }),
  removeRule: (id, ruleId) => call('DELETE', `/api/sessions/${id}/rules/${encodeURIComponent(ruleId)}`),
  editStep: (id, stepId, patch) => call('PATCH', `/api/sessions/${id}/steps/${encodeURIComponent(stepId)}`, patch),
  end: (id) => call('POST', `/api/sessions/${id}/end`),
  workers: () => call('GET', '/api/workers'),
  training: (name) => call('GET', `/api/workers/${encodeURIComponent(name)}/training`),
  playbooks: () => call('GET', '/api/playbooks'),
  playbook: (id) => call('GET', `/api/playbooks/${encodeURIComponent(id)}`),
  savePlaybook: (id, source) => call('PUT', `/api/playbooks/${encodeURIComponent(id)}`, { source }),
};

export const frameUrl = (sessionId, frameId) => `/api/sessions/${sessionId}/frames/${frameId}`;
