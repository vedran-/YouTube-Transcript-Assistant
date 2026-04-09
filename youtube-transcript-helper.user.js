// ==UserScript==
// @name         YouTube Transcript: Save & AI (Greasemonkey)
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  Extracts transcript, saves as .txt, and displays AI summary in-page
// @author       You
// @match        https://www.youtube.com/watch*
// @grant        GM.xmlHttpRequest
// @grant        GM.setValue
// @grant        GM.getValue
// ==/UserScript==

(async function() {
    'use strict';

    async function injectUI() {
        if (document.getElementById('llm-tool-container')) return;
        const target = document.querySelector('#owner');
        if (!target) return;

        const container = document.createElement('div');
        container.id = 'llm-tool-container';
        container.style = "display: inline-flex; align-items: center; margin-left: 10px; gap: 8px; vertical-align: middle;";

        const aiBtn = createBtn('🤖 Summarize', '#065fd4');
        aiBtn.onclick = async () => {
            const apiKey = await GM.getValue("llm_api_key", "");
            if (!apiKey) return alert("Click ⚙️ to set API Key!");
            
					aiBtn.disabled = true; // Disable until finished
          aiBtn.innerText = '⏳ Extracting...';
            try {
                const transcriptData = await getTranscriptData();
                const cleanText = transcriptData.map(item => item.text).join(' ');
                
                aiBtn.innerText = '🚀 Thinking...';
                const summary = await fetchSummary(cleanText);
                showSummaryInUI(summary);
                aiBtn.innerText = '✅ Done!';
            } catch (e) { alert(e.message); aiBtn.innerText = '❌ Error'; aiBtn.disabled = false; }
            setTimeout(() => aiBtn.innerText = '🤖 Summarize', 3000);
        };

        const saveBtn = createBtn('💾 Save .txt', '#2e7d32');
        saveBtn.onclick = async () => {
            saveBtn.innerText = '⏳ Extracting...';
            try {
                const transcriptData = await getTranscriptData();
                const formattedText = transcriptData.map(item => `[${item.ts}] ${item.text}`).join('\n');
                const videoTitle = document.querySelector('h1.ytd-video-primary-info-renderer, ytd-watch-metadata h1')?.innerText.replace(/[\\/:*?"<>|]/g, "") || "transcript";
                downloadFile(`${videoTitle}.txt`, formattedText);
                saveBtn.innerText = '✅ Saved!';
            } catch (e) { alert(e.message); saveBtn.innerText = '❌ Error'; }
            setTimeout(() => saveBtn.innerText = '💾 Save .txt', 3000);
        };

        const settingsBtn = document.createElement('button');
        settingsBtn.innerText = '⚙️';
        settingsBtn.style = "background: none; border: none; cursor: pointer; font-size: 16px;";
				settingsBtn.onclick = async () => {
            const currentUrl = await GM.getValue("llm_api_url", "https://openrouter.ai/api/v1/chat/completions");
            const currentKey = await GM.getValue("llm_api_key", "");
            const currentModel = await GM.getValue("llm_model", "stepfun/step-3.5-flash:free");

            const newUrl = prompt("LLM API URL:", currentUrl);
            // Only update if User didn't click Cancel (null) and didn't leave it empty
            if (newUrl !== null && newUrl.trim() !== "") {
                await GM.setValue("llm_api_url", newUrl.trim());
            }

            const newKey = prompt("API Key:", currentKey);
            if (newKey !== null && newKey.trim() !== "") {
                await GM.setValue("llm_api_key", newKey.trim());
            }

            const newModel = prompt("Model Name:", currentModel);
            if (newModel !== null && newModel.trim() !== "") {
                await GM.setValue("llm_model", newModel.trim());
            }
        };

        container.append(aiBtn, saveBtn, settingsBtn);
        target.appendChild(container);
    }

		function showSummaryInUI(text) {
        let box = document.getElementById('ai-summary-box');

        // Strip markdown code blocks just in case the LLM forgets and wraps the HTML
        const cleanHtml = text.replace(/```html/gi, '').replace(/```/g, '').trim();

        if (!box) {
            box = document.createElement('div');
            box.id = 'ai-summary-box';
            // Uses YouTube's native CSS variables for perfect dark/light mode integration
            box.style = "background: var(--yt-spec-badge-chip-background, #f2f2f2); color: var(--yt-spec-text-primary, #0f0f0f); padding: 16px; margin-top: 15px; border-radius: 12px; font-family: Roboto, Arial, sans-serif; font-size: 14px; line-height: 1.6; border: 1px solid var(--yt-spec-10-percent-layer, #ccc);";
            
            // Header Container
            const header = document.createElement('div');
            header.style = "display: flex; justify-content: space-between; align-items: center; font-size: 16px; font-weight: 600; margin-bottom: 8px;";
            header.innerHTML = "<span>✨ AI Summary</span>";
            
            // Controls (Copy & Fold)
            const controls = document.createElement('div');
            controls.style = "display: flex; gap: 12px; align-items: center;";
            
            const copyBtn = document.createElement('button');
            copyBtn.innerText = '📋';
            copyBtn.title = "Copy Summary";
            copyBtn.style = "background: none; border: none; cursor: pointer; color: var(--yt-spec-text-primary); font-size: 16px; padding: 0;";
            
            const foldBtn = document.createElement('button');
            foldBtn.innerText = '▼';
            foldBtn.title = "Toggle Summary";
            foldBtn.style = "background: none; border: none; cursor: pointer; color: var(--yt-spec-text-primary); font-size: 14px; padding: 0;";
            
            controls.append(copyBtn, foldBtn);
            header.appendChild(controls);
            
            const divider = document.createElement('hr');
            divider.style = "border: 0; height: 1px; background: var(--yt-spec-10-percent-layer, #ccc); margin: 0 0 12px 0;";
            
            const content = document.createElement('div');
            content.id = 'ai-summary-content';
            
            // --- Interactivity ---
            foldBtn.onclick = () => {
                if (content.style.display === 'none') {
                    content.style.display = 'block';
                    divider.style.display = 'block';
                    foldBtn.innerText = '▼';
                } else {
                    content.style.display = 'none';
                    divider.style.display = 'none';
                    foldBtn.innerText = '▶';
                }
            };

            copyBtn.onclick = () => {
                // Copies the rendered text, ignoring HTML tags
                navigator.clipboard.writeText(content.innerText);
                copyBtn.innerText = '✅';
                setTimeout(() => copyBtn.innerText = '📋', 2000);
            };
            
            box.append(header, divider, content);
            
            const anchor = document.querySelector('#above-the-fold') || document.querySelector('#meta');
            anchor.prepend(box);
        }

        const contentDiv = document.getElementById('ai-summary-content');
        contentDiv.innerHTML = cleanHtml;
        
        // Ensure it unfolds if you generate a new summary while it's closed
        contentDiv.style.display = 'block';
        box.querySelector('hr').style.display = 'block';
        box.querySelector('button[title="Toggle Summary"]').innerText = '▼';

        box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    async function fetchSummary(text) {
        const url = await GM.getValue("llm_api_url", "");
        const key = await GM.getValue("llm_api_key", "");
        const model = await GM.getValue("llm_model", "");

        const safeText = text.length > 60000 ? text.substring(0, 60000) + "... [Truncated]" : text;

        // Note the updated prompt demanding strictly HTML output
        const prompt = `You are an expert content analyzer. Provide a concise yet comprehensive summary of this video transcript. Focus on core messages and key takeaways. Ignore ads/fillers. 

IMPORTANT: Format your response ENTIRELY in clean HTML. Use <p>, <b>, <ul>, <li>, and <br> tags for readability. Do NOT use Markdown, asterisks, or wrap the output in code blocks. 

Transcript: 
${safeText}`;

        return new Promise((resolve, reject) => {
            GM.xmlHttpRequest({
                method: "POST",
                url: url,
                headers: { 
                    "Content-Type": "application/json", 
                    "Authorization": `Bearer ${key}`,
                    "HTTP-Referer": "https://youtube.com",
                    "X-Title": "YT Transcript Assistant"
                },
                data: JSON.stringify({
                    model: model,
                    messages: [{role: "user", content: prompt}]
                }),
                onload: (res) => {
                    if (res.status === 200) {
                        try {
                            const json = JSON.parse(res.responseText);
                            const content = json.choices?.[0]?.message?.content;
                            if (content) resolve(content);
                            else reject(new Error("Unexpected API response format."));
                        } catch (e) {
                            reject(new Error("Failed to parse API response."));
                        }
                    } else {
                        try {
                            const errorJson = JSON.parse(res.responseText);
                            reject(new Error(`API Error ${res.status}: ${errorJson.error?.message || res.statusText}`));
                        } catch (e) {
                            reject(new Error(`API Error ${res.status}: ${res.responseText}`));
                        }
                    }
                },
                onerror: () => reject(new Error("Network Error: Could not reach API."))
            });
        });
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

        // Polling loop to detect which UI version YouTube is using
        for (let i = 0; i < 15; i++) {
            await new Promise(r => setTimeout(r, 400));
            
            // Try Modern View Model (from your first snippet)
            segments = document.querySelectorAll('transcript-segment-view-model');
            if (segments.length > 0) { type = "modern"; break; }
            
            // Try Polymer Renderer (from your second snippet)
            segments = document.querySelectorAll('ytd-transcript-segment-renderer');
            if (segments.length > 0) { type = "polymer"; break; }
        }

        if (segments.length === 0) throw new Error("Transcript failed to load or unsupported UI.");

        return Array.from(segments).map(s => {
            if (type === "modern") {
                return {
                    ts: s.querySelector('.ytwTranscriptSegmentViewModelTimestamp')?.innerText.trim() || "",
                    text: s.querySelector('.yt-core-attributed-string')?.innerText.trim() || ""
                };
            } else {
                // Mapping for the "Polymer" style snippets
                return {
                    ts: s.querySelector('.segment-timestamp')?.innerText.trim() || "",
                    text: s.querySelector('.segment-text')?.innerText.trim() || ""
                };
            }
        });
    }  

    function createBtn(text, color) {
        const b = document.createElement('button');
        b.innerText = text;
        b.style = `background: ${color}; color: white; border: none; padding: 6px 14px; border-radius: 18px; cursor: pointer; font-weight: 500; font-family: Roboto, Arial; font-size: 12px;`;
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
