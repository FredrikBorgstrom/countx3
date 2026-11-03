<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let search = $state('');

	const types: Record<string, () => string> = {
		asset: m.type_asset,
		liability: m.type_liability,
		equity: m.type_equity,
		income: m.type_income,
		expense: m.type_expense,
	};
	const visible = $derived(
		data.items.filter(
			(a) => !search || a.number.startsWith(search) || a.name.toLowerCase().includes(search.toLowerCase()),
		),
	);
</script>

<div class="stack">
	<header class="row">
		<h1>{m.nav_accounts()}</h1>
		<input type="search" placeholder={m.search()} bind:value={search} />
	</header>
	<div class="card table-wrap">
		<table>
			<thead>
				<tr><th>{m.account()}</th><th>{m.name()}</th><th>{m.type()}</th><th>{m.tax_code()}</th><th></th></tr>
			</thead>
			<tbody>
				{#each visible as a (a.number)}
					<tr class:inactive={!a.active}>
						<td><a href={`/c/${data.company.id}/vouchers?account=${a.number}`}>{a.number}</a></td>
						<td>{a.name}</td>
						<td>{types[a.type]?.() ?? a.type}</td>
						<td>{a.defaultTaxCode ?? ''}</td>
						<td>{#if !a.active}<span class="badge">{m.inactive()}</span>{/if}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<style>
	.inactive {
		color: var(--muted);
	}
</style>
