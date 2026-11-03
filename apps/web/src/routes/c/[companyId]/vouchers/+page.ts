import { api, guard } from '#lib';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, url, depends }) => {
	depends('app:vouchers');
	const filters = {
		status: (['draft', 'booked'] as const).find((s) => s === url.searchParams.get('status')),
		from: url.searchParams.get('from') || undefined,
		to: url.searchParams.get('to') || undefined,
		search: url.searchParams.get('search') || undefined,
		account: url.searchParams.get('account') || undefined,
	};
	const page = await guard(api.call('vouchers.list', { companyId: params.companyId, limit: 50, ...filters }));
	return { filters, page };
};
