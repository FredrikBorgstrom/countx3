<script lang="ts">
	import { api, Countx3Error, setSession } from '#lib';
	import { m } from '#lib/paraglide/messages.js';
	import { goto } from '$app/navigation';

	let mode = $state<'login' | 'signup'>('login');
	let email = $state('');
	let name = $state('');
	let password = $state('');
	let error = $state('');
	let busy = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		error = '';
		try {
			const session =
				mode === 'login'
					? await api.auth.logIn({ email, password })
					: await api.auth.signUp({ email, name, password });
			setSession(session.sessionToken);
			await goto('/');
		} catch (err) {
			error = err instanceof Countx3Error ? err.message : m.network_error();
		} finally {
			busy = false;
		}
	}
</script>

<main>
	<form class="card stack" onsubmit={submit}>
		<div>
			<h1>countx3</h1>
			<p class="muted">{m.tagline()}</p>
		</div>
		<label>{m.email()}<input type="email" autocomplete="email" required bind:value={email} /></label>
		{#if mode === 'signup'}
			<label>{m.name()}<input autocomplete="name" required bind:value={name} /></label>
		{/if}
		<label>
			{m.password()}
			<input
				type="password"
				autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
				minlength={mode === 'signup' ? 10 : undefined}
				required
				bind:value={password}
			/>
		</label>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		<button class="primary" disabled={busy}>{mode === 'login' ? m.log_in() : m.create_account()}</button>
		<button type="button" onclick={() => (mode = mode === 'login' ? 'signup' : 'login')}>
			{mode === 'login' ? m.no_account() : m.have_account()}
		</button>
	</form>
</main>

<style>
	main {
		min-height: 100dvh;
		display: grid;
		place-items: center;
		padding: 1rem;
	}

	form {
		width: min(100%, 380px);
	}
</style>
