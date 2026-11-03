import { api, guard } from '#lib';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params }) => {
	const companyId = params.companyId;
	const [accounts, taxCodes, series] = await guard(
		Promise.all([
			api.call('accounts.list', { companyId }),
			api.call('taxCodes.list', { companyId }),
			api.call('series.list', { companyId }),
		]),
	);
	return { accounts: accounts.items, taxCodes: taxCodes.items, series: series.items };
};
