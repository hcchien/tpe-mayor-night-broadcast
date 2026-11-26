-- Existing registrations were for election eve; never opt them into counting night.
ALTER TABLE venues ADD COLUMN events TEXT NOT NULL DEFAULT '["election_eve"]'
  CHECK(events IN ('["election_eve"]','["counting_night"]','["election_eve","counting_night"]'));
