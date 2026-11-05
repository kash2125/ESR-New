import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { createHandler, cleanDescription, verifyIdentity } from '../src/worker.js';
import { hashPassword } from '../src/auth.js';
function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../migrations/0001_projects.sql', import.meta.url), 'utf8'));
  db.exec(fs.readFileSync(new URL('../migrations/0002_staff_login.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql) {
      const statement = db.prepare(sql);
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { return statement.get(...args) || null; },
        async all() { return { results: statement.all(...args) }; },
        run() { return { meta: { changes: Number(statement.run(...args).changes) } }; }
      };
    },
    async batch(statements) {
      db.exec('BEGIN');
      try { const result = statements.map(s => s.run()); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    }
  };
}
const base = { project_number:'2_3055', project_name:'Sample Transit', engineer:'Kash', project_status:'Contract', sales_person:'Victor Sanchez', start_date:'2026-10-01', description:'<div class="descriptionEntry">Initial update</div>' };
const request = (route, method = 'GET', body, headers = {}) => new Request('https://new.getesr.com' + route, { method, headers:{ Origin:'https://new.getesr.com', 'Content-Type':'application/json', ...headers }, ...(body ? {body: JSON.stringify(body)} : {}) });
test('public reads, authentication, CSRF, optimistic updates, audit trail and delete roles', async () => {
  const env = { DB:database(), DELETE_ALLOWED_EMAILS:'owner@example.com' };
  const handle = createHandler(async req => {
    const email = req.headers.get('Test-Identity');
    if (!email) throw Object.assign(new Error('Sign in required'), { status:401 });
    return {email};
  });
  const staff = {'Test-Identity':'staff@example.com'};
  assert.deepEqual(await (await handle(request('/api/projects'), env)).json(), []);
  assert.equal((await handle(request('/api/admin/projects','POST',{project:base}),env)).status,401);
  assert.equal((await handle(request('/api/admin/projects','POST',{project:base},{...staff,Origin:'https://other.test'}),env)).status,403);
  assert.equal((await handle(request('/api/admin/projects','POST',{project:base},staff),env)).status,201);
  assert.equal((await handle(request('/api/admin/projects','POST',{project:{...base,project_number:'2_3055'}},staff),env)).status,409);
  const before = await (await handle(request('/api/projects'),env)).json();
  assert.equal(before.length,1);
  assert.equal(before[0]._version,1);
  const changed = {...base,description:'Updated',project_number:'2_3056'};
  assert.equal((await handle(request('/api/admin/projects/2_3055','PUT',{project:changed,expected_version:1},staff),env)).status,200);
  assert.equal((await handle(request('/api/admin/projects/2_3056','PUT',{project:changed,expected_version:1},staff),env)).status,409);
  assert.equal((await handle(request('/api/admin/projects/2_3056','DELETE',{expected_version:2},staff),env)).status,403);
  const audit = await env.DB.prepare('SELECT * FROM project_audit').all();
  assert.equal(audit.results.length,2);
  assert.match(audit.results[1].previous_data,/Initial update/);
  assert.equal((await handle(request('/api/admin/projects/2_3056','DELETE',{expected_version:2},{'Test-Identity':'owner@example.com'}),env)).status,200);
  assert.equal((await env.DB.prepare('SELECT * FROM project_audit').all()).results.length,3);
  assert.deepEqual(await (await handle(request('/api/projects'),env)).json(),[]);
});
test('unsigned and forged staff sessions cannot write',async () => {
  const handle=createHandler();
  const env={DB:database()};
  assert.equal((await handle(request('/api/admin/projects','POST',{project:base},{Cookie:'esr_session='+'a'.repeat(64)}),env)).status,401);
  assert.deepEqual(await (await handle(request('/api/session'),env)).json(),{user:null,canDelete:false});
});
test('stored markup is sanitized while history structure remains',() => {
  const html=cleanDescription('<section class="latestUpdateBox"><div class="projectUpdate" onclick="alert(1)">Note<script>alert(1)</script><img src=x onerror=alert(1)></div></section>');
  assert.match(html,/latestUpdateBox/);
  assert.match(html,/projectUpdate/);
  assert.doesNotMatch(html,/script|onclick|onerror|img/);
});
test('password login uses hashed sessions, expiry, approved email, logout and throttling',async () => {
  const env={DB:database(),EDIT_ALLOWED_EMAILS:'engineering@nswash.com',DELETE_ALLOWED_EMAILS:'engineering@nswash.com',STAFF_PASSWORD_HASH:await hashPassword('local test password only')};
  const handle=createHandler();
  const credentials={email:'engineering@nswash.com',password:'local test password only'};
  assert.equal((await handle(request('/api/login','POST',{...credentials,password:'wrong'}),env)).status,401);
  assert.equal((await handle(request('/api/login','POST',{...credentials,email:'other@example.com'}),env)).status,401);
  const login=await handle(request('/api/login','POST',credentials),env);
  assert.equal(login.status,200);
  const cookie=login.headers.get('Set-Cookie');
  assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);
  const req=request('/api/admin/session','GET',null,{Cookie:cookie.split(';')[0]});
  assert.deepEqual(await verifyIdentity(req,env),{email:'engineering@nswash.com'});
  const stored=await env.DB.prepare('SELECT * FROM staff_sessions').all();
  assert.equal(stored.results.length,1);
  assert.ok(!cookie.includes(stored.results[0].token_hash));
  assert.equal((await handle(request('/api/logout','POST',{}, {Cookie:cookie.split(';')[0]}),env)).status,200);
  await assert.rejects(verifyIdentity(req,env),{status:401});
  for(let i=0;i<5;i++)assert.equal((await handle(request('/api/login','POST',{...credentials,password:'wrong'}),env)).status,401);
  assert.equal((await handle(request('/api/login','POST',credentials),env)).status,429);
});
