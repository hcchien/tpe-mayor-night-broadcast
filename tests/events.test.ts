import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import { venue } from './support';

test('event migration preserves existing registrations as election eve and constrains stored events',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')&&f<'0005').sort())db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
    const {events,...oldVenue}=venue;
    const fields={...oldVenue,accessible:1,id:'old',consent_version:'existing',created_at:'2026-11-26',updated_at:'2026-11-26'};
    db.prepare(`INSERT INTO venues(${Object.keys(fields).join(',')}) VALUES(${Object.keys(fields).map(()=>'?').join(',')})`).run(...Object.values(fields));
    db.exec(readFileSync(new URL('../migrations/0005_venue_events.sql',import.meta.url),'utf8'));
    const row=db.prepare('SELECT * FROM venues WHERE id=?').get('old')!;
    assert.deepEqual(JSON.parse(row.events as string),['election_eve']);
    for(const [key,value] of Object.entries(fields))assert.equal(row[key],value);
    for(const invalid of ['[]','["unknown"]','["election_eve","election_eve"]','not json'])assert.throws(()=>db.prepare('UPDATE venues SET events=? WHERE id=?').run(invalid,'old'));
  }finally{db.close();}
});
