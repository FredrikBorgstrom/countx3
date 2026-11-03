import { api, guard } from '#lib';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, url, parent }) => {
	const { fiscalYear, today } = await parent();
	const companyId = params.companyId;
	const report =
		(['trial', 'income', 'balance'] as const).find((r) => r === url.searchParams.get('report')) ?? 'income';
	const from = url.searchParams.get('from') || fiscalYear.start;
	const to =
		url.searchParams.get('to') ||
		(today > fiscalYear.end ? fiscalYear.end : today < fiscalYear.start ? fiscalYear.start : today);

	if (report === 'trial') {
		return {
			report,
			from,
			to,
			trial: await guard(api.call('reports.trialBalance', { companyId, from, to })),
		};
	}
	const statement =
		report === 'income'
			? await guard(api.call('reports.incomeStatement', { companyId, from, to }))
			: await guard(api.call('reports.balanceSheet', { companyId, date: to }));
	return { report, from, to, statement };
};
