<script lang="ts">
	import { amount, api, Countx3Error, voucherTotal } from '#lib';
	import ActorBadge from '#lib/components/ActorBadge.svelte';
	import { m } from '#lib/paraglide/messages.js';
	import { invalidate } from '$app/navigation';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type Voucher = (typeof data.page.items)[number];
	let extra = $state<Voucher[]>([]);
	let cursor = $state<string | null>(null);
	let expanded = $state<string | null>(null);
	let error = $state('');

	$effect(() => {
		// A new load (filters changed, or after an action) resets pagination.
		cursor = data.page.nextCursor;
		extra = [];
	});

	const vouchers = $derived([...data.page.items, ...extra]);
	const companyId = $derived(data.company.id);

	async function more() {
		if (!cursor) return;
		const next = await api.call('vouchers.list', { companyId, limit: 50, cursor, ...data.filters });
		extra = [...extra, ...next.items];
		cursor = next.nextCursor;
	}

	async function act(action: () => Promise<unknown>) {
		error = '';
		try {
			await action();
			await invalidate('app:vouchers');
		} catch (err) {
			error = err instanceof Countx3Error ? err.message : String(err);
		}
	}
</script>

<div class="stack">
	<header class="row">
		<h1>{m.nav_vouchers()}</h1>
		<span class="spacer"></span>
		<a href={`/c/${companyId}/vouchers/new`}><button class="primary">{m.nav_new_voucher()}</button></a>
	</header>

	<form class="card row filters" method="GET">
		<select name="status" value={data.filters.status ?? ''}>
			<option value="">{m.all_statuses()}</option>
			<option value="booked">{m.booked()}</option>
			<option value="draft">{m.drafts()}</option>
		</select>
		<input type="date" name="from" value={data.filters.from ?? ''} aria-label={m.from()} />
		<input type="date" name="to" value={data.filters.to ?? ''} aria-label={m.to()} />
		<input name="account" placeholder={m.account()} value={data.filters.account ?? ''} size="6" />
		<input name="search" placeholder={m.search()} value={data.filters.search ?? ''} />
		<button>{m.filter()}</button>
	</form>

	{#if error}<p class="error" role="alert">{error}</p>{/if}

	<div class="card table-wrap">
		<table>
			<thead>
				<tr>
					<th>{m.voucher()}</th>
					<th>{m.date()}</th>
					<th>{m.description()}</th>
					<th>{m.by()}</th>
					<th class="num">{m.amount()}</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each vouchers as v (v.id)}
					<tr class="clickable" onclick={() => (expanded = expanded === v.id ? null : v.id)}>
						<td>{#if v.ref}<strong>{v.ref}</strong>{:else}<span class="badge draft">{m.draft()}</span>{/if}</td>
						<td class="nowrap">{v.date}</td>
						<td>
							{v.description}
							{#if v.correctsVoucherId}<span class="badge">{m.correction()}</span>{/if}
						</td>
						<td><ActorBadge actor={v.bookedBy ?? v.createdBy} /></td>
						<td class="num">{amount(voucherTotal(v.lines))}</td>
						<td class="actions">
							{#if v.status === 'draft'}
								<button onclick={(e) => { e.stopPropagation(); act(() => api.call('vouchers.book', { companyId, voucherId: v.id })); }}>{m.book()}</button>
								<button class="danger" onclick={(e) => { e.stopPropagation(); act(() => api.call('vouchers.delete', { companyId, voucherId: v.id })); }}>{m.delete()}</button>
							{/if}
						</td>
					</tr>
					{#if expanded === v.id}
						<tr class="lines">
							<td colspan="6">
								<table>
									<thead>
										<tr><th>{m.account()}</th><th>{m.text()}</th><th>{m.tax_code()}</th><th class="num">{m.debit()}</th><th class="num">{m.credit()}</th></tr>
									</thead>
									<tbody>
										{#each v.lines as line (line.lineNo)}
											<tr>
												<td>{line.account}</td>
												<td>{line.description ?? ''}</td>
												<td>{line.taxCode ?? ''}</td>
												<td class="num">{line.amount.startsWith('-') ? '' : amount(line.amount)}</td>
												<td class="num">{line.amount.startsWith('-') ? amount(line.amount.slice(1)) : ''}</td>
											</tr>
										{/each}
									</tbody>
								</table>
								{#if v.hash}<p class="muted hash">{m.booked_at({ at: v.bookedAt ?? '' })} · SHA-256 {v.hash.slice(0, 16)}…</p>{/if}
							</td>
						</tr>
					{/if}
				{:else}
					<tr><td colspan="6" class="muted">{m.no_vouchers_match()}</td></tr>
				{/each}
			</tbody>
		</table>
		{#if cursor}<button onclick={more}>{m.load_more()}</button>{/if}
	</div>
</div>

<style>
	.spacer {
		flex: 1;
	}

	.clickable {
		cursor: pointer;
	}

	.clickable:hover {
		background: var(--surface-2);
	}

	.actions {
		white-space: nowrap;
		text-align: right;
	}

	.lines > td {
		background: var(--surface-2);
	}

	.hash {
		font-size: 0.8rem;
		margin: 0.5rem 0 0;
	}

	.filters input[type='date'] {
		width: 10.5rem;
	}
</style>
