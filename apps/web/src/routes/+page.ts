import { redirect } from '@sveltejs/kit';
import { api, guard, isSignedIn } from '#lib';
import type { PageLoad } from './$types';

export const load: PageLoad = async () => {
	if (!isSignedIn()) redirect(307, '/login');
	const { items } = await guard(api.call('companies.list', {}));
	redirect(307, items.length === 1 ? `/c/${items[0]!.id}` : '/companies');
};
