// ==UserScript==
// @name         YouTube Transcript: Save & AI (Greasemonkey)
// @namespace    http://tampermonkey.net/
// @version      1.6
// @description  Extracts transcript + metadata, saves as .txt, and displays AI summary
// @author       You
// @match        https://www.youtube.com/watch*
// @grant        GM.xmlHttpRequest
// @grant        GM.setValue
// @grant        GM.getValue
// ==/UserScript==

(async function() {
    'use strict';

    function getVideoMetadata() {
        let title = "";
        let fullDescription = "";
        let uploadDate = "";
        let duration = "";
        let thumbnailUrl = "";
        let genre = "";
        let viewCount = "";
        let likeCount = "";

        // Extract ALL metadata from JSON-LD script tag (most reliable source)
        try {
            const jsonLdScript = document.querySelector('script[type="application/ld+json"]');
            if (jsonLdScript && jsonLdScript.textContent) {
                const data = JSON.parse(jsonLdScript.textContent);
                if (data && typeof data === 'object') {
                    // Primary extractions from JSON-LD
                    title = data.name || "";
                    fullDescription = data.description || "";
                    uploadDate = data.uploadDate || "";
                    duration = data.duration || "";  // ISO 8601 format: PT824S
                    thumbnailUrl = Array.isArray(data.thumbnailUrl) ? data.thumbnailUrl[0] : (data.thumbnailUrl || "");
                    genre = data.genre || "";

                    // Extract interaction stats (views, likes) - handle various formats
                    const stats = data.interactionStatistic;
                    if (stats && typeof stats === 'object') {
                        const statsArray = Array.isArray(stats) ? stats : [stats];
                        statsArray.forEach(stat => {
                            if (!stat || typeof stat !== 'object') return;
                            
                            const interactionType = stat.interactionType;
                            let type = "";
                            if (typeof interactionType === 'string') {
                                type = interactionType;
                            } else if (typeof interactionType === 'object' && interactionType !== null) {
                                type = interactionType["@type"] || interactionType.name || "";
                            }
                            
                            const count = stat.userInteractionCount;
                            if (typeof type === 'string' && type.includes("WatchAction")) {
                                viewCount = typeof count === 'number' ? count.toLocaleString() : String(count || "");
                            } else if (typeof type === 'string' && type.includes("LikeAction")) {
                                likeCount = typeof count === 'number' ? count.toLocaleString() : String(count || "");
                            }
                        });
                    }

                    console.log('[YT] JSON-LD extracted:', { 
                        title: title?.substring(0, 30), 
                        duration, 
                        uploadDate, 
                        viewCount, 
                        likeCount, 
                        genre 
                    });
                }
            }
        } catch (e) {
            console.warn('[YT] JSON-LD extraction failed:', e.message);
        }

        // Title fallbacks
        if (!title) {
            const titleElem = document.querySelector('h1.ytd-watch-metadata yt-formatted-string');
            if (titleElem) {
                title = titleElem.getAttribute('title') || titleElem.innerText || titleElem.textContent;
            }
        }
        if (!title) {
            const h1Elem = document.querySelector('h1.ytd-watch-metadata');
            if (h1Elem) title = h1Elem.innerText || h1Elem.textContent;
        }
        if (!title) {
            title = document.title.replace(" - YouTube", "").replace("- YouTube", "");
        }
        title = title.trim();

        // Description fallbacks
        if (!fullDescription || fullDescription.length < 50) {
            try {
                const scripts = document.querySelectorAll('script');
                for (let i = 0; i < scripts.length; i++) {
                    const scriptText = scripts[i].textContent;
                    if (scriptText.includes('ytInitialPlayerResponse')) {
                        const match = scriptText.match(/var\s+ytInitialPlayerResponse\s*=\s*({[\s\S]*?});\s*(?:var\s|<\/script>)/);
                        if (match) {
                            const data = JSON.parse(match[1]);
                            fullDescription = data?.videoDetails?.shortDescription || data?.videoDetails?.description || "";
                            if (fullDescription && fullDescription.length > 50) break;
                        }
                    }
                }
            } catch (e) {
                console.warn('[YT] ytInitialPlayerResponse fallback failed:', e.message);
            }
        }
        if (!fullDescription || fullDescription.length < 50) {
            try {
                const playerResp = window.ytInitialPlayerResponse || window['ytInitialPlayerResponse'];
                if (playerResp) {
                    fullDescription = playerResp.videoDetails?.shortDescription || playerResp.videoDetails?.description || "";
                }
            } catch (e) {
                console.warn('[YT] window.ytInitialPlayerResponse failed:', e.message);
            }
        }
        if (!fullDescription || fullDescription.length < 50) {
            const expanderAttrString = document.querySelector('#description-inline-expander yt-attributed-string');
            if (expanderAttrString) {
                fullDescription = expanderAttrString.textContent || expanderAttrString.innerText;
            }
        }

        // Clean up description
        if (fullDescription) {
            fullDescription = fullDescription
                .replace(/\r\n/g, '\n')
                .replace(/\n\s*\n\s*\n/g, '\n\n')
                .replace(/^\s+|\s+$/g, '')
                .replace(/\u00A0/g, ' ')
                .replace(/ {2,}/g, ' ');
        }
        if (!fullDescription || fullDescription.trim().length < 10) {
            fullDescription = "No Description available.";
        }

        // Format duration from ISO 8601 (PT824S → 13:44)
        let formattedDuration = "";
        if (duration) {
            const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
            if (match) {
                const hours = parseInt(match[1] || 0);
                const minutes = parseInt(match[2] || 0);
                const seconds = parseInt(match[3] || 0);
                if (hours > 0) {
                    formattedDuration = `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
                } else {
                    formattedDuration = `${minutes}:${String(seconds).padStart(2, '0')}`;
                }
            }
        }

        // Format upload date
        let formattedDate = uploadDate;
        if (uploadDate) {
            try {
                const dateObj = new Date(uploadDate);
                if (!isNaN(dateObj)) {
                    formattedDate = dateObj.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
                }
            } catch (e) {}
        }

        return { 
            title: title.trim(),
            description: fullDescription.trim(),
            uploadDate: formattedDate,
            duration: formattedDuration,
            thumbnailUrl: thumbnailUrl,
            genre: genre,
            viewCount: viewCount,
            likeCount: likeCount
        };
    }

    async function injectUI() {
        if (document.getElementById('llm-tool-container')) return;
        const target = document.querySelector('#owner');
        if (!target) return;

        const container = document.createElement('div');
        container.id = 'llm-tool-container';
        container.style = "display: inline-flex; align-items: center; margin-left: 10px; gap: 8px; vertical-align: middle;";

        const aiBtn = createBtn('🤖 Summarize', '#065fd4');
        aiBtn.onclick = async () => {
            if (aiBtn.disabled) return;
            const apiKey = await GM.getValue("llm_api_key", "");
            if (!apiKey) return alert("Click ⚙️ to set API Key!");
            
            aiBtn.disabled = true;
            aiBtn.innerText = '⏳ Extracting...';
            try {
                const meta = getVideoMetadata();
                const transcriptData = await getTranscriptData();
                const cleanText = transcriptData.map(item => item.text).join(' ');
                
                aiBtn.innerText = '🚀 Thinking...';
                const prompt = `Video Title: ${meta.title}
Upload Date: ${meta.uploadDate || 'N/A'}
Duration: ${meta.duration || 'N/A'}
Views: ${meta.viewCount || 'N/A'}
Likes: ${meta.likeCount || 'N/A'}
Genre: ${meta.genre || 'N/A'}

Description: ${meta.description}

Transcript: ${cleanText.substring(0, 50000)}`;

                const summary = await fetchSummaryWithPrompt(prompt);
                showSummaryInUI(summary);
                aiBtn.innerText = '✅ Done!';
            } catch (e) { alert(e.message); aiBtn.innerText = '❌ Error'; }
            setTimeout(() => { aiBtn.innerText = '🤖 Summarize'; aiBtn.disabled = false; }, 3000);
        };

        const saveBtn = createBtn('💾 Save .txt', '#2e7d32');
        saveBtn.onclick = async () => {
            saveBtn.innerText = '⏳ Saving...';
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
                const safeFilename = meta.title.replace(/[\\/:*?"<>|]/g, "") || "transcript";
                
                downloadFile(`${safeFilename}.txt`, fileContent);
                saveBtn.innerText = '✅ Saved!';
            } catch (e) { alert(e.message); saveBtn.innerText = '❌ Error'; }
            setTimeout(() => saveBtn.innerText = '💾 Save .txt', 3000);
        };

        const settingsBtn = document.createElement('button');
        settingsBtn.innerText = '⚙️';
        settingsBtn.style = "background: none; border: none; cursor: pointer; font-size: 16px; color: var(--yt-spec-text-primary);";
        settingsBtn.onclick = async () => {
            const currentUrl = await GM.getValue("llm_api_url", "https://openrouter.ai/api/v1/chat/completions");
            const currentKey = await GM.getValue("llm_api_key", "");
            const currentModel = await GM.getValue("llm_model", "google/gemini-2.0-flash-001");

            const newUrl = prompt("API URL:", currentUrl);
            if (newUrl !== null && newUrl.trim() !== "") await GM.setValue("llm_api_url", newUrl.trim());
            const newKey = prompt("API Key:", currentKey);
            if (newKey !== null && newKey.trim() !== "") await GM.setValue("llm_api_key", newKey.trim());
            const newModel = prompt("Model Name:", currentModel);
            if (newModel !== null && newModel.trim() !== "") await GM.setValue("llm_model", newModel.trim());
        };

        container.append(aiBtn, saveBtn, settingsBtn);
        target.appendChild(container);
    }

    async function getTranscriptData() {
        let showBtn = Array.from(document.querySelectorAll('button, tp-yt-paper-button'))
            .find(b => b.innerText?.toLowerCase().includes("show transcript"));

        if (!showBtn) {
            const expand = document.querySelector('tp-yt-paper-button#expand, #expand-theme, #expand');
            if (expand) expand.click();
            await new Promise(r => setTimeout(r, 800));
            showBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText?.toLowerCase().includes("show transcript"));
        }

        if (!showBtn) throw new Error("Transcript button not found.");
        showBtn.click();

        let segments = [];
        let type = "";
        let transcriptContainer = null;

        for (let i = 0; i < 15; i++) {
            await new Promise(r => setTimeout(r, 400));
            
            // Try modern YouTube transcript panel
            transcriptContainer = document.querySelector('ytd-engagement-panel-section-list-renderer ytd-transcript-section-renderer');
            if (transcriptContainer) {
                segments = transcriptContainer.querySelectorAll('transcript-segment-view-model');
                if (segments.length > 0) { type = "modern"; break; }
            }
            
            // Try older YouTube transcript panel
            transcriptContainer = document.querySelector('ytd-transcript-renderer');
            if (!transcriptContainer) {
                transcriptContainer = document.querySelector('ytd-engagement-panel-section-list-renderer');
            }
            if (transcriptContainer) {
                segments = transcriptContainer.querySelectorAll('ytd-transcript-segment-renderer');
                if (segments.length > 0) { type = "polymer"; break; }
            }
            
            // Fallback: document-wide search (least reliable)
            segments = document.querySelectorAll('transcript-segment-view-model');
            if (segments.length > 0) { type = "modern"; break; }
            segments = document.querySelectorAll('ytd-transcript-segment-renderer');
            if (segments.length > 0) { type = "polymer"; break; }
        }

        if (segments.length === 0) throw new Error("Transcript failed to load.");

        return Array.from(segments).map(s => {
            if (type === "modern") {
                return {
                    ts: s.querySelector('.ytwTranscriptSegmentViewModelTimestamp')?.innerText.trim() || "",
                    text: s.querySelector('.yt-core-attributed-string, .ytAttributedStringHost')?.innerText.trim() || ""
                };
            } else {
                return {
                    ts: s.querySelector('.segment-timestamp')?.innerText.trim() || "",
                    text: s.querySelector('.segment-text')?.innerText.trim() || ""
                };
            }
        });
    }

    async function fetchSummaryWithPrompt(prompt) {
        const url = await GM.getValue("llm_api_url", "");
        const key = await GM.getValue("llm_api_key", "");
        const model = await GM.getValue("llm_model", "");

        const systemMessage = "You are a specialized video summarizer. Using the title, metadata, description, and transcript provided, create a comprehensive summary. Format your response using ONLY HTML tags like <p>, <b>, <ul>, <li>. Do not use Markdown.";

        return new Promise((resolve, reject) => {
            GM.xmlHttpRequest({
                method: "POST",
                url: url,
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}`, "HTTP-Referer": "https://youtube.com", "X-Title": "YT Assistant" },
                data: JSON.stringify({
                    model: model,
                    messages: [
                        {role: "system", content: systemMessage},
                        {role: "user", content: prompt}
                    ]
                }),
                onload: (res) => {
                    if (res.status === 200) {
                        const content = JSON.parse(res.responseText).choices?.[0]?.message?.content;
                        content ? resolve(content) : reject(new Error("Empty response from AI."));
                    } else reject(new Error(`API Error ${res.status}: ${res.responseText}`));
                },
                onerror: reject
            });
        });
    }

    function showSummaryInUI(html) {
        let box = document.getElementById('ai-summary-box');
        const cleanHtml = html.replace(/```html/gi, '').replace(/```/g, '').trim();

        if (!box) {
            box = document.createElement('div');
            box.id = 'ai-summary-box';
            box.style = "background: var(--yt-spec-badge-chip-background, #f2f2f2); color: var(--yt-spec-text-primary, #0f0f0f); padding: 16px; margin-top: 15px; border-radius: 12px; font-family: Roboto, Arial, sans-serif; font-size: 14px; line-height: 1.6; border: 1px solid var(--yt-spec-10-percent-layer, #ccc);";
            
            box.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; font-weight:600; margin-bottom:8px;">
                    <span>✨ AI Summary</span>
                    <div style="display:flex; gap:12px;">
                        <button id="ai-copy" title="Copy" style="background:none; border:none; cursor:pointer; font-size:16px;">📋</button>
                        <button id="ai-fold" title="Toggle" style="background:none; border:none; cursor:pointer; font-size:14px;">▼</button>
                    </div>
                </div>
                <hr style="border:0; height:1px; background:var(--yt-spec-10-percent-layer, #ccc); margin:0 0 12px 0;">
                <div id="ai-summary-content"></div>
            `;
            
            const anchor = document.querySelector('#above-the-fold') || document.querySelector('#meta');
            anchor.prepend(box);

            box.querySelector('#ai-fold').onclick = () => {
                const c = box.querySelector('#ai-summary-content');
                const hr = box.querySelector('hr');
                const isHidden = c.style.display === 'none';
                c.style.display = isHidden ? 'block' : 'none';
                hr.style.display = isHidden ? 'block' : 'none';
                box.querySelector('#ai-fold').innerText = isHidden ? '▼' : '▶';
            };

            box.querySelector('#ai-copy').onclick = () => {
                navigator.clipboard.writeText(box.querySelector('#ai-summary-content').innerText);
                box.querySelector('#ai-copy').innerText = '✅';
                setTimeout(() => box.querySelector('#ai-copy').innerText = '📋', 2000);
            };
        }

        box.querySelector('#ai-summary-content').innerHTML = cleanHtml;
        box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function createBtn(text, color) {
        const b = document.createElement('button');
        b.innerText = text;
        b.style = `background: ${color}; color: white; border: none; padding: 6px 14px; border-radius: 18px; cursor: pointer; font-weight: 500; font-size: 12px;`;
        return b;
    }

    function downloadFile(filename, text) {
        const element = document.createElement('a');
        element.href = URL.createObjectURL(new Blob([text], {type: 'text/plain'}));
        element.download = filename;
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
    }

    setInterval(injectUI, 2000);
})();
