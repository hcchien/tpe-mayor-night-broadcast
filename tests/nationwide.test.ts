import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { cities, submissionSchema } from '../src/schema';
import { submission, venue } from './support';

test('nationwide registration accepts all 22 counties and cities, townships and islands',()=>{
  assert.equal(cities.length,22);
  for(const [city,district] of [['新竹縣','竹北市'],['花蓮縣','吉安鄉'],['南投縣','埔里鎮'],['澎湖縣','湖西鄉'],['金門縣','金城鎮'],['連江縣','南竿鄉']]) {
    assert.equal(submissionSchema.safeParse({...submission,city,district,address:city+district+'測試路 100 號'}).success,true);
  }
  assert.equal(submissionSchema.parse({...submission,city:'台中市',district:'西區'}).city,'臺中市');
  for(const change of [{city:'東京'},{city:undefined},{district:'<script>'},{district:'區'},{district:'x'.repeat(100)}])assert.equal(submissionSchema.safeParse({...submission,...change}).success,false);
});

test('nationwide migration preserves existing venue content and defaults its city to Taipei',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    for(const file of ['0001_initial.sql','0002_merchant_google_auth.sql','0003_admin_google_login.sql'])db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
    const {city,...oldVenue}=venue;
    const fields={...oldVenue,accessible:1,id:'existing-venue',consent_version:'existing',created_at:'2026-11-26',updated_at:'2026-11-26'};
    db.prepare(`INSERT INTO venues(${Object.keys(fields).join(',')}) VALUES(${Object.keys(fields).map(()=>'?').join(',')})`).run(...Object.values(fields));
    db.exec(readFileSync(new URL('../migrations/0004_nationwide_venues.sql',import.meta.url),'utf8'));
    const row=db.prepare('SELECT * FROM venues WHERE id=?').get('existing-venue')!;
    assert.equal(row.city,'臺北市');
    for(const [key,value] of Object.entries(fields))assert.equal(row[key],value);
  }finally{db.close();}
});
