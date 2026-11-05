const encoder = new TextEncoder();
const hex = bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2,'0')).join('');
const bytes = value => Uint8Array.from(value.match(/../g) || [], pair => parseInt(pair,16));
const fail = (message,status) => Object.assign(new Error(message),{status});
const digest = async value => hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
const approved = (email,env) => String(env.EDIT_ALLOWED_EMAILS || '').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean).includes(email);
async function derive(password,salt,iterations) {
  const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations,hash:'SHA-256'},key,256));
}
export async function hashPassword(password) {
  const salt=crypto.getRandomValues(new Uint8Array(32));
  // Workers Web Crypto supports PBKDF2 at up to 100,000 iterations.
  return `pbkdf2$100000$${hex(salt)}$${hex(await derive(password,salt,100000))}`;
}
async function matches(password,stored) {
  const parts=String(stored).split('$');
  if(parts.length!==4 || parts[0]!=='pbkdf2' || parts[1]!=='100000' || !/^[0-9a-f]{64}$/.test(parts[2]) || !/^[0-9a-f]{64}$/.test(parts[3])) throw fail('Staff login has not been configured.',503);
  const actual=await derive(password,bytes(parts[2]),100000);
  const expected=bytes(parts[3]);
  let difference=0;
  for(let i=0;i<32;i++) difference |= actual[i]^expected[i];
  return difference===0;
}
function tokenFrom(request) {
  return (request.headers.get('Cookie') || '').match(/(?:^|;\s*)esr_session=([0-9a-f]{64})(?:;|$)/)?.[1];
}
export async function verifyIdentity(request,env) {
  const token=tokenFrom(request);
  if(!token) throw fail('Please sign in with your engineering account.',401);
  const row=await env.DB.prepare('SELECT email, expires_at FROM staff_sessions WHERE token_hash = ?').bind(await digest(token)).first();
  if(!row || row.expires_at<=Date.now() || !approved(row.email,env)) throw fail('Your session has expired. Please sign in again.',401);
  return {email:row.email};
}
export async function signIn(request,env,body) {
  if(!env.STAFF_PASSWORD_HASH) throw fail('Staff login has not been configured.',503);
  if(typeof body?.email!=='string' || typeof body?.password!=='string' || body.password.length>256) throw fail('Enter your engineering email and password.',400);
  const email=body.email.trim().toLowerCase();
  const now=Date.now();
  const window=15*60*1000;
  const ip=request.headers.get('CF-Connecting-IP') || 'local';
  const key=await digest(ip+':'+Math.floor(now/window));
  const attempt=await env.DB.prepare('INSERT INTO login_attempts (attempt_key,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(attempt_key) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(key,now+window).first();
  if(attempt.attempts>5) throw fail('Too many sign-in attempts. Please try again in 15 minutes.',429);
  // Run the same password check for both approved and unknown email addresses.
  const valid=await matches(body.password,env.STAFF_PASSWORD_HASH);
  if(!valid || !approved(email,env)) throw fail('Email or password is incorrect.',401);
  const token=hex(crypto.getRandomValues(new Uint8Array(32)));
  const expires=now+8*60*60*1000;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM staff_sessions WHERE expires_at <= ?').bind(now),
    env.DB.prepare('DELETE FROM login_attempts WHERE expires_at <= ?').bind(now),
    env.DB.prepare('DELETE FROM login_attempts WHERE attempt_key = ?').bind(key),
    env.DB.prepare('INSERT INTO staff_sessions (token_hash,email,expires_at,created_at) VALUES (?,?,?,?)').bind(await digest(token),email,expires,now)
  ]);
  return { user:{email}, cookie:`esr_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800` };
}
export async function signOut(request,env) {
  const token=tokenFrom(request);
  if(token) await env.DB.prepare('DELETE FROM staff_sessions WHERE token_hash = ?').bind(await digest(token)).run();
  return 'esr_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
}
