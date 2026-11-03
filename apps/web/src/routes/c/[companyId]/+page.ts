import { api, guard } from '#lib';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent, params }) => {
	const { fiscalYear, today } = await parent();
	const companyId = params.companyId;
	const to = today < fiscalYear.start ? fiscalYear.start : today > fiscalYear.end ? fiscalYear.end : today;
	const [balanceSheet, incomeStatement, recent, chain] = await guard(
		Promise.all([
			api.call('reports.balanceSheet', { companyId, date: to }),
			api.call('reports.incomeStatement', { companyId, from: fiscalYear.start, to }),
			api.call('vouchers.list', { companyId, limit: 8 }),
			api.call('ledger.verify', { companyId }),
		]),
	);
	return { balanceSheet, incomeStatement, recent: recent.items, chain, to };
};
