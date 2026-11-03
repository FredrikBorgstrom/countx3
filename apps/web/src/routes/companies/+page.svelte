<script lang="ts">
	import { api, Countx3Error, signOut } from '#lib';
	import { m } from '#lib/paraglide/messages.js';
	import { goto } from '$app/navigation';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const year = new Date().getFullYear();
	let form = $state({
		name: '',
		legalForm: 'AB' as 'AB' | 'EF',
		organizationNumber: '',
		start: `${year}-01-01`,
		end: `${year}-12-31`,
	});
	let issues = $state<string[]>([]);
	let busy = $state(false);

	async function create(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		issues = [];
		try {
			const company = await api.call('companies.create', {
				name: form.name,
				legalForm: form.legalForm,
				organizationNumber: form.organizationNumber,
				fiscalYear: { start: form.start, end: form.end },
			});
			await goto(`/c/${company.id}`);
		} catch (err) {
			if (err instanceof Countx3Error)
				issues = err.issues?.length ? err.issues.map((i) => i.message) : [err.message];
			else issues = [m.network_error()];
		} finally {
			busy = false;
		}
	}
</script>

<main class="stack">
	<header class="row">
		<h1>{m.companies()}</h1>
		<span class="spacer"></span>
		<button onclick={signOut}>{m.log_out()}</button>
	</header>

	{#if data.items.length > 0}
		<ul class="card list">
			{#each data.items as company (company.id)}
				<li>
					<a href={`/c/${company.id}`}>{company.name}</a>
					<span class="muted">{company.organizationNumber} · {company.legalForm}</span>
					<span class="badge">{company.role}</span>
				</li>
			{/each}
		</ul>
	{/if}

	<form class="card stack" onsubmit={create}>
		<h2>{m.new_company()}</h2>
		<label>{m.company_name()}<input required bind:value={form.name} /></label>
		<div class="grid">
			<label>
				{m.legal_form()}
				<select bind:value={form.legalForm}>
					<option value="AB">{m.legal_form_ab()}</option>
					<option value="EF">{m.legal_form_ef()}</option>
				</select>
			</label>
			<label>
				{form.legalForm === 'AB' ? m.organization_number() : m.personal_number()}
				<input required placeholder="556677-8899" bind:value={form.organizationNumber} />
			</label>
			<label>{m.fiscal_year_start()}<input type="date" required bind:value={form.start} /></label>
			<label>{m.fiscal_year_end()}<input type="date" required bind:value={form.end} /></label>
		</div>
		{#each issues as issue (issue)}<p class="error">{issue}</p>{/each}
		<div><button class="primary" disabled={busy}>{m.create_company()}</button></div>
	</form>
</main>

<style>
	main {
		max-width: 720px;
		margin: 0 auto;
		padding: 1.5rem 1rem;
	}

	.spacer {
		flex: 1;
	}

	.list {
		list-style: none;
		margin: 0;
		padding: 0.25rem 1rem;
	}

	.list li {
		display: flex;
		gap: 0.75rem;
		align-items: baseline;
		flex-wrap: wrap;
		padding: 0.6rem 0;
		border-bottom: 1px solid var(--border);
	}

	.list li:last-child {
		border-bottom: none;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 0.75rem;
	}
</style>
