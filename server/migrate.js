'use strict';
// `npm run migrate` — creates/updates the database schema.
const db = require('./db');
db.open();
console.log('Database ready:', require('./config').databaseFile);
db.close();
