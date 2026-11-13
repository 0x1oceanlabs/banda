CREATE TABLE clients_people (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT,
  email TEXT,
  added_at INTEGER NOT NULL
);
CREATE INDEX clients_people_by_city ON clients_people (city);
