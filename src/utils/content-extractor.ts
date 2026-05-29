import { ExtractedContent } from '../types/types';
import { createMarkdownContent } from 'defuddle/full';
import { sanitizeFileName } from './string-utils';
import { buildVariables } from './shared';
import browser from './browser-polyfill';
import { debugLog } from './debug';

interface ContentResponse {
	content: string;
	selectedHtml: string;
	extractedContent: ExtractedContent;
	schemaOrgData: any;
	fullHtml: string;
	title: string;
	author: string;
	description: string;
	domain: string;
	favicon: string;
	image: string;
	parseTime: number;
	published: string;
	site: string;
	wordCount: number;
	language: string;
	metaTags: { name?: string | null; property?: string | null; content: string | null }[];
}

async function sendExtractRequest(tabId: number, includeThoughts: boolean): Promise<ContentResponse> {
	const response = await browser.runtime.sendMessage({
		action: "sendMessageToTab",
		tabId: tabId,
		message: { action: "getPageContent", includeThoughts }
	}) as ContentResponse & { success?: boolean; error?: string };

	if (response && 'success' in response && !response.success && response.error) {
		throw new Error(response.error);
	}

	if (response && response.content) {
		return response;
	}

	throw new Error('No content received from page');
}

export async function extractPageContent(tabId: number, includeThoughts: boolean): Promise<ContentResponse | null> {
	try {
		return await sendExtractRequest(tabId, includeThoughts);
	} catch (firstError) {
		debugLog('Clipper', 'First extraction attempt failed, retrying...', firstError);
		try {
			await browser.runtime.sendMessage({ action: "forceInjectContentScript", tabId });
		} catch {
			// If force-inject fails, proceed anyway
		}
		try {
			return await sendExtractRequest(tabId, includeThoughts);
		} catch (retryError) {
			console.error('[Obsidian Clipper] Extraction failed after retry:', retryError);
			throw new Error('LLM Chat Clipper was not able to start. Please try reloading the page.');
		}
	}
}

export async function initializePageContent(
	content: string,
	selectedHtml: string,
	extractedContent: ExtractedContent,
	currentUrl: string,
	schemaOrgData: any,
	fullHtml: string,
	title: string,
	author: string,
	description: string,
	favicon: string,
	image: string,
	published: string,
	site: string,
	wordCount: number,
	language: string,
	metaTags: { name?: string | null; property?: string | null; content: string | null }[]
) {
	try {
		currentUrl = currentUrl.replace(/#:~:text=[^&]+(&|$)/, '');

		let selectedMarkdown = '';
		if (selectedHtml) {
			content = selectedHtml;
			selectedMarkdown = createMarkdownContent(selectedHtml, currentUrl);
		}

		const markdownBody = createMarkdownContent(content, currentUrl);

		const noteName = sanitizeFileName(title);

		const currentVariables = buildVariables({
			title,
			author,
			content: markdownBody,
			contentHtml: content,
			url: currentUrl,
			fullHtml,
			description,
			favicon,
			image,
			published,
			site,
			language,
			wordCount,
			selection: selectedMarkdown,
			selectionHtml: selectedHtml,
			schemaOrgData,
			metaTags,
			extractedContent,
		});

		debugLog('Variables', 'Available variables:', currentVariables);

		return {
			noteName,
			currentVariables
		};
	} catch (error: unknown) {
		console.error('Error in initializePageContent:', error);
		if (error instanceof Error) {
			throw new Error(`Unable to initialize page content: ${error.message}`);
		} else {
			throw new Error('Unable to initialize page content: Unknown error');
		}
	}
}
