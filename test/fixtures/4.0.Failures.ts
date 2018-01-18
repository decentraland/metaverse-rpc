import { ScriptingClient, API } from '../../lib/client';
import { test, shouldFail } from './support/ClientHelpers';

test(() => shouldFail(async () => {
  // this line throws an error in the RPC host
  // the error should be forwarded to the client
  // and it should create and throw a valid instance of Error (js)
  await API.Methods.fail();

  return 'ok';
}, 'RPC Call to API.Methods.fail'));
