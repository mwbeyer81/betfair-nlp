#!/usr/bin/env node

// MongoDB script to drop all collections
// This script will be executed by mongosh

// Get all collection names and drop each one
db.getCollectionNames().forEach(function (collection) {
  db[collection].drop();
  print("Dropped collection: " + collection);
});

print("All collections have been dropped successfully.");
