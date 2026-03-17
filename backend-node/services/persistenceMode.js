let mongoAvailable = false;

export function setMongoAvailability(value) {
  mongoAvailable = Boolean(value);
}

export function isMongoAvailable() {
  return mongoAvailable;
}
