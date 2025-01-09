import { ReadonlyHeaders } from "next/dist/server/web/spec-extension/adapters/headers";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { KeyType } from "@prisma/client";
import crypto from "crypto";

export type DomainAndSelector = {
	domain: string,
	selector: string
};

export interface DnsDkimFetchResult {
	domain: string;
	selector: string;
	value: string;
	timestamp: Date;
	keyType: KeyType;
	keyDataBase64: string | null;
}

const pemHeader = "-----BEGIN PUBLIC KEY-----\n";
const pemFooter = "\n-----END PUBLIC KEY-----";

export function kValueToKeyType(s: string | null | undefined): KeyType {
	if (s === null || s === undefined) {
		// if k is not specified, RSA is implied, see https://datatracker.ietf.org/doc/html/rfc6376#section-3.6.1
		return 'RSA';
	}
	if (s.toLowerCase() === 'rsa') {
		return 'RSA';
	}
	if (s.toLowerCase() === 'ed25519') {
		return 'Ed25519';
	}
	throw new Error(`Unknown key type: "${s}"`);
}

function isBase64(key: string): boolean {
  const base64Regex = /^[A-Za-z0-9+/]+={0,2}$/;
  return base64Regex.test(key);
}

// relaxed implementation of Tag=Value List, see https://datatracker.ietf.org/doc/html/rfc6376#section-3.2
export function parseDkimTagList(dkimValue: string): Record<string, string> {
	const result: Record<string, string> = {};
	const parts = dkimValue.split(';').map(part => part.trim());
	for (const part of parts) {
		const i = part.indexOf('=');
		if (i <= 0) {
			continue;
		}
		const key = part.slice(0, i).trim();
		const value = part.slice(i + 1).trim();
		switch (key) {
			case "v":
				if(value !== 'DKIM1') {
					throw new Error(`Unknown DKIM version: ${value}`);
				}
				break;
			case "p":
				if (isBase64(value)) {
					const modifiedValue = pemHeader + value.replace(/\s/g, "\n") + pemFooter;
					console.log(modifiedValue);
					try {
						const publicKey = crypto.createPublicKey(modifiedValue);
						// console.log(publicKey.asymmetricKeyType);
						// console.log(publicKey.asymmetricKeyDetails?.modulusLength);
						if (publicKey.asymmetricKeyType === "rsa" && [512, 1024, 2048, 4096].includes(publicKey.asymmetricKeyDetails?.modulusLength!)) {
							result[key] = value;
						}
						else if ( publicKey.asymmetricKeyType === "ed25519" && publicKey.asymmetricKeyDetails?.modulusLength === 256 ) {
							result[key] = value;
						} else {
							console.error("Invalid public key passed value for key p: ${value}");
							continue;
						}
					} catch (error) {
						console.error(`Invalid public key passed value for key p: ${value} ${error}`);
						continue;
					}
				} else {
					console.error(`Invalid base64 value for key p: ${value}`);
					continue;
				}
				break;
			default:
				if (result.hasOwnProperty(key)) {
					// duplicate key, keep the first one
					continue;
				}
				break;
		}
		result[key] = value;
	}
	return result;
}

export function load_domains_and_selectors_from_tsv(fileContent: string): DomainAndSelector[] {
	let result = [];
	const lines = fileContent.split('\n').map(line => line.trim()).filter(line => line);
	for (let i = 0; i < lines.length; i++) {
		const [domain, selector] = lines[i].split('\t');
		if (!selector || !domain) {
			console.error(`error: line ${i}, selector or domain is empty`);
			continue;
		}
		result.push({ domain, selector });
	}
	return result;
}

export function getCanonicalRecordString(dsp: DomainAndSelector, dkimRecordValue: string): string {
	return `${dsp.selector}._domainkey.${dsp.domain} TXT "${dkimRecordValue}"`;
}


function dataToMessage(data: any): string {
	if (!data) {
		return '';
	}
	if (data?.message) {
		return `${data.message}`;
	}
	if (data instanceof Object) {
		return JSON.stringify(data);
	}
	return `${data}`;
}

export function axiosErrorMessage(error: any): string {
	if (error.response) {
		const data = error?.response?.data;
		const message = dataToMessage(data);
		return `${error} - ${message}`;
	}
	else {
		return `${error.message}`;
	}
}

export async function checkRateLimiter(rateLimiter: RateLimiterMemory, headers: ReadonlyHeaders, consumePoints: number) {
	const forwardedFor = headers.get("x-forwarded-for");
	if (forwardedFor) {
		const clientIp = forwardedFor.split(',')[0];
		await rateLimiter.consume(clientIp, consumePoints);
	}
}

export function isValidDate(year: number, month: number, day: number) {
	const date = new Date(year, month - 1, day);
	return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function truncate(s: string, maxLength: number) {
	if (s.length > maxLength) {
		return s.slice(0, Math.max(maxLength, 3) - 3) + "...";
	} else {
		return s;
	}
}

export const DspSourceIdentifiers = ['top_1m_lookup', 'api', 'selector_guesser', 'seed', 'try_selectors', 'api_auto', 'scraper', 'public_key_gcd_batch', 'unknown'] as const;
export type DspSourceIdentifier = typeof DspSourceIdentifiers[number];

export function stringToDspSourceIdentifier(s: string): DspSourceIdentifier {
	const sourceIdentifier = DspSourceIdentifiers.find(id => id === s);
	if (sourceIdentifier) {
		return sourceIdentifier;
	}
	return 'unknown';
}

export const KeySourceIdentifiers = ['public_key_gcd_batch', 'unknown'] as const;
export type KeySourceIdentifier = typeof KeySourceIdentifiers[number];

export function stringToKeySourceIdentifier(s: string): KeySourceIdentifier {
	const sourceIdentifier = KeySourceIdentifiers.find(id => id === s);
	if (sourceIdentifier) {
		return sourceIdentifier;
	}
	return 'unknown';
}


export function dspSourceIdentifierToHumanReadable(sourceIdentifierStr: string) {
	switch (stringToDspSourceIdentifier(sourceIdentifierStr)) {
		case 'top_1m_lookup':
		case 'scraper':
			return 'Scraped';
		case 'api':
			return 'Inbox upload';
		case 'api_auto':
			return 'Inbox upload';
		case 'selector_guesser':
			return 'Selector guesser';
		case 'seed':
			return 'Seed';
		case 'try_selectors':
			return 'Try selectors';
		case 'public_key_gcd_batch':
			return 'Mail archive';
		case 'unknown':
			return 'Unknown';
	}
}


export function keySourceIdentifierToHumanReadable(sourceIdentifierStr: string) {
	switch (stringToKeySourceIdentifier(sourceIdentifierStr)) {
		case 'public_key_gcd_batch':
			return 'Reverse engineered';
		case 'unknown':
			return 'Unknown';
	}
}
