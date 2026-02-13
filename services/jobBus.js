const EventEmitter = require('events');

// Singleton event bus for worker -> controller communication
class JobBus extends EventEmitter {}

module.exports = new JobBus();
