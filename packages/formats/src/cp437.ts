/** IBM PC code page 437 ("PC8"), the encoding SIE files use. Bytes 0x00–0x7F are ASCII. */
const HIGH =
	'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

const ENCODE = new Map([...HIGH].map((char, i) => [char, 0x80 + i]));

export const CP437_HIGH_LENGTH = [...HIGH].length;

export function decodeCp437(bytes: Uint8Array): string {
	let out = '';
	for (const b of bytes) out += b < 0x80 ? String.fromCharCode(b) : HIGH[b - 0x80];
	return out;
}

/** Characters that do not exist in CP437 become "?". */
export function encodeCp437(text: string): Uint8Array {
	const out: number[] = [];
	for (const char of text) {
		const code = char.codePointAt(0)!;
		out.push(code < 0x80 ? code : (ENCODE.get(char) ?? 0x3f));
	}
	return Uint8Array.from(out);
}
