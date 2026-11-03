<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import { getLocale } from '#lib/paraglide/runtime.js';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	$effect(() => {
		document.documentElement.lang = getLocale();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>countx3</title>
</svelte:head>

{@render children()}
