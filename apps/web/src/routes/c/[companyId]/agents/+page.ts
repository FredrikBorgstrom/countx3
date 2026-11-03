import { api, guard } from '#lib';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, depends }) => {
	depends('app:tokens');
	const { items } = await guard(api.call('tokens.list', {}));
	return { tokens: items.filter((t) => t.companyId === params.companyId || t.companyId === null) };
};
