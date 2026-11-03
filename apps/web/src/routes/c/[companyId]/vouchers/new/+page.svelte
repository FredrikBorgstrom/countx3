<script lang="ts">
	import { amount, api, Countx3Error, parseAmountInput, sumAmounts, today } from '#lib';
	import { m } from '#lib/paraglide/messages.js';
	import { goto } from '$app/navigation';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type Row = { account: string; debit: string; credit: string; taxCode: string; description: string };
	const emptyRow = (): Row => ({ account: '', debit: '', credit: '', taxCode: '', description: '' });

	let series = $state('A');
	let date = $state(today());
	let description = $state('');
	let rows = $state<Row[]>([emptyRow(), emptyRow()]);
	let issues = $state<{ code: string; message: string; path?: string }[]>([]);
	let busy = $state(false);

	const companyId = $derived(data.company.id);
	const accountNames = $derived(new Map(data.accounts.map((a) => [a.number, a])));

	/** Debit and credit columns become one signed amount per line, the API format. */
	const lines = $derived(
		rows
			.filter((r) => r.account || r.debit || r.credit)
			.map((r) => {
				const debit = r.debit ? parseAmountInput(r.debit) : null;
				const credit = r.credit ? parseAmountInput(r.credit) : null;
				const value = debit ?? (credit ? (credit.startsWith('-') ? credit.slice(1) : `-${credit}`) : null);
				return {
					account: r.account.trim(),
					amount: value ?? '',
					taxCode: r.taxCode || undefined,
					description: r.description || undefined,
				};
			}),
	);
	const malformed = $derived(lines.some((l) => !l.amount));
	const debitTotal = $derived(
		sumAmounts(lines.filter((l) => l.amount && !l.amount.startsWith('-')).map((l) => l.amount)),
	);
	const creditTotal = $derived(
		sumAmounts(lines.filter((l) => l.amount.startsWith('-')).map((l) => l.amount.slice(1))),
	);
	const difference = $derived(sumAmounts(lines.filter((l) => l.amount).map((l) => l.amount)));

	function onAccountChange(row: Row) {
		const account = accountNames.get(row.account.trim());
		if (account?.defaultTaxCode && !row.taxCode) row.taxCode = account.defaultTaxCode;
	}

	// Live validation: the server runs the real booking in a dry run and reports every problem.
	let validationTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const input = { companyId, series, date, description, lines };
		clearTimeout(validationTimer);
		if (malformed || lines.length < 2 || !description) {
			issues = [];
			return;
		}
		validationTimer = setTimeout(async () => {
			try {
				await api.call('vouchers.create', { ...input, book: true, dryRun: true });
				issues = [];
			} catch (err) {
				issues =
					err instanceof Countx3Error
						? err.issues?.length
							? err.issues
							: [{ code: err.code, message: err.message }]
						: [];
			}
		}, 350);
	});

	async function save(book: boolean) {
		busy = true;
		try {
			await api.call('vouchers.create', { companyId, series, date, description, lines, book });
			await goto(`/c/${companyId}/vouchers`);
		} catch (err) {
			issues =
				err instanceof Countx3Error
					? err.issues?.length
						? err.issues
						: [{ code: err.code, message: err.message }]
					: [];
		} finally {
			busy = false;
		}
	}
</script>

<datalist id="accounts">
	{#each data.accounts as a (a.number)}<option value={a.number}>{a.name}</option>{/each}
</datalist>

<div class="stack">
	<h1>{m.nav_new_voucher()}</h1>

	<section class="card stack">
		<div class="head">
			<label>
				{m.series()}
				<select bind:value={series}>
					{#each data.series as s (s.code)}<option value={s.code}>{s.code} – {s.name}</option>{/each}
				</select>
			</label>
			<label>{m.date()}<input type="date" bind:value={date} /></label>
			<label class="grow">{m.description()}<input bind:value={description} placeholder={m.description_placeholder()} /></label>
		</div>

		<div class="table-wrap">
			<table class="editor">
				<thead>
					<tr>
						<th>{m.account()}</th>
						<th>{m.tax_code()}</th>
						<th class="num">{m.debit()}</th>
						<th class="num">{m.credit()}</th>
						<th>{m.text()}</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each rows as row, i (i)}
						<tr>
							<td>
								<input list="accounts" bind:value={row.account} onchange={() => onAccountChange(row)} size="6" aria-label={m.account()} />
								<div class="muted small">{accountNames.get(row.account.trim())?.name ?? ''}</div>
							</td>
							<td>
								<select bind:value={row.taxCode} aria-label={m.tax_code()}>
									<option value=""></option>
									{#each data.taxCodes as t (t.code)}<option value={t.code} title={t.label}>{t.code}</option>{/each}
								</select>
							</td>
							<td><input class="num" inputmode="decimal" bind:value={row.debit} oninput={() => (row.credit = '')} aria-label={m.debit()} /></td>
							<td><input class="num" inputmode="decimal" bind:value={row.credit} oninput={() => (row.debit = '')} aria-label={m.credit()} /></td>
							<td><input bind:value={row.description} aria-label={m.text()} /></td>
							<td><button type="button" aria-label={m.remove_line()} onclick={() => rows.splice(i, 1)} disabled={rows.length <= 2}>×</button></td>
						</tr>
					{/each}
				</tbody>
				<tfoot>
					<tr>
						<td colspan="2"><button type="button" onclick={() => rows.push(emptyRow())}>{m.add_line()}</button></td>
						<td class="num"><strong>{amount(debitTotal)}</strong></td>
						<td class="num"><strong>{amount(creditTotal)}</strong></td>
						<td colspan="2">
							{#if difference !== '0.00'}<span class="error">{m.difference({ amount: amount(difference) })}</span>{/if}
						</td>
					</tr>
				</tfoot>
			</table>
		</div>

		{#if malformed}<p class="error">{m.invalid_amounts()}</p>{/if}
		{#if issues.length}
			<ul class="issues">
				{#each issues as issue (issue.code + issue.path)}
					<li class="error"><code>{issue.code}</code> {issue.message}</li>
				{/each}
			</ul>
		{/if}

		<div class="row">
			<button class="primary" disabled={busy || malformed || issues.length > 0} onclick={() => save(true)}>{m.book()}</button>
			<button disabled={busy || malformed} onclick={() => save(false)}>{m.save_draft()}</button>
		</div>
		<p class="muted small">{m.booking_is_permanent()}</p>
	</section>
</div>

<style>
	.head {
		display: grid;
		grid-template-columns: auto auto 1fr;
		gap: 0.75rem;
	}

	.editor input,
	.editor select {
		width: 100%;
	}

	.editor td:first-child {
		min-width: 9rem;
	}

	.small {
		font-size: 0.8rem;
	}

	.issues {
		margin: 0;
		padding-left: 1.1rem;
	}

	@media (max-width: 640px) {
		.head {
			grid-template-columns: 1fr 1fr;
		}

		.grow {
			grid-column: 1 / -1;
		}
	}
</style>
