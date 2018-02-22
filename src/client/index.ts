// SANITY CHECKS

new Function(`
  XMLHttpRequest = function () {
    throw new Error('XMLHttpRequest is disabled. Please use fetch');
  };
`)()

// Exports

export * from './Script'
export * from './EventSubscriber'

export { WebWorkerTransport } from '../common/transports/WebWorker'
export { WebSocketTransport } from '../common/transports/WebSocket'
export { MemoryTransport } from '../common/transports/Memory'
