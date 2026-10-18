import { createMasterGateway, createAscmConnectionReporter } from '../ppc-master/gateway.mjs';
import { createPackageDelivery } from '../ppc-package/core.mjs';
import { createAscmFlowHttpHandler } from './http.mjs';

/** Laziness preserves the zero-business-access boundary of all refusals. */
export function createAscmFlowApplication({ env = {}, fetchImpl = globalThis.fetch, now = () => new Date().toISOString(),
  gatewayFactory = createMasterGateway, packageDeliveryFactory = createPackageDelivery, connectionReporterFactory = createAscmConnectionReporter } = {}) {
  let gateway, delivery, reporter;
  return createAscmFlowHttpHandler({ env, now,
    invokeAscm: request => { gateway ||= gatewayFactory({ env, fetchImpl, now }); return gateway(request); },
    getPackageDelivery: () => { delivery ||= packageDeliveryFactory({ env, fetchImpl, now }); return delivery; },
    invokeConnection: input => { reporter ||= connectionReporterFactory({ env, fetchImpl }); return reporter(input); },
  });
}
