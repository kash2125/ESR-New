import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const baseURL=process.argv[2] || 'https://esr-new.pages.dev';
if(!/^https:\/\/(?:esr-new\.pages\.dev|new\.getesr\.com)$/.test(baseURL))throw new Error('Use an approved ESR-New hostname.');
process.stdout.write('Enter staff password to verify login (input is hidden):\n');
process.stdin.setRawMode(true);process.stdin.resume();
let input='';
process.stdin.on('data',async chunk=>{
  for(const char of chunk.toString()) {
    if(char==='\u0003')process.exit(1);
    if(char==='\r' || char==='\n') {
      process.stdin.setRawMode(false);process.stdin.pause();
      const password=input;input='';let browser;
      try {
        browser=await chromium.launch({channel:'chrome',headless:true});
        const context=await browser.newContext();const page=await context.newPage();
        await page.goto(baseURL+'/login.html');
        await page.locator('#password').fill(password);
        await page.locator('#signInButton').click();
        await page.waitForURL(url=>['/','/index.html'].includes(url.pathname));
        await page.locator('#addProjectBtn').waitFor({state:'visible'});
        await page.locator('.deleteOnlyActions').first().waitFor({state:'visible'});
        const session=await page.evaluate(async()=>await(await fetch('/api/session')).json());
        assert.equal(session.user.email,'engineering@nswash.com');
        assert.equal(session.canDelete,true,'Server grants delete permission to the engineering account');
        const project=await page.evaluate(async()=> (await(await fetch('/api/projects')).json())[0].project_number);
        await page.goto(baseURL+'/edit_project.html?project='+encodeURIComponent(project));
        await page.waitForFunction(()=>!!document.querySelector('#project_number').value);
        await page.goto(baseURL+'/index.html');
        await page.locator('#logoutBtn').click();
        await page.waitForFunction(()=>getComputedStyle(document.querySelector('#loginBtn')).display!=='none');
        const after=await page.evaluate(async()=>await(await fetch('/api/session')).json());
        assert.equal(after.user,null);
        console.log('Verified production login, staff/delete permissions, project editor loading, and logout. No project records were changed.');
      } catch(error) {console.error(String(error.message).replaceAll(password,'[hidden]'));process.exitCode=1;}
      finally {if(browser)await browser.close();process.exit(process.exitCode || 0);}
    } else if(char==='\u007f' || char==='\b')input=input.slice(0,-1);
    else input+=char;
  }
});
