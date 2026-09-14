import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const pages = [
  ['home', '/', 'ARENA — Your edge. Your arena.', 'The daily trading competition on Robinhood Chain. Explore the arena, follow each round and find your place.'],
  ['arena', '/arena/', 'The arena — ARENA', 'Follow the current ARENA round, its countdown and confirmed registrations. Check eligibility and register for the next round.'],
  ['rounds', '/rounds/', 'Round directory — ARENA', 'Explore current, upcoming and past ARENA trading windows. Search a round and view its schedule.'],
  ['round', '/rounds/view/', 'Round details — ARENA', 'Round timing, registration windows and the status of verified results.'],
  ['my-arena', '/my-arena/', 'My arena — ARENA', 'Your wallet, access eligibility and confirmed round entries in one place.'],
  ['guide', '/guide/', 'How to play — ARENA', 'Learn how to connect, qualify and enter an ARENA trading round.'],
  ['token', '/token/', '$ARENA access — ARENA', 'The official access contract, network and 10 million token entry requirement.'],
  ['rules', '/rules/', 'The rulebook — ARENA', 'Read the confirmed competition rules, entry requirements and terms awaiting final confirmation.'],
];
const source = async relative => (await readFile(path.join(root, relative), 'utf8')).replaceAll('\r\n', '\n');
const layout = await source('site/layout.html');
const sculpture = await source('site/components/sculpture.svg');
const entry = await source('site/components/entry.html');
const navigation = [['arena','/arena/','The arena'],['rounds','/rounds/','Rounds'],['guide','/guide/','How to play'],['token','/token/','$ARENA'],['rules','/rules/','Rules']];
for (const [id, url, title, description] of pages) {
  const content = (await source(`site/pages/${id}.html`)).replace('{{sculpture}}', sculpture).replace('{{entry}}', entry);
  const nav = navigation.map(([key, href, label]) => `<a href="${href}"${key === id || (id === 'round' && key === 'rounds') ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  let html = layout;
  for (const [key, value] of Object.entries({id, url, title, description, content, nav})) html = html.replaceAll(`{{${key}}}`, value);
  if (/\{\{\w+\}\}/.test(html)) throw new Error('Unresolved template in ' + id);
  const directory = path.join(root, 'dist', url);
  await mkdir(directory, {recursive:true});
  await writeFile(path.join(directory, 'index.html'), html);
}
console.log(`Built ${pages.length} ARENA pages.`);
