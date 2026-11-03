<script lang="ts">
	import { signOut } from '#lib';
	import { m } from '#lib/paraglide/messages.js';
	import { getLocale, locales, setLocale } from '#lib/paraglide/runtime.js';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const base = $derived(`/c/${data.company.id}`);
	const nav = $derived([
		{ href: base, label: m.nav_overview() },
		{ href: `${base}/vouchers`, label: m.nav_vouchers() },
		{ href: `${base}/vouchers/new`, label: m.nav_new_voucher() },
		{ href: `${base}/reports`, label: m.nav_reports() },
		{ href: `${base}/accounts`, label: m.nav_accounts() },
		{ href: `${base}/agents`, label: m.nav_agents() },
		{ href: `${base}/audit`, label: m.nav_audit() },
	]);
	let menuOpen = $state(false);
</script>

<div class="shell">
	<aside class:open={menuOpen}>
		<div class="brand">
			<a href="/companies">countx3</a>
			<button class="menu" aria-label={m.menu()} aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>☰</button>
		</div>
		<div class="company">
			<strong>{data.company.name}</strong>
			<span class="muted">{data.company.organizationNumber}</span>
		</div>
		<nav>
			{#each nav as item (item.href)}
				<a href={item.href} aria-current={page.url.pathname === item.href ? 'page' : undefined} onclick={() => (menuOpen = false)}>
					{item.label}
				</a>
			{/each}
		</nav>
		<div class="footer">
			<select aria-label={m.language()} value={getLocale()} onchange={(e) => setLocale(e.currentTarget.value as (typeof locales)[number])}>
				{#each locales as locale (locale)}<option value={locale}>{locale === 'sv' ? 'Svenska' : 'English'}</option>{/each}
			</select>
			<button onclick={signOut}>{m.log_out()}</button>
		</div>
	</aside>
	<main>
		{@render children()}
	</main>
</div>

<style>
	.shell {
		display: grid;
		grid-template-columns: 230px 1fr;
		min-height: 100dvh;
	}

	aside {
		border-right: 1px solid var(--border);
		background: var(--surface);
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		position: sticky;
		top: 0;
		height: 100dvh;
	}

	.brand {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.brand a {
		font-weight: 700;
		text-decoration: none;
		font-size: 1.1rem;
	}

	.menu {
		display: none;
	}

	.company {
		display: grid;
		font-size: 0.9rem;
	}

	nav {
		display: grid;
		gap: 0.15rem;
	}

	nav a {
		color: var(--text);
		text-decoration: none;
		padding: 0.4rem 0.6rem;
		border-radius: 8px;
	}

	nav a[aria-current='page'] {
		background: var(--surface-2);
		font-weight: 600;
	}

	.footer {
		margin-top: auto;
		display: grid;
		gap: 0.5rem;
	}

	main {
		padding: 1.5rem;
		min-width: 0;
	}

	@media (max-width: 760px) {
		.shell {
			grid-template-columns: 1fr;
			grid-template-rows: auto 1fr;
		}

		aside {
			position: static;
			height: auto;
			border-right: none;
			border-bottom: 1px solid var(--border);
		}

		.menu {
			display: block;
		}

		aside:not(.open) :is(.company, nav, .footer) {
			display: none;
		}

		main {
			padding: 1rem;
		}
	}
</style>
