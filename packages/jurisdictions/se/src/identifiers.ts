/** Luhn (mod 10) check digit used by organisationsnummer, personnummer, OCR, bankgiro and plusgiro. */
export function luhnCheckDigit(digits: string): number {
	let total = 0;
	for (let i = 0; i < digits.length; i++) {
		let d = Number(digits[digits.length - 1 - i]);
		if (i % 2 === 0) {
			d *= 2;
			if (d > 9) d -= 9;
		}
		total += d;
	}
	return (10 - (total % 10)) % 10;
}

export const isLuhnValid = (digits: string) =>
	/^\d{2,}$/.test(digits) && luhnCheckDigit(digits.slice(0, -1)) === Number(digits.at(-1));

/** Normalises "556677-8899", "16556677-8899" or "199001011234" to 10 digits; null if malformed. */
export function normalizeIdentityNumber(value: string): string | null {
	const digits = value.replace(/[\s-+]/g, '');
	if (/^\d{10}$/.test(digits)) return digits;
	if (/^\d{12}$/.test(digits)) return digits.slice(2);
	return null;
}

export function isValidPersonnummer(value: string): boolean {
	const digits = normalizeIdentityNumber(value);
	if (!digits || !isLuhnValid(digits)) return false;
	const month = Number(digits.slice(2, 4));
	const rawDay = Number(digits.slice(4, 6));
	// Samordningsnummer add 60 to the day.
	const day = rawDay > 60 ? rawDay - 60 : rawDay;
	return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/** Organisationsnummer for legal persons: Luhn-valid and the third digit is at least 2. */
export function isValidOrganisationsnummer(value: string): boolean {
	const digits = normalizeIdentityNumber(value);
	return !!digits && isLuhnValid(digits) && Number(digits[2]) >= 2;
}

export const formatOrganisationsnummer = (value: string) => {
	const digits = normalizeIdentityNumber(value);
	return digits ? `${digits.slice(0, 6)}-${digits.slice(6)}` : value;
};

/**
 * OCR payment reference for Bankgirot: base digits + optional length digit + Luhn check digit.
 * The length digit is the total length (incl. length and check digit) modulo 10.
 */
export function ocrReference(base: string, withLengthDigit = true): string {
	if (!/^\d+$/.test(base)) throw new RangeError('OCR base must be digits');
	const body = withLengthDigit ? `${base}${(base.length + 2) % 10}` : base;
	const ocr = `${body}${luhnCheckDigit(body)}`;
	if (ocr.length < 2 || ocr.length > 25) throw new RangeError('OCR reference must be 2–25 digits');
	return ocr;
}

export const isValidOcrReference = (value: string, requireLengthDigit = false) =>
	/^\d{2,25}$/.test(value) &&
	isLuhnValid(value) &&
	(!requireLengthDigit || Number(value.at(-2)) === value.length % 10);

export const isValidBankgiro = (value: string) => {
	const digits = value.replace('-', '');
	return /^\d{7,8}$/.test(digits) && isLuhnValid(digits);
};

export const isValidPlusgiro = (value: string) => {
	const digits = value.replace('-', '');
	return /^\d{2,8}$/.test(digits) && isLuhnValid(digits);
};
