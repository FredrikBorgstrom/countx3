import { api, guard } from '#lib';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params }) =>
	guard(api.call('audit.list', { companyId: params.companyId, limit: 200 }));
