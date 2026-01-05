import OpenAI from "https://esm.run/openai";

let ai = null;

/* 공통: AI 초기화 */
function initAI(key) {
    ai = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: key,
        dangerouslyAllowBrowser: true,
        defaultHeaders: {
            "HTTP-Referer": location.origin,
            "X-Title": "WordLearningApp"
        }
    });
    window.GEMINI_KEY = key;
}

/* 공통: API 키 Ping 테스트 */
async function verifyApiKey(key) {
    const tempAI = new OpenAI({
        dangerouslyAllowBrowser: true,
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: key
    });

    const res = await tempAI.chat.completions.create({
        model: "google/gemma-3-27b-it:free",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 5
    });

    return !!res.choices?.length;
}

/* 설정창 저장 버튼 */
const inputField = document.getElementById("settingsApiKey");
const saveBtn = document.getElementById("saveApiKeyBtn");

saveBtn.addEventListener("click", async () => {
    const key = inputField.value.trim();
    if (!key) return myAlert("API 키를 입력하세요!");

    try {
        await verifyApiKey(key);
        localStorage.setItem("userApiKey", key);
        initAI(key);
        myAlert("API 키 정상 확인, 저장 완료!");
        document.getElementById("apiKeyPrompt")?.style && (document.getElementById("apiKeyPrompt").style.display = "none");
    } catch (err) {
        console.error(err);
        myAlert("API 키가 유효하지 않습니다.");
    }
});

/* 팝업용 저장 */
window.saveUserApiKey = async function () {
    const key = document.getElementById("popupApiKey").value.trim();
    if (!key) return myAlert("OpenRouter API 키를 입력하세요!");

    try {
        await verifyApiKey(key);
        localStorage.setItem("userApiKey", key);
        initAI(key);
        myAlert("API 키 정상 확인, 저장 완료!");
        document.getElementById("apiKeyPrompt").style.display = "none";
    } catch (err) {
        console.error(err);
        myAlert("API 키가 유효하지 않습니다.");
    }
};

/* 페이지 로드시 기존 키 복원 */
const savedKey = localStorage.getItem("userApiKey");
if (savedKey) {
    initAI(savedKey);
}

/* ================= AI 기능 ================= */

window.checkAI = async function (userMean, correctMean, word) {
    if (!ai) return false;
    if (!userMean) return false;
    if (userMean.replace(/\s/g, '') === correctMean.replace(/\s/g, '')) return true;

    try {
        const res = await ai.chat.completions.create({
            model: "google/gemma-3-27b-it:free",
            messages: [
                {
                    role: "user",
                    content: `Is "${userMean}" a correct meaning for "${word}"? Definition: "${correctMean}". Reply only true or false.`
                }
            ],
            temperature: 0,
            max_tokens: 5
        });
        console.log(res.choices[0].message.content.trim().toLowerCase());
        return res.choices[0].message.content.trim().toLowerCase() === "true";
    } catch {
        return correctMean.includes(userMean) || userMean.includes(correctMean);
    }
};

window.generateWithGemini = async function (dbRef) {
    if (!ai) return;
    let data = {};
    try {
        const res = await ai.chat.completions.create({
            model: "google/gemma-3-27b-it:free",
            messages: [
                {
                    role: "user",
                    content: `
The purpose is to learn the etymology of an English word.

You must respond with ONLY valid JSON.
Do not use markdown.
Do not add explanations.

Choose an English word that has an interesting etymology.
"desc" must briefly explain the word’s meaning or origin in Korean
(under 100 characters, suitable for etymology learning).

Format:
{"word":"<English word>","desc":"<Korean 설명>"}
`
                }
            ],
            max_tokens: 100
        });

        const raw = res.choices[0].message.content;
        console.log(raw);

        const jsonText = raw.replace(/```json|```/g, "").trim();
        data = JSON.parse(jsonText);

        await dbRef.set({
            ...data,
            createdAt: firebase.database.ServerValue.TIMESTAMP
        });


        window.renderEtymology?.(data.word, data.desc);
    } catch {
        window.renderEtymology?.("Serendipity", "뜻밖의 행운");
    }
};

console.log("AI 모듈(OpenRouter + OpenAI SDK) 로드 완료!");
