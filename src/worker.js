import { verifyIdentity, signIn, signOut } from './auth.js';
export { verifyIdentity } from './auth.js';
import sanitizeHtml from 'sanitize-html';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const fail = (message, status) => Object.assign(new Error(message), { status });
export function cleanDescription(value) {
  return sanitizeHtml(String(value || ''), {
    allowedTags: ['span', 'strong', 'b', 'em', 'i', 'u', 'br', 'div', 'p', 'ul', 'ol', 'li', 'mark', 'hr', 'section'],
    allowedAttributes: { '*': ['class', 'data-all-previous-updates'] },
    allowedClasses: { '*': ['descriptionEntry', 'projectUpdate', 'latestUpdateBox', 'latestUpdateContent', 'previousUpdatesBox', 'dashboardScrollBox', 'updateSectionTitle'] }
  });
}
function canDelete(email, env) {
  return String(env.DELETE_ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean).includes(email);
}
function publicProject(row) {
  const data = JSON.parse(row.data);
  return { ...data, description: cleanDescription(data.description), description_html: cleanDescription(data.description_html || data.description), _version: row.version };
}
function projectPayload(body, previous) {
  const source = body.project;
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw fail('Missing project details.', 400);
  const data = { ...(previous || {}) };
  for (const key of ['project_number', 'project_name', 'engineer', 'project_status', 'sales_person', 'start_date', 'description_color']) data[key] = String(source[key] || '').trim();
  if (!/^[A-Za-z0-9_./ -]{1,80}$/.test(data.project_number)) throw fail('Enter a valid project number.', 400);
  if (['project_name', 'engineer', 'sales_person'].some(key => !data[key] || data[key].length > 300)) throw fail('Complete the project name, engineer, and salesperson.', 400);
  if (!['Contract', 'No Contract', 'Completed'].includes(data.project_status)) throw fail('Select a valid request type.', 400);
  const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!date(data.start_date)) throw fail('Enter a valid start date.', 400);
  data.completed_date = source.completed_date || null;
  if (data.completed_date && (!date(data.completed_date) || data.completed_date < data.start_date)) throw fail('Completed date must be on or after the start date.', 400);
  data.description = cleanDescription(source.description);
  data.description_html = data.description;
  if (!sanitizeHtml(data.description, { allowedTags: [], allowedAttributes: {} }).trim()) throw fail('Add a project update.', 400);
  data.created_at = previous?.created_at || new Date().toISOString();
  if (!['#000000', '#c62828'].includes(data.description_color)) data.description_color = '#000000';
  return data;
}
export function createHandler(identity = verifyIdentity) {
  return async function handle(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      const path = url.pathname;
      if (path === '/api/login' || path === '/api/logout') {
        if(request.method!=='POST') return json({error:'Method not allowed.'},405);
        if(request.headers.get('Origin')!==url.origin || request.headers.get('Sec-Fetch-Site')==='cross-site') throw fail('Cross-origin changes are not allowed.',403);
        if(path==='/api/logout') {
          const response=json({ok:true});response.headers.set('Set-Cookie',await signOut(request,env));return response;
        }
        if(Number(request.headers.get('Content-Length'))>4096) throw fail('Sign-in request is too large.',413);
        const raw=await request.text();
        if(raw.length>4096) throw fail('Sign-in request is too large.',413);
        let body;try{body=JSON.parse(raw);}catch{throw fail('Invalid JSON.',400);}
        const result=await signIn(request,env,body);
        const response=json({user:result.user,canDelete:canDelete(result.user.email,env)});
        response.headers.set('Set-Cookie',result.cookie);return response;
      }
      if (path === '/api/session' && request.method === 'GET') {
        try {
          const user = await identity(request, env);
          return json({ user, canDelete: canDelete(user.email, env) });
        } catch { return json({ user: null, canDelete: false }); }
      }
      if (path === '/api/projects' && request.method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM projects ORDER BY json_extract(data, \'$.created_at\') DESC').all();
        return json(results.map(publicProject));
      }
      if (!path.startsWith('/api/admin/')) return json({ error: 'Not found.' }, 404);
      const user = await identity(request, env);
      if (path === '/api/admin/session' && request.method === 'GET') return json({ user, canDelete: canDelete(user.email, env) });
      if (request.method === 'GET') return json({ error: 'Not found.' }, 404);
      // A valid staff session and same-origin request are both required for mutations.
      if (request.headers.get('Origin') !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') throw fail('Cross-origin changes are not allowed.', 403);
      if (!['POST', 'PUT', 'DELETE'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405);
      if (Number(request.headers.get('Content-Length')) > 250000) throw fail('Project update is too large.', 413);
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > 250000) throw fail('Project update is too large.', 413);
      let body;
      try { body = JSON.parse(raw); } catch { throw fail('Invalid JSON.', 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('Invalid request body.', 400);
      const now = new Date().toISOString();
      if (path === '/api/admin/projects' && request.method === 'POST') {
        const data = projectPayload(body);
        const duplicate = await env.DB.prepare('SELECT project_number FROM projects WHERE project_number = ?').bind(data.project_number).first();
        if (duplicate) throw fail('That project number already exists.', 409);
        const encoded = JSON.stringify(data);
        await env.DB.batch([
          env.DB.prepare('INSERT INTO projects VALUES (?, ?, 1, ?, ?)').bind(data.project_number, encoded, now, user.email),
          env.DB.prepare('INSERT INTO project_audit (project_number,action,actor,recorded_at,next_data) VALUES (?,\'create\',?,?,?)').bind(data.project_number, user.email, now, encoded)
        ]);
        return json({ ...data, _version: 1 }, 201);
      }
      const match = path.match(/^\/api\/admin\/projects\/([^/]+)$/);
      if (!match) return json({ error: 'Not found.' }, 404);
      const number = decodeURIComponent(match[1]);
      const existing = await env.DB.prepare('SELECT * FROM projects WHERE project_number = ?').bind(number).first();
      if (!existing) throw fail('Project not found.', 404);
      if (!Number.isInteger(body.expected_version) || body.expected_version !== existing.version) throw fail('This project changed since you opened it. Reload before saving to avoid overwriting another update.', 409);
      if (request.method === 'DELETE') {
        if (!canDelete(user.email, env)) throw fail('Your account is not approved to delete projects.', 403);
        const result = await env.DB.batch([
          env.DB.prepare('DELETE FROM projects WHERE project_number = ? AND version = ?').bind(number, existing.version),
          env.DB.prepare('INSERT INTO project_audit (project_number,action,actor,recorded_at,previous_data) SELECT ?,\'delete\',?,?,? WHERE changes() = 1').bind(number, user.email, now, existing.data)
        ]);
        if (!result[0].meta.changes) throw fail('Project changed. Reload and try again.', 409);
        return json({ ok: true });
      }
      if (request.method !== 'PUT') return json({ error: 'Method not allowed.' }, 405);
      const data = projectPayload(body, JSON.parse(existing.data));
      const encoded = JSON.stringify(data);
      const result = await env.DB.batch([
        env.DB.prepare('UPDATE projects SET project_number = ?, data = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE project_number = ? AND version = ?').bind(data.project_number, encoded, now, user.email, number, existing.version),
        env.DB.prepare('INSERT INTO project_audit (project_number,action,actor,recorded_at,previous_data,next_data) SELECT ?,\'update\',?,?,?,? WHERE changes() = 1').bind(data.project_number, user.email, now, existing.data, encoded)
      ]);
      if (!result[0].meta.changes) throw fail('Project changed. Reload and try again.', 409);
      return json({ ...data, _version: existing.version + 1 });
    } catch (error) {
      const status = error.status || (/UNIQUE constraint/i.test(error.message) ? 409 : 500);
      return json({ error: status === 500 ? 'Could not complete the request. Check the database connection and try again.' : error.message }, status);
    }
  };
}
export default { fetch: createHandler() };
