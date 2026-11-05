const projectCache = new Map();
async function apiRequest(path, options = {}) {
  const response = await fetch(path, { ...options, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...options.headers } });
  if (!(response.headers.get('Content-Type') || '').includes('application/json')) throw new Error('Please use Staff Sign In to continue.');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The request failed.');
  return data;
}
let sessionPromise;
const appAuth = { auth: {
  getSession() {
    // The server checks the HttpOnly session cookie; browser code never stores credentials.
    if (!sessionPromise) sessionPromise = fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' })
      .then(async response => response.ok ? response.json() : null)
      .then(session => ({ data: { session: session?.user ? session : null }, error: null }))
      .catch(() => ({ data: { session: null }, error: null }));
    return sessionPromise;
  },
  async signOut() {
    await apiRequest('/api/logout',{method:'POST',body:'{}'});
    window.location.assign('/index.html');
  }
} };
async function loadProjects() {
  const rows = await apiRequest('/api/projects');
  rows.forEach(row => projectCache.set(row.project_number.toLowerCase(), row));
  return rows;
}
async function getProjectByNumber(number) {
  const rows = await loadProjects();
  return rows.find(row => row.project_number.toLowerCase() === String(number).toLowerCase()) || null;
}
async function insertProject(project) {
  const row = await apiRequest('/api/admin/projects', { method: 'POST', body: JSON.stringify({ project }) });
  projectCache.set(row.project_number.toLowerCase(), row);
  return row;
}
async function updateProject(number, project) {
  const existing = projectCache.get(number.toLowerCase());
  if (!existing) throw new Error('Reload the project before saving.');
  const row = await apiRequest('/api/admin/projects/' + encodeURIComponent(number), { method: 'PUT', body: JSON.stringify({ project, expected_version: existing._version }) });
  projectCache.delete(number.toLowerCase());
  projectCache.set(row.project_number.toLowerCase(), row);
  return row;
}
async function deleteProjectByNumber(number) {
  const existing = projectCache.get(number.toLowerCase());
  if (!existing) throw new Error('Reload the project before deleting.');
  await apiRequest('/api/admin/projects/' + encodeURIComponent(number), { method: 'DELETE', body: JSON.stringify({ expected_version: existing._version }) });
  projectCache.delete(number.toLowerCase());
  return true;
}
async function completeProjectByNumber(number, date) {
  const existing = projectCache.get(number.toLowerCase());
  return updateProject(number, { ...existing, project_status: 'Completed', completed_date: date });
}
async function restoreProjectByNumber(number) {
  const existing = projectCache.get(number.toLowerCase());
  return updateProject(number, { ...existing, project_status: 'No Contract', completed_date: null });
}
