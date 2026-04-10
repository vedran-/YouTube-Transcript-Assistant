// ==UserScript==
// @name         YouTube Transcript: Save & AI (Greasemonkey)
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Extracts transcript + metadata, saves as .txt, and displays AI summary
// @author       You
// @match        https://www.youtube.com/watch*
// @grant        GM.xmlHttpRequest
// @grant        GM.setValue
// @grant        GM.getValue
// ==/UserScript==

/**
 * @typedef {Object} TranscriptSegment
 * @property {string} ts - Timestamp string (e.g. "0:00")
 * @property {string} text - Transcript text content
 */

/**
 * @typedef {Object} VideoMetadata
 * @property {string} title
 * @property {string} description
 * @property {string} uploadDate
 * @property {string} duration
 * @property {string} thumbnailUrl
 * @property {string} genre
 * @property {string} viewCount
 * @property {string} likeCount
 */

/**
 * @typedef {Object} LLMResponse
 * @property {number} status
 * @property {string} responseText
 */

/* ==========================================================================
   CONFIG — centralized constants (no more magic numbers)
   ========================================================================== */

const CONFIG = {
    // SPA navigation detection
    OBSERVER_COOLDOWN_MS:        1500,   // debounce time for MutationObserver
    OBSERVER_MAX_BUFFER_MS:      5000,   // max time to batch mutations

    // Transcript extraction
    TRANSCRIPT_POLL_ATTEMPTS:    15,
    TRANSCRIPT_POLL_INTERVAL_MS: 200,
    TRANSCRIPT_LOAD_DELAY_MS:    500,

    // AI / API
    TRANSCRIPT_MAX_CHARS:        50000,  // max transcript chars sent to LLM
    SUMMARY_MAX_CHARS:           10000,  // max summary chars sent to TLDR step
    AI_BUTTON_RESET_DELAY_MS:    3000,
    SAVE_BUTTON_RESET_DELAY_MS:  3000,

    // Description fallback
    DESCRIPTION_MIN_LENGTH:      50,
    DESCRIPTION_FALLBACK_MIN:    10,

    // UI
    INJECT_CHECK_INTERVAL_MS:    2000,   // fallback polling (legacy guard)
};

/* ==========================================================================
   STYLES — injected once as a <style> block
   ========================================================================== */

const STYLES = `
.yt-tc-container {
    display: inline-flex;
    align-items: center;
    margin-left: 10px;
    gap: 8px;
    vertical-align: middle;
}
.yt-tc-btn {
    border: none;
    padding: 6px 14px;
    border-radius: 18px;
    cursor: pointer;
    font-weight: 500;
    font-size: 12px;
    color: #fff;
    transition: opacity 0.15s;
}
.yt-tc-btn:hover { opacity: 0.85; }
.yt-tc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.yt-tc-btn--summarize { background: #065fd4; }
.yt-tc-btn--save       { background: #2e7d32; }

.yt-tc-settings-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 16px;
    color: var(--yt-spec-text-primary, #0f0f0f);
}

/* Summary box */
#ai-summary-box {
    background: var(--yt-spec-badge-chip-background, #f2f2f2);
    color: var(--yt-spec-text-primary, #0f0f0f);
    padding: 0;
    margin-top: 12px;
    margin-bottom: 16px;
    border-radius: 12px;
    font-family: Roboto, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    border: 1px solid var(--yt-spec-10-percent-layer, #ccc);
    overflow: hidden;
    transition: all 0.2s ease;
}
#ai-summary-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    cursor: pointer;
    user-select: none;
    font-weight: 600;
    font-size: 13px;
}
#ai-summary-header:hover {
    background: var(--yt-spec-badge-chip-background-hover, #e5e5e5);
}
#ai-tldr {
    padding: 12px 12px;
    background: var(--yt-spec-badge-chip-background, #f2f2f2);
    border-bottom: 1px solid var(--yt-spec-10-percent-layer, #ccc);
    font-size: 15px;
    font-weight: 800;
    color: var(--yt-spec-text-primary, #0f0f0f);
    line-height: 1.4;
    letter-spacing: -0.01em;
}
#ai-summary-content {
    padding: 10px 12px 8px 12px;
    border-top: 1px solid var(--yt-spec-10-percent-layer, #ccc);
    font-size: 14px;
    line-height: 1.65;
    transition: max-height 0.3s ease, padding 0.2s ease;
}
#ai-fold-indicator {
    font-size: 11px;
    transition: transform 0.2s ease;
}
#ai-copy-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 14px;
    padding: 4px 6px;
    border-radius: 4px;
    transition: background 0.15s;
}
#ai-copy-btn:hover {
    background: var(--yt-spec-badge-chip-background-hover, #e5e5e5);
}

/* Settings dialog */
.yt-tc-dialog-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 99999;
}
.yt-tc-dialog {
    background: var(--yt-spec-base-background, #fff);
    color: var(--yt-spec-text-primary, #0f0f0f);
    border-radius: 12px;
    padding: 24px;
    min-width: 380px;
    max-width: 90vw;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    font-family: Roboto, Arial, sans-serif;
}
.yt-tc-dialog h3 {
    margin: 0 0 16px;
    font-size: 18px;
}
.yt-tc-dialog label {
    display: block;
    margin-bottom: 4px;
    font-weight: 600;
    font-size: 13px;
}
.yt-tc-dialog input {
    width: 100%;
    padding: 8px 10px;
    margin-bottom: 12px;
    border: 1px solid var(--yt-spec-10-percent-layer, #ccc);
    border-radius: 8px;
    font-size: 14px;
    box-sizing: border-box;
}
.yt-tc-dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 8px;
}
.yt-tc-dialog-btn {
    padding: 8px 20px;
    border-radius: 18px;
    border: none;
    cursor: pointer;
    font-weight: 500;
    font-size: 13px;
}
.yt-tc-dialog-btn--save {
    background: #065fd4;
    color: #fff;
}
.yt-tc-dialog-btn--cancel {
    background: var(--yt-spec-badge-chip-background, #e5e5e5);
    color: var(--yt-spec-text-primary, #0f0f0f);
}

/* Toast notification */
.yt-tc-toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    background: #323232;
    color: #fff;
    padding: 12px 24px;
    border-radius: 8px;
    font-size: 14px;
    z-index: 999999;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    animation: yt-tc-toast-in 0.2s ease;
}
.yt-tc-toast--error { background: #c62828; }
.yt-tc-toast--success { background: #2e7d32; }
@keyframes yt-tc-toast-in {
    from { opacity: 0; transform: translateX(-50%) translateY(20px); }
    to   { opacity: 1; transform: translateX(-50%) translateY(0); }
}
`;

/* ==========================================================================
   HELPERS
   ========================================================================== */

/**
 * Inject a <style> block into <head> (idempotent — safe to call repeatedly).
 */
function injectStyles() {
    if (document.getElementById('yt-transcribe-styles')) return;
    const style = document.createElement('style');
    style.id = 'yt-transcribe-styles';
    style.textContent = STYLES;
    (document.head || document.documentElement).appendChild(style);
}

/**
 * Show a transient toast notification.
 * @param {string} message
 * @param {'info'|'success'|'error'} type
 */
function showToast(message, type = 'info') {
    const existing = document.querySelector('.yt-tc-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `yt-tc-toast yt-tc-toast--${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

/**
 * Wait for an element to appear in the DOM using MutationObserver.
 * @param {string} selector
 * @param {object}  opts
 * @param {number}  opts.timeoutMs
 * @param {Element} opts.root
 * @returns {Promise<Element>}
 */
function waitForElement(selector, { timeoutMs = 8000, root = document } = {}) {
    return new Promise((resolve, reject) => {
        const existing = root.querySelector(selector);
        if (existing) return resolve(existing);

        const observer = new MutationObserver(() => {
            const el = root.querySelector(selector);
            if (el) { observer.disconnect(); resolve(el); }
        });

        observer.observe(root, { childList: true, subtree: true });

        setTimeout(() => { observer.disconnect(); reject(new Error(`Timeout waiting for "${selector}"`)); }, timeoutMs);
    });
}

/**
 * Create a styled button element.
 * @param {string} text
 * @param {'summarize'|'save'} variant
 * @returns {HTMLButtonElement}
 */
function createBtn(text, variant) {
    const btn = document.createElement('button');
    btn.className = `yt-tc-btn yt-tc-btn--${variant}`;
    btn.textContent = text;
    return btn;
}

/**
 * Download a text file via Blob URL.
 * @param {string} filename
 * @param {string} text
 */
function downloadFile(filename, text) {
    const element = document.createElement('a');
    element.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    element.download = filename;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
}

/**
 * Sanitize a filename by removing illegal characters.
 * @param {string} name
 * @returns {string}
 */
function sanitizeFilename(name) {
    return name.replace(/[\\/:*?"<>|]/g, '').trim() || 'transcript';
}

/* ==========================================================================
   METADATA EXTRACTION
   ========================================================================== */

/**
 * Extract video metadata from the current YouTube watch page.
 * @returns {VideoMetadata}
 */
function getVideoMetadata() {
    const meta = {
        title: '',
        description: '',
        uploadDate: '',
        duration: '',
        thumbnailUrl: '',
        genre: '',
        viewCount: '',
        likeCount: '',
    };

    /* --- JSON-LD extraction (primary) --- */
    try {
        const jsonLdScript = document.querySelector('script[type="application/ld+json"]');
        if (jsonLdScript?.textContent) {
            const data = JSON.parse(jsonLdScript.textContent);
            if (data && typeof data === 'object') {
                meta.title          = data.name || '';
                meta.description    = data.description || '';
                meta.uploadDate     = data.uploadDate || '';
                meta.duration       = data.duration || '';
                meta.thumbnailUrl   = Array.isArray(data.thumbnailUrl) ? data.thumbnailUrl[0] : (data.thumbnailUrl || '');
                meta.genre          = data.genre || '';

                const stats = data.interactionStatistic;
                if (stats) {
                    const statsArr = Array.isArray(stats) ? stats : [stats];
                    for (const stat of statsArr) {
                        if (!stat || typeof stat !== 'object') continue;
                        const itype = typeof stat.interactionType === 'string'
                            ? stat.interactionType
                            : stat.interactionType?.['@type'] || stat.interactionType?.name || '';
                        const count = stat.userInteractionCount;
                        if (itype.includes('WatchAction')) {
                            meta.viewCount = typeof count === 'number' ? count.toLocaleString() : String(count || '');
                        } else if (itype.includes('LikeAction')) {
                            meta.likeCount = typeof count === 'number' ? count.toLocaleString() : String(count || '');
                        }
                    }
                }
                console.log('[YT-TC] JSON-LD extracted:', {
                    title: meta.title?.substring(0, 30),
                    duration: meta.duration,
                    uploadDate: meta.uploadDate,
                    viewCount: meta.viewCount,
                    likeCount: meta.likeCount,
                    genre: meta.genre,
                });
            }
        }
    } catch (e) {
        console.warn('[YT-TC] JSON-LD extraction failed:', e.message);
    }

    /* --- Title fallbacks (pipeline) --- */
    if (!meta.title) {
        meta.title = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')
            ?.getAttribute('title')
            || document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.innerText
            || document.querySelector('h1.ytd-watch-metadata')?.innerText
            || document.title.replace(/\s*-?\s*YouTube/gi, '').trim();
    }
    meta.title = meta.title.trim();

    /* --- Description fallbacks (pipeline) --- */
    const descriptionCandidates = [];

    // 1) JSON-LD already captured in meta.description
    if (meta.description) descriptionCandidates.push(meta.description);

    // 2) ytInitialPlayerResponse from inline scripts
    try {
        const scripts = document.querySelectorAll('script');
        for (const s of scripts) {
            if (s.textContent?.includes('ytInitialPlayerResponse')) {
                const match = s.textContent.match(/var\s+ytInitialPlayerResponse\s*=\s*({[\s\S]*?});\s*(?:var\s|<\/script>)/);
                if (match) {
                    const data = JSON.parse(match[1]);
                    const desc = data?.videoDetails?.shortDescription || data?.videoDetails?.description || '';
                    if (desc) descriptionCandidates.push(desc);
                }
                break;
            }
        }
    } catch { /* ignore */ }

    // 3) window.ytInitialPlayerResponse
    try {
        const playerResp = window.ytInitialPlayerResponse;
        if (playerResp) {
            const desc = playerResp.videoDetails?.shortDescription || playerResp.videoDetails?.description || '';
            if (desc) descriptionCandidates.push(desc);
        }
    } catch { /* ignore */ }

    // 4) DOM expander element
    const expanderAttrString = document.querySelector('#description-inline-expander yt-attributed-string');
    if (expanderAttrString) {
        const desc = expanderAttrString.textContent || expanderAttrString.innerText;
        if (desc) descriptionCandidates.push(desc);
    }

    // Pick the first candidate that meets the minimum length, else the longest
    meta.description = descriptionCandidates.find(d => d.length >= CONFIG.DESCRIPTION_MIN_LENGTH)
        || descriptionCandidates.reduce((a, b) => (b.length > a.length ? b : a), '')
        || 'No description available.';

    // Cleanup
    meta.description = meta.description
        .replace(/\r\n/g, '\n')
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        .trim()
        .replace(/\u00A0/g, ' ')
        .replace(/ {2,}/g, ' ');

    if (meta.description.length < CONFIG.DESCRIPTION_FALLBACK_MIN) {
        meta.description = 'No description available.';
    }

    /* --- Format duration (ISO 8601 → mm:ss / hh:mm:ss) --- */
    if (meta.duration) {
        const m = meta.duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        if (m) {
            const hours   = parseInt(m[1] || '0', 10);
            const minutes = parseInt(m[2] || '0', 10);
            const seconds = parseInt(m[3] || '0', 10);
            meta.duration = hours > 0
                ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
                : `${minutes}:${String(seconds).padStart(2, '0')}`;
        }
    }

    /* --- Format upload date --- */
    if (meta.uploadDate) {
        try {
            const dateObj = new Date(meta.uploadDate);
            if (!isNaN(dateObj)) {
                meta.uploadDate = dateObj.toLocaleDateString('en-US', {
                    year: 'numeric', month: 'long', day: 'numeric',
                });
            }
        } catch { /* keep raw string */ }
    }

    return meta;
}

/* ==========================================================================
   TRANSCRIPT EXTRACTION
   ========================================================================== */

/**
 * Click the "Show transcript" button and extract all segments.
 * @returns {Promise<TranscriptSegment[]>}
 */
async function getTranscriptData() {
    // Try to find and click the "Show transcript" button
    const showBtn = Array.from(document.querySelectorAll('button, tp-yt-paper-button'))
        .find(b => b.innerText?.toLowerCase().includes('show transcript'));

    if (!showBtn) {
        // Try expand button first (for long descriptions)
        const expand = document.querySelector('tp-yt-paper-button#expand, #expand-theme, #expand');
        if (expand) expand.click();
        await new Promise(r => setTimeout(r, CONFIG.TRANSCRIPT_LOAD_DELAY_MS));
    }

    if (!showBtn) throw new Error('"Show transcript" button not found.');
    showBtn.click();

    // Wait briefly for the panel to open, then poll for segments (like the original fast behavior)
    await new Promise(r => setTimeout(r, CONFIG.TRANSCRIPT_LOAD_DELAY_MS));

    // Try multiple selectors with fast polling (breaks on first match)
    const selectors = [
        { sel: 'ytd-engagement-panel-section-list-renderer ytd-transcript-section-renderer transcript-segment-view-model', type: 'modern' },
        { sel: 'ytd-transcript-renderer ytd-transcript-segment-renderer', type: 'polymer' },
        { sel: 'transcript-segment-view-model', type: 'modern' },
        { sel: 'ytd-transcript-renderer ytd-transcript-segment-renderer', type: 'polymer' },
    ];

    const totalAttempts = CONFIG.TRANSCRIPT_POLL_ATTEMPTS;

    for (let attempt = 0; attempt < totalAttempts; attempt++) {
        for (const { sel, type } of selectors) {
            const segments = document.querySelectorAll(sel);
            if (segments.length > 0) {
                return Array.from(segments).map(s => ({
                    ts: type === 'modern'
                        ? s.querySelector('.ytwTranscriptSegmentViewModelTimestamp')?.innerText.trim() || ''
                        : s.querySelector('.segment-timestamp')?.innerText.trim() || '',
                    text: type === 'modern'
                        ? s.querySelector('.yt-core-attributed-string, .ytAttributedStringHost')?.innerText.trim() || ''
                        : s.querySelector('.segment-text')?.innerText.trim() || '',
                }));
            }
        }
        await new Promise(r => setTimeout(r, CONFIG.TRANSCRIPT_POLL_INTERVAL_MS));
    }

    throw new Error('Transcript failed to load — no segments found.');
}

/* ==========================================================================
   LLM / API
   ========================================================================== */

/**
 * Generic LLM API call — single entry point for all AI requests.
 * @param {Array<{role: string, content: string}>} messages
 * @returns {Promise<string>}
 */
async function callLLM(messages) {
    const url   = await GM.getValue('llm_api_url', '');
    const key   = await GM.getValue('llm_api_key', '');
    const model = await GM.getValue('llm_model', '');

    return new Promise((resolve, reject) => {
        GM.xmlHttpRequest({
            method: 'POST',
            url,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${key}`,
                'HTTP-Referer': 'https://youtube.com',
                'X-Title': 'YT Assistant',
            },
            data: JSON.stringify({ model, messages }),
            onload: (res) => {
                if (res.status === 200) {
                    try {
                        const content = JSON.parse(res.responseText).choices?.[0]?.message?.content;
                        content ? resolve(content) : reject(new Error('Empty response from AI.'));
                    } catch (e) {
                        reject(new Error(`Failed to parse AI response: ${e.message}`));
                    }
                } else {
                    reject(new Error(`API Error ${res.status}: ${res.responseText.substring(0, 200)}`));
                }
            },
            onerror: (err) => reject(new Error(`API request failed: ${err?.responseText || err}`)),
        });
    });
}

/**
 * Generate a full video summary.
 * @param {string} prompt
 * @returns {Promise<string>}
 */
async function fetchSummaryWithPrompt(prompt) {
    const systemMessage = 'You are a specialized video summarizer. Using the title, metadata, description, and transcript provided, create a comprehensive summary. Format your response using ONLY HTML tags like <p>, <b>, <ul>, <li>. Do not use Markdown.';

    return callLLM([
        { role: 'system', content: systemMessage },
        { role: 'user', content: prompt },
    ]);
}

/**
 * Generate a one-sentence TLDR from a full summary.
 * @param {string} fullSummary
 * @returns {Promise<string>}
 */
async function fetchTLDR(fullSummary) {
    const prompt = `Based on the following video summary, create a single sentence TLDR (too long didn't read) that captures the absolute core message. Return ONLY the sentence text, nothing else. No quotes, no labels, no HTML.

Summary: ${fullSummary.substring(0, CONFIG.SUMMARY_MAX_CHARS)}`;

    const result = await callLLM([
        { role: 'system', content: 'You create concise one-sentence summaries. Return ONLY the sentence, nothing else.' },
        { role: 'user', content: prompt },
    ]);

    return result.replace(/^["']|["']$/g, '').trim();
}

/* ==========================================================================
   UI
   ========================================================================== */

/**
 * Display the AI-generated summary in a collapsible box.
 * @param {string} fullSummary
 * @param {string} tldr
 */
function showSummaryInUI(fullSummary, tldr) {
    let box = document.getElementById('ai-summary-box');
    const cleanHtml = fullSummary.replace(/```html/gi, '').replace(/```/g, '').trim();

    if (!box) {
        box = document.createElement('div');
        box.id = 'ai-summary-box';

        const header = document.createElement('div');
        header.id = 'ai-summary-header';
        header.innerHTML = `
            <span style="display: flex; align-items: center; gap: 6px;">✨ AI Summary</span>
            <div style="display: flex; align-items: center; gap: 4px;">
                <button id="ai-copy-btn" title="Copy to clipboard">📋</button>
                <span id="ai-fold-indicator">▼</span>
            </div>
        `;

        const tldrSection = document.createElement('div');
        tldrSection.id = 'ai-tldr';

        const content = document.createElement('div');
        content.id = 'ai-summary-content';
        content.style.display = 'block';
        content.style.maxHeight = '5000px';

        box.append(header, tldrSection, content);

        const anchor = document.querySelector('#above-the-fold') || document.querySelector('#meta');
        if (anchor) anchor.prepend(box);

        /* Toggle content fold */
        header.addEventListener('click', () => {
            const indicator = document.getElementById('ai-fold-indicator');
            const isHidden = content.style.display === 'none';
            if (isHidden) {
                content.style.display = 'block';
                content.style.maxHeight = '5000px';
                indicator.style.transform = 'rotate(0deg)';
            } else {
                content.style.maxHeight = '0px';
                indicator.style.transform = 'rotate(-90deg)';
                setTimeout(() => { if (content.style.maxHeight === '0px') content.style.display = 'none'; }, 300);
            }
        });

        /* Copy TLDR + summary */
        document.getElementById('ai-copy-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            const tldrText = document.getElementById('ai-tldr')?.textContent || '';
            const summaryText = content.textContent;
            navigator.clipboard.writeText(`TLDR: ${tldrText}\n\n${summaryText}`);
            const btn = document.getElementById('ai-copy-btn');
            btn.textContent = '✅';
            setTimeout(() => { btn.textContent = '📋'; }, 2000);
        });
    }

    /* Populate content */
    const tldrEl = box.querySelector('#ai-tldr');
    if (tldrEl) tldrEl.textContent = tldr ? `TLDR: ${tldr}` : '';

    const contentEl = box.querySelector('#ai-summary-content');
    if (contentEl) contentEl.innerHTML = cleanHtml;

    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/**
 * Show the consolidated settings dialog.
 */
async function showSettingsDialog() {
    const [currentUrl, currentKey, currentModel] = await Promise.all([
        GM.getValue('llm_api_url', 'https://openrouter.ai/api/v1/chat/completions'),
        GM.getValue('llm_api_key', ''),
        GM.getValue('llm_model', 'google/gemini-2.0-flash-001'),
    ]);

    // Remove any existing dialog
    const existing = document.querySelector('.yt-tc-dialog-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'yt-tc-dialog-overlay';
    overlay.innerHTML = `
        <div class="yt-tc-dialog" role="dialog" aria-labelledby="yt-tc-dialog-title">
            <h3 id="yt-tc-dialog-title">⚙️ AI Settings</h3>
            <label for="yt-tc-api-url">API URL</label>
            <input id="yt-tc-api-url" type="text" value="${currentUrl.replace(/"/g, '&quot;')}" spellcheck="false" />
            <label for="yt-tc-api-key">API Key</label>
            <input id="yt-tc-api-key" type="password" value="${currentKey.replace(/"/g, '&quot;')}" spellcheck="false" />
            <label for="yt-tc-model">Model</label>
            <input id="yt-tc-model" type="text" value="${currentModel.replace(/"/g, '&quot;')}" spellcheck="false" />
            <div class="yt-tc-dialog-actions">
                <button class="yt-tc-dialog-btn yt-tc-dialog-btn--cancel" id="yt-tc-dialog-cancel">Cancel</button>
                <button class="yt-tc-dialog-btn yt-tc-dialog-btn--save" id="yt-tc-dialog-save">Save</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    // Focus first input
    overlay.querySelector('#yt-tc-api-url').focus();

    // Handlers
    const save = async () => {
        const url  = document.getElementById('yt-tc-api-url').value.trim();
        const key  = document.getElementById('yt-tc-api-key').value.trim();
        const model = document.getElementById('yt-tc-model').value.trim();
        if (url) await GM.setValue('llm_api_url', url);
        if (key) await GM.setValue('llm_api_key', key);
        if (model) await GM.setValue('llm_model', model);
        overlay.remove();
        showToast('Settings saved!', 'success');
    };

    const cancel = () => { overlay.remove(); };

    document.getElementById('yt-tc-dialog-save').addEventListener('click', save);
    document.getElementById('yt-tc-dialog-cancel').addEventListener('click', cancel);

    // Close on overlay background click
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cancel(); });

    // Close on Escape
    const escHandler = (e) => { if (e.key === 'Escape') { cancel(); document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);
}

/**
 * Inject the button container into the page (idempotent).
 */
async function injectUI() {
    injectStyles();

    if (document.getElementById('llm-tool-container')) return;

    const target = document.querySelector('#owner');
    if (!target) return;

    const container = document.createElement('div');
    container.id = 'llm-tool-container';
    container.className = 'yt-tc-container';

    /* --- Summarize button --- */
    const aiBtn = createBtn('🤖 Summarize', 'summarize');
    aiBtn.addEventListener('click', async () => {
        if (aiBtn.disabled) return;
        const apiKey = await GM.getValue('llm_api_key', '');
        if (!apiKey) {
            showToast('Click ⚙️ to set API Key!', 'error');
            return;
        }

        aiBtn.disabled = true;
        aiBtn.textContent = '⏳ Extracting...';

        try {
            const meta = getVideoMetadata();
            const transcriptData = await getTranscriptData();
            const cleanText = transcriptData.map(item => item.text).join(' ');

            aiBtn.textContent = '🚀 Thinking...';

            const prompt = `Video Title: ${meta.title}
Upload Date: ${meta.uploadDate || 'N/A'}
Duration: ${meta.duration || 'N/A'}
Views: ${meta.viewCount || 'N/A'}
Likes: ${meta.likeCount || 'N/A'}
Genre: ${meta.genre || 'N/A'}

Description: ${meta.description}

Transcript: ${cleanText.substring(0, CONFIG.TRANSCRIPT_MAX_CHARS)}`;

            // Step 1: Full summary
            aiBtn.textContent = '📝 Summarizing...';
            const fullSummary = await fetchSummaryWithPrompt(prompt);

            // Step 2: TLDR
            aiBtn.textContent = '✂️ Creating TLDR...';
            const tldr = await fetchTLDR(fullSummary);

            showSummaryInUI(fullSummary, tldr);
            aiBtn.textContent = '✅ Done!';
            showToast('Summary generated!', 'success');
        } catch (e) {
            showToast(e.message, 'error');
            aiBtn.textContent = '❌ Error';
        }

        setTimeout(() => {
            aiBtn.textContent = '🤖 Summarize';
            aiBtn.disabled = false;
        }, CONFIG.AI_BUTTON_RESET_DELAY_MS);
    });

    /* --- Save button --- */
    const saveBtn = createBtn('💾 Save .txt', 'save');
    saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        saveBtn.textContent = '⏳ Saving...';

        try {
            const meta = getVideoMetadata();
            const transcriptData = await getTranscriptData();
            const formattedTranscript = transcriptData.map(item => `[${item.ts}] ${item.text}`).join('\n');

            const fileContent = `TITLE: ${meta.title}
UPLOAD DATE: ${meta.uploadDate || 'N/A'}
DURATION: ${meta.duration || 'N/A'}
VIEWS: ${meta.viewCount || 'N/A'}
LIKES: ${meta.likeCount || 'N/A'}
GENRE: ${meta.genre || 'N/A'}
THUMBNAIL: ${meta.thumbnailUrl || 'N/A'}

DESCRIPTION:
${meta.description}

--- TRANSCRIPT ---
${formattedTranscript}`;

            const safeFilename = sanitizeFilename(meta.title);
            downloadFile(`${safeFilename}.txt`, fileContent);
            saveBtn.textContent = '✅ Saved!';
            showToast('File saved!', 'success');
        } catch (e) {
            showToast(e.message, 'error');
            saveBtn.textContent = '❌ Error';
        }

        setTimeout(() => {
            saveBtn.textContent = '💾 Save .txt';
            saveBtn.disabled = false;
        }, CONFIG.SAVE_BUTTON_RESET_DELAY_MS);
    });

    /* --- Settings button --- */
    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'yt-tc-settings-btn';
    settingsBtn.textContent = '⚙️';
    settingsBtn.title = 'Settings';
    settingsBtn.addEventListener('click', showSettingsDialog);

    container.append(aiBtn, saveBtn, settingsBtn);
    target.appendChild(container);
}

/* ==========================================================================
   INIT — MutationObserver for SPA navigation + fallback interval
   ========================================================================== */

(function init() {
    // First injection
    injectUI();

    // Watch for YouTube SPA navigation (URL changes without full reload)
    let lastUrl = location.href;
    let cooldown = false;

    const observer = new MutationObserver(() => {
        if (cooldown) return;
        const currentUrl = location.href;
        if (currentUrl !== lastUrl) {
            lastUrl = currentUrl;
            cooldown = true;
            setTimeout(() => { cooldown = false; }, CONFIG.OBSERVER_COOLDOWN_MS);
            // Wait for page content to settle
            setTimeout(injectUI, CONFIG.OBSERVER_MAX_BUFFER_MS);
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Fallback: legacy interval as safety net (less frequent now)
    setInterval(injectUI, CONFIG.INJECT_CHECK_INTERVAL_MS);
})();
