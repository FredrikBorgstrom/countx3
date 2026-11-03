<script lang="ts">
	import { amount } from '#lib';
	import { m } from '#lib/paraglide/messages.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const tabs = [
		{ id: 'income', label: m.income_statement() },
		{ id: 'balance', label: m.balance_sheet() },
		{ id: 'trial', label: m.trial_balance() },
	] as const;
	let open = $state<string | null>(null);
</script>

<div class="stack">
	<h1>{m.nav_reports()}</h1>

	<form class="card row" method="GET">
		<select name="report" value={data.report}>
			{#each tabs as tab (tab.id)}<option value={tab.id}>{tab.label}</option>{/each}
		</select>
		{#if data.report !== 'balance'}<input type="date" name="from" value={data.from} aria-label={m.from()} />{/if}
		<input type="date" name="to" value={data.to} aria-label={m.to()} />
		<button>{m.show()}</button>
	</form>

	{#if data.statement}
		<section class="card table-wrap">
			<h2>{data.statement.title}</h2>
			<table>
				<tbody>
					{#each data.statement.rows as row (row.key)}
						{#if row.isTotal || row.amount !== '0.00'}
							<tr class:total={row.isTotal} class:clickable={!row.isTotal} onclick={() => (open = open === row.key ? null : row.key)}>
								<td>{row.label}</td>
								<td class="num">{amount(row.amount)}</td>
							</tr>
							{#if open === row.key}
								{#each row.accounts as a (a.account)}
									<tr class="detail"><td>{a.account} {a.name}</td><td class="num">{amount(a.amount)}</td></tr>
								{/each}
							{/if}
						{/if}
					{/each}
				</tbody>
			</table>
		</section>
	{:else if data.trial}
		<section class="card table-wrap">
			<h2>{m.trial_balance()}</h2>
			<table>
				<thead>
					<tr>
						<th>{m.account()}</th>
						<th class="num">{m.opening_balance()}</th>
						<th class="num">{m.debit()}</th>
						<th class="num">{m.credit()}</th>
						<th class="num">{m.closing_balance()}</th>
					</tr>
				</thead>
				<tbody>
					{#each data.trial.rows as r (r.account)}
						<tr>
							<td><a href={`/c/${data.company.id}/vouchers?account=${r.account}`}>{r.account}</a> {r.name}</td>
							<td class="num">{amount(r.opening)}</td>
							<td class="num">{amount(r.debit)}</td>
							<td class="num">{amount(r.credit)}</td>
							<td class="num">{amount(r.closing)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	{/if}
</div>

<style>
	.total td {
		font-weight: 700;
		border-top: 2px solid var(--border);
	}

	.clickable {
		cursor: pointer;
	}

	.detail td {
		color: var(--muted);
		font-size: 0.9rem;
		padding-left: 1.5rem;
	}
</style>
