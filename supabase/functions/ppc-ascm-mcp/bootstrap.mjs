import { createMasterGateway, createAscmConnectionReporter } from '../ppc-master/gateway.mjs';
import { createAscmMcpCore } from './core.mjs';
import { createAscmMcpHttpHandler } from './http.mjs';

/**
 * SDK dependencies are supplied by the pinned Edge entry point (or the same
 * packages in local checks), keeping this composition importable in Node.
 * @param {{env?: Record<string, string>, createMcpHandler: Function, McpServer: Function,
 * z: any, fetchImpl?: typeof fetch, now?: Function, cryptoImpl?: Crypto,
 * gatewayFactory?: Function, connectionReporterFactory?: Function}} options
 */
export function createAscmMcpApplication({ env = {}, createMcpHandler, McpServer, z,
  fetchImpl = globalThis.fetch, now = () => new Date().toISOString(), cryptoImpl = globalThis.crypto,
  gatewayFactory = createMasterGateway, connectionReporterFactory = createAscmConnectionReporter } = {}) {
  let gateway, connectionReporter;
  const core = createAscmMcpCore({ env, fetchImpl, now, cryptoImpl,
    invokeAscm: request => {
      gateway ||= gatewayFactory({ env, fetchImpl, now, cryptoImpl });
      return gateway(request);
    },
    invokeConnection: payload => {
      connectionReporter ||= connectionReporterFactory({ env, fetchImpl });
      return connectionReporter(payload);
    },
  });
  return createAscmMcpHttpHandler({ core, resource: env.PPC_ASCM_MCP_RESOURCE,
    issuer: env.SUPABASE_URL ? `${env.SUPABASE_URL}/auth/v1` : '', createMcpHandler, McpServer, z });
}
