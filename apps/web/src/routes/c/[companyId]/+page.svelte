<script lang="ts">
	import { amount, voucherTotal } from '#lib';
	import ActorBadge from '#lib/components/ActorBadge.svelte';
	import { m } from '#lib/paraglide/messages.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const figure = (rows: { key: string; amount: string }[], key: string) =>
		rows.find((r) => r.key === key)?.amount ?? '0.00';
	const figures = $derived([
		{ label: m.figure_cash(), value: figure(data.balanceSheet.rows, 'cash') },
		{ label: m.figure_sales(), value: figure(data.incomeStatement.rows, 'netSales') },
		{ label: m.figure_result(), value: figure(data.incomeStatement.rows, 'yearResult') },
		{ label: m.figure_assets(), value: figure(data.balanceSheet.rows, 'totalAssets') },
	]);
</script>

<div class="stack">
	<header class="row">
		<h1>{m.nav_overview()}</h1>
		<span class="muted">{m.fiscal_year_range({ start: data.fiscalYear.start, end: data.to })}</span>
	</header>

	<section class="figures">
		{#each figures as f (f.label)}
			<div class="card">
				<div class="muted">{f.label}</div>
				<div class="value num">{amount(f.value)}</div>
			</div>
		{/each}
	</section>

	<section class="card">
		<div class="row">
			<h2>{m.latest_vouchers()}</h2>
			<span class="spacer"></span>
			<span class={data.chain.intact ? 'badge ok' : 'badge'} title={data.chain.head}>
				{data.chain.intact ? m.chain_intact({ count: data.chain.bookedVouchers }) : m.chain_broken()}
			</span>
		</div>
		{#if data.recent.length === 0}
			<p class="muted">{m.no_vouchers_yet()} <a href={`/c/${data.company.id}/vouchers/new`}>{m.nav_new_voucher()}</a></p>
		{:else}
			<div class="table-wrap">
				<table>
					<tbody>
						{#each data.recent as v (v.id)}
							<tr>
								<td>{#if v.ref}{v.ref}{:else}<span class="badge draft">{m.draft()}</span>{/if}</td>
								<td class="nowrap">{v.date}</td>
								<td>{v.description}</td>
								<td><ActorBadge actor={v.bookedBy ?? v.createdBy} /></td>
								<td class="num">{amount(voucherTotal(v.lines))}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</div>

<style>
	.figures {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 1rem;
	}

	.value {
		font-size: 1.4rem;
		font-weight: 600;
		text-align: left;
	}

	.spacer {
		flex: 1;
	}
</style>
