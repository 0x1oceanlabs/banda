CREATE TABLE clients_notes (
  id INTEGER PRIMARY KEY,
  client INTEGER NOT NULL REFERENCES clients_people (id),
  text TEXT NOT NULL,
  at INTEGER NOT NULL
);
