import { GoogleGenAI } from "https://esm.run/@google/genai";

let ai = null;

/* 공통: AI 초기화 */
function initAI(key) {
    ai = new GoogleGenAI({ apiKey: key });
    window.GEMINI_KEY = key;
}

/* 공통: API 키 Ping 테스트 */
async function verifyApiKey(key) {
    const tempAI = new GoogleGenAI({ apiKey: key });

    const result = await tempAI.models.countTokens({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: "Hi" }] }],
    });

    return result && result.totalTokens > 0;
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
        let msg = "API 연결 실패";
        if (err.message?.includes("API_KEY_INVALID")) msg += " - 키가 잘못되었습니다.";
        else if (err.message?.includes("429")) msg += " - 사용량 제한";
        else if (err.message?.includes("INTERNAL")) msg += " - 서버 오류";
        myAlert(msg);
    }
});

/* 팝업용 저장 (같은 로직 재사용) */
window.saveUserApiKey = async function () {
    const key = document.getElementById("popupApiKey").value.trim();
    if (!key) return myAlert("Gemini API 키를 입력하세요!");

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
        const res = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: `Is "${userMean}" a correct meaning for "${word}"? Definition: "${correctMean}". Reply only true or false.`,
            config: { temperature: 0, maxOutputTokens: 5 }
        });
        return res.text?.trim().toLowerCase() === "true";
    } catch {
        return correctMean.includes(userMean) || userMean.includes(correctMean);
    }
};

window.generateWithGemini = async function (dbRef) {
    if (!ai) return;

    try {
        const res = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: `{"word":"English","desc":"Korean under 100 chars"}`,
            config: { responseMimeType: "application/json" }
        });

        const data = JSON.parse(res.text);
        await dbRef.set({
            ...data,
            createdAt: firebase.database.ServerValue.TIMESTAMP
        });

        window.renderEtymology?.(data.word, data.desc);
    } catch {
        window.renderEtymology?.("Serendipity", "뜻밖의 행운");
    }
};

console.log("AI 모듈 로드 완료!");
