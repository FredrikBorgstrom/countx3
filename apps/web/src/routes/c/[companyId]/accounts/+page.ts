import { api, guard } from '#lib';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params }) =>
	guard(api.call('accounts.list', { companyId: params.companyId, includeInactive: true }));
