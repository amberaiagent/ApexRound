import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountTokenPanel } from '../dist/lib/token-panel.js';
import { config } from '../dist/lib/config.js';

const old = '0x' + 'a'.repeat(40), next = '0x' + 'b'.repeat(40);
const tick = () => new Promise(resolve => setImmediate(resolve));
function panel(initial) {
  const nodes = new Map(['access-contract','copy-contract','contract-explorer','copy-status'].map(id => {
    const node = new EventTarget();
    Object.assign(node, {textContent:'', hidden:false, disabled:false, removeAttribute(key) { delete this[key]; }});
    return [id,node];
  }));
  const window = new EventTarget(), writes = [];
  const send = detail => window.dispatchEvent(new CustomEvent('arena:state', {detail}));
  window.addEventListener('arena:state-request', () => { if (initial) send(initial); });
  mountTokenPanel({document:{querySelector:selector=>nodes.get(selector.slice(1))},window,navigator:{clipboard:{writeText:async value=>writes.push(value)}}});
  return {nodes,writes,send};
}
const active = address => ({ready:true,state:{token:{chainId:4663,address}}});
const pending = {ready:true,state:{token:null}};
test('Public configuration has no substitute access CA while the new token is pending', () => {
  assert.equal(config.tokenAddress,null);
  assert.equal(config.decimals,null);
});
test('Token panel waits for verified state, clears retired CA and accepts the new token without a reload', async () => {
  const ui=panel();
  assert.match(ui.nodes.get('access-contract').textContent,/Checking/);
  assert.equal(ui.nodes.get('copy-contract').hidden,true);
  ui.send(active(old));
  assert.equal(ui.nodes.get('access-contract').textContent,old);
  ui.nodes.get('copy-contract').dispatchEvent(new Event('click')); await tick();
  assert.deepEqual(ui.writes,[old]);
  ui.send(pending);
  assert.match(ui.nodes.get('access-contract').textContent,/New contract to be announced/);
  assert.equal(ui.nodes.get('contract-explorer').href,undefined);
  assert.equal(ui.nodes.get('copy-status').textContent,'');
  ui.nodes.get('copy-contract').dispatchEvent(new Event('click')); await tick();
  assert.deepEqual(ui.writes,[old]);
  ui.send(active(next));
  assert.equal(ui.nodes.get('contract-explorer').href,'https://robinhoodchain.blockscout.com/token/'+next);
  ui.nodes.get('copy-contract').dispatchEvent(new Event('click')); await tick();
  assert.deepEqual(ui.writes,[old,next]);
});
test('Stale, failed, malformed and wrong-network state cannot expose or copy a CA', async () => {
  for (const state of [{...active(old),ready:false}, {ready:false,error:'Offline'}, active('javascript:alert(1)'), active('0x'+'0'.repeat(40)), {ready:true,state:{token:{chainId:1,address:old}}}]) {
    const ui=panel(active(old)); ui.send(state);
    assert.equal(ui.nodes.get('copy-contract').disabled,true);
    assert.equal(ui.nodes.get('contract-explorer').hidden,true);
    assert.equal(ui.nodes.get('contract-explorer').href,undefined);
    assert.ok(!ui.nodes.get('access-contract').textContent.includes(old));
    ui.nodes.get('copy-contract').dispatchEvent(new Event('click')); await tick();
    assert.deepEqual(ui.writes,[]);
  }
});
