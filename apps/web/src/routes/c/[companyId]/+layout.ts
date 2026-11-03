import { redirect } from '@sveltejs/kit';
import { api, guard, isSignedIn } from '#lib';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ params }) => {
	if (!isSignedIn()) redirect(307, '/login');
	const company = await guard(api.call('companies.get', { companyId: params.companyId }));
	const today = new Date().toISOString().slice(0, 10);
	const fiscalYear =
		company.fiscalYears.find((fy) => fy.start <= today && today <= fy.end) ?? company.fiscalYears[0]!;
	return { company, fiscalYear, today };
};
